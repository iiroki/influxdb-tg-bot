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
    readonly tags?: string[]
  }
): string => {
  const { header, tags } = config
  const builder: string[] = []
  if (header) {
    builder.push(createMdHeader(header))
  }

  const now = new Date()
  rows.forEach(r => {
    builder.push(`\`${r._field}\`: \`${r._value}\``)
    getInfluxTags(r).forEach(t => {
      if (!tags || tags.includes(t[0])) {
        builder.push(`${ROW_INDENT}# \`${t[0]}\`: \`${t[1]}\``)
      }
    })

    builder.push(`${ROW_INDENT}(${formatDistance(parseISO(r._time), now, { includeSeconds: true })} ago)`)
    builder.push('')
  })

  return createMdBlock(builder.join('\n'))
}

export const toInfluxTableTagMdList = (
  tables: InfluxTableMap,
  config: {
    readonly header?: string
    readonly tags?: string[]
  }
): string => {
  const { header, tags } = config
  const builder: string[] = []
  if (header) {
    builder.push(createMdHeader(header))
  }

  for (const [table, rows] of [...tables.entries()]) {
    builder.push(`${table} - \`${getInfluxRowFieldName(rows)}\``)

    getInfluxTags(rows)
      .filter(([k]) => !tags || tags.includes(k)) // Show only the specified tags
      .forEach(([k, v]) => builder.push(`${ROW_INDENT}# \`${k}\`: \`${v}\``))

    builder.push('')
  }

  return createMdBlock(builder.join('\n'))
}
