<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowDownToLine, BookOpen, ChevronLeft, ChevronRight, Columns2, ExternalLink, FilePlus2, FolderPlus, GitBranch, Library, List, Maximize, PanelLeft, Plus, RotateCw, Rows2, Settings2, X } from '@lucide/vue'
import { getPlatform } from './platform'
import { useSplitLayout } from './app/useSplitLayout'
import { useReadingSettings } from './app/useReadingSettings'
import { useReadingSession } from './app/useReadingSession'
import { useDocumentLibrary } from './app/useDocumentLibrary'
import { useReadingWindows } from './app/useReadingWindows'
import type { ReaderHandle, ReaderStatus } from './app/readerRegistry'
import FileTree from './documents/FileTree.vue'
import Reader from './reader/Reader.vue'
import SourceViewer from './reader/SourceViewer.vue'
import type { SourceLocation } from './reader/sourcePosition'
import { localPath } from './documents/address'
import RemoteDialog from './repositories/RemoteDialog.vue'
import ReadingSettings from './app/components/ReadingSettings.vue'
import MobileReaderUI, { type MobilePanel } from './app/components/MobileReaderUI.vue'
import MobileSheet from './app/components/MobileSheet.vue'
import ReaderDialog from './app/components/ReaderDialog.vue'
import SettingSwitch from './app/components/SettingSwitch.vue'
import './app/mobile.css'
import { clearRemoteDirectories, forgetRepository, remoteLabel, remoteRoot, repositories, syncRepositories } from './repositories/remote'
import type { CloneProgress, LocalClone, RemoteRepository } from './repositories/types'
import { choose, list } from './documents/library'
import { markdown, nameOf, parentOf, pathKey, isRemote } from './documents/address'
import type { Entry } from './documents/types'
import { save } from './core/persistence'
import { uid } from './app/session'
import type { Group, Tab } from './core/reading'

const platform = getPlatform()
const native = platform.kind !== 'browser'
const readers = new Map<string, ReaderHandle>()
function setReader(groupId: string, instance: unknown) {
  if (instance) readers.set(groupId, instance as ReaderHandle)
  else readers.delete(groupId)
}
const params = new URLSearchParams(location.search)
const windowId = platform.capabilities.independentWindows ? params.get('view') || 'main' : 'main'
const detached = windowId !== 'main'
const settings = useReadingSettings()
const { state, currentGroup, current, revisions, openDocument, openTab, activeTab, anchor, closeTab, split, moveTab, canTravel, travel, mouseHistory } =
  useReadingSession({ windowId, detached, settings, readers })
const { roots, expanded, contents, folders, files, rootFor, indexSeries, adjacent, expand, refreshDirectories, invalidateLibrary, clearSeries } =
  useDocumentLibrary(state, activeTab, notify)
const mobile = ref(platform.kind === 'android' || matchMedia('(max-width: 760px) and (pointer: coarse)').matches)
const mobilePanel = ref<MobilePanel>()
const readerStatus = reactive<Record<string, ReaderStatus>>({})
const mobileMedia = matchMedia('(max-width: 760px) and (pointer: coarse)')
const updateMobile = () => { mobile.value = platform.kind === 'android' || mobileMedia.matches }
function endSplit(group = currentGroup.value) {
  for (const item of state.groups) {
    readers.get(item.id)?.flush()
    if (item.id !== group.id) group.tabs.push(...item.tabs.filter(tab => !group.tabs.some(existing => existing.id === tab.id)))
  }
  state.groups = [group]
  state.focused = group.id
}
function toggleMobileSplit() {
  if (state.groups.length > 1) endSplit()
  else split(state.axis, currentGroup.value)
}
function selectMobileTab(group: Group, tab: Tab) {
  readers.get(currentGroup.value.id)?.flush()
  state.focused = group.id
  group.active = tab.id
}
function openOtherPane(path: string, fragment = '') {
  const other = state.groups.find(group => group.id !== currentGroup.value.id)
  if (other) openDocument(path, fragment, other, 'new')
  else split(state.axis, currentGroup.value, { id: uid(), path, fragment })
  mobilePanel.value = undefined
}

