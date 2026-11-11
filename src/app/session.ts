import type { Tab, Workspace } from '../core/reading'
export const uid = () => crypto.randomUUID()
export function workspace(tab?: Tab): Workspace {
  const id = uid()
  return { groups: [{ id, tabs: tab ? [tab] : [], active: tab?.id || '' }], focused: id, axis: 'row', ratio: 50 }
}
