import { z } from 'zod'

export type Storage = User[]

export type User = {
  readonly id: number // Telegram ID
  readonly actions: Action[]
  // TODO: Notifications
}

export type Action = {
  readonly id: string
  readonly name: string
  readonly command: string
}

export type ActionInput = Omit<Action, 'id'>

export const StorageValidator: z.ZodType<Storage> = z.object({
  id: z.number(),
  actions: z.object({
    id: z.string(),
    name: z.string(),
    command: z.string()
  }).array()
}).array()