const refreshing = ref(false)
let queuedRefresh = false
let queuedRemoteSync = false
const settingsOpen = ref(false)
const sourceView = ref<{ path: string; initial: SourceLocation }>()
function openSource(group = currentGroup.value, path = activeTab(group)?.path) {
  if (!path) return
  readers.get(group.id)?.flush()
  sourceView.value = { path, initial: path === activeTab(group)?.path ? readers.get(group.id)?.sourcePosition() || { line: 0, within: 0 } : { line: 0, within: 0 } }
  mobilePanel.value = undefined
}
function sourceLink(href: string) {
  if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) { previewLink(href, currentGroup.value); return }
  const target = sourceView.value && localPath(sourceView.value.path, href)
  if (!target || !markdown.test(target.path)) { notify('此链接未指向可打开的 Markdown 文件。'); return }
  sourceView.value = undefined
  openDocument(target.path, target.fragment)
}
const remoteDialog = ref<true | RemoteRepository>()
const localDialog = ref<LocalClone>()
const adoption = ref<LocalClone>()
async function adoptRepository() {
  if (!adoption.value || !platform.repositories.adoptClone) return
  try {
    await platform.repositories.adoptClone(adoption.value.path)
    localDialog.value = { ...adoption.value, managed: true }
    adoption.value = undefined
    await scanClones()
  } catch { notify('无法启用副本管理，原目录未更新。') }
}
const localClones = reactive<Record<string, LocalClone>>({})
const updating = ref('')
const updateProgress = ref<CloneProgress>()
let cloneScan = 0
async function scanClones() {
  const generation = ++cloneScan
  await Promise.all(roots.value.filter(entry => entry.directory && !isRemote(entry.path) && !entry.path.startsWith('demo:/')).map(async entry => {
    try {
      const info = await platform.repositories.inspectClone(entry.path)
      if (generation !== cloneScan) return
      if (info?.source && info.path) { localClones[entry.path] = info; entry.sourceKind = info.managed === false ? 'unmanaged' : 'local' }
      else { delete localClones[entry.path]; delete entry.sourceKind }
    } catch { /* Unavailable sources remain untouched and can still be read offline. */ }
  }))
}
watch(() => roots.value.map(entry => entry.path).join('\n'), () => { if (native) void scanClones() }, { immediate: true })
function cloneAdded(path: string, label: string) {
  if (localDialog.value) {
    roots.value = roots.value.filter(root => root.path !== localDialog.value!.path && !root.path.startsWith(localDialog.value!.path + '/'))
    expanded.value = expanded.value.filter(item => item !== localDialog.value!.path && !item.startsWith(localDialog.value!.path + '/'))
  }
  localDialog.value = undefined
  showFolder({ path, label, directory: true, sourceKind: 'local' })
  void scanClones()
  void refreshLibrary()
}
async function updateLocal(entry: Entry) {
  const info = localClones[entry.path]
  if (!info) throw new Error('无法识别克隆来源，请重新添加仓库。')
  updating.value = entry.label || nameOf(entry.path)
  try {
    const path = await platform.repositories.updateClone(info.path, info.source, { directory: info.directory, progress: value => updateProgress.value = value })
    if (entry.path !== path) { roots.value = roots.value.filter(root => root.path !== entry.path); roots.value.push({ ...entry, path }) }
  } finally { updating.value = ''; updateProgress.value = undefined }
}
async function updateRepository(entry: Entry) {
  if (refreshing.value || updating.value) return
  if (localClones[entry.path]?.managed === false) { adoption.value = localClones[entry.path]; return }
  refreshing.value = true
  let failure = ''
  try {
    if (isRemote(entry.path)) {
      const id = entry.path.split('/')[1]
      if (await syncRepositories(id)) failure = '无法更新在线仓库，请检查网络和仓库设置。'
    } else await updateLocal(entry)
  } catch (error) { failure = typeof error === 'string' ? error : error instanceof Error ? error.message : '仓库更新失败，原副本保留。' }
  finally { refreshing.value = false }
  await refreshLibrary()
  if (native) save('library-refresh', uid())
  notify(failure || '仓库已更新，阅读位置已保留。')
}
const removal = ref<Entry>()
const skipRemoval = ref(false)
const linkPreview = ref<{ href: string; path?: string; fragment?: string; group: Group }>()
function previewLink(href: string, group: Group, path?: string, fragment?: string) {
  linkPreview.value = { href, path, fragment, group }
}
async function confirmLink() {
  const target = linkPreview.value
  linkPreview.value = undefined
  if (!target) return
  if (target.path) openDocument(target.path, target.fragment, target.group)
  else try { await platform.openExternal(target.href) } catch { notify('无法打开此链接。') }
}
function confirmRemove() {
  if (!removal.value) return
  if (skipRemoval.value) settings.confirmRemoval = false
  removeEntry(removal.value)
  removal.value = undefined
}
const side = ref(!detached && platform.kind !== 'android')
const outline = ref(platform.kind !== 'android')
const focus = ref(false)
const message = ref('')
const dragTarget = ref('')
const ghost = ref<{ name: string; x: number; y: number }>()
const dropGroup = ref('')
let cancelDrag: (() => void) | undefined
const surface = ref<HTMLElement>()
useSplitLayout(state, platform.capabilities.automaticSplitDirection || mobile.value, surface)
function navigateSeries(group: Group, step: number, continuous = false) {
  const path = adjacent(group, step)
  if (path) openDocument(path, '', group, 'current', continuous ? (step > 0 ? 'first' : 'last') : undefined)
}
let notifyTimer: number | undefined
const { merging, detach, mergeBack, acceptPending, restoreWindows } = useReadingWindows({
  windowId, detached, currentGroup, current, readers, closeTab, notify,
})

