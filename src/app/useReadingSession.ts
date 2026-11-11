import { computed, reactive, watch } from 'vue'
import { load, save } from '../core/persistence'
import type { Anchor, Group, Tab, Workspace } from '../core/reading'
import { uid, workspace } from './session'
import { pathKey, restorable } from '../documents/address'
import { welcome } from '../documents/library'
import { getPlatform } from '../platform'
import { splitDirection } from '../platform/policy'
import type { ReadingSettings } from './useReadingSettings'
import type { ReaderHandle } from './readerRegistry'

export const useReadingSession = ({ windowId, detached, settings, readers }: {
  windowId: string
  detached: boolean
  settings: ReadingSettings
  readers: Map<string, ReaderHandle>
}) => {
  const platform = getPlatform()
  const start: Tab = { id: uid(), path: welcome }
  const previousLayout = load<Workspace>('layout:' + windowId, workspace(start))
  const detachedGroup = previousLayout.groups.find(group => group.id === previousLayout.focused) || previousLayout.groups[0]
  const state = reactive(detached ? workspace(detachedGroup?.tabs.find(tab => tab.id === detachedGroup.active)) : previousLayout)
  state.groups.forEach(group => {
    group.tabs = group.tabs.filter(tab => restorable(tab.path))
    if (!group.tabs.some(tab => tab.id === group.active)) group.active = group.tabs.at(-1)?.id || ''
  })
  const currentGroup = computed(() => state.groups.find(group => group.id === state.focused) || state.groups[0]!)
  const current = computed(() => currentGroup.value.tabs.find(tab => tab.id === currentGroup.value.active))
  const history = reactive<Record<string, { back: Tab[]; forward: Tab[] }>>({})
  const revisions = reactive<Record<string, number>>({})
  function snapshotTab(group: Group) {
    readers.get(group.id)?.flush()
    const tab = activeTab(group)
    return tab && { ...tab }
  }
  function openDocument(path: string, fragment = '', group = currentGroup.value, mode = settings.openMode, edge?: Tab['pageEdge']) {
    const previous = snapshotTab(group)
    if (previous && (pathKey(previous.path) !== pathKey(path) || fragment)) {
      const stack = history[group.id] ||= { back: [], forward: [] }
      stack.back.push(previous)
      if (stack.back.length > 100) stack.back.shift()
      stack.forward = []
    }
    openTab(path, fragment, group, undefined, mode, edge)
  }
  function canTravel(group: Group, direction: 'back' | 'forward') {
    return Boolean(history[group.id]?.[direction].length)
  }
  function travel(group: Group, direction: 'back' | 'forward') {
    const stack = history[group.id]
    const destination = stack?.[direction].pop()
    if (!stack || !destination) return
    const current = snapshotTab(group)
    if (current) stack[direction === 'back' ? 'forward' : 'back'].push(current)
    const index = group.tabs.findIndex(tab => tab.id === destination.id)
    if (index >= 0) group.tabs.splice(index, 1, destination)
    else if (detached) group.tabs = [destination]
    else group.tabs.push(destination)
    group.active = destination.id
    state.focused = group.id
    revisions[group.id] = (revisions[group.id] || 0) + 1
  }
  function mouseHistory(event: MouseEvent) {
    if (event.button !== 3 && event.button !== 4) return
    event.preventDefault()
    if (event.type === 'mouseup') travel(currentGroup.value, event.button === 3 ? 'back' : 'forward')
  }
  function openTab(path: string, fragment = '', group = currentGroup.value, source?: Tab, mode: 'new' | 'current' = 'new', edge?: Tab['pageEdge']) {
    const current = activeTab(group)
    const replacing = mode === 'current' || detached
    const matching = group.tabs.find(tab => pathKey(tab.path) === pathKey(path))
    const existing = replacing ? (current && pathKey(current.path) === pathKey(path) ? current : undefined) : matching
    if (current && current !== existing) readers.get(group.id)?.flush()
    const tab = existing || {
      id: replacing && current ? current.id : uid(),
      path,
      anchor: source?.anchor || matching?.anchor || load<Anchor | undefined>('position:' + pathKey(path), undefined),
    }
    if (fragment) tab.fragment = fragment
    if (edge) tab.pageEdge = edge
    if (!existing) {
      if (replacing && current) group.tabs.splice(group.tabs.indexOf(current), 1, tab)
      else group.tabs.push(tab)
    }
    group.active = tab.id
    state.focused = group.id
  }
  function anchor(tab: Tab, value: Anchor) {
    tab.anchor = value
    delete tab.fragment
    delete tab.pageEdge
    if (restorable(tab.path)) save('position:' + pathKey(tab.path), value)
  }
  function activeTab(group: Group) { return group.tabs.find(tab => tab.id === group.active) }
  function closeTab(group: Group, id: string) {
    const index = group.tabs.findIndex(tab => tab.id === id)
    if (index < 0) return
    group.tabs.splice(index, 1)
    if (group.active === id) group.active = (group.tabs[index] || group.tabs[index - 1])?.id || ''
    if (!group.tabs.length && state.groups.length > 1) {
      state.groups = state.groups.filter(item => item.id !== group.id)
      if (state.focused === group.id) state.focused = state.groups[0]!.id
    }
  }
  function split(axis: Workspace['axis'], source = currentGroup.value, tab = activeTab(source), move = false) {
    if (tab && source.active === tab.id) readers.get(source.id)?.flush()
    state.axis = platform.capabilities.automaticSplitDirection ? splitDirection(screen.width || innerWidth, screen.height || innerHeight) : axis
    const other = state.groups.find(group => group.id !== source.id)
    if (other) {
      if (move && tab) moveTab(source, other, tab)
      return
    }
    const id = uid()
    state.groups.push({ id, tabs: [], active: '' })
    state.focused = id
    if (tab) {
      openTab(tab.path, tab.fragment, currentGroup.value, tab)
      if (move && source.tabs.length > 1) closeTab(source, tab.id)
    }
  }
  function moveTab(source: Group, destination: Group, tab: Tab) {
    const duplicate = destination.tabs.findIndex(item => pathKey(item.path) === pathKey(tab.path))
    if (duplicate >= 0) destination.tabs.splice(duplicate, 1, tab)
    else destination.tabs.push(tab)
    destination.active = tab.id
    state.focused = destination.id
    closeTab(source, tab.id)
  }

  watch(state, () => save('layout:' + windowId, state), { deep: true, flush: 'sync' })
  return { state, currentGroup, current, revisions, openDocument, openTab, activeTab, anchor, closeTab, split, moveTab, canTravel, travel, mouseHistory }
}
