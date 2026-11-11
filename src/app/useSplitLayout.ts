import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import type { Workspace } from '../core/reading'
import { splitDirection } from '../platform/policy'

/** Desktop keeps the chosen axis. Android derives it from the available viewport. */
export const useSplitLayout = (state: Workspace, automatic: boolean, surface: Ref<HTMLElement | undefined>) => {
  if (!automatic) return
  const update = () => {
    const orientation = screen.orientation?.type
    state.axis = orientation
      ? orientation.startsWith('portrait') ? 'column' : 'row'
      : splitDirection(screen.width || window.innerWidth, screen.height || window.innerHeight)
  }
  let observer: ResizeObserver | undefined
  watch(surface, element => {
    observer?.disconnect()
    if (element) {
      observer = new ResizeObserver(update)
      observer.observe(element)
    }
    update()
  })
  onMounted(() => {
    update()
    screen.orientation?.addEventListener('change', update)
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    screen.orientation?.removeEventListener('change', update)
    window.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('resize', update)
  })
}