function notify(text: string) {
  message.value = text
  clearTimeout(notifyTimer)
  notifyTimer = window.setTimeout(() => message.value = '', 4800)
}
async function refreshLibrary(broadcast = false) {
  if (!native) { notify('浏览器预览需要重新选择文件或文件夹，才能读取磁盘上的更新。'); return }
  queuedRemoteSync ||= broadcast
  if (refreshing.value) { queuedRefresh = true; return }
  refreshing.value = true
  try {
    do {
      queuedRefresh = false
      const syncRemote = queuedRemoteSync
      queuedRemoteSync = false
      let remoteFailures = syncRemote ? await syncRepositories() : 0
      let unmanagedSources = false
      if (syncRemote) {
        await scanClones()
        unmanagedSources = roots.value.some(entry => localClones[entry.path]?.managed === false)
        for (const entry of [...roots.value]) {
          if (!localClones[entry.path] || localClones[entry.path]?.managed === false) continue
          try { await updateLocal(entry) } catch { remoteFailures++ }
        }
      }
      if (syncRemote) save('library-refresh', uid())
      clearRemoteDirectories()
      invalidateLibrary()
      for (const group of state.groups) {
        const tab = activeTab(group)
        const root = tab && rootFor(tab.path)
        if (root) indexSeries(root)
      }
      const [foldersRead, documentsRead] = await Promise.all([
        detached ? Promise.resolve<boolean[]>([]) : refreshDirectories(),
        Promise.all([...readers.values()].map(reader => reader.refresh())),
      ])
      if (syncRemote) notify(remoteFailures
        ? '部分远程仓库无法同步，保留上次选定的版本。'
        : foldersRead.includes(false) || documentsRead.includes(false)
          ? '刷新结束，部分文件或文件夹无法读取。'
          : unmanagedSources ? '已更新仓库并重读本地来源。Git 文件夹需先启用副本管理才能同步。' : '已更新仓库并重新读取文档库。')
    } while (queuedRefresh)
  } finally { refreshing.value = false }
}
async function select(entry: Entry) {
  if (!entry.directory) { openDocument(entry.path); if (mobile.value) { side.value = false; mobilePanel.value = undefined }; return }
  if (expanded.value.includes(entry.path)) {
    expanded.value = expanded.value.filter(path => path !== entry.path)
    return
  }
  expanded.value.push(entry.path)
  await expand(entry.path)
}
async function pick(directory: boolean) {
  try {
    const entries = await choose(directory)
    for (const entry of entries) {
      if (!entry.directory && !markdown.test(entry.path)) continue
      const existing = roots.value.find(root => pathKey(root.path) === pathKey(entry.path))
      if (!existing && (entry.directory || !folders.value.some(root => pathKey(entry.path).startsWith(pathKey(root.path).replace(/\/$/, '') + '/')))) roots.value.push(entry)
      if (entry.directory) {
        side.value = true
        if (mobile.value) mobilePanel.value = 'library'
        if (!expanded.value.includes(entry.path)) expanded.value.push(entry.path)
        delete contents[entry.path]
        clearSeries(entry.path)
        if (current.value && rootFor(current.value.path) === entry.path) indexSeries(entry.path)
        void expand(entry.path)
      } else openDocument(existing?.path || entry.path)
    }
    if (entries.some(entry => entry.directory)) focus.value = false
  } catch { notify('无法打开所选项目，请重试。') }
}
function showFolder(entry: Entry) {
  if (!roots.value.some(root => pathKey(root.path) === pathKey(entry.path))) roots.value.push(entry)
  if (!expanded.value.includes(entry.path)) expanded.value.push(entry.path)
  remoteDialog.value = undefined
  localDialog.value = undefined
  focus.value = false
  side.value = true
  if (mobile.value) mobilePanel.value = 'library'
  void expand(entry.path, true).then(ok => { if (!ok) notify('无法读取目录，请检查仓库或本地路径。') })
}
function addRemote(repo: RemoteRepository) {
  const path = remoteRoot(repo)
  const prefix = 'remote:/' + repo.id
  roots.value = roots.value.filter(root => root.path !== prefix && !root.path.startsWith(prefix + '/'))
  expanded.value = expanded.value.filter(item => (item !== prefix && !item.startsWith(prefix + '/')) || item === path)
  showFolder({ path, directory: true, label: remoteLabel(path) })
  void refreshLibrary()
}
function remove(entry: Entry) {
  if (!settings.confirmRemoval) { removeEntry(entry); return }
  skipRemoval.value = false
  removal.value = entry
}
function removeEntry(entry: Entry) {
  if (isRemote(entry.path)) forgetRepository(entry.path)
  roots.value = roots.value.filter(root => root.path !== entry.path)
  expanded.value = expanded.value.filter(path => path !== entry.path && !path.startsWith(entry.path + '/'))
}
function breadcrumbs(path: string) {
  const root = rootFor(path)
  if (!root) return [{ path: parentOf(path).replace(/\/$/, ''), label: nameOf(parentOf(path)) }]
  let directory = root
  const crumbs = [{ path: root, label: roots.value.find(entry => entry.path === root)?.label || remoteLabel(root) || nameOf(root) }]
  for (const part of path.slice(root.length + 1).split('/').slice(0, -1)) {
    directory += '/' + part
    crumbs.push({ path: directory, label: part })
  }
  return crumbs
}
async function folderMenu(event: MouseEvent, path: string, group: Group) {
  showMenu(event, [{ label: '正在读取…', disabled: true, run: () => {} }])
  const menu = context.value
  async function showFolder(directory: string) {
    let entries: Entry[]
    try { entries = await list(directory) }
    catch { entries = [] }
    if (!context.value || context.value !== menu) return
    context.value.actions = entries.map(entry => ({
      label: nameOf(entry.path) + (entry.directory ? ' ›' : ''),
      keepOpen: entry.directory,
      run: () => entry.directory ? void showFolder(entry.path) : openDocument(entry.path, '', group),
    }))
    if (!entries.length) context.value.actions = [{ label: '没有可打开的文档', disabled: true, run: () => {} }]
    context.value.y = Math.max(4, Math.min(context.value.y, innerHeight - Math.min(300, entries.length * 34 + 14) - 4))
  }
  await showFolder(path)
}
function resize(event: PointerEvent) {
  const bar = event.currentTarget as HTMLElement
  bar.setPointerCapture(event.pointerId)
  bar.onpointermove = move => {
    const bounds = surface.value?.getBoundingClientRect()
    if (!bounds) return
    const percent = state.axis === 'row' ? (move.clientX - bounds.left) / bounds.width : (move.clientY - bounds.top) / bounds.height
    state.ratio = Math.min(75, Math.max(25, percent * 100))
  }
  bar.onlostpointercapture = () => { bar.onpointermove = null }
}
function onStorage(event: StorageEvent) {
  if (event.key === 'folio:library-refresh') void refreshLibrary()
}
function documentPointer(event: PointerEvent, tab: Tab, source?: Group, link?: HTMLElement) {
  if (event.button !== 0 || mobile.value) return
  cancelDrag?.()
  const element = link || event.currentTarget as HTMLElement
  const { clientX: startX, clientY: startY, pointerId } = event
  let dragging = false
  function target(x: number, y: number) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return { kind: platform.capabilities.independentWindows ? 'window' : '' }
    const region = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-group]')
    const group = state.groups.find(item => item.id === region?.dataset.group)
    if (detached || !region || !group) return { kind: 'window' }
    const bounds = region.getBoundingClientRect()
    if (state.groups.length === 1 && y > bounds.bottom - 48) return { kind: 'column', group }
    if (state.groups.length === 1 && x > bounds.right - 48) return { kind: 'row', group }
    return { kind: state.groups.length > 1 && group !== source ? 'group' : platform.capabilities.independentWindows ? 'window' : '', group }
  }
  function cleanup() {
    dragTarget.value = ''
    dropGroup.value = ''
    ghost.value = undefined
    cancelDrag = undefined
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', finish)
    element.removeEventListener('lostpointercapture', cleanup)
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  }
  function move(event: PointerEvent) {
    if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) < 12) return
    dragging = true
    const destination = target(event.clientX, event.clientY)
    dragTarget.value = destination.kind
    dropGroup.value = destination.group?.id || ''
    ghost.value = {
      name: nameOf(tab.path),
      x: event.clientX,
      y: event.clientY,
    }
  }
  function finish(event: PointerEvent) {
    const destination = target(event.clientX, event.clientY)
    cleanup()
    if (!dragging) {
      if (source) { source.active = tab.id; state.focused = source.id }
      else if (!link) openDocument(tab.path, tab.fragment)
      return
    }
    if (link) {
      const suppress = (click: MouseEvent) => { click.preventDefault(); click.stopPropagation() }
      element.addEventListener('click', suppress, { capture: true, once: true })
      window.setTimeout(() => element.removeEventListener('click', suppress, true), 0)
    }
    if (source?.active === tab.id) readers.get(source.id)?.flush()
    if (destination.kind === 'window') void detach(tab, source, { x: event.screenX, y: event.screenY })
    else if (destination.kind === 'row' || destination.kind === 'column') {
      split(destination.kind, destination.group, tab, Boolean(source))
    } else if (destination.kind === 'group' && destination.group) {
      if (source) moveTab(source, destination.group, tab)
      else openTab(tab.path, tab.fragment, destination.group)
    }
  }
  cancelDrag = cleanup
  element.setPointerCapture(pointerId)
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', finish)
  element.addEventListener('lostpointercapture', cleanup)
}
type MenuAction = { label: string; run: () => void; disabled?: boolean; keepOpen?: boolean }
const context = ref<{ x: number; y: number; actions: MenuAction[] }>()
function showMenu(event: MouseEvent, actions: MenuAction[]) {
  event.preventDefault()
  if (mobile.value) mobilePanel.value = undefined
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  context.value = {
    x: Math.max(4, Math.min(event.clientX || bounds.left, innerWidth - 164)),
    y: Math.max(4, Math.min(event.clientY || bounds.bottom, innerHeight - actions.length * 36 - 12)),
    actions,
  }
}
function fileMenu(event: MouseEvent, entry: Entry) {
  if (entry.directory) {
    if (localClones[entry.path]) { if (localClones[entry.path]?.managed === false) adoption.value = localClones[entry.path]; else localDialog.value = localClones[entry.path]; return }
    const repo = repositories().find(item => remoteRoot(item) === entry.path)
    if (repo && event.type === 'click') { remoteDialog.value = repo; return }
    if (repo) showMenu(event, [
      { label: '仓库设置 / 克隆', run: () => { remoteDialog.value = repo } },
      { label: '刷新文档库', run: () => void refreshLibrary(true) },
    ])
    return
  }
  showMenu(event, [
    { label: '查看 Markdown 源码', run: () => openSource(currentGroup.value, entry.path) },
    { label: '在新标签打开', run: () => openDocument(entry.path, '', currentGroup.value, 'new') },
    { label: '在当前标签打开', run: () => openDocument(entry.path, '', currentGroup.value, 'current') },
    ...(mobile.value ? [{ label: '在另一阅读区打开', run: () => openOtherPane(entry.path) }] : []),
  ])
}
function linkMenu(event: MouseEvent, path: string, fragment: string, group: Group) {
  showMenu(event, detached
    ? [{ label: '在当前窗口打开', run: () => openDocument(path, fragment, group, 'current') }]
    : [
        { label: '在新标签打开', run: () => openDocument(path, fragment, group, 'new') },
        { label: '在当前标签打开', run: () => openDocument(path, fragment, group, 'current') },
        ...(mobile.value ? [{ label: '在另一阅读区打开', run: () => openOtherPane(path, fragment) }] : []),
      ])
}
function tabMenu(event: MouseEvent, group: Group, tab: Tab) {
  const index = group.tabs.indexOf(tab)
  const left = group.tabs.slice(0, index)
  const right = group.tabs.slice(index + 1)
  function closeMany(tabs: Tab[]) {
    if (tabs.some(item => item.id === group.active)) {
      readers.get(group.id)?.flush()
      group.active = tab.id
    }
    const ids = new Set(tabs.map(item => item.id))
    group.tabs = group.tabs.filter(item => !ids.has(item.id))
  }
  showMenu(event, [
    { label: '查看 Markdown 源码', run: () => openSource(group, tab.path) },
    { label: '关闭当前标签', run: () => closeTab(group, tab.id) },
    { label: '关闭其它', run: () => closeMany([...left, ...right]), disabled: !left.length && !right.length },
    { label: '关闭左边', run: () => closeMany(left), disabled: !left.length },
    { label: '关闭右边', run: () => closeMany(right), disabled: !right.length },
  ])
}
function dismissMenu(event: PointerEvent) {
  if (!(event.target as HTMLElement).closest('.context-menu, .mobile-sheet')) context.value = undefined
}
function mobileBack(event: Event) {
  if (event.defaultPrevented || adoption.value || sourceView.value || remoteDialog.value || localDialog.value || removal.value || linkPreview.value) return
  if (context.value) context.value = undefined
  else if (mobilePanel.value) mobilePanel.value = undefined
  else if (focus.value && mobile.value) focus.value = false
  else if (settingsOpen.value) settingsOpen.value = false
  else if (side.value) side.value = false
  else if (outline.value) outline.value = false
  else if (canTravel(currentGroup.value, 'back')) travel(currentGroup.value, 'back')
  else return
  event.preventDefault()
}
function shortcuts(event: KeyboardEvent) {
  if (adoption.value || sourceView.value || removal.value || linkPreview.value || (event.target as Element)?.closest('[role=dialog]')) return
  if (event.key === 'Escape' && context.value) { context.value = undefined; return }
  if (event.key === 'Escape') { mobilePanel.value = undefined; cancelDrag?.(); settingsOpen.value = false; focus.value = false; return }
  if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault()
    navigateSeries(currentGroup.value, event.key === 'ArrowLeft' ? -1 : 1)
    return
  }
  if (settings.readingMode === 'paged' && !event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey &&
      !(event.target as HTMLElement | null)?.closest?.('input, select, textarea, button, pre, table, [contenteditable], [role=dialog], .context-menu')) {
    const step = ['ArrowLeft', 'PageUp'].includes(event.key) ? -1 : ['ArrowRight', 'PageDown'].includes(event.key) ? 1 : 0
    if (step) { event.preventDefault(); readers.get(currentGroup.value.id)?.turn(step); return }
  }
  if (!event.ctrlKey && !event.metaKey) return
  if (event.key === '[' || event.key === ']') {
    event.preventDefault()
    travel(currentGroup.value, event.key === '[' ? 'back' : 'forward')
    return
  }
  if (detached && event.key === 'Enter') { event.preventDefault(); void mergeBack(); return }
  if (!detached && event.key.toLowerCase() === 'o') { event.preventDefault(); void pick(event.shiftKey) }
}
onMounted(async () => {
  mobileMedia.addEventListener('change', updateMobile)
  window.addEventListener('folio-back', mobileBack)
  window.addEventListener('storage', onStorage)
  window.addEventListener('keydown', shortcuts)
  window.addEventListener('mousedown', mouseHistory, true)
  window.addEventListener('mouseup', mouseHistory, true)
  window.addEventListener('auxclick', mouseHistory, true)
  window.addEventListener('pointerdown', dismissMenu, true)
  if (!detached) {
    acceptPending()
    void refreshDirectories()
  }
  restoreWindows()
})
onBeforeUnmount(() => { mobileMedia.removeEventListener('change', updateMobile); cancelDrag?.(); window.removeEventListener('folio-back', mobileBack); window.removeEventListener('mousedown', mouseHistory, true); window.removeEventListener('mouseup', mouseHistory, true); window.removeEventListener('auxclick', mouseHistory, true); window.removeEventListener('pointerdown', dismissMenu, true); window.removeEventListener('storage', onStorage); window.removeEventListener('keydown', shortcuts) })
</script>

