export interface SourceLocation { line: number; within: number }
export const sourceLineAt = (start: number, end: number, ratio: number): SourceLocation => {
  const offset = Math.max(0, Math.min(.999999, ratio)) * Math.max(1, end - start)
  return { line: start + Math.floor(offset), within: offset % 1 }
}
export const sourceRatioAt = (start: number, end: number, position: SourceLocation) =>
  Math.max(0, Math.min(1, (position.line + position.within - start) / Math.max(1, end - start)))

export function renderedLocation(view: HTMLElement): SourceLocation {
  const bounds = view.getBoundingClientRect()
  const blocks = [...view.querySelectorAll<HTMLElement>('[data-source-start]')].flatMap(element =>
    [...element.getClientRects()].filter(rect => rect.right > bounds.left + 1 && rect.left < bounds.right - 1 && rect.bottom > bounds.top + 2)
      .map(rect => ({ element, rect })))
  const crossing = blocks.filter(({ rect }) => rect.top <= bounds.top + 4).sort((a, b) => a.rect.height - b.rect.height)[0]
  const selected = crossing || blocks.sort((a, b) => a.rect.top - b.rect.top)[0]
  if (!selected) return { line: 0, within: 0 }
  const { element, rect } = selected
  return sourceLineAt(Number(element.dataset.sourceStart), Number(element.dataset.sourceEnd), (bounds.top - rect.top) / Math.max(1, rect.height))
}
