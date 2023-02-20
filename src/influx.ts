import { HttpError, InfluxDB, QueryApi } from '@influxdata/influxdb-client'

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

export type InfluxKey = {
  readonly _value: string
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
    from(bucket:"${bucket}")
      |> range(start: -${days}d)
      |> group(columns: ["_measurement"])
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
    from(bucket:"${bucket}")
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
    from(bucket:"${bucket}")
      |> range(start: -${days}d)
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> keys()
  `

  try {
    const rows = await queryApi.collectRows<InfluxKey>(query)
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
    from(bucket:"${bucket}")
      |> range(start: -${days}d)
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> keyValues(keyColumns: ["${tag}"])
  `

  try {
    const rows = await queryApi.collectRows<InfluxKey>(query)
    return rows.map(r => r._value).filter(c => !c.startsWith('_'))
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
  getTagValues
}