<template>
  <div class="shell" :class="{ 'mobile-ui': mobile, 'mobile-immersive': mobile && focus }" :data-platform="platform.kind" :data-theme="settings.theme" :style="{ '--custom-paper': settings.tint || undefined }">
    <header v-if="!detached && !mobile" class="toolbar">
      <button class="brand" title="切换文件栏" @click="side = !side; focus = false"><span class="brand-mark"><BookOpen :size="19" /></span><span class="brand-name">Folio</span><span class="brand-sub">Markdown 阅读器</span></button>
      <div class="toolbar-actions">
        <button v-if="platform.capabilities.remoteRepositories" class="action" aria-label="添加远程仓库" title="添加远程仓库" @click="remoteDialog = true"><GitBranch :size="16" /><span>远程仓库</span></button>
        <button class="action" aria-label="打开文件" title="Ctrl+O" @click="pick(false)"><FilePlus2 :size="16" /><span>打开文件</span></button>
        <button class="action primary" aria-label="打开文件夹" title="Ctrl+Shift+O" @click="pick(true)"><FolderPlus :size="17" /><span>打开文件夹</span></button>
      </div>
      <div class="toolbar-end">
        <button class="action refresh-library" title="刷新文档库" aria-label="刷新文档库" :disabled="refreshing" @click="refreshLibrary(true)"><RotateCw :size="16" /><span>{{ refreshing ? '正在刷新' : '刷新文档库' }}</span></button>
        <button class="icon" title="切换文件栏" aria-label="切换文件栏" :aria-pressed="side && !focus" @click="side = !side; focus = false"><PanelLeft :size="17" /></button>
        <button class="icon" title="切换文章目录" aria-label="切换文章目录" :aria-pressed="outline && !focus" @click="outline = !outline; focus = false"><List :size="19" /></button>
        <button class="icon" title="专注阅读" aria-label="专注阅读" :aria-pressed="focus" @click="focus = !focus"><Maximize :size="17" /></button>
        <button class="icon" title="阅读设置" aria-label="阅读设置" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen"><Settings2 :size="18" /></button>
      </div>
    </header>

    <MobileReaderUI v-if="mobile && !detached" v-model:panel="mobilePanel" :state="state" :current="current" :status="readerStatus[currentGroup.id]"
      :crumbs="current ? breadcrumbs(current.path) : []" :immersive="focus" :paged="settings.readingMode === 'paged'" :refreshing="refreshing" :remote="platform.capabilities.remoteRepositories"
      :can-back="canTravel(currentGroup, 'back')" :can-forward="canTravel(currentGroup, 'forward')"
      @reveal="focus = false" @immersive="focus = true" @history="travel(currentGroup, $event)" @split="toggleMobileSplit"
      @source="openSource()" @pick="pick" @refresh="refreshLibrary(true)" @remote="remoteDialog = true" @heading="readers.get(currentGroup.id)?.jumpTo($event)"
      @select-tab="selectMobileTab" @close-tab="(group, tab) => closeTab(group, tab.id)" @tab-menu="tabMenu"
      @browse="(event, path) => folderMenu(event, path, currentGroup)">
      <template #library>
        <div class="mobile-library-tree">
          <div class="tree-label">文件夹与仓库 <span>{{ folders.length }}</span></div>
          <FileTree :touch="true" :entries="folders" :expanded="expanded" :contents="contents" :current="current?.path" removable @select="select" @remove="remove" @update="updateRepository" @file-menu="fileMenu" />
          <div class="tree-label singles">单篇文档 <span>{{ files.length }}</span></div>
          <FileTree :touch="true" :entries="files" :expanded="expanded" :contents="contents" :current="current?.path" removable @select="select" @remove="remove" @update="updateRepository" @file-menu="fileMenu" />
          <p v-if="!roots.length" class="mobile-empty-note">打开文件夹或连接仓库，开始你的阅读。</p>
        </div>
      </template>
      <template #settings><ReadingSettings :mobile="true" :settings="settings" @update="Object.assign(settings, $event)" @close="mobilePanel = undefined" /></template>
    </MobileReaderUI>
    <div class="workbench" :class="{ 'with-library': !mobile && !detached && side && !focus }">
      <aside v-if="!mobile && !detached && side && !focus" class="sidebar" aria-label="文档库">
        <div class="sidebar-heading"><Library :size="17" /><b>文档库</b><button class="icon" title="添加文件夹" aria-label="添加文件夹" @click="pick(true)"><Plus :size="17" /></button></div>
        <div class="tree-scroll">
          <div class="tree-label">文件夹 <span>{{ folders.length }}</span></div>
          <FileTree :touch="mobile" :entries="folders" :expanded="expanded" :contents="contents" :current="current?.path" removable @select="select" @remove="remove" @update="updateRepository" @file-menu="fileMenu" @document-pointer="(event, entry) => documentPointer(event, { id: uid(), path: entry.path })" />
          <div class="tree-label singles">独立文件 <span>{{ files.length }}</span></div>
          <FileTree :touch="mobile" v-if="files.length" :entries="files" :expanded="expanded" :contents="contents" :current="current?.path" removable @select="select" @remove="remove" @update="updateRepository" @file-menu="fileMenu" @document-pointer="(event, entry) => documentPointer(event, { id: uid(), path: entry.path })" />
          <button v-else class="add-file" @click="pick(false)"><Plus :size="14" /> 添加 Markdown 文件</button>
        </div>
        <div class="sidebar-foot"><span></span>{{ native ? '本地文档' : '浏览器预览' }}</div>
      </aside>
      <main ref="surface" class="surface" :class="state.axis">
        <template v-for="(group, index) in state.groups" :key="group.id">
          <div v-if="index" class="splitter" role="separator" tabindex="0" :aria-orientation="state.axis === 'row' ? 'vertical' : 'horizontal'"
            :aria-valuenow="Math.round(state.ratio)" @pointerdown="resize"
            @keydown.left.prevent="state.ratio = Math.max(25, state.ratio - 5)" @keydown.right.prevent="state.ratio = Math.min(75, state.ratio + 5)"
            @keydown.up.prevent="state.ratio = Math.max(25, state.ratio - 5)" @keydown.down.prevent="state.ratio = Math.min(75, state.ratio + 5)"></div>
          <section class="group" :data-group="group.id" :class="{ focused: state.focused === group.id }"
            :style="{ flex: state.groups.length === 1 ? '1' : (index ? 100 - state.ratio : state.ratio) + ' 1 0' }"
            @pointerdown="state.focused = group.id" @focusin="state.focused = group.id">
            <div v-if="!detached && !mobile" class="group-header">
              <div class="tabs" aria-label="已打开文档">
                <div v-for="tab in group.tabs" :key="tab.id" class="tab" @contextmenu="tabMenu($event, group, tab)" :class="{ selected: group.active === tab.id }">
                  <button class="tab-name" :title="tab.path" :aria-pressed="group.active === tab.id"
                    @pointerdown="documentPointer($event, tab, group)" @click="event => { if (event.detail === 0 || platform.kind === 'android') group.active = tab.id }"><BookOpen :size="14" /><span>{{ nameOf(tab.path) }}</span></button>
                  <button class="icon tab-close" :aria-label="'关闭 ' + nameOf(tab.path)" @click="closeTab(group, tab.id)"><X :size="13" /></button>
                </div>
              </div>
              <div class="pane-actions">
                <button class="icon" :title="platform.capabilities.automaticSplitDirection ? '分屏阅读（随设备旋转）' : '左右分屏'" :aria-label="platform.capabilities.automaticSplitDirection ? '分屏阅读' : '左右分屏'" :disabled="!activeTab(group)" @click="split('row', group)"><component :is="platform.capabilities.automaticSplitDirection && state.axis === 'column' ? Rows2 : Columns2" :size="16" /></button>
                <button v-if="!platform.capabilities.automaticSplitDirection" class="icon" title="上下分屏" aria-label="上下分屏" :disabled="!activeTab(group)" @click="split('column', group)"><Rows2 :size="16" /></button>
                <button v-if="platform.capabilities.independentWindows" class="icon" title="移到独立窗口" aria-label="移到独立窗口" :disabled="!activeTab(group)" @click="activeTab(group) && detach(activeTab(group)!, group)"><ExternalLink :size="16" /></button>
              </div>
            </div>
            <div v-if="mobile && state.groups.length > 1 && !focus" class="mobile-pane-heading" :class="{ active: state.focused === group.id }"><button @click="state.focused = group.id; mobilePanel = 'tabs'"><span>{{ index + 1 }}</span>{{ activeTab(group) ? nameOf(activeTab(group)!.path) : '选择文档' }}</button><button class="mobile-icon" aria-label="只保留此阅读区" @click="endSplit(group)"><X :size="16" /></button></div>
            <template v-if="activeTab(group)">
              <div v-if="!detached && !mobile" class="breadcrumb" :title="activeTab(group)!.path">
                <button class="icon history-button" aria-label="上一步" title="上一步 · Ctrl + ["
                  :disabled="!canTravel(group, 'back')" @click="travel(group, 'back')"><ChevronLeft :size="15" /></button>
                <button class="icon history-button" aria-label="下一步" title="下一步 · Ctrl + ]"
                  :disabled="!canTravel(group, 'forward')" @click="travel(group, 'forward')"><ChevronRight :size="15" /></button>
                <template v-for="crumb in breadcrumbs(activeTab(group)!.path)" :key="crumb.path">
                  <button class="crumb" :title="crumb.path" @click="folderMenu($event, crumb.path, group)">{{ crumb.label }}</button>
                  <ChevronRight :size="12" />
                </template>
                <b>{{ nameOf(activeTab(group)!.path) }}</b>
              </div>
              <Reader :key="activeTab(group)!.id + activeTab(group)!.path + (revisions[group.id] || 0)" :ref="instance => setReader(group.id, instance)" :tab="activeTab(group)!" :outline="!mobile && !detached && outline && !focus && !(state.groups.length > 1 && state.axis === 'row')"
                :centered="state.groups.length === 1 || state.axis === 'column'" :compact="state.groups.length > 1 && state.axis === 'row'" :font="settings.font" :line="settings.line" :width="settings.width"
                :mobile="mobile" :gutter="mobile ? settings.mobilePadding : undefined" :swipe-paging="settings.swipePaging" :tap-paging="settings.tapPaging"
                :paged="settings.readingMode === 'paged'" :animation="settings.pageAnimation"
                @toggle-chrome="mobile && (focus = !focus)" @status="readerStatus[group.id] = $event"
                :previous-document="Boolean(adjacent(group, -1))" :next-document="Boolean(adjacent(group, 1))"
                @page-boundary="step => navigateSeries(group, step, true)"
                @preview-link="(href, path, fragment) => previewLink(href, group, path, fragment)"
                @link-pointer="(event, path, fragment, link) => documentPointer(event, { id: uid(), path, fragment }, undefined, link)"
                @outline-selected="platform.kind === 'android' && (outline = false)" @position="anchor" @link-menu="(event, path, fragment) => linkMenu(event, path, fragment, group)" @navigate="(path, fragment) => openDocument(path, fragment, group)" @error="notify">
                <template #navigation>
              <footer v-if="detached || (settings.readingMode !== 'paged' && (adjacent(group, -1) || adjacent(group, 1)))" class="document-nav">
                <button v-if="settings.readingMode !== 'paged' && adjacent(group, -1)" class="action previous-document" title="Alt + ←" @click="navigateSeries(group, -1)"><ChevronLeft :size="15" />上一个文档</button>
                <button v-if="settings.readingMode !== 'paged' && adjacent(group, 1)" class="action next-document" title="Alt + →" @click="navigateSeries(group, 1)">下一个文档<ChevronRight :size="15" /></button>
                <div v-if="detached" class="detached-nav">
                  <button class="icon" title="刷新文档库" aria-label="刷新文档库" :disabled="refreshing" @click="refreshLibrary(true)"><RotateCw :size="15" /></button>
                  <button class="icon history-button" aria-label="上一步" :disabled="!canTravel(group, 'back')" @click="travel(group, 'back')"><ChevronLeft :size="15" /></button>
                  <button class="icon history-button" aria-label="下一步" :disabled="!canTravel(group, 'forward')" @click="travel(group, 'forward')"><ChevronRight :size="15" /></button>
                  <button class="action return-button" title="Ctrl + Enter" :disabled="merging" @click="mergeBack"><ArrowDownToLine :size="15" />移回主窗口</button>
                </div>
              </footer>
                </template>
              </Reader>
            </template>
            <div v-else class="blank"><BookOpen :size="34" /><h2>打开一篇文档</h2><p>从文档库选择 Markdown，或直接打开本地文件。</p><button class="action primary" @click="pick(false)">打开文件</button></div>
            <div v-if="dropGroup === group.id && dragTarget === 'group'" class="drop-overlay">在此阅读区打开</div>
            <div v-if="dropGroup === group.id && ['row', 'column'].includes(dragTarget)" class="drop-overlay edge" :class="dragTarget">松手分屏</div>
          </section>
        </template>
      </main>
    </div>
    <SourceViewer v-if="sourceView" :path="sourceView.path" :initial="sourceView.initial" :mobile="mobile" :source-paged="settings.sourceReadingMode === 'paged'" @mode="settings.sourceReadingMode = $event ? 'paged' : 'scroll'" @close="sourceView = undefined" @link="sourceLink" />
    <ReaderDialog v-if="adoption" title="启用本地副本管理？" confirm-label="启用并查看配置" @close="adoption = undefined" @confirm="adoptRepository">
      <p>{{ adoption.path }}</p><p>此目录是旧版克隆或手动打开的 Git 文件夹。启用后，仓库更新会以远程副本替换整个目录，本地修改及远程不存在的文件可能被覆盖。</p><p>请先将需要保留的文件备份到此目录之外。普通本地文件夹不会自动启用。</p>
    </ReaderDialog>
    <ReaderDialog v-if="removal" title="移出文档库？" confirm-label="移出" @close="removal = undefined" @confirm="confirmRemove">
      <p>{{ removal.label || nameOf(removal.path) }}</p><p>仅移出文档库，不会删除原文件或本地仓库。</p>
      <SettingSwitch label="以后不再提醒" :checked="skipRemoval" @change="skipRemoval = $event" />
    </ReaderDialog>
    <ReaderDialog v-if="linkPreview" :title="linkPreview.path ? '链接地址' : '打开外部链接？'" :confirm-label="linkPreview.path ? '打开文档' : '继续打开'" @close="linkPreview = undefined" @confirm="confirmLink">
      <p>{{ linkPreview.href }}</p><p v-if="!linkPreview.path">此链接将交给系统浏览器或外部应用打开。</p>
    </ReaderDialog>
    <RemoteDialog v-if="remoteDialog || localDialog" :local="localDialog" :existing="remoteDialog === true ? undefined : remoteDialog" @close="remoteDialog = undefined; localDialog = undefined"
      @connected="addRemote" @cloned="cloneAdded" />
    <ReadingSettings v-if="settingsOpen && !mobile" :settings="settings" @update="Object.assign(settings, $event)" @close="settingsOpen = false" />
    <div v-if="context && !mobile" class="context-menu" role="menu" aria-label="文档操作"
      :style="{ left: context.x + 'px', top: context.y + 'px' }" @contextmenu.prevent>
      <button v-for="action in context.actions" :key="action.label" role="menuitem" :disabled="action.disabled"
        @click="if (!action.keepOpen) context = undefined; action.run()">{{ action.label }}</button>
    </div>
    <MobileSheet v-if="context && mobile" title="文档操作" @close="context = undefined"><div class="mobile-context-actions" role="menu"><button v-for="action in context.actions" :key="action.label" role="menuitem" :disabled="action.disabled" @click="if (!action.keepOpen) context = undefined; action.run()">{{ action.label }}</button></div></MobileSheet>
    <div v-if="ghost" class="drag-ghost" :style="{ left: ghost.x + 'px', top: ghost.y + 'px' }"><BookOpen :size="15" /><span>{{ ghost.name }}</span></div>
    <div v-if="updating" class="toast" role="status">正在更新 {{ updating }} · {{ updateProgress?.phase || '下载新副本' }}<button v-if="platform.repositories.cancelClone" class="action" @click="platform.repositories.cancelClone()">取消</button></div>
    <div v-if="!updating && (message || dragTarget === 'window')" class="toast" role="status">{{ dragTarget === 'window' ? '松手移到独立窗口' : message }}</div>
  </div>
</template>
