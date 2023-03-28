import { z } from 'zod'
import { InfluxTagFilter } from '../influx/model'

export type Storage = User[]

export type User = {
  readonly id: number // Telegram user ID
  readonly chatId: number // Telegram chat ID
  readonly actions: Action[]
  readonly notifications: Notification[]
}

export type Action = {
  readonly id: string
  readonly name: string
  readonly command: string
}

export type Notification = {
  readonly id: string
  readonly name: string
  readonly operator: '<' | '>' | '<=' | '>=' | '==' | '!='
  readonly value: number
  readonly intervalMs: number
  readonly bucket: string
  readonly measurement: string
  readonly field: string
  readonly where: InfluxTagFilter[]
}

export type ActionInput = Omit<Action, 'id'>
export type NotificationInput = Omit<Notification, 'id' | 'operator'> & {
  readonly operator: string
}

export const ActionValidator: z.ZodType<Action> = z.object({
  id: z.string().uuid(),
  name: z.string(),
  command: z.string()
})

export const NotificationValidator: z.ZodType<Notification> = z.object({
  id: z.string().uuid(),
  name: z.string(),
  operator: z.union([
    z.literal('<'),
    z.literal('>'),
    z.literal('<='),
    z.literal('>='),
    z.literal('=='),
    z.literal('!=')
  ]),
  value: z.number(),
  intervalMs: z.number().min(1000),
  bucket: z.string(),
  measurement: z.string(),
  field: z.string(),
  where: z.object({
    tag: z.string(),
    value: z.string()
  }).array()
})

export const UserValidator: z.ZodType<User> = z.object({
  id: z.number(),
  chatId: z.number(),
  actions: ActionValidator.array(),
  notifications: NotificationValidator.array().default([])
}) as z.ZodType<User>

export const StorageValidator: z.ZodType<Storage> = UserValidator.array()
