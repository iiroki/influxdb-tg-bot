import { HttpError, InfluxDB } from '@influxdata/influxdb-client'

export type TagFilter = {
  readonly tag: string
  readonly value: string
}

export type InfluxBucket = {
  readonly id: string
  readonly name: string
  readonly table: number
  readonly retentionPolicy: string
  readonly retentionPeriod: number
  readonly result: string
  readonly organizationID: string
}

export type InfluxMeasurement = {
  readonly _measurement: string
}

export type InfluxField = {
  readonly _field: string
}

export type InfluxValue = {
  readonly _value: string
}

export type InfluxRow = InfluxMeasurement & InfluxField & InfluxValue & {
  readonly _time: string // UTC
  readonly result: string
  readonly table: number
  readonly [key: string]: string | number
}

const INFLUX_URL = process.env.INFLUX_URL
const INFLUX_TOKEN = process.env.INFLUX_TOKEN
const INFLUX_ORG = process.env.INFLUX_ORG

if (!INFLUX_URL || !INFLUX_TOKEN || !INFLUX_ORG) {
  throw new Error('InfluxDB env variables not provided, see README.md.')
}

const queryApi = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN }).getQueryApi(INFLUX_ORG)

const getBuckets = async (): Promise<InfluxBucket[]> => (
  queryApi.collectRows<InfluxBucket>('buckets()')
)

const getMeasurements = async (bucket: string, days = 30): Promise<InfluxMeasurement[] | null> => {
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${days}d)
      |> keys()
      |> keep(columns: ["_measurement"])
      |> distinct(column: "_measurement")
  `

  try {
    return await queryApi.collectRows<InfluxMeasurement>(query)
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 404) {
      return null
    }

    throw err
  }
}

const getFields = async (bucket: string, measurement: string, days = 30): Promise<string[] | null> => {
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${days}d)
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> group(columns: ["_field"])
      |> distinct(column: "_field")
  `

  try {
    const rows = await queryApi.collectRows<InfluxField>(query)
    return rows.map(r => r._field)
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 404) {
      return null
    }

    throw err
  }
}

const getTags = async (bucket: string, measurement: string, days = 30): Promise<string[] | null> => {
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${days}d)
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> keys()
      |> group()
      |> distinct()
  `

  try {
    const rows = await queryApi.collectRows<InfluxValue>(query)
    return rows.map(r => r._value).filter(c => !c.startsWith('_'))
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 404) {
      return null
    }

    throw err
  }
}

const getTagValues = async (bucket: string, measurement: string, tag: string, days = 30): Promise<string[] | null> => {
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${days}d)
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> keyValues(keyColumns: ["${tag}"])
      |> group()
      |> distinct()
  `

  try {
    const rows = await queryApi.collectRows<InfluxValue>(query)
    return rows.map(r => r._value).filter(c => !c.startsWith('_'))
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 404) {
      return null
    }

    throw err
  }
}

const getLastValue = async (bucket: string, measurement: string, field: string, tagFilters: TagFilter[], days = 30): Promise<InfluxRow[] | null> => {
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${days}d)
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> filter(fn: (r) => ${tagFilters.map(f => `r["${f.tag}"] == "${f.value}"`).join(' and ')})
      |> filter(fn: (r) => r["_field"] == "${field}")
      |> last()
  `

  try {
    return await queryApi.collectRows<InfluxRow>(query)
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 404) {
      return null
    }

    throw err
  }
}

export default {
  getBuckets,
  getMeasurements,
  getFields,
  getTags,
  getTagValues,
  getLastValue
}
