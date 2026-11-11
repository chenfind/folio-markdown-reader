import { getPlatform } from '../platform'
import { listRemote, readRemote } from '../repositories/remote'
import { isRemote, markdown, nameOf } from './address'
import type { Entry } from './types'

const decoder = new TextDecoder()
const hidden = (name: string) => name.startsWith('.') || ['node_modules', 'target'].includes(name)
const examples = import.meta.glob('../examples/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
export const demo = 'demo:/阅读手册'
export const welcome = demo + '/起点.md'
const demoFiles = new Map(Object.entries(examples).map(([path, content]) => [demo + '/' + nameOf(path), content]))

export const choose = (directory: boolean) => getPlatform().files.choose(directory)

export async function list(path: string): Promise<Entry[]> {
  let entries: Entry[]
  if (path.startsWith('demo:/')) {
    entries = [...new Map([...demoFiles.keys()].filter(key => key.startsWith(path + '/')).map(key => {
      const parts = key.slice(path.length + 1).split('/')
      return [parts[0], { path: path + '/' + parts[0], directory: parts.length > 1 }]
    })).values()]
  } else if (isRemote(path)) {
    entries = (await listRemote(path)).map(entry => ({ path: path + '/' + entry.name, directory: entry.directory }))
  } else entries = await getPlatform().files.list(path)
  return entries.filter(entry => !hidden(nameOf(entry.path)) && (entry.directory || markdown.test(entry.path)))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || nameOf(a.path).localeCompare(nameOf(b.path), 'zh-CN', { numeric: true }))
}

export const bytes = (path: string) => isRemote(path) ? readRemote(path) : getPlatform().files.read(path)
export async function read(path: string) {
  const example = demoFiles.get(path)
  const data = example === undefined ? await bytes(path) : new TextEncoder().encode(example)
  const buffer = new Uint8Array(data).buffer
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), b => b.toString(16).padStart(2, '0')).join('')
  return { text: decoder.decode(data), hash }
}


export const external = (url: string) => {
  if (/^https?:\/\//i.test(url)) return getPlatform().openExternal(url)
}
