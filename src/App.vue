<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowDownToLine, BookOpen, ChevronLeft, ChevronRight, Columns2, ExternalLink, FilePlus2, FolderPlus, GitBranch, Library, List, Maximize, PanelLeft, Plus, RotateCw, Rows2, Settings2, X } from '@lucide/vue'
import { getPlatform } from './platform'
import { useSplitLayout } from './app/useSplitLayout'
import { useReadingSettings } from './app/useReadingSettings'
import { useReadingSession } from './app/useReadingSession'
import { useDocumentLibrary } from './app/useDocumentLibrary'
import { useReadingWindows } from './app/useReadingWindows'
import type { ReaderHandle } from './app/readerRegistry'
import FileTree from './documents/FileTree.vue'
import Reader from './reader/Reader.vue'
import RemoteDialog from './repositories/RemoteDialog.vue'
import ReadingSettings from './app/components/ReadingSettings.vue'
import { clearRemoteDirectories, forgetRepository, remoteLabel, remoteRoot, repositories, syncRepositories } from './repositories/remote'
import type { RemoteRepository } from './repositories/types'
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
const refreshing = ref(false)
let queuedRefresh = false
const settingsOpen = ref(false)
const remoteDialog = ref<true | RemoteRepository>()
const side = ref(!detached && platform.kind !== 'android')
const outline = ref(platform.kind !== 'android')
const focus = ref(false)
const message = ref('')
const dragTarget = ref('')
const ghost = ref<{ name: string; x: number; y: number }>()
const dropGroup = ref('')
let cancelDrag: (() => void) | undefined
const surface = ref<HTMLElement>()
useSplitLayout(state, platform.capabilities.automaticSplitDirection, surface)
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
  if (refreshing.value) { queuedRefresh = true; return }
  refreshing.value = true
  try {
    do {
      queuedRefresh = false
      const remoteFailures = broadcast ? await syncRepositories() : 0
      if (broadcast) save('library-refresh', uid())
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
      if (broadcast) notify(remoteFailures
        ? '部分远程仓库无法同步，保留上次选定的版本。'
        : foldersRead.includes(false) || documentsRead.includes(false)
          ? '刷新结束，部分文件或文件夹无法读取。'
          : '已重新读取文档库。')
    } while (queuedRefresh)
  } finally { refreshing.value = false }
}
async function select(entry: Entry) {
  if (!entry.directory) { openDocument(entry.path); if (platform.kind === 'android') side.value = false; return }
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
  focus.value = false
  side.value = true
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
  if (isRemote(entry.path)) forgetRepository(entry.path)
  roots.value = roots.value.filter(root => root.path !== entry.path)
  expanded.value = expanded.value.filter(path => path !== entry.path && !path.startsWith(entry.path + '/'))
}
function breadcrumbs(path: string) {
  const root = rootFor(path)
  if (!root) return [{ path: parentOf(path).replace(/\/$/, ''), label: nameOf(parentOf(path)) }]
  let directory = root
  const crumbs = [{ path: root, label: remoteLabel(root) || nameOf(root) }]
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
  if (event.button !== 0 || (platform.kind === 'android' && event.pointerType === 'touch')) return
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
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  context.value = {
    x: Math.max(4, Math.min(event.clientX || bounds.left, innerWidth - 164)),
    y: Math.max(4, Math.min(event.clientY || bounds.bottom, innerHeight - actions.length * 36 - 12)),
    actions,
  }
}
function fileMenu(event: MouseEvent, entry: Entry) {
  if (entry.directory) {
    const repo = repositories().find(item => remoteRoot(item) === entry.path)
    if (repo) showMenu(event, [
      { label: '仓库设置 / 克隆', run: () => { remoteDialog.value = repo } },
      { label: '刷新文档库', run: () => void refreshLibrary(true) },
    ])
    return
  }
  showMenu(event, [
    { label: '在新标签打开', run: () => openDocument(entry.path, '', currentGroup.value, 'new') },
    { label: '在当前标签打开', run: () => openDocument(entry.path, '', currentGroup.value, 'current') },
  ])
}
function linkMenu(event: MouseEvent, path: string, fragment: string, group: Group) {
  showMenu(event, detached
    ? [{ label: '在当前窗口打开', run: () => openDocument(path, fragment, group, 'current') }]
    : [
        { label: '在新标签打开', run: () => openDocument(path, fragment, group, 'new') },
        { label: '在当前标签打开', run: () => openDocument(path, fragment, group, 'current') },
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
    { label: '关闭当前标签', run: () => closeTab(group, tab.id) },
    { label: '关闭其它', run: () => closeMany([...left, ...right]), disabled: !left.length && !right.length },
    { label: '关闭左边', run: () => closeMany(left), disabled: !left.length },
    { label: '关闭右边', run: () => closeMany(right), disabled: !right.length },
  ])
}
function dismissMenu(event: PointerEvent) {
  if (!(event.target as HTMLElement).closest('.context-menu')) context.value = undefined
}
function mobileBack(event: Event) {
  if (event.defaultPrevented || remoteDialog.value) return
  if (settingsOpen.value) settingsOpen.value = false
  else if (side.value) side.value = false
  else if (outline.value) outline.value = false
  else if (canTravel(currentGroup.value, 'back')) travel(currentGroup.value, 'back')
  else return
  event.preventDefault()
}
function shortcuts(event: KeyboardEvent) {
  if (event.key === 'Escape' && context.value) { context.value = undefined; return }
  if (event.key === 'Escape') { cancelDrag?.(); settingsOpen.value = false; focus.value = false; return }
  if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault()
    navigateSeries(currentGroup.value, event.key === 'ArrowLeft' ? -1 : 1)
    return
  }
  if (settings.readingMode === 'paged' && !event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey &&
      !(event.target as HTMLElement | null)?.closest?.('input, select, textarea, pre, table, [contenteditable], .context-menu')) {
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
  window.addEventListener('folio-back', mobileBack)
  window.addEventListener('storage', onStorage)
  window.addEventListener('keydown', shortcuts)
  window.addEventListener('mousedown', mouseHistory, true)
  window.addEventListener('mouseup', mouseHistory, true)
  window.addEventListener('auxclick', mouseHistory, true)
  window.addEventListener('pointerdown', dismissMenu, true)
  if (!detached) {
    acceptPending()
    if (native && repositories().length) {
      const failures = await syncRepositories()
      if (failures) notify('部分远程仓库无法同步，保留上次选定的版本。')
      await refreshLibrary()
    } else void refreshDirectories()
  }
  restoreWindows()
})
onBeforeUnmount(() => { cancelDrag?.(); window.removeEventListener('folio-back', mobileBack); window.removeEventListener('mousedown', mouseHistory, true); window.removeEventListener('mouseup', mouseHistory, true); window.removeEventListener('auxclick', mouseHistory, true); window.removeEventListener('pointerdown', dismissMenu, true); window.removeEventListener('storage', onStorage); window.removeEventListener('keydown', shortcuts) })
</script>

