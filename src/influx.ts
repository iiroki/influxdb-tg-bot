import { HttpError, InfluxDB } from '@influxdata/influxdb-client'
import { z } from 'zod'

// Models

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

export type InfluxKey = {
  readonly _value: string
}

export type InfluxValue = {
  readonly _value: number
}

export type InfluxRow = InfluxMeasurement & InfluxField & InfluxValue & {
  readonly _time: string // UTC
  readonly result: string
  readonly table: number
  readonly [key: string]: string | number
}

export type InfluxTimespan = {
  readonly start?: string // InfluxDB time ('7d', '1h', '5m') or ISO date ('2023-02-028T19:00:00Z')
  readonly end?: string // InfluxDB time ('7d', '1h', '5m') or ISO date ('2023-02-028T19:00:00Z')
}

export type InfluxTagParams = InfluxTimespan & {
  readonly tagFilter?: string[]
  readonly tags?: string[]
}

export type InfluxAggregateParams = InfluxTagParams & {
  readonly aggregate?: string // Example: '1h' or '10m
}

export const InfluxDbTimeValidator = z.string().regex(/^-?[0-9]+[d|h|m]$/)

export const InfluxTimespanValidator: z.ZodType<InfluxTimespan> = z.object({
  start: InfluxDbTimeValidator.or(z.string().datetime({ precision: 0 })).optional(),
  end: InfluxDbTimeValidator.or(z.string().datetime({ precision: 0 })).optional()
})

export const InfluxTagParamsValidator: z.ZodType<InfluxTagParams> = InfluxTimespanValidator.and(z.object({
  tagFilter: z.string().array().optional(),
  tags: z.string().array().optional()
}))

export const InfluxAggregateParamsValidator: z.ZodType<InfluxAggregateParams> = InfluxTagParamsValidator.and(z.object({
  aggregateWindow: InfluxDbTimeValidator.optional()
}))

// API

const INFLUX_URL = process.env.INFLUX_URL
const INFLUX_TOKEN = process.env.INFLUX_TOKEN
const INFLUX_ORG = process.env.INFLUX_ORG

if (!INFLUX_URL || !INFLUX_TOKEN || !INFLUX_ORG) {
  throw new Error('InfluxDB env variables not provided, see README.md.')
}

const queryApi = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN }).getQueryApi(INFLUX_ORG)

const createRange = (config: InfluxTimespan): string => {
  const builder: string[] = ['|> range(']

  builder.push(`start: ${config.start ?? '-7d'}`)
  if (config.end) {
    builder.push(`, stop: ${config.end}`)
  }

  return builder.concat(')').join('')
}

const getBuckets = async (): Promise<InfluxBucket[]> => (
  queryApi.collectRows<InfluxBucket>('buckets()')
)

const getMeasurements = async (bucket: string, config: InfluxTimespan): Promise<InfluxMeasurement[] | null> => {
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

const getFields = async (bucket: string, measurement: string, config: InfluxTimespan): Promise<string[] | null> => {
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

const getTags = async (bucket: string, measurement: string, config: InfluxTimespan): Promise<string[] | null> => {
  const query = `
    from(bucket: "${bucket}")
      |${createRange(config)}
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

const getTagValues = async (bucket: string, measurement: string, tag: string, config: InfluxTimespan): Promise<string[] | null> => {
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
  tagFilters: TagFilter[],
  days = 30
): Promise<InfluxRow[] | null> => {
  const tagFilterExpr = tagFilters.length !== 0
    ? tagFilters.map(f => `r["${f.tag}"] == "${f.value}"`).join(' and ')
    : 'true'

  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${days}d)
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> filter(fn: (r) => ${tagFilterExpr})
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
  tagFilters: TagFilter[],
  days = 30,
  aggregateWindow = '1h'
): Promise<InfluxRow[] | null> => {
  const tagFilterExpr = tagFilters.length !== 0
    ? tagFilters.map(f => `r["${f.tag}"] == "${f.value}"`).join(' and ')
    : 'true'

  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${days}d)
      |> filter(fn: (r) => r["_measurement"] == "${measurement}")
      |> filter(fn: (r) => ${tagFilterExpr})
      |> filter(fn: (r) => r["_field"] == "${field}")
      |> aggregateWindow(every: ${aggregateWindow}, fn: mean, createEmpty: false)
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
