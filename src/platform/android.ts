import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { Entry } from '../documents/types'
import type { CloneProgress, RepositoryAccess } from '../repositories/types'
import type { Platform } from './types'
import { capabilitiesFor } from './policy'

const mobile = <T>(command: string, payload: object = {}) =>
  invoke<T>('mobile_request', { command, payload })

export const androidPlatform = (repositories: RepositoryAccess): Platform => {
  const noWindow = async (): Promise<never> => { throw new Error('Android 版使用应用内分屏。') }
  return {
    kind: 'android',
    capabilities: capabilitiesFor('android'),
    files: {
      choose: async directory => (await mobile<{ entries: Entry[] }>('choose', { directory })).entries,
      list: async path => (await mobile<{ entries: Entry[] }>('list', { path })).entries,
      read: async path => {
        const { data } = await mobile<{ data: string }>('read', { path })
        return Uint8Array.from(atob(data), character => character.charCodeAt(0))
      },
    },
    repositories: {
      ...repositories,
      clone: async (source, options) => {
        let statusPending = false
        const timer = window.setInterval(async () => {
          if (statusPending) return
          statusPending = true
          try { options?.progress?.(await mobile<CloneProgress>('cloneStatus')) }
          catch { /* The clone result reports connection failures. */ }
          finally { statusPending = false }
        }, 350)
        try {
          const result = await mobile<{ path: string }>('cloneStart', { ...source, token: options?.token || '' })
          return result.path
        } finally { clearInterval(timer) }
      },
      cancelClone: async () => { await mobile('cloneCancel') },
    },
    windows: { create: noWindow, focus: async () => false, closeCurrent: noWindow, onCloseRequested: async () => () => {} },
    openExternal: openUrl,
  }
}
