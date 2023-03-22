import { HttpError, InfluxDB } from '@influxdata/influxdb-client'
import {
  InfluxAggregateParams,
  InfluxBucket,
  InfluxField,
  InfluxKey,
  InfluxMeasurement,
  InfluxRow,
  InfluxTagParams,
  InfluxTimespanParams,
  InfluxTagFilter
} from './model'

const INFLUX_URL = process.env.INFLUX_URL
const INFLUX_TOKEN = process.env.INFLUX_TOKEN
const INFLUX_ORG = process.env.INFLUX_ORG

if (!INFLUX_URL || !INFLUX_TOKEN || !INFLUX_ORG) {
  throw new Error('InfluxDB env variables not provided, see README.md.')
}

const queryApi = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN }).getQueryApi(INFLUX_ORG)

const createRange = (config: InfluxTimespanParams): string => {
  const builder: string[] = ['|> range(']

  builder.push(`start: ${config.start ?? '-7d'}`)
  if (config.end) {
    builder.push(`, stop: ${config.end}`)
  }

  return builder.concat(')').join('')
}

const createWhereFilter = (where: InfluxTagFilter[]): string => where.length !== 0
  ? where.map(filter => `r["${filter.tag}"] == "${filter.value}"`).join(' and ')
  : 'true'

const getBuckets = async (): Promise<InfluxBucket[]> => (
  queryApi.collectRows<InfluxBucket>('buckets()')
)

const getMeasurements = async (bucket: string, config: InfluxTimespanParams): Promise<InfluxMeasurement[] | null> => {
  const query = `
    from(bucket: "${bucket}")
      ${createRange(config)}
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

const getFields = async (bucket: string, measurement: string, config: InfluxTimespanParams): Promise<string[] | null> => {
  const query = `
    from(bucket: "${bucket}")
      ${createRange(config)}
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

const getTags = async (bucket: string, measurement: string, config: InfluxTimespanParams): Promise<string[] | null> => {
  const query = `
    from(bucket: "${bucket}")
      ${createRange(config)}
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> keys()
      |> group()
      |> distinct()
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

const getTagValues = async (bucket: string, measurement: string, tag: string, config: InfluxTimespanParams): Promise<string[] | null> => {
  const query = `
    from(bucket: "${bucket}")
      ${createRange(config)}
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> keyValues(keyColumns: ["${tag}"])
      |> group()
      |> distinct()
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

const getLastValue = async (
  bucket: string,
  measurement: string,
  field: string,
  where: InfluxTagFilter[],
  config: InfluxTagParams
): Promise<InfluxRow[] | null> => {
  const query = `
    from(bucket: "${bucket}")
      ${createRange(config)}
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> filter(fn: (r) => ${createWhereFilter(where)})
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

const getValuesFromTimespan = async (
  bucket: string,
  measurement: string,
  field: string,
  where: InfluxTagFilter[],
  config: InfluxAggregateParams
): Promise<InfluxRow[] | null> => {
  const { aggregate, raw } = config
  const query = `
    from(bucket: "${bucket}")
      ${createRange(config)}
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> filter(fn: (r) => ${createWhereFilter(where)})
      |> filter(fn: (r) => r["_field"] == "${field}")
      ${raw ? '' : `|> aggregateWindow(every: ${aggregate ?? '1h'}, fn: mean, createEmpty: false)`}
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
  getLastValue,
  getValuesFromTimespan
}
