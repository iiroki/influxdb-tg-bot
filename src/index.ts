import dotnev from 'dotenv'
dotnev.config()

import { TelegramBot } from './telegram'


const telegram = new TelegramBot()

console.log('Starting InfluxDB Telegram Bot...')
telegram.start()
