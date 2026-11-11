export type Provider = 'github' | 'gitlab' | 'git'
export interface RemoteSource { provider: Provider; url: string; branch: string }
export interface Revision { commit: string; tree?: string }
export interface RemoteRepository extends RemoteSource {
  id: string
  directory: string
  revision: Revision
}
export interface RemoteEntry { name: string; directory: boolean }
export interface TreeEntry { path: string; type: string; mode: string }
export interface CloneProgress { phase: string; completed: number; total: number }
export interface CloneOptions { token?: string; progress?: (progress: CloneProgress) => void }
export interface RepositoryAccess {
  resolve(source: RemoteSource, directory: string, token: string | null): Promise<Revision>
  list(source: RemoteSource, commit: string, path: string): Promise<RemoteEntry[]>
  tree(source: RemoteSource, tree: string): Promise<TreeEntry[] | null>
  read(source: RemoteSource, commit: string, path: string): Promise<Uint8Array>
  clone(source: RemoteSource, options?: CloneOptions): Promise<string | null>
  cancelClone?: () => Promise<void>
}
