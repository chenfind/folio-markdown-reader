import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { RepositoryAccess, Revision, RemoteEntry, TreeEntry } from '../repositories/types'
import type { Platform } from './types'
import { capabilitiesFor } from './policy'


const repositoryAccess: RepositoryAccess = {
  resolve: (source, directory, token) => invoke<Revision>('remote_resolve', { source, directory, token }),
  list: (source, commit, path) => invoke<RemoteEntry[]>('remote_list', { source, commit, path }),
  tree: (source, tree) => invoke<TreeEntry[] | null>('remote_github_tree', { source, tree }),
  read: async (source, commit, path) => new Uint8Array(await invoke<ArrayBuffer>('remote_read', { source, commit, path })),
  clone: async () => { throw new Error('当前平台的内置 Git 适配尚未完成。') },
}

export const createNativePlatform = async (): Promise<Platform> => {
  const kind = await invoke<string>('runtime_platform')
  if (kind !== 'windows' && kind !== 'android') throw new Error('当前原生系统尚未适配。')
  if (kind === 'android') {
    const { androidPlatform } = await import('./android')
    return androidPlatform(repositoryAccess)
  }
  const { windows, files, cloneRepository } = await import('./windows')
  return { kind, capabilities: capabilitiesFor(kind), files, repositories: { ...repositoryAccess, clone: cloneRepository }, windows, openExternal: openUrl }
}
