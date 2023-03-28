import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { randomUUID as uuid4 } from 'crypto'
import { Action, ActionInput, ActionValidator, Notification, NotificationInput, NotificationValidator, Storage, StorageValidator, User } from './model'

// Very simple storage implementation, because the bot is not meant to be used by many people.
const STORAGE_PATH = process.env.STORAGE_PATH ?? 'storage.json'
const storage: Storage = []

const init = async (): Promise<void> => {
  if (!existsSync(STORAGE_PATH)) {
    await persist()
    return
  }

  const file = await readFile(STORAGE_PATH)
  storage.push(...StorageValidator.parse(JSON.parse(file.toString())))
  storage.forEach(user => user.actions.sort((a, b) => a.name.localeCompare(b.name)))
  await persist() // Ensure that notifications are persisted
}

const createUserIfNotExists = async (userId: number, chatId: number): Promise<void> => {
  if (!userExists(userId)) {
    storage.push({ id: userId, chatId, actions: [], notifications: [] })
    await persist()
  }
}

const getActions = (userId: number): Action[] => getUser(userId).actions

const addAction = async (userId: number, input: ActionInput): Promise<void> => {
  const user = getUser(userId)
  const action = ActionValidator.parse({ ...input, id: uuid4() })
  user.actions.push(action)
  user.actions.sort((a, b) => a.name.localeCompare(b.name))
  await persist()
}

const removeAction = async (userId: number, actionId: string): Promise<Action | null> => {
  const user = getUser(userId)
  const i = user.actions.findIndex(a => a.id === actionId)
  if (i !== -1) {
    const action = user.actions[i]
    user.actions.splice(i, 1)
    await persist()
    return action
  }

  return null
}

const getAllNotifications = (): Notification[] => storage.flatMap(u => u.notifications)

const addNotification = async (userId: number, input: NotificationInput): Promise<Notification> => {
  const notification = NotificationValidator.parse({ ...input, id: uuid4() })
  const user = getUser(userId)
  user.notifications.push(notification)
  user.notifications.sort((a, b) => a.name.localeCompare(b.name))
  await persist()
  return notification
}

const removeNotification = async (userId: number, notificationId: string): Promise<Notification | null> => {
  const user = getUser(userId)
  const i = user.notifications.findIndex(a => a.id === notificationId)
  if (i !== -1) {
    const notification = user.notifications[i]
    user.notifications.splice(i, 1)
    await persist()
    return notification
  }

  return null
}

const getNotificationUser = (notificationId: string): User | null => {
  for (const user of storage) {
    if (!!user.notifications.find(n => n.id === notificationId)) {
      return user
    }
  }

  return null
}

const userExists = (userId: number): boolean => storage.some(u => u.id === userId)

// INTERNAL

const getUser = (id: number): User => {
  const user = storage.find(u => u.id === id)
  if (!user) {
    throw new Error(`User not found with ID: ${id}`)
  }

  return user
}

const persist = async (): Promise<void> => writeFile(STORAGE_PATH, JSON.stringify(storage))

export default {
  init,
  createUserIfNotExists,
  getActions,
  addAction,
  removeAction,
  getAllNotifications,
  addNotification,
  removeNotification,
  getNotificationUser,
  userExists
}
