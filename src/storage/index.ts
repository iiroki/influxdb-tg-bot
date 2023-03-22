import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { randomUUID as uuid4 } from 'crypto'
import { Action, ActionInput, Storage, StorageValidator, User } from './model'

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
}

const createUserIfNotExists = async (userId: number): Promise<void> => {
  if (!userExists(userId)) {
    storage.push({ id: userId, actions: [] })
    await persist()
  }
}

const getActions = (userId: number): Action[] => getUser(userId).actions

const addAction = async (userId: number, action: ActionInput): Promise<void> => {
  const user = getUser(userId)
  user.actions.push({ ...action, id: uuid4() })
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

// INTERNAL

const userExists = (userId: number): boolean => storage.some(u => u.id === userId)

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
  userExists
}
