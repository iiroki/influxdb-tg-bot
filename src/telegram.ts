import { Telegraf } from 'telegraf'

const TG_API_TOKEN = process.env.TG_API_TOKEN
const TG_ALLOWED_USERNAMES = process.env.TG_ALLOWED_USERNAMES?.split(',') ?? []

export class TelegramBot {
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
      console.log('Message received:', ctx.message)
      const username = ctx.message?.from.username
      if (!username || !this.allowedUsernames.has(username)) {
        await ctx.reply('Unauthorized user.')
      } else {
        await next()
      }
    })

    this.bot.command('test', async ctx => {
      console.log('Command received:', ctx.message)
      await ctx.reply('Test command received.')
    })
  }

  start() {
    this.bot.launch()
    console.log('TelegramBot started.')
  }
}
