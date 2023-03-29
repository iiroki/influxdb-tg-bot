import EventEmitter from 'events'
import { InfluxRow, InfluxTagFilter, InfluxTagParams } from './model'
import influx from '.'

export declare interface InfluxIntervalReader {
  on(event: 'data', listener: (data: InfluxIntervalReadData) => void | Promise<void>): this
}

export type InfluxIntervalRead = {
  readonly id: string
  readonly intervalMs: number
  readonly bucket: string
  readonly measurement: string
  readonly field: string
  readonly where: InfluxTagFilter[]
}

export type InfluxIntervalReadData = {
  readonly id: string
  readonly rows: InfluxRow[]
}

export class InfluxIntervalReader extends EventEmitter {
  private readonly intervalMap: Map<string, NodeJS.Timeout> = new Map()

  init(params: InfluxIntervalRead[]) {
    params.forEach(p => this.create(p))
  }

  create(params: InfluxIntervalRead) {
    const { id, intervalMs, bucket, measurement, field, where } = params
    const config: InfluxTagParams = { start: '-1h' }

    const interval = setInterval(async () => {
      try {
        const rows = await influx.getLastValue(bucket, measurement, field, where, config)
        if (rows) {
          const data: InfluxIntervalReadData = { id, rows }
          this.emit('data', data)
        }
      } catch (err) {
        this.log('Read error:', err)
      }
    }, intervalMs)

    this.intervalMap.set(id, interval)
    this.log('Created interval:', id)
  }

  remove(id: string) {
    const interval = this.intervalMap.get(id)
    if (interval) {
      clearInterval(interval)
      this.intervalMap.delete(id)
      this.log('Removed interval:', id)
    } else {
      this.log('Could not remove interval (not found):', id)
    }
  }

  private log(...args: any[]) {
    console.log('[InfluxIntervalReader]', ...args)
  }
}
