export const markdown = /\.(md|markdown|mdown|mkd)$/i
export const nameOf = (path: string) => path.split('/').filter(Boolean).at(-1) || path
export const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)
export const pathKey = (path: string) => /^[a-z]:\/|^\/\//i.test(path) ? path.toLowerCase() : path
export const isRemote = (path: string) => path.startsWith('remote:/')
export const restorable = (path: string) => !path.startsWith('import:/')
export function localPath(from: string, href: string) {
  try {
    const [relative = '', fragment = ''] = href.split('#', 2)
    const target = decodeURIComponent(relative)
    if (/^[a-z][a-z\d+.-]*:|^[/\\]/i.test(target)) return null
    const pieces = parentOf(from).split('/').filter(Boolean)
    const minimum = (from.startsWith('import:/') || from.startsWith('saf:/') || isRemote(from)) ? 2 : 1
    for (const part of target.replaceAll('\\', '/').split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {
        if (pieces.length <= minimum) return null
        pieces.pop()
      } else pieces.push(part)
    }
    return { path: target ? (from.startsWith('//') ? '//' : '') + pieces.join('/') : from, fragment: decodeURIComponent(fragment) }
  } catch { return null }
}
