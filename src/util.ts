import { InfluxRow } from './influx'

export type InfluxTableMap = Map<number, InfluxRow[]>

const IGNORED_INFLUX_PROPERTIES: Set<keyof InfluxRow> = new Set(['result', 'table'])

export const divideToInfluxTables = (rows: InfluxRow[]): InfluxTableMap => {
  const tableMap = new Map<number, InfluxRow[]>()
  rows.forEach(r => {
    const existing = tableMap.get(r.table)
    if (existing) {
      existing.push(r)
    } else {
      tableMap.set(r.table, [r])
    }
  })

  return tableMap
}

export const combineInfluxTableMaps = (tables: InfluxTableMap[]): InfluxTableMap => {
  const combinedTableMap = new Map<number, InfluxRow[]>()
  tables.forEach((t, i) => {
    // TODO
  })

  return combinedTableMap
}

export const getInfluxTags = (rows: InfluxRow | InfluxRow[]): [string, string][] => {
  const row = Array.isArray(rows) ? rows.at(0) : rows
  if (!row) {
    return []
  }

  const tags: [string, string][] = []
  Object.entries(row)
    .filter(([key]) => !(key.startsWith('_') || IGNORED_INFLUX_PROPERTIES.has(key)))
    .forEach(([key, value]) => tags.push([key, value.toString()]))

  return tags
}

export const getInfluxRowFieldName = (rows: InfluxRow[]): string => rows.at(0)?._field ?? 'Unknown'
