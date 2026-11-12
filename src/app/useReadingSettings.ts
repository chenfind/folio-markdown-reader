import { onBeforeUnmount, reactive, watch } from 'vue'
import { load, save } from '../core/persistence'

export interface ReadingSettings {
  theme: string
  font: number
  line: number
  width: number
  tint: string
  swipePaging: boolean
  tapPaging: boolean
  mobilePadding: number
  confirmRemoval: boolean
  openMode: 'new' | 'current'
  readingMode: 'scroll' | 'paged'
  sourceReadingMode: 'scroll' | 'paged'
  pageAnimation: 'none' | 'slide' | 'curl'
}
export const defaultSettings: Readonly<ReadingSettings> = Object.freeze({
  swipePaging: true, tapPaging: true, mobilePadding: 24, confirmRemoval: true,
  theme: 'light', font: 17, line: 1.8, width: 700, tint: '',
  openMode: 'new', readingMode: 'scroll', sourceReadingMode: 'paged', pageAnimation: 'slide',
})

export const useReadingSettings = () => {
  const settings = reactive({ ...defaultSettings, ...load<Partial<ReadingSettings>>('settings', {}) })
  watch(settings, () => save('settings', settings), { deep: true })
  const onStorage = (event: StorageEvent) => {
    if (event.key === 'folio:settings') Object.assign(settings, defaultSettings, load('settings', {}))
  }
  window.addEventListener('storage', onStorage)
  onBeforeUnmount(() => window.removeEventListener('storage', onStorage))
  return settings
}
