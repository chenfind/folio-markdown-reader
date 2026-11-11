import { onBeforeUnmount, onMounted, ref, type ComputedRef } from 'vue'
import { getPlatform } from '../platform'
import { restorable, pathKey } from '../documents/address'
import { load, save } from '../core/persistence'
import type { Group, Tab } from '../core/reading'
import type { ReaderHandle } from './readerRegistry'
import { uid, workspace } from './session'

export const useReadingWindows = ({ windowId, detached, currentGroup, current, readers, closeTab, notify }: {
  windowId: string
  detached: boolean
  currentGroup: ComputedRef<Group>
  current: ComputedRef<Tab | undefined>
  readers: Map<string, ReaderHandle>
  closeTab: (group: Group, id: string) => void
  notify: (text: string) => void
}) => {
  const platform = getPlatform()
  const native = platform.kind !== 'browser'
  const merging = ref(false)
  function detachedIds() { return load<string[]>('windows', []) }
  async function spawn(id: string, at?: { x: number; y: number }) {
    if (!platform.capabilities.independentWindows) throw new Error('当前平台不提供独立阅读窗口。')
    await platform.windows.create(id, {
      url: '/?view=' + encodeURIComponent(id),
      title: 'Folio', width: 920, height: 740, minWidth: 440, minHeight: 380,
      ...(at ? { x: Math.round(at.x) - 80, y: Math.round(at.y) - 22 } : {}),
    })
  }
  async function detach(tab: Tab, group?: Group, at?: { x: number; y: number }) {
    if (!platform.capabilities.independentWindows) return
    if (!restorable(tab.path)) { notify('浏览器导入的文件可在当前窗口分屏。桌面版支持移到独立窗口。'); return }
    if (group?.active === tab.id) readers.get(group.id)?.flush()
    const id = 'reader-' + uid()
    save('layout:' + id, workspace({ ...tab }))
    try {
      await spawn(id, at)
      if (native) save('windows', [...detachedIds(), id])
      if (group) closeTab(group, tab.id)
    } catch { notify('无法打开独立窗口。请重试，或检查浏览器弹窗设置。') }
  }
  function forgetWindow() {
    save('windows', detachedIds().filter(id => id !== windowId))
    localStorage.removeItem('folio:layout:' + windowId)
  }
  async function mergeBack() {
    if (!platform.capabilities.independentWindows) return
    const tab = current.value
    if (!tab || merging.value) return
    readers.get(currentGroup.value.id)?.flush()
    merging.value = true
    const key = 'folio:incoming:' + windowId
    localStorage.setItem(key, JSON.stringify(tab))
    try {
      if (native && !await platform.windows.focus('main')) {
        await platform.windows.create('main', { url: '/', title: 'Folio', width: 1360, height: 880, minWidth: 620, minHeight: 480 })
      }
      const deadline = Date.now() + 5000
      while (localStorage.getItem(key) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
      if (localStorage.getItem(key)) throw new Error('Main window did not accept the document')
      await platform.windows.closeCurrent()
    } catch {
      localStorage.removeItem(key)
      notify('无法移回主窗口，文档仍在这里。请重试。')
    } finally { merging.value = false }
  }
  function acceptIncoming(key: string) {
    if (detached || !platform.capabilities.independentWindows) return
    const incoming = load<Tab | null>(key.slice('folio:'.length), null)
    if (!incoming) return
    const group = currentGroup.value
    readers.get(group.id)?.flush()
    const index = group.tabs.findIndex(tab => pathKey(tab.path) === pathKey(incoming.path))
    const tab = { ...incoming, id: uid() }
    if (index < 0) group.tabs.push(tab)
    else group.tabs.splice(index, 1, tab)
    group.active = tab.id
    localStorage.removeItem(key)
  }

  const acceptPending = () => {
    if (!detached && platform.capabilities.independentWindows) Object.keys(localStorage).filter(key => key.startsWith('folio:incoming:')).forEach(acceptIncoming)
  }
  const restoreWindows = () => {
    if (platform.capabilities.independentWindows && native && !detached) {
      for (const id of detachedIds()) void spawn(id).catch(() => notify('部分独立窗口未能恢复。'))
    }
  }
  const incoming = (event: StorageEvent) => {
    if (event.key?.startsWith('folio:incoming:') && event.newValue) acceptIncoming(event.key)
  }
  let unlisten: (() => void) | undefined
  onMounted(async () => {
    window.addEventListener('storage', incoming)
    if (platform.capabilities.independentWindows && native) {
      const cleanup = await platform.windows.onCloseRequested(() => {
        readers.forEach(reader => reader.flush())
        if (detached) forgetWindow()
      })
      if (disposed) cleanup()
      else unlisten = cleanup
    }
  })
  let disposed = false
  onBeforeUnmount(() => {
    disposed = true
    unlisten?.()
    window.removeEventListener('storage', incoming)
  })
  return { merging, detach, mergeBack, acceptPending, restoreWindows }
}
