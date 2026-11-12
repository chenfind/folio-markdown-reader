import type { Heading } from '../reader/markdown'
export interface ReaderStatus {
  headings: Heading[]
  active: string
  progress: number
  page: number
  pages: number
}
export interface ReaderHandle {
  flush(): void
  turn(step: number): void
  refresh(): Promise<boolean>
  jumpTo(id: string): void
  sourcePosition(): import('../reader/sourcePosition').SourceLocation
}
