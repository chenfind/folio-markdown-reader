import type { FileAccess } from '../documents/types'
import type { RepositoryAccess } from '../repositories/types'

export type RuntimeKind = 'browser' | 'windows' | 'android'
export interface PlatformCapabilities {
  nativeFiles: boolean
  remoteRepositories: boolean
  cloneRepositories: boolean
  independentWindows: boolean
  automaticSplitDirection: boolean
}
export interface WindowOptions {
  url: string
  title: string
  width: number
  height: number
  minWidth: number
  minHeight: number
  x?: number
  y?: number
}
export interface ReadingWindows {
  create(id: string, options: WindowOptions): Promise<void>
  focus(id: string): Promise<boolean>
  closeCurrent(): Promise<void>
  onCloseRequested(handler: () => void): Promise<() => void>
}
export interface Platform {
  kind: RuntimeKind
  capabilities: Readonly<PlatformCapabilities>
  files: FileAccess
  repositories: RepositoryAccess
  windows: ReadingWindows
  openExternal(url: string): Promise<void>
}
