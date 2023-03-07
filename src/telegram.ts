import { parseISO, format } from 'date-fns'
import { Context, Telegraf } from 'telegraf'
import { Message, Update} from 'telegraf/types'
import { createLineChart } from './chart'
import influx, { TagFilter } from './influx'
import { tableTest, toInfluxRowMdList, toMdList } from './md'
import { divideToInfluxTables } from './util'

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
        await ctx.reply(`${ERROR_PREFIX} Unauthorized user!`)
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
      ctx.reply(`${ERROR_PREFIX} Sorry, an unknown error occurred :(`)
    })

    this.bot.command('buckets', this.handleGetBuckets.bind(this))
    this.bot.command('measurements', this.handleGetMeasurements.bind(this))
    this.bot.command('fields', this.handleGetFields.bind(this))
    this.bot.command('tags', this.handleGetTags.bind(this))
    this.bot.command('tag', this.handleGetTagValues.bind(this))
    this.bot.command('current', this.handleGetCurrentValues.bind(this))
    this.bot.command('chart', this.handleGetChart.bind(this))
    this.bot.on('text', async ctx => ctx.reply(`${ERROR_PREFIX} Beep boop, don\'t undestand...`))
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
    const [bucket] = this.getCommandParams(ctx.message?.text)
    if (!bucket) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/measurements <bucket>'))
    }

    const measurements = await influx.getMeasurements(bucket)
    if (!measurements) {
      return await ctx.reply(`${ERROR_PREFIX} No measurements found.`)
    }

    await ctx.replyWithMarkdownV2(toMdList(measurements.map(m => m._measurement), 'Measurements'))
  }

  private async handleGetFields(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    const bucket = params[0]
    const measurement = params[1]
    if (!bucket || !measurement) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/fields <bucket> <measurement>'))
    }

    const fields = await influx.getFields(bucket, measurement)
    if (!fields) {
      return await ctx.reply(`${ERROR_PREFIX} No fields found.`)
    }

    await ctx.replyWithMarkdownV2(toMdList(fields, 'Fields'))
  }

  private async handleGetTags(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 2) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/tags <bucket> <measurement>'))
    }

    const [bucket, measurement] = params
    const tags = await influx.getTags(bucket, measurement)
    if (!tags) {
      return await ctx.reply(`${ERROR_PREFIX} No tags found.`)
    }

    await ctx.replyWithMarkdownV2(toMdList(tags, 'Tags'))
  }

  private async handleGetTagValues(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 3) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/tag <bucket> <measurement> <tag>'))
    }

    const [bucket, measurement, tag] = params
    const tagValues = await influx.getTagValues(bucket, measurement, tag)
    if (!tagValues) {
      return await ctx.reply(`${ERROR_PREFIX} No tag values found.`)
    }

    await ctx.replyWithMarkdownV2(toMdList(tagValues, `Tag (\`${tag}\`)`))
  }

  private async handleGetCurrentValues(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 4) {
      return await ctx.replyWithMarkdownV2(
        this.createUsageText('/current <bucket> <measurement> <field> <tagFilters> [<shownTags>]')
      )
    }

    // Source: https://stackoverflow.com/a/19156525
    const [bucket, measurement, field, tagFilterStr, shownTags] = params
    const tagFilters: TagFilter[] = this.parseTagFilters(tagFilterStr)

    const rows = await influx.getLastValue(bucket, measurement, field, tagFilters)
    if (!rows) {
      return await ctx.reply(`${ERROR_PREFIX} No values found.`)
    }

    await ctx.replyWithMarkdownV2(
      toInfluxRowMdList(rows, { header: 'Current values', shownTags: shownTags?.split(',') })
    )
  }

  private async handleGetChart(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    if (params.length < 4) {
      return await ctx.replyWithMarkdownV2(
        this.createUsageText('/chart <bucket> <measurement> <field> <tagFilters> [<days>] [<aggregateWindow>]')
      )
    }

    const [bucket, measurement, field, tagFilterStr, daysStr, aggregateWindow] = params
    const tagFilters: TagFilter[] = this.parseTagFilters(tagFilterStr)
    const days = Number(daysStr) || 7 // Default: 7 days / 1 week
    const rows = await influx.getValuesFromTimespan(bucket, measurement, field, tagFilters, days, aggregateWindow)
    if (!rows || rows.length === 0) {
      return await ctx.reply(`${ERROR_PREFIX} No values found.`)
    }

    const tables = divideToInfluxTables(rows)
    const source = await createLineChart(tables)
    if (!source) {
      return await ctx.reply(`${ERROR_PREFIX} Could not create a chart.`)
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

  private createUsageText(usage: string): string {
    return `*Usage:*\n\`${usage}\``
  }

  private log(...args: any[]) {
    console.log(`[InfluxTelegramBot]`, ...args)
  }
}
