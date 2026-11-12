import type { Entry, FileAccess } from '../documents/types'
import type { Platform, ReadingWindows } from './types'
import { capabilitiesFor } from './policy'

const unsupported = async (): Promise<never> => { throw new Error('此功能需要原生应用支持。') }

const createBrowserFiles = (): FileAccess => {
  const imports = new Map<string, File>()
  return {
    choose: (directory) => new Promise<Entry[]>(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      if (directory) input.webkitdirectory = true
      else input.accept = '.md,.markdown,.mdown,.mkd'
      input.oncancel = () => resolve([])
      input.onchange = () => {
        const files = Array.from(input.files || [])
        const root = 'import:/' + crypto.randomUUID()
        for (const file of files) imports.set(root + '/' + (file.webkitRelativePath || file.name), file)
        const paths = [...new Set(files.map(file => directory ? file.webkitRelativePath.split('/')[0]! : file.name))]
        resolve(paths.map(path => ({ path: root + '/' + path, directory })))
      }
      input.click()
    }),
    list: async (path) => [...new Map([...imports.keys()].filter(key => key.startsWith(path + '/')).map(key => {
      const parts = key.slice(path.length + 1).split('/')
      return [parts[0], { path: path + '/' + parts[0], directory: parts.length > 1 }]
    })).values()],
    read: async (path) => {
      const file = imports.get(path)
      if (!file) throw new Error('请重新导入该文件所在的文件夹。')
      return new Uint8Array(await file.arrayBuffer())
    },
  }
}

const browserWindows: ReadingWindows = {
  create: async (id, options) => {
    if (!window.open(options.url, id, 'popup,width=' + options.width + ',height=' + options.height)) {
      throw new Error('浏览器拦截了弹出窗口。')
    }
  },
  focus: async () => false,
  closeCurrent: async () => { window.close() },
  onCloseRequested: async () => () => {},
}

export const createBrowserPlatform = (): Platform => ({
  kind: 'browser',
  capabilities: capabilitiesFor('browser'),
  files: createBrowserFiles(),
  windows: browserWindows,
  repositories: {
    resolve: unsupported, list: unsupported, tree: unsupported, read: unsupported, clone: unsupported, inspectClone: async () => null, updateClone: unsupported,
  },
  openExternal: async (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
})