<template>
  <div class="shell" :data-platform="platform.kind" @contextmenu.prevent :data-theme="settings.theme" :style="{ '--custom-paper': settings.tint || undefined }">
    <header v-if="!detached" class="toolbar">
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
    <div class="workbench" :class="{ 'with-library': !detached && side && !focus }">
      <aside v-if="!detached && side && !focus" class="sidebar" aria-label="文档库">
        <div class="sidebar-heading"><Library :size="17" /><b>文档库</b><button class="icon" title="添加文件夹" aria-label="添加文件夹" @click="pick(true)"><Plus :size="17" /></button></div>
        <div class="tree-scroll">
          <div class="tree-label">文件夹 <span>{{ folders.length }}</span></div>
          <FileTree :touch="platform.kind === 'android'" :entries="folders" :expanded="expanded" :contents="contents" :current="current?.path" removable @select="select" @remove="remove" @file-menu="fileMenu" @document-pointer="(event, entry) => documentPointer(event, { id: uid(), path: entry.path })" />
          <div class="tree-label singles">独立文件 <span>{{ files.length }}</span></div>
          <FileTree :touch="platform.kind === 'android'" v-if="files.length" :entries="files" :expanded="expanded" :contents="contents" :current="current?.path" removable @select="select" @remove="remove" @file-menu="fileMenu" @document-pointer="(event, entry) => documentPointer(event, { id: uid(), path: entry.path })" />
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
            <div v-if="!detached" class="group-header">
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
            <template v-if="activeTab(group)">
              <div v-if="!detached" class="breadcrumb" :title="activeTab(group)!.path">
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
              <Reader :key="activeTab(group)!.id + activeTab(group)!.path + (revisions[group.id] || 0)" :ref="instance => setReader(group.id, instance)" :tab="activeTab(group)!" :outline="!detached && outline && !focus && !(state.groups.length > 1 && state.axis === 'row')"
                :centered="state.groups.length === 1 || state.axis === 'column'" :compact="state.groups.length > 1 && state.axis === 'row'" :font="settings.font" :line="settings.line" :width="settings.width"
                :paged="settings.readingMode === 'paged'" :animation="settings.pageAnimation"
                :previous-document="Boolean(adjacent(group, -1))" :next-document="Boolean(adjacent(group, 1))"
                @page-boundary="step => navigateSeries(group, step, true)"
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
    <RemoteDialog v-if="remoteDialog" :existing="remoteDialog === true ? undefined : remoteDialog" @close="remoteDialog = undefined"
      @connected="addRemote" @cloned="(path, label) => showFolder({ path, label, directory: true })" />
    <ReadingSettings v-if="settingsOpen" :settings="settings" @update="Object.assign(settings, $event)" @close="settingsOpen = false" />
    <div v-if="context" class="context-menu" role="menu" aria-label="文档操作"
      :style="{ left: context.x + 'px', top: context.y + 'px' }" @contextmenu.prevent>
      <button v-for="action in context.actions" :key="action.label" role="menuitem" :disabled="action.disabled"
        @click="if (!action.keepOpen) context = undefined; action.run()">{{ action.label }}</button>
    </div>
    <div v-if="ghost" class="drag-ghost" :style="{ left: ghost.x + 'px', top: ghost.y + 'px' }"><BookOpen :size="15" /><span>{{ ghost.name }}</span></div>
    <div v-if="message || dragTarget === 'window'" class="toast" role="status">{{ dragTarget === 'window' ? '松手移到独立窗口' : message }}</div>
  </div>
</template>
