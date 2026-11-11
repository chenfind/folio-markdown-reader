export interface Anchor {
  heading: string
  block: string
  index: number
  within: number
  progress: number
  hash: string
}
export interface Tab { id: string; path: string; anchor?: Anchor; fragment?: string; pageEdge?: 'first' | 'last' }
export interface Group { id: string; tabs: Tab[]; active: string }
export interface Workspace { groups: Group[]; focused: string; axis: 'row' | 'column'; ratio: number }
