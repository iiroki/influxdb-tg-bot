import { Context, NarrowedContext, Telegraf } from 'telegraf'
import { InlineKeyboardButton, InlineKeyboardMarkup, Message, Update } from 'telegraf/types'
import { z, ZodError } from 'zod'
import { ChartConfigValidator, createChart } from './chart'
import influx from './influx'
import { InfluxIntervalReadData, InfluxIntervalReader } from './influx/interval'
import {
  InfluxAggregateParamsValidator,
  InfluxTagParamsValidator,
  InfluxTimespanParamsValidator,
  InfluxTagFilter
} from './influx/model'
import {
  createMdBlock,
  createMdHeader,
  toInfluxTableTagMdList,
  toInfluxRowMdList,
  toMdList,
  toInfluxTimestampDistanceMd,
  formatObject
} from './format'
import storage from './storage'
import { divideToInfluxTables, getValueOperatorFunc, stripQuotes, toArrayOrUndefined } from './util'
import { VOCABULARY as V } from './vocabulary'

type MessageContext = NarrowedContext<Context<Update>, Update.MessageUpdate<Message.TextMessage>>
type CallbackContext = NarrowedContext<Context<Update>, Update.CallbackQueryUpdate>

const TG_API_TOKEN = process.env.TG_API_TOKEN
const TG_ALLOWED_USERNAMES = process.env.TG_ALLOWED_USERNAMES?.split(',') ?? []
const ERROR_PREFIX = '[ERROR]'

enum Command {
  Start = 'start',
  Help = 'help',
  Buckets = 'buckets',
  Measurements = 'measurements',
  Fields = 'fields',
  Tags = 'tags',
  Tag = 'tag',
  Get = 'get',
  Chart = 'chart',
  Actions = 'actions',
  ActionsAdd = 'actions_add',
  ActionsGet = 'actions_get',
  ActionsRemove = 'actions_remove',
  Notifications = 'notifications',
  NotificationsAdd = 'notifications_add',
  NotificationsRemove = 'notifications_remove'
}

export class InfluxTelegramBot {
  private readonly bot: Telegraf
  private readonly allowedUsernames = new Set(TG_ALLOWED_USERNAMES)
  private readonly intervalReader = new InfluxIntervalReader()

