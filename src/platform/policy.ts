import type { PlatformCapabilities, RuntimeKind } from './types'

const capabilities: Record<RuntimeKind, Readonly<PlatformCapabilities>> = {
  browser: { nativeFiles: false, remoteRepositories: false, cloneRepositories: false, independentWindows: true, automaticSplitDirection: false },
  windows: { nativeFiles: true, remoteRepositories: true, cloneRepositories: true, independentWindows: true, automaticSplitDirection: false },
  // Android uses SAF, Keystore and an embedded Git engine; independent windows stay disabled.
  android: { nativeFiles: true, remoteRepositories: true, cloneRepositories: true, independentWindows: false, automaticSplitDirection: true },
}

export const capabilitiesFor = (kind: RuntimeKind) => capabilities[kind]
export const splitDirection = (width: number, height: number): 'row' | 'column' =>
  height >= width ? 'column' : 'row'
