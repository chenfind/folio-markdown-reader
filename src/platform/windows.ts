import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { readDir, readFile } from '@tauri-apps/plugin-fs'
import type { FileAccess } from '../documents/types'
import type { RemoteSource } from '../repositories/types'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { ReadingWindows } from './types'

export const windows: ReadingWindows = {
  create: async (id, options) => {
    if (await WebviewWindow.getByLabel(id)) return
    await new Promise<void>((resolve, reject) => {
      const child = new WebviewWindow(id, options)
      const timeout = window.setTimeout(() => reject(new Error('创建窗口超时。')), 5000)
      void child.once('tauri://created', () => { clearTimeout(timeout); resolve() })
      void child.once('tauri://error', () => { clearTimeout(timeout); reject(new Error('无法创建窗口。')) })
    })
  },
  focus: async (id) => {
    const target = await WebviewWindow.getByLabel(id)
    if (!target) return false
    await target.unminimize()
    await target.setFocus()
    return true
  },
  closeCurrent: () => getCurrentWindow().close(),
  onCloseRequested: (handler) => getCurrentWindow().onCloseRequested(handler),
}

const normalize = (path: string) => path.replaceAll('\\', '/')
export const files: FileAccess = {
  choose: async (directory) => {
    const selection = await open(directory ? { directory: true, recursive: true, multiple: true } :
      { multiple: true, filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }] })
    return (Array.isArray(selection) ? selection : selection ? [selection] : []).map(path => ({ path: normalize(path), directory }))
  },
  list: async (path) => (await readDir(path))
    .filter(entry => !entry.isSymlink && (entry.isDirectory || entry.isFile))
    .map(entry => ({ path: path.replace(/\/$/, '') + '/' + entry.name, directory: entry.isDirectory })),
  read: readFile,
}

export const cloneRepository = async (source: RemoteSource): Promise<string | null> => {
    const parent = await open({ directory: true, recursive: true, title: '选择克隆位置' })
    if (!parent) return null
    return invoke<string>('remote_clone', { url: source.url, branch: source.branch, parent })
}
