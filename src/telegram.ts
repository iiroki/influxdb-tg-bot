import { Context, Telegraf } from 'telegraf'
import { Message, Update } from 'telegraf/types'
import { z, ZodError } from 'zod'
import { createLineChart } from './chart'
import influx, { InfluxTimespan, InfluxTimespanValidator, TagFilter } from './influx'
import { createMdBlock, createMdHeader, tableTest, toInfluxRowMdList, toMdList } from './md'
import { divideToInfluxTables } from './util'

type TgMessageUpdate = Context<Update> & {
  readonly message: Message.TextMessage
}

const TG_API_TOKEN = process.env.TG_API_TOKEN
const TG_ALLOWED_USERNAMES = process.env.TG_ALLOWED_USERNAMES?.split(',') ?? []
const ERROR_PREFIX_MD = '[ERROR]'

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
        await ctx.reply(`${ERROR_PREFIX_MD} Unauthorized user!`)
      } else {
        await next()
      }
    })

    // Log incoming message
    this.bot.use(async (ctx, next) => {
      this.log(`Received message: ${JSON.stringify(ctx.message)}`)
      await next()
    })

    this.bot.catch((err, ctx) => {
      this.log(`Unhandled error: ${ctx}`, err)
      if (err instanceof ZodError) {
        ctx.replyWithMarkdownV2(`${ERROR_PREFIX_MD} Invalid configuration:\n${createMdBlock(err.message)}`)
      } else {
        ctx.replyWithMarkdownV2(`${ERROR_PREFIX_MD} Sorry, an unknown error occurred :\\(`)
      }
    })

    this.bot.command('buckets', this.handleGetBuckets.bind(this))
    this.bot.command('measurements', this.handleGetMeasurements.bind(this))
    this.bot.command('fields', this.handleGetFields.bind(this))
    this.bot.command('tags', this.handleGetTags.bind(this))
    this.bot.command('tag', this.handleGetTagValues.bind(this))
    this.bot.command('current', this.handleGetCurrentValues.bind(this))
    this.bot.command('chart', this.handleGetChart.bind(this))
    this.bot.on('text', async ctx => ctx.reply(`${ERROR_PREFIX_MD} Beep boop, don\'t undestand...`))
    this.log(`Initialized for users: ${TG_ALLOWED_USERNAMES.join(', ')}`)
  }

  start() {
    this.bot.launch()
    this.log('Started.')
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
    const config = InfluxTimespanValidator.parse(this.parseConfig(configStr))
    const measurements = await influx.getMeasurements(bucket, config)
    if (!measurements) {
      return await ctx.replyWithMarkdownV2(`${ERROR_PREFIX_MD} No measurements found.`)
    }

    await ctx.replyWithMarkdownV2(toMdList(measurements.map(m => m._measurement), 'Measurements'))
  }

  private async handleGetFields(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 2) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/fields <bucket> <measurement> [<config>]'))
    }

    const [bucket, measurement, configStr] = params
    const config = InfluxTimespanValidator.parse(this.parseConfig(configStr))
    const fields = await influx.getFields(bucket, measurement, config)
    if (!fields) {
      return await ctx.reply(`${ERROR_PREFIX_MD} No fields found.`)
    }

    await ctx.replyWithMarkdownV2(toMdList(fields, 'Fields'))
  }

  private async handleGetTags(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 2) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/tags <bucket> <measurement> [<config>]'))
    }

    const [bucket, measurement, configStr] = params
    const config = InfluxTimespanValidator.parse(this.parseConfig(configStr))
    const tags = await influx.getTags(bucket, measurement, config)
    if (!tags) {
      return await ctx.reply(`${ERROR_PREFIX_MD} No tags found.`)
    }

    await ctx.replyWithMarkdownV2(toMdList(tags, 'Tags'))
  }

  private async handleGetTagValues(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 3) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/tag <bucket> <measurement> <tag> [<config>]'))
    }

    const [bucket, measurement, tag, configStr] = params
    const config = InfluxTimespanValidator.parse(this.parseConfig(configStr))
    const tagValues = await influx.getTagValues(bucket, measurement, tag, config)
    if (!tagValues) {
      return await ctx.reply(`${ERROR_PREFIX_MD} No tag values found.`)
    }

    await ctx.replyWithMarkdownV2(toMdList(tagValues, `Tag (\`${tag}\`)`))
  }

  private async handleGetCurrentValues(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 3) {
      return await ctx.replyWithMarkdownV2(
        this.createUsageText('/current <bucket> <measurement> <field> [<config>]')
      )
    }

    // Source: https://stackoverflow.com/a/19156525
    const [bucket, measurement, field, tagFilterStr = '*', shownTags] = params
    const tagFilters: TagFilter[] = this.parseTagFilters(tagFilterStr)

    const rows = await influx.getLastValue(bucket, measurement, field, tagFilters)
    if (!rows) {
      return await ctx.reply(`${ERROR_PREFIX_MD} No values found.`)
    }

    await ctx.replyWithMarkdownV2(
      toInfluxRowMdList(rows, { header: 'Current values', shownTags: shownTags?.split(',') })
    )
  }

  private async handleGetChart(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 3) {
      return await ctx.replyWithMarkdownV2(
        this.createUsageText('/chart <bucket> <measurement> <field> [<config>]')
      )
    }

    const [bucket, measurement, field, tagFilterStr = '*', daysStr, aggregateWindow] = params
    const tagFilters: TagFilter[] = this.parseTagFilters(tagFilterStr)
    const days = Number(daysStr) || 7 // Default: 7 days / 1 week
    const rows = await influx.getValuesFromTimespan(bucket, measurement, field, tagFilters, days, aggregateWindow)
    if (!rows || rows.length === 0) {
      return await ctx.reply(`${ERROR_PREFIX_MD} No values found.`)
    }

    const tables = divideToInfluxTables(rows)
    const source = await createLineChart(tables)
    if (!source) {
      return await ctx.reply(`${ERROR_PREFIX_MD} Could not create a chart.`)
    }

    const caption = tableTest(tables, 'Chart tags')
    await ctx.replyWithPhoto({ source }, { caption, parse_mode: 'MarkdownV2' })
  }

  // Source: https://stackoverflow.com/a/16261693
  private getCommandParams(text?: string): string[] {
    return text ? text.match(/(?:[^\s"]+|"[^"]*")+/g)?.slice(1) ?? [] : []
  }

  private parseTagFilters(tagFilterStr: string): TagFilter[] {
    return (tagFilterStr === '*' ? [] : tagFilterStr.split(',')).map(f => {
      const [tag, value] = f.split('=')
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
      const value = valueWithQuotes.replace(/^"(.*)"$/, '$1')
      if (key && value) {
        config[key] = value.includes(',') ? value.split(',') : value
      }
    }

    console.log('CONFIG:', config)
    return config
  }

  private createUsageText(usage: string): string {
    return createMdBlock(`${createMdHeader(`${ERROR_PREFIX_MD} Usage`)}\n${usage}`)
  }

  private log(...args: any[]) {
    console.log(`[InfluxTelegramBot]`, ...args)
  }
}
