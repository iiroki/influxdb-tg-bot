import { Chart, ChartConfiguration, ScatterDataPoint } from 'chart.js'
import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import AutoColors from 'chartjs-plugin-autocolors'
import { format, parseISO } from 'date-fns'
import { InfluxRow } from './influx'

Chart.register(AutoColors)
const X_DATE_FORMAT = 'd.M. h:mm'

const chartNodeCanvas = new ChartJSNodeCanvas({
  width: Number(process.env.CHART_WIDTH) || 1400,
  height: Number(process.env.CHART_HEIGHT) || 1000
})

const toXy = (row: InfluxRow): ScatterDataPoint => ({
  x: row._time as unknown as number, // X-axis values can also be strings!
  y: row._value
})

export const createLineChart = async (rows: InfluxRow[]): Promise<Buffer | null> => {
  const tableRowMap = new Map<number, InfluxRow[]>()
  rows.forEach(r => {
    const existing = tableRowMap.get(r.table)
    if (existing) {
      existing.push(r)
    } else {
      tableRowMap.set(r.table, [r])
    }
  })

  const tableRows = tableRowMap.get(0) // TODO: Data from all tables
  if (!tableRows) {
    return null
  }

  const config: ChartConfiguration = {
    type: 'line',
    data: {
      datasets: [...tableRowMap.entries()].map(e => ({
        label: e[1].length !== 0 ? e[1][0]._field : 'Unknown',
        data: e[1].map(toXy)
      }))
    },
    options: {
      scales: {
        x: {
          ticks: {
            // Format x-axis timestamp labels
            callback (tick): string | null {
              if (typeof tick === 'number') {
                const value = this.getLabelForValue(tick)
                return format(parseISO(value), X_DATE_FORMAT)
              }

              return null
            }
          }
        }
      },
      plugins: {
        autocolors: { offset: 3 } // Nicer to eyes :)
      }
    }
  }

  return await chartNodeCanvas.renderToBuffer(config)
}
