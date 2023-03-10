import { Context, Telegraf } from 'telegraf'
import { Message, Update } from 'telegraf/types'
import { z, ZodError } from 'zod'
import { ChartConfigValidator, createChart } from './chart'
import influx from './influx'
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
  toMdList
} from './md'
import { divideToInfluxTables, toArrayOrUndefined } from './util'

type TgMessageUpdate = Context<Update> & {
  readonly message: Message.TextMessage
}

const TG_API_TOKEN = process.env.TG_API_TOKEN
const TG_ALLOWED_USERNAMES = process.env.TG_ALLOWED_USERNAMES?.split(',') ?? []
const ERROR_PREFIX = '[ERROR]'

export class InfluxTelegramBot {
  private readonly bot: Telegraf
  private readonly allowedUsernames = new Set(TG_ALLOWED_USERNAMES)

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
      const username = ctx.message?.from.username
      if (!username || !this.allowedUsernames.has(username)) {
        // TODO: This is currently triggered by edited messages
        await ctx.replyWithMarkdownV2(createMdBlock(`${ERROR_PREFIX} Unauthorized user!`))
      } else {
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

    // Unknown command
    this.bot.on('text', async ctx => ctx.replyWithMarkdownV2(
      createMdBlock(`${ERROR_PREFIX} Beep boop, don\'t undestand...`)
    ))

    this.log(`Initialized for users: ${TG_ALLOWED_USERNAMES.join(', ')}`)
  }

  start() {
    this.bot.launch()
    this.log('Started.')
  }

  private async handleGetHelp(ctx: TgMessageUpdate) {
    await ctx.replyWithMarkdownV2(
      `${createMdBlock(createMdHeader(`Help`))}[GitHub \\- Commands](https://github.com/iiroki/influxdb-tg-bot#commands)`
    )
  }

  private async handleGetBuckets(ctx: TgMessageUpdate) {
    const buckets = await influx.getBuckets()
    await ctx.replyWithMarkdownV2(toMdList(buckets.map(b => b.name), 'Buckets'))
  }

  private async handleGetMeasurements(ctx: TgMessageUpdate) {
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

  private async handleGetFields(ctx: TgMessageUpdate) {
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

  private async handleGetTags(ctx: TgMessageUpdate) {
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

  private async handleGetTagValues(ctx: TgMessageUpdate) {
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

  private async handleGetValues(ctx: TgMessageUpdate) {
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

  private async handleGetChart(ctx: TgMessageUpdate) {
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

  // Source: https://stackoverflow.com/a/16261693
  private getCommandParams(text?: string): string[] {
    return text ? text.match(/(?:[^\s"]+|"[^"]*")+/g)?.slice(1) ?? [] : []
  }

  // Source: https://stackoverflow.com/a/19156525
  private parseWhere(whereStr: string): InfluxTagFilter[] {
    return (whereStr === '*' ? [] : whereStr.split(',')).map(f => {
      const [tag, value] = f.split('=')
      // TODO: Handle undefined "tag"/"value"
      return { tag, value: value.replace(/^"(.*)"$/, '$1') }
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