  constructor() {
    if (!TG_API_TOKEN) {
      throw new Error('Telegram API token is not provided')
    }

    this.bot = new Telegraf(TG_API_TOKEN)
    process.on('SIGINT', () => {
      this.bot.stop('SIGINT')
      this.log('Stopped.')
    })

    // Validate the user who sent the message
    this.bot.use(async (ctx, next) => {
      const user = ctx.message?.from ?? ctx.callbackQuery?.from
      const username = user?.username
      if (!username || !this.allowedUsernames.has(username)) {
        // TODO: This is currently triggered by edited messages
        await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} ${V['telegram.unauthorized-user']}}`))
      } else {
        if (ctx.message) {
          await storage.createUserIfNotExists(ctx.message.from.id, ctx.message.chat.id)
        }

        await next()
      }
    })

    // Log incoming message
    this.bot.use(async (ctx, next) => {
      if (ctx.message && 'text' in ctx.message) {
        this.log(`Received message from "${ctx.message.from.username}": "${ctx.message.text}"`)
      }

      await next()
    })

    this.bot.catch((err, ctx) => {
      this.log(`Unhandled error: ${ctx}`, err)
      if (err instanceof ZodError) {
        ctx.replyWithMarkdownV2(
          createMdBlock(`${createMdHeader(`${ERROR_PREFIX} ${V['telegram.invalid-config']}`)}\n${err.message}`)
        )
      } else {
        ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} ${V['telegram.unknown-error']}`))
      }
    })

    // Commands
    this.bot.command('start', this.handleGetHelp.bind(this))
    this.bot.command('help', this.handleGetHelp.bind(this))
    this.bot.command('buckets', this.handleGetBuckets.bind(this))
    this.bot.command('measurements', this.handleGetMeasurements.bind(this))
    this.bot.command('fields', this.handleGetFields.bind(this))
    this.bot.command('tags', this.handleGetTags.bind(this))
    this.bot.command('tag', this.handleGetTagValues.bind(this))
    this.bot.command('get', this.handleGetValues.bind(this))
    this.bot.command('chart', this.handleGetChart.bind(this))
    this.bot.command('actions', this.handleRunAction.bind(this))
    this.bot.command('actions_add', this.handleAddAction.bind(this))
    this.bot.command('actions_remove', this.handleRemoveAction.bind(this))
    this.bot.command('actions_get', this.handleGetAction.bind(this))
    this.bot.command('notifications', this.handleGetNotification.bind(this))
    this.bot.command('notifications_add', this.handleAddNotification.bind(this))
    this.bot.command('notifications_remove', this.handleRemoveNotification.bind(this))

    // Actions
    this.bot.action(/^actions_run\/.+$/, this.handleRunActionCallback.bind(this))
    this.bot.action(/^actions_remove\/.+$/, this.handleRemoveActionCallback.bind(this))
    this.bot.action(/^actions_get\/.+$/, this.handleGetActionCallback.bind(this))
    this.bot.action(/^notifications_get\/.+$/, this.handleGetNotificationCallback.bind(this))
    this.bot.action(/^notifications_remove\/.+$/, this.handleRemoveNotificationCallback.bind(this))

    // Unknown
    this.bot.on('text', async ctx => ctx.replyWithMarkdownV2(
      createMdBlock(`${ERROR_PREFIX} ${V['telegram.unknown-command']}`)
    ))

    // Notifications
    this.intervalReader.on('data', this.handleNotificationValue.bind(this))

    this.log(`Initialized for users: ${TG_ALLOWED_USERNAMES.join(', ')}`)
  }

  async start() {
    await storage.init()
    this.intervalReader.init(storage.getAllNotifications())
    this.bot.launch()
    this.log('Started.')

    // Set command help
    this.bot.telegram.setMyCommands(Object.values(Command).map(c => ({
      command: c, description: V[`telegram.command.${c}`]
    })))
  }

  private async handleGetHelp(ctx: MessageContext) {
    await ctx.replyWithMarkdownV2(
      `${createMdBlock(createMdHeader(V['telegram.help']))}[GitHub \\- Commands](https://github.com/iiroki/influxdb-tg-bot#commands)`
    )
  }

  private async handleGetBuckets(ctx: MessageContext) {
    const buckets = await influx.getBuckets()
    await ctx.replyWithMarkdownV2(toMdList(buckets.map(b => b.name), V['influx.buckets']))
  }

  private async handleGetMeasurements(
    ctx: MessageContext
  ) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 1) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/measurements <bucket> [<config>]'))
    }
    
    const [bucket, configStr] = params
    const config = InfluxTimespanParamsValidator.parse(this.parseConfig(configStr))
    const measurements = await influx.getMeasurements(bucket, config)
    if (!measurements) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} ${V['influx.measurements-not-found']}`))
    }

    await ctx.replyWithMarkdownV2(toMdList(measurements.map(m => m._measurement), V['influx.measurements']))
  }

  private async handleGetFields(ctx: MessageContext) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 2) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/fields <bucket> <measurement> [<config>]'))
    }

    const [bucket, measurement, configStr] = params
    const config = InfluxTimespanParamsValidator.parse(this.parseConfig(configStr))
    const fields = await influx.getFields(bucket, measurement, config)
    if (!fields) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} ${V['influx.fields-not-found']}}`))
    }

    await ctx.replyWithMarkdownV2(toMdList(fields, V['influx.fields']))
  }

  private async handleGetTags(ctx: MessageContext) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 2) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/tags <bucket> <measurement> [<config>]'))
    }

    const [bucket, measurement, configStr] = params
    const config = InfluxTimespanParamsValidator.parse(this.parseConfig(configStr))
    const tags = await influx.getTags(bucket, measurement, config)
    if (!tags) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} ${V['influx.tags-not-found']}}}`))
    }

    await ctx.replyWithMarkdownV2(toMdList(tags, V['influx.tags']))
  }

  private async handleGetTagValues(ctx: MessageContext) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 3) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/tag <bucket> <measurement> <tag> [<config>]'))
    }

    const [bucket, measurement, tag, configStr] = params
    const config = InfluxTimespanParamsValidator.parse(this.parseConfig(configStr))
    const tagValues = await influx.getTagValues(bucket, measurement, tag, config)
    if (!tagValues) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} ${V['influx.tags-values-not-found']}`))
    }

    await ctx.replyWithMarkdownV2(toMdList(tagValues, V['influx.tag-values'](tag)))
  }

  private async handleGetValues(ctx: MessageContext) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 4) {
      return await ctx.replyWithMarkdownV2(
        this.createUsageText('/get <bucket> <measurement> <field> <where> [<config>]')
      )
    }

    const [bucket, measurement, field, whereStr, configStr] = params
    const where = this.parseWhere(whereStr)
    const config = InfluxTagParamsValidator.parse(this.parseConfig(configStr))
    const rows = await influx.getLastValue(bucket, measurement, field, where, config)
    if (!rows || rows.length === 0) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} ${V['influx.values-not-found']}`))
    }

    await ctx.replyWithMarkdownV2(
      toInfluxRowMdList(rows, { header: V['influx.values'], tags: toArrayOrUndefined(config.tags) })
    )
  }

  private async handleGetChart(ctx: MessageContext) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 4) {
      return await ctx.replyWithMarkdownV2(
        this.createUsageText('/chart <type> <bucket> <measurement> <field> <where> [<config>]')
      )
    }

    const [typeStr, bucket, measurement, field, whereStr, configStr] = params
    const type = z.union([z.literal('line'), z.literal('bar')]).parse(typeStr)
    const where = this.parseWhere(whereStr)
    const config = InfluxAggregateParamsValidator.and(ChartConfigValidator).parse(this.parseConfig(configStr))
    const rows = await influx.getValuesFromTimespan(bucket, measurement, field, where, config)
    if (!rows || rows.length === 0) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} ${V['influx.values-not-found']}`))
    }

    const tables = divideToInfluxTables(rows)
    const source = await createChart(type, tables, config)
    if (!source) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} ${V['telegram.chart-error']}`))
    }

    const caption = toInfluxTableTagMdList(tables, {
      header: V['telegram.chart-tags'],
      tags: toArrayOrUndefined(config.tags)
    })

    await ctx.replyWithPhoto({ source }, { caption, parse_mode: 'MarkdownV2' })
  }

  private async handleRunAction(ctx: MessageContext) {
    await ctx.replyWithMarkdownV2(
      createMdBlock(createMdHeader(V['telegram.actions-run'])),
      { reply_markup: this.createActionKeyboard(ctx.message.from.id, 'run') }
    )
  }

  private async handleAddAction(ctx: MessageContext) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 2) {
      await ctx.replyWithMarkdownV2(this.createUsageText('/actions_add <name> <command...>'))
      return
    }

    const [rawName, ...rest] = params
    const name = stripQuotes(rawName)
    await storage.addAction(ctx.message.from.id, { name, command: stripQuotes(rest.join(' ')) })
    await ctx.replyWithMarkdownV2(createMdBlock(`${createMdHeader(V['telegram.action-added'])}\n${name}`),)
  }

  private async handleRemoveAction(ctx: MessageContext) {
    await ctx.replyWithMarkdownV2(
      createMdBlock(createMdHeader(V['telegram.actions-remove'])),
      { reply_markup: this.createActionKeyboard(ctx.message.from.id, 'remove') }
    )
  }

  private async handleGetAction(ctx: MessageContext) {
    await ctx.replyWithMarkdownV2(
      createMdBlock(createMdHeader(V['telegram.actions-get'])),
      { reply_markup: this.createActionKeyboard(ctx.message.from.id, 'get') }
    )
  }

  private async handleGetNotification(ctx: MessageContext) {
    await ctx.replyWithMarkdownV2(
      createMdBlock(createMdHeader(V['telegram.notifications-get'])),
      { reply_markup: this.createNotificationKeyboard(ctx.message.from.id, 'get') }
    )
  }
  private async handleAddNotification(ctx: MessageContext) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 8) {
      await ctx.replyWithMarkdownV2(this.createUsageText(
        '/notifications_add <name> <operator> <value> <intervalSeconds> <bucket> <measurement> <field> <where>'
      ))

      return
    }

    const [rawName, operator, value, intervalSeconds, bucket, measurement, field, where] = params
    const name = stripQuotes(rawName)
    const notification = await storage.addNotification(ctx.message.from.id, {
      name,
      operator,
      value: Number(value),
      intervalMs: Number(intervalSeconds) * 1000,
      bucket,
      measurement,
      field,
      where: this.parseWhere(where)
    })

    this.intervalReader.create(notification)
    await ctx.replyWithMarkdownV2(createMdBlock(`${createMdHeader(V['telegram.notification-added'])}\n${name}`),)
  }

  private async handleRemoveNotification(ctx: MessageContext) {
    await ctx.replyWithMarkdownV2(
      createMdBlock(createMdHeader(V['telegram.notifications-remove'])),
      { reply_markup: this.createNotificationKeyboard(ctx.message.from.id, 'remove') }
    )
  }

  private async handleRunActionCallback(ctx: Context) {
    await ctx.answerCbQuery()
    if (ctx.chat && 'callback_query' in ctx.update && 'data' in ctx.update.callback_query) {
      const { chat } = ctx
      const { data, from } = ctx.update.callback_query
      const actionId = data.split('/')[1]
      const action = storage.getActions(from.id).find(a => a.id === actionId)
      if (!action) {
        await ctx.deleteMessage(ctx.update.callback_query.message?.message_id)
        return
      }

      await ctx.editMessageText(
        createMdBlock(`${createMdHeader(V['telegram.action-running'])}\n${action.name}...`),
        { parse_mode: 'MarkdownV2' }
      )

      // Trigger action = Telegram command
      if (chat.type === 'private' || chat.type === 'group' || chat.type === 'supergroup') {
        const message: Update.New & Update.NonChannel & Message = {
          message_id: 0,
          text: action.command,
          from,
          chat,
          date: new Date().getTime(),
          entities: [{ type: 'bot_command', offset: 0, length: action.command.split(' ')[0].length }]
        }

        await this.bot.handleUpdate({ message, update_id: 0 })
      }
    }
  }

  private async handleRemoveActionCallback(ctx: CallbackContext) {
    await ctx.answerCbQuery()
    if ('data' in ctx.update.callback_query) {
      const { data, from } = ctx.update.callback_query
      const actionId = data.split('/')[1]
      const removed = await storage.removeAction(from.id, actionId)
      if (!removed) {
        await ctx.deleteMessage(ctx.update.callback_query.message?.message_id)
        return
      }

      await ctx.editMessageText(
        createMdBlock(`${createMdHeader(V['telegram.action-removed'])}\n${removed.name}`),
        { parse_mode: 'MarkdownV2' }
      )
    }
  }

  private async handleGetActionCallback(ctx: CallbackContext) {
    await ctx.answerCbQuery()
    if ('data' in ctx.update.callback_query) {
      const { data, from } = ctx.update.callback_query
      const actionId = data.split('/')[1]
      const action = storage.getActions(from.id).find(a => a.id === actionId)
      if (!action) {
        await ctx.deleteMessage(ctx.update.callback_query.message?.message_id)
        return
      }

      await ctx.editMessageText(
        createMdBlock(`${createMdHeader(V['telegram.action'](action.name))}\n${action.command}`),
        { parse_mode: 'MarkdownV2' }
      )
    }
  }

  private async handleGetNotificationCallback(ctx: CallbackContext) {
    await ctx.answerCbQuery()
    if ('data' in ctx.update.callback_query) {
      const { data, from } = ctx.update.callback_query
      const notificationId = data.split('/')[1]
      const notification = storage.getNotifications(from.id).find(a => a.id === notificationId)
      if (!notification) {
        await ctx.deleteMessage(ctx.update.callback_query.message?.message_id)
        return
      }

      const { name, id, ...rest } = notification
      await ctx.editMessageText(
        createMdBlock(`${createMdHeader(V['telegram.notification'](name))}\n${formatObject(rest)}`),
        { parse_mode: 'MarkdownV2' }
      )
    }
  }

  private async handleRemoveNotificationCallback(ctx: CallbackContext) {
    await ctx.answerCbQuery()
    if ('data' in ctx.update.callback_query) {
      const { data, from } = ctx.update.callback_query
      const notificationId = data.split('/')[1]
      const removed = await storage.removeNotification(from.id, notificationId)
      if (!removed) {
        await ctx.deleteMessage(ctx.update.callback_query.message?.message_id)
        return
      }

      await ctx.editMessageText(
        createMdBlock(`${createMdHeader(V['telegram.notification-removed'])}\n${removed.name}`),
        { parse_mode: 'MarkdownV2' }
      )
    }
  }

  private async handleNotificationValue(data: InfluxIntervalReadData) {
    const notification = storage.getAllNotifications().find(n => n.id === data.id)
    if (notification && data.rows.length > 0) {
      const row = data.rows[0]
      const func = getValueOperatorFunc(notification)
      if (!func(row)) {
        return 
      }

      const user = storage.getNotificationUser(notification.id)
      if (!user) {
        return
      }

      const builder: (string | number)[] = [
        createMdHeader(V['telegram.notification'](notification.name)),
        `${row._value}`,
        `(${toInfluxTimestampDistanceMd(row)})`
      ]

      const message = createMdBlock(builder.join('\n'))
      await this.bot.telegram.sendMessage(user.chatId, message, { parse_mode: 'MarkdownV2' })
      this.intervalReader.remove(data.id)
      storage.removeNotification(user.id, notification.id)
    } else {
      this.log('Unknown notification (removing...)', data.id)
      this.intervalReader.remove(data.id)
    }
  }

  private createActionKeyboard(userId: number, method: 'run' | 'remove' | 'get'): InlineKeyboardMarkup {
    const actions = storage.getActions(userId)
    const buttons: InlineKeyboardButton[] = actions.map(a => ({
      text: a.name,
      callback_data: `actions_${method}/${a.id}`
    }))

    return { inline_keyboard: buttons.map(b => [b]) }
  }

  private createNotificationKeyboard(userId: number, method: 'remove' | 'get'): InlineKeyboardMarkup {
    const notifications = storage.getNotifications(userId)
    const buttons: InlineKeyboardButton[] = notifications.map(n => ({
      text: n.name,
      callback_data: `notifications_${method}/${n.id}`
    }))

    return { inline_keyboard: buttons.map(b => [b]) }
  }

  // Source: https://stackoverflow.com/a/16261693
  private getCommandParams(text?: string): string[] {
    return text ? text.match(/(?:[^\s"]+|"[^"]*")+/g)?.slice(1) ?? [] : []
  }

  // Source: https://stackoverflow.com/a/19156525
  private parseWhere(whereStr: string): InfluxTagFilter[] {
    return (whereStr === '*' ? [] : whereStr.split(',')).map(f => {
      const [tag, value] = f.split('=')
      // TODO: Handle undefined "tag"/"value"
      return { tag, value: stripQuotes(value) }
    })
  }

  private parseConfig(str: string): Record<string, string | string[]> {
    const config: Record<string, string | string[]> = {}
    if (!str) {
      return config
    }

    // Example: "tagFilter=tag1,tag2;start=7d"
    for (const item of str.split(';')) {
      // Example: "tagFilter=tag1,tag2" or "start=7d"
      const [key, valueWithQuotes] = item.split('=')
      if (!valueWithQuotes) {
        continue
      }

      const value = valueWithQuotes.replace(/^"(.*)"$/, '$1')
      if (key && value) {
        config[key] = value.includes(',') ? value.split(',') : value
      }
    }

    return config
  }

  private createUsageText(usage: string): string {
    return createMdBlock(`${createMdHeader(`${ERROR_PREFIX} ${V['telegram.usage']}`)}\n${usage}`)
  }

  private log(...args: any[]) {
    console.log(`[InfluxTelegramBot]`, ...args)
  }
}
