import { z } from 'zod'

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

export type InfluxTagFilter = {
  readonly tag: string
  readonly value: string
}

export type InfluxTimespan = {
  readonly start?: string // InfluxDB time ('7d', '1h', '5m') or ISO date ('2023-02-028T19:00:00Z')
  readonly end?: string // InfluxDB time ('7d', '1h', '5m') or ISO date ('2023-02-028T19:00:00Z')
}

export type InfluxTagParams = InfluxTimespan & {
  readonly tags?: string[]
}

export type InfluxAggregateParams = InfluxTagParams & {
  readonly aggregate?: string // Example: '1h' or '10m
  readonly raw?: boolean
}

export const InfluxDbTimeValidator = z.string().regex(/^-?[0-9]+[d|h|m]$/)

export const InfluxTimespanValidator: z.ZodType<InfluxTimespan> = z.object({
  start: InfluxDbTimeValidator.or(z.string().datetime({ precision: 0 })).optional(),
  end: InfluxDbTimeValidator.or(z.string().datetime({ precision: 0 })).optional()
})

export const InfluxTagParamsValidator: z.ZodType<InfluxTagParams> = InfluxTimespanValidator.and(z.object({
  tags: z.string().array().optional()
}))

export const InfluxAggregateParamsValidator: z.ZodType<InfluxAggregateParams> = InfluxTagParamsValidator.and(z.object({
  aggregateWindow: InfluxDbTimeValidator.optional(),
  raw: z.coerce.boolean().optional()
}))
