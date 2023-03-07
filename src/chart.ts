import { Chart, ChartConfiguration, ChartDataset, ScatterDataPoint } from 'chart.js'
import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import AutoColors from 'chartjs-plugin-autocolors'
import { format, parseISO } from 'date-fns'
import { InfluxRow } from './influx'
import { divideToInfluxTables, InfluxTableMap } from './util'

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

export const createLineChart = async (tables: InfluxTableMap): Promise<Buffer | null> => {
  if (tables.size === 0) {
    return null
  }

  const datasets: ChartDataset<'line', ScatterDataPoint[]>[] = [...tables.entries()].map(([table, rows]) => ({
    label: `${table} - ${rows.at(0)?._field ?? 'Unknown'}`,
    data: rows.map(toXy)
  }))

  const config: ChartConfiguration = {
    type: 'line',
    data: { datasets },
    options: {
      scales: {
        x: {
          ticks: {
            // Format x-axis timestamp labels
            callback (tick): string | null {
              // Line chart uses the index as tick value
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
