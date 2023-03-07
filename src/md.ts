import { format, formatDistance, parseISO } from 'date-fns'
import { InfluxRow } from './influx'
import { getInfluxRowFieldName, getInfluxTags, InfluxTableMap } from './util'

const ROW_INDENT = ' '.repeat(2)
export const createMdHeader = (header: string): string => `${header}:\n${'='.repeat(header.length + 1)}`
export const createMdBlock = (text: string): string => '```\n' + text + '\n```'

export const toMdList = (items: any[], header?: string): string => {
  const builder: string[] = []
  if (header) {
    builder.push(createMdHeader(header))
  }

  items.forEach(item => builder.push(`\`${typeof item === 'object' ? JSON.stringify(item) : item}\``))
  return createMdBlock(builder.join('\n'))
}

export const toInfluxRowMdList = (
  rows: InfluxRow[],
  config: {
    readonly header?: string
    readonly shownTags?: string[]
  }
): string => {
  const { header, shownTags } = config
  const builder: string[] = []
  if (header) {
    builder.push(createMdHeader(header))
  }

  rows.forEach(r => {
    builder.push(`\`${r._field}\`: \`${r._value}\``)
    getInfluxTags(r).forEach(t => {
      if (!shownTags || shownTags.includes(t[0])) {
        builder.push(`${ROW_INDENT}# \`${t[0]}\`: \`${t[1]}\``)
      }
    })

    builder.push(`${ROW_INDENT}(${formatDistance(parseISO(r._time), new Date(), { includeSeconds: true })} ago)`)
    builder.push('')
  })

  return createMdBlock(builder.join('\n'))
}

export const tableTest = (tables: InfluxTableMap, header?: string): string => {
  const builder: string[] = []
  if (header) {
    builder.push(createMdHeader(header))
  }

  for (const [table, rows] of [...tables.entries()]) {
    builder.push(`${table} - \`${getInfluxRowFieldName(rows)}\``)
    getInfluxTags(rows).forEach(([k, v]) => builder.push(`${ROW_INDENT}# \`${k}\`: \`${v}\``))
    builder.push('')
  }

  return createMdBlock(builder.join('\n'))
}
