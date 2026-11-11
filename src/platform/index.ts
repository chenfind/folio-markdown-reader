import { isTauri } from '@tauri-apps/api/core'
import type { Platform } from './types'
import { createBrowserPlatform } from './browser'

let current: Platform | undefined

export const initializePlatform = async (): Promise<void> => {
  if (current) return
  current = isTauri() ? await (await import('./tauri')).createNativePlatform() : createBrowserPlatform()
}

export const getPlatform = (): Platform => {
  if (!current) throw new Error('平台服务尚未初始化。')
  return current
}
