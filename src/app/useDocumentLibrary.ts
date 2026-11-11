import { computed, reactive, ref, watch } from 'vue'
import { load, save } from '../core/persistence'
import type { Group, Tab, Workspace } from '../core/reading'
import { pathKey, restorable } from '../documents/address'
import { demo, list } from '../documents/library'
import type { Entry } from '../documents/types'

export const useDocumentLibrary = (state: Workspace, activeTab: (group: Group) => Tab | undefined, notify: (message: string) => void) => {
  let libraryGeneration = 0
  const roots = ref(load<Entry[]>('roots', [{ path: demo, directory: true }]).filter(entry => restorable(entry.path)))
  const expanded = ref(load<string[]>('expanded', [demo]).filter(restorable))
  const contents = reactive<Record<string, Entry[]>>({})
  const folders = computed(() => roots.value.filter(entry => entry.directory))
  const files = computed(() => roots.value.filter(entry => !entry.directory))
  const series = reactive<Record<string, string[]>>({})
  const indexing = new Map<string, Promise<void>>()

  function rootFor(path: string) {
    const key = pathKey(path)
    return folders.value.filter(root => key.startsWith(pathKey(root.path).replace(/\/$/, '') + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0]?.path
  }
  function indexSeries(root: string) {
    if (series[root] || indexing.has(root)) return
    const generation = libraryGeneration
    const scan = async () => {
      const docs: string[] = []
      const pending: Entry[] = [{ path: root, directory: true }]
      while (pending.length && generation === libraryGeneration) {
        const entry = pending.pop()!
        if (!entry.directory) { docs.push(entry.path); continue }
        try { pending.push(...(await list(entry.path)).reverse()) } catch { /* A removed or inaccessible subtree has no available documents. */ }
      }
      if (generation === libraryGeneration) series[root] = docs
    }
    indexing.set(root, scan().finally(() => { if (generation === libraryGeneration) indexing.delete(root) }))
  }
  watch(() => state.groups.map(group => {
    const tab = activeTab(group)
    return tab && rootFor(tab.path)
  }), roots => roots.forEach(root => { if (root) indexSeries(root) }), { immediate: true })
  function adjacent(group: Group, step: number) {
    const tab = activeTab(group)
    if (!tab) return
    const root = rootFor(tab.path)
    const docs = root && series[root]
    if (!docs) return
    const index = docs.findIndex(path => pathKey(path) === pathKey(tab.path))
    if (index >= 0) return docs[index + step]
  }
  watch([roots, expanded], () => {
    save('roots', roots.value.filter(entry => restorable(entry.path)))
    save('expanded', expanded.value.filter(restorable))
  }, { deep: true })
  async function expand(path: string, force = false) {
    if (!force && contents[path]) return true
    const generation = libraryGeneration
    try {
      const entries = await list(path)
      if (generation === libraryGeneration) contents[path] = entries
      return true
    } catch (error) {
      if (generation === libraryGeneration) {
        contents[path] = []
        if (!force) notify(typeof error === 'string' ? error : '无法读取文件夹，请重新打开该文件夹。')
      }
      return false
    }
  }
  async function refreshDirectories() {
    const paths = [...new Set([...folders.value.map(entry => entry.path), ...expanded.value])]
    return Promise.all(paths.map(path => expand(path, true)))
  }

  const invalidateLibrary = () => {
    libraryGeneration++
    indexing.clear()
    Object.keys(series).forEach(path => delete series[path])
    Object.keys(contents).forEach(path => { if (!expanded.value.includes(path)) delete contents[path] })
  }
  const clearSeries = (root: string) => { delete series[root] }
  return { roots, expanded, contents, folders, files, rootFor, indexSeries, adjacent, expand, refreshDirectories, invalidateLibrary, clearSeries }
}
