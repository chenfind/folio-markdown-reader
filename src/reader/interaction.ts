export interface Stroke { x: number; y: number; elapsed: number; width: number; startX: number }
export function swipeStep(stroke: Stroke): -1 | 0 | 1 {
  const distance = Math.max(44, Math.min(80, stroke.width * .12))
  if (stroke.startX < 24 || stroke.startX > stroke.width - 24 || stroke.elapsed > 900 ||
      Math.abs(stroke.x) < distance || Math.abs(stroke.x) < Math.abs(stroke.y) * 1.5) return 0
  return stroke.x < 0 ? 1 : -1
}
export function tapZone(x: number, y: number): 'center' | -1 | 1 {
  if (x >= .34 && x <= .66 && y >= .26 && y <= .74) return 'center'
  return x < .5 + (y - .5) * .32 ? -1 : 1
}
const controls = 'a,button,input,textarea,select,label,summary,audio,video,iframe,[role="button"],[role="link"],[role="slider"],[role="switch"],[role="checkbox"],[role="tab"],[role="textbox"],[contenteditable]:not([contenteditable="false"]),[data-reader-interactive],[draggable="true"],[tabindex]:not([tabindex="-1"]):not(.reading-scroll)'
export function scrollAxes(element: HTMLElement) {
  const style = getComputedStyle(element)
  return {
    x: element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2 && /auto|scroll/.test(style.overflowX),
    y: element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 2 && /auto|scroll/.test(style.overflowY),
  }
}
export function reservesInteraction(target: EventTarget | null, boundary?: HTMLElement, axis?: 'x' | 'y') {
  if (!(target instanceof Element)) return false
  if (target.closest(controls)) return true
  for (let element: Element | null = target; element && element !== boundary; element = element.parentElement) {
    if (!(element instanceof HTMLElement)) continue
    const axes = scrollAxes(element)
    if (axis ? axes[axis] : axes.x || axes.y) return true
  }
  return false
}
