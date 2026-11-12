import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import GithubSlugger from 'github-slugger'
import { localPath } from '../documents/address'

export interface Heading { id: string; text: string; level: number }
const mediaTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' }
const md = new MarkdownIt({ html: false, linkify: true, highlight: (code, language) =>
  hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : '' })
for (const type of ['fence', 'code_block']) {
  const original = md.renderer.rules[type]!
  md.renderer.rules[type] = (tokens, index, options, env, renderer) => {
    const range = tokens[index]?.map
    const result = original(tokens, index, options, env, renderer)
    return range ? result.replace('<pre', `<pre data-source-start="${range[0]}" data-source-end="${range[1]}"`) : result
  }
}

/** The caller owns and revokes returned object URLs, including stale render results. */
export const renderMarkdown = async (text: string, path: string, bytes: (path: string) => Promise<Uint8Array>) => {
  const env = {}
  const tokens = md.parse(text, env)
  const slugger = new GithubSlugger()
  const headings: Heading[] = []
  const images: Promise<void>[] = []
  const resources = new Map<string, Promise<string>>()
  const newUrls: string[] = []
  tokens.forEach((token, i) => {
    if (token.map && token.nesting === 1) {
      token.attrSet('data-source-start', String(token.map[0]))
      token.attrSet('data-source-end', String(token.map[1]))
    }
    if (token.type === 'heading_open') {
      const title = tokens[i + 1]?.children?.map(child => child.content).join('') || '章节'
      const id = slugger.slug(title)
      token.attrSet('id', id)
      headings.push({ id, text: title, level: Number(token.tag[1]) })
    }
    token.children?.forEach(child => {
      if (child.type === 'link_open') {
        const href = String(child.attrGet('href') || '')
        const target = localPath(path, href)
        child.attrSet('title', target ? target.path + (target.fragment ? '#' + target.fragment : '') : href)
      }
      if (child.type !== 'image') return
      const src = child.attrGet('src') || ''
      const resolved = localPath(path, String(src))
      const mime = resolved && mediaTypes[resolved.path.split('.').at(-1)?.toLowerCase() || '']
      if (!resolved || !mime) {
        child.type = 'text'
        child.content = '[图片] ' + (child.content || src)
        return
      }
      let resource = resources.get(resolved.path)
      if (!resource) {
        resource = bytes(resolved.path).then(data => {
          const url = URL.createObjectURL(new Blob([new Uint8Array(data).buffer], { type: mime }))
          newUrls.push(url)
          return url
        })
        resources.set(resolved.path, resource)
      }
      images.push(resource.then(url => child.attrSet('src', url)).catch(() => {
        child.type = 'text'
        child.content = '[图片无法读取] ' + (child.content || src)
      }))
    })
  })
  await Promise.all(images)

  return { html: md.renderer.render(tokens, md.options, env), headings, urls: newUrls }
}
