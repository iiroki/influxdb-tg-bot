import { format, formatDistance, parseISO } from 'date-fns'
import { InfluxRow } from './influx'

const MD_ESCAPED_CHARS = new Set([
  '-',
  '_',
  '(',
  ')',
  '[',
  ']',
  '.',
  ','
])

const ROW_INDENT = ' '.repeat(4)

const IGNORED_INFLUX_PROPERTIES: Set<keyof InfluxRow> = new Set(['result', 'table'])

const escapeMd = (text: string) => {
  let escaped = ''
  for (const char of text) {
    if (MD_ESCAPED_CHARS.has(char)) {
      escaped += '\\'
    }

    escaped += char
  }

  return escaped
}

export const toMdList = (items: any[], header?: string): string => {
  const builder: string[] = []
  if (header) {
    builder.push(`*${header}:*`)
  }

  items.forEach(item => builder.push(`${ROW_INDENT}\`${typeof item === 'object' ? JSON.stringify(item) : item}\``))
  return escapeMd(builder.join('\n'))
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
    builder.push(`*${header}:*`)
  }

  rows.forEach(r => {
    builder.push(`${ROW_INDENT}\`${r._field}\`: \`${r._value}\``)
    Object.entries(r).filter(e => !(e[0].startsWith('_') || IGNORED_INFLUX_PROPERTIES.has(e[0]))).forEach(tag => {
      if (!shownTags || shownTags.includes(tag[0])) {
        builder.push(`${ROW_INDENT}- \`${tag[0]}\`: \`${tag[1]}\``)
      }
    })

    builder.push(`${ROW_INDENT}  (${formatDistance(parseISO(r._time), new Date(), { includeSeconds: true })} ago)`)
    builder.push('')
  })

  return escapeMd(builder.join('\n'))
}
