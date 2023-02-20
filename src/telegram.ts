import { Context, Telegraf } from 'telegraf'
import { Message, Update} from 'telegraf/types'
import influx from './influx'
import { toMdList } from './md'

type TgMessageUpdate = Context<Update> & {
  readonly message: Message.TextMessage
}

const TG_API_TOKEN = process.env.TG_API_TOKEN
const TG_ALLOWED_USERNAMES = process.env.TG_ALLOWED_USERNAMES?.split(',') ?? []

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
      console.log('TelegramBot stopped.')
    })

    // Validate the user who sent the message
    this.bot.use(async (ctx, next) => {
      const username = ctx.message?.from.username
      if (!username || !this.allowedUsernames.has(username)) {
        await ctx.reply('Unauthorized user!')
      } else {
        await next()
      }
    })

    this.bot.catch((err, ctx) => {
      console.log(`TelegramBot unhandled error: ${ctx}`, err)
      ctx.reply('Sorry, an unknown error occurred :(')
    })

    this.bot.command('buckets', this.handleGetBuckets.bind(this))
    this.bot.command('measurements', this.handleGetMeasurements.bind(this))
    this.bot.command('fields', this.handleGetFields.bind(this))
    this.bot.command('tags', this.handleGetTags.bind(this))
    this.bot.command('tag', this.handleGetTagValues.bind(this))
    console.log(`TelegramBot initialized for users: ${TG_ALLOWED_USERNAMES.join(', ')}`)
  }

  start() {
    this.bot.launch()
    console.log('TelegramBot started.')
  }

  private async handleGetBuckets(ctx: TgMessageUpdate) {
    const buckets = await influx.getBuckets()
    await ctx.replyWithMarkdownV2(toMdList(buckets.map(b => b.name), 'Buckets'))
  }

  private async handleGetMeasurements(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    const bucket = params[0]
    if (!bucket) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/measurements <bucket>'))
    }

    const measurements = await influx.getMeasurements(bucket)
    if (!measurements) {
      return await ctx.reply(`Unknown bucket: \`${bucket}\``)
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
      return await ctx.reply(`Unknown bucket: \`${bucket}\``)
    }

    await ctx.replyWithMarkdownV2(toMdList(fields, 'Fields'))
  }

  private async handleGetTags(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    const bucket = params[0]
    const measurement = params[1]
    if (!bucket || !measurement) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/tags <bucket> <measurement>'))
    }

    const tags = await influx.getTags(bucket, measurement)
    if (!tags) {
      return await ctx.reply(`Unknown bucket: \`${bucket}\``)
    }

    await ctx.replyWithMarkdownV2(toMdList(tags, 'Tags'))
  }

  private async handleGetTagValues(ctx: TgMessageUpdate) {
    const params = this.getCommandParams(ctx.message?.text)
    const bucket = params[0]
    const measurement = params[1]
    const tag = params[2]
    if (!bucket || !measurement || !tag) {
      return await ctx.replyWithMarkdownV2(this.createUsageText('/tag <bucket> <measurement> <tag>'))
    }

    const tagValues = await influx.getTagValues(bucket, measurement, tag)
    if (!tagValues) {
      return await ctx.reply(`Unknown bucket: \`${bucket}\``)
    }

    await ctx.replyWithMarkdownV2(toMdList(tagValues, `Tag (${tag})`))
  }

  private getCommandParams(text?: string): string[] {
    return text ? text.split(' ').slice(1) : []
  }

  private createUsageText(usage: string): string {
    return `*Usage:*\n\`${usage}\``
  }
}
