import dotnev from 'dotenv'
dotnev.config()
import { InfluxTelegramBot } from './telegram'

const bot = new InfluxTelegramBot()
console.log('Starting InfluxDB Telegram Bot...')
bot.start()
