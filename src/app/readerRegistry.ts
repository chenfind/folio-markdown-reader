export interface ReaderHandle {
  flush(): void
  turn(step: number): void
  refresh(): Promise<boolean>
}
