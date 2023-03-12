import { Chart, ChartConfiguration, ChartDataset, ScatterDataPoint } from 'chart.js'
import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import AutoColors from 'chartjs-plugin-autocolors'
import { format, parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { z } from 'zod'
import { InfluxRow } from './influx/model'
import { InfluxTableMap } from './util'

Chart.register(AutoColors)
const TZ = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone
const X_DATE_FORMAT = 'd.M. H:mm'

const chartNodeCanvas = new ChartJSNodeCanvas({
  width: Number(process.env.CHART_WIDTH) || 1400,
  height: Number(process.env.CHART_HEIGHT) || 1000
})

export type ChartType = 'line' | 'bar'
export type ChartConfig = {
  readonly min?: number
  readonly max?: number
  readonly color?: number
  readonly seconds?: boolean
}

export const ChartConfigValidator: z.ZodType<ChartConfig> = z.object({
  min: z.coerce.number().optional(),
  max: z.coerce.number().optional(),
  color: z.coerce.number().max(9999).optional(),
  seconds: z.coerce.boolean().optional()
})

const toXy = (row: InfluxRow): ScatterDataPoint => ({
  x: row._time as unknown as number, // X-axis values can also be strings!
  y: row._value
})

export const createChart = async (type: ChartType, tables: InfluxTableMap, config: ChartConfig): Promise<Buffer | null> => {
  if (tables.size === 0) {
    return null
  }

  const { min, max, color } = config
  const datasets: ChartDataset<typeof type, ScatterDataPoint[]>[] = [...tables.entries()]
    .sort((a, b) => {
      // Sort based on the first row's timestamp
      const aRow = a[1].at(0)
      const bRow = b[1].at(0)
      if (!aRow || !bRow) {
        throw new Error('Invalid InfluxDB table rows, could not sort.')
      }

      return aRow._time.localeCompare(bRow._time)
    })
    .map(([table, rows]) => ({
      label: `${table} - ${rows.at(0)?._field ?? 'Unknown'}`,
      data: rows.map(toXy)
    }))

  const xDateFormat = X_DATE_FORMAT.concat(config.seconds ? ':ss' : '')
  const chartjs: ChartConfiguration = {
    type,
    data: { datasets },
    options: {
      scales: {
        y: { min, max },
        x: {
          ticks: {
            // Format x-axis timestamp labels
            callback (tick): string | null {
              // Line chart uses the index as tick value
              if (typeof tick === 'number') {
                const value = this.getLabelForValue(tick)
                return formatInTimeZone(parseISO(value), TZ, xDateFormat)
              }

              return null
            }
          }
        }
      },
      plugins: {
        autocolors: { offset: color ?? 3 } // Nicer to eyes :)
      }
    }
  }

  return await chartNodeCanvas.renderToBuffer(chartjs)
}
