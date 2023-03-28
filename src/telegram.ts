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
  toInfluxTimestampDistanceMd
} from './md'
import storage from './storage'
import { divideToInfluxTables, getValueOperatorFunc, stripQuotes, toArrayOrUndefined } from './util'

const TG_API_TOKEN = process.env.TG_API_TOKEN
const TG_ALLOWED_USERNAMES = process.env.TG_ALLOWED_USERNAMES?.split(',') ?? []
const ERROR_PREFIX = '[ERROR]'

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
        await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} Unauthorized user!`))
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
        console.log('!!! CHAT ID:', ctx.message.chat.id)
        this.log(`Received message from "${ctx.message.from.username}": "${ctx.message.text}"`)
      }

      await next()
    })

    this.bot.catch((err, ctx) => {
      this.log(`Unhandled error: ${ctx}`, err)
      if (err instanceof ZodError) {
        ctx.replyWithMarkdownV2(
          createMdBlock(`${createMdHeader(`${ERROR_PREFIX} Invalid configuration`)}\n${err.message}`)
        )
      } else {
        ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} Sorry, an unknown error occurred :(`))
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
    this.bot.command('actions', this.handleActions.bind(this))
    this.bot.command('notifications_add', this.handleAddNotification.bind(this))
    this.bot.command('todo', ctx => {})

    // Actions
    this.bot.action(/^action-run\/.+$/, this.handleRunAction.bind(this))
    this.bot.action(/^action-remove\/.+$/, this.handleRemoveAction.bind(this))
    this.bot.action(/^action-get\/.+$/, this.handleGetAction.bind(this))
    // this.bot.action(/^notification-create\/.+$/, this.handleCreateNotification.bind(this))
    // TODO: Notifications

    // Unknown
    this.bot.on('text', async ctx => ctx.replyWithMarkdownV2(
      createMdBlock(`${ERROR_PREFIX} Beep boop, don\'t undestand...`)
    ))

    // Notifications
    this.intervalReader.on('data', this.handleNotificationData.bind(this))

    this.log(`Initialized for users: ${TG_ALLOWED_USERNAMES.join(', ')}`)
  }

  async start() {
    await storage.init()
    this.intervalReader.init(storage.getAllNotifications())
    this.bot.launch()
    this.log('Started.')
  }

  private async handleGetHelp(ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message.TextMessage>>) {
    await ctx.replyWithMarkdownV2(
      `${createMdBlock(createMdHeader(`Help`))}[GitHub \\- Commands](https://github.com/iiroki/influxdb-tg-bot#commands)`
    )
  }

  private async handleGetBuckets(ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message.TextMessage>>) {
    const buckets = await influx.getBuckets()
    await ctx.replyWithMarkdownV2(toMdList(buckets.map(b => b.name), 'Buckets'))
  }

  private async handleGetMeasurements(
    ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message.TextMessage>>
  ) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 1) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/measurements <bucket> [<config>]'))
    }
    
    const [bucket, configStr] = params
    const config = InfluxTimespanParamsValidator.parse(this.parseConfig(configStr))
    const measurements = await influx.getMeasurements(bucket, config)
    if (!measurements) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} No measurements found.`))
    }

    await ctx.replyWithMarkdownV2(toMdList(measurements.map(m => m._measurement), 'Measurements'))
  }

  private async handleGetFields(ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message.TextMessage>>) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 2) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/fields <bucket> <measurement> [<config>]'))
    }

    const [bucket, measurement, configStr] = params
    const config = InfluxTimespanParamsValidator.parse(this.parseConfig(configStr))
    const fields = await influx.getFields(bucket, measurement, config)
    if (!fields) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} No fields found.`))
    }

    await ctx.replyWithMarkdownV2(toMdList(fields, 'Fields'))
  }

  private async handleGetTags(ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message.TextMessage>>) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 2) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/tags <bucket> <measurement> [<config>]'))
    }

    const [bucket, measurement, configStr] = params
    const config = InfluxTimespanParamsValidator.parse(this.parseConfig(configStr))
    const tags = await influx.getTags(bucket, measurement, config)
    if (!tags) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} No tags found.`))
    }

    await ctx.replyWithMarkdownV2(toMdList(tags, 'Tags'))
  }

  private async handleGetTagValues(ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message.TextMessage>>) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 3) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/tag <bucket> <measurement> <tag> [<config>]'))
    }

    const [bucket, measurement, tag, configStr] = params
    const config = InfluxTimespanParamsValidator.parse(this.parseConfig(configStr))
    const tagValues = await influx.getTagValues(bucket, measurement, tag, config)
    if (!tagValues) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} No tag values found.`))
    }

    await ctx.replyWithMarkdownV2(toMdList(tagValues, `Tag (\`${tag}\`)`))
  }

  private async handleGetValues(ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message.TextMessage>>) {
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
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} No values found.`))
    }

    await ctx.replyWithMarkdownV2(
      toInfluxRowMdList(rows, { header: 'Values', tags: toArrayOrUndefined(config.tags) })
    )
  }

  private async handleGetChart(ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message.TextMessage>>) {
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
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} No values found.`))
    }

    const tables = divideToInfluxTables(rows)
    const source = await createChart(type, tables, config)
    if (!source) {
      return await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} Could not create a chart.`))
    }

    const caption = toInfluxTableTagMdList(tables, {
      header: 'Chart tags',
      tags: toArrayOrUndefined(config.tags)
    })

    await ctx.replyWithPhoto({ source }, { caption, parse_mode: 'MarkdownV2' })
  }

  private async handleActions(ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message.TextMessage>>) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length === 0) {
      await ctx.replyWithMarkdownV2(
        createMdBlock(createMdHeader('Actions')),
        { reply_markup: this.createActionKeyboard(ctx.message.from.id, 'run') }
      )

      return
    }

    const method = params[0]
    if (method === 'add') {
      const [rawName, ...rest] = params.slice(1)
      const name = stripQuotes(rawName)
      await storage.addAction(ctx.message.from.id, { name, command: rest.join(' ') })
      await ctx.replyWithMarkdownV2(createMdBlock(`${createMdHeader('Action added')}\n${name}`),)
    } else if (method === 'remove') {
      await ctx.replyWithMarkdownV2(
        createMdBlock(createMdHeader('Actions (Remove)')),
        { reply_markup: this.createActionKeyboard(ctx.message.from.id, 'remove') }
      )
    } else if (method === 'get') {
      await ctx.replyWithMarkdownV2(
        createMdBlock(createMdHeader('Actions (Get)')),
        { reply_markup: this.createActionKeyboard(ctx.message.from.id, 'get') }
      )
    } else {
      await ctx.replyWithMarkdownV2(this.createUsageText('/action [<add|remove|get>] [<name>] [<command>]'))
    }
  }

  private async handleAddNotification(ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message.TextMessage>>) {
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
    await ctx.replyWithMarkdownV2(createMdBlock(`${createMdHeader('Notification added')}\n${name}`),)
  }

  private async handleRunAction(ctx: Context) {
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
        createMdBlock(`${createMdHeader('Running')}\n${action.name}...`),
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

  private async handleRemoveAction(ctx: NarrowedContext<Context<Update>, Update.CallbackQueryUpdate>) {
    if ('data' in ctx.update.callback_query) {
      const { data, from } = ctx.update.callback_query
      const actionId = data.split('/')[1]
      const removed = await storage.removeAction(from.id, actionId)
      if (!removed) {
        await ctx.deleteMessage(ctx.update.callback_query.message?.message_id)
        return
      }

      await ctx.editMessageText(
        createMdBlock(`${createMdHeader('Action removed')}\n${removed.name}`),
        { parse_mode: 'MarkdownV2' }
      )
    }
  }

  private async handleGetAction(ctx: NarrowedContext<Context<Update>, Update.CallbackQueryUpdate>) {
    if ('data' in ctx.update.callback_query) {
      const { data, from } = ctx.update.callback_query
      const actionId = data.split('/')[1]
      const action = storage.getActions(from.id).find(a => a.id === actionId)
      if (!action) {
        await ctx.deleteMessage(ctx.update.callback_query.message?.message_id)
        return
      }

      await ctx.editMessageText(
        createMdBlock(`${createMdHeader(`Action (${action.name})`)}\n${action.command}`),
        { parse_mode: 'MarkdownV2' }
      )
    }
  }

  private async handleNotificationData(data: InfluxIntervalReadData) {
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
        createMdHeader(`Notification`),
        `${notification.name}: ${row._value}`,
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
      callback_data: `action-${method}/${a.id}`
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
    return createMdBlock(`${createMdHeader(`${ERROR_PREFIX} Usage`)}\n${usage}`)
  }

  private log(...args: any[]) {
    console.log(`[InfluxTelegramBot]`, ...args)
  }
}
