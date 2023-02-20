const MD_ESCAPED_CHARS = new Set([
  '-',
  '_',
  '(',
  ')',
  '[',
  ']'
])

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

export const toMdList = (items: any[], header?: string) => {
  const builder: string[] = []
  if (header) {
    builder.push(`*${header}:*`)
  }

  items.forEach(item => builder.push(`    \`${item}\``))
  return escapeMd(builder.join('\n'))
}
