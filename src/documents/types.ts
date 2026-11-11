export interface Entry { path: string; directory: boolean; label?: string }
export interface FileAccess {
  choose(directory: boolean): Promise<Entry[]>
  list(path: string): Promise<Entry[]>
  read(path: string): Promise<Uint8Array>
}
