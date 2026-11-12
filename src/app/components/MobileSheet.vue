<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from '@lucide/vue'
defineProps<{ title: string; subtitle?: string }>()
const emit = defineEmits<{ close: [] }>()
const surface = ref<HTMLElement>()
const offset = ref(0)
let drag: { id: number; x: number; y: number; time: number } | undefined
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || (event.target as Element).closest('button')) return
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveDrag(event: PointerEvent) {
  if (drag?.id === event.pointerId && Math.abs(event.clientY - drag.y) > Math.abs(event.clientX - drag.x)) offset.value = Math.max(0, event.clientY - drag.y)
}
function finishDrag(event: PointerEvent) {
  if (drag?.id !== event.pointerId) return
  const close = offset.value > 100 || (offset.value > 45 && offset.value / Math.max(1, performance.now() - drag.time) > .65)
  drag = undefined
  offset.value = 0
  if (close) emit('close')
}
function cancelDrag() { drag = undefined; offset.value = 0 }
const previous = document.activeElement as HTMLElement | null
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close') }
  if (event.key !== 'Tab') return
  const items = [...surface.value!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(item => item.getClientRects().length)
  if (!items.length) { event.preventDefault(); surface.value?.focus(); return }
  const first = items[0]!, last = items.at(-1)!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === surface.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
onMounted(async () => { await nextTick(); surface.value?.focus() })
onBeforeUnmount(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }) })
</script>
<template>
  <div class="mobile-scrim" @click.self="emit('close')">
    <section ref="surface" :style="{ transform: offset ? 'translateY(' + offset + 'px)' : undefined }" @pointermove="moveDrag" @pointerup="finishDrag" @pointercancel="cancelDrag" class="mobile-sheet" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown="key">
      <div class="sheet-grip" aria-hidden="true" @pointerdown="startDrag"></div>
      <header class="sheet-heading" @pointerdown="startDrag"><div><h2>{{ title }}</h2><p v-if="subtitle">{{ subtitle }}</p></div><button class="mobile-icon" :aria-label="'关闭' + title" @click="emit('close')"><X :size="22" /></button></header>
      <div class="sheet-content"><slot /></div>
    </section>
  </div>
</template>
