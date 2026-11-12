<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from '@lucide/vue'
defineProps<{ title: string; confirmLabel: string }>()
const emit = defineEmits<{ close: []; confirm: [] }>()
const surface = ref<HTMLElement>()
const previous = document.activeElement as HTMLElement | null
let pressedInside = false
function guardClick(event: MouseEvent) {
  if (event.detail > 0 && !pressedInside) { event.preventDefault(); event.stopPropagation() }
  pressedInside = false
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close') }
  if (event.key !== 'Tab') return
  const items = [...surface.value!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')]
  const first = items[0]!, last = items.at(-1)!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === surface.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
function back(event: Event) { event.preventDefault(); emit('close') }
onMounted(async () => { window.addEventListener('folio-back', back); await nextTick(); surface.value?.focus() })
onBeforeUnmount(() => { window.removeEventListener('folio-back', back); if (previous?.isConnected) previous.focus({ preventScroll: true }) })
</script>
<template>
  <div class="reader-dialog-scrim" @pointerdown.capture="pressedInside = true" @click.capture="guardClick" @pointerdown.self="emit('close')">
    <section ref="surface" class="reader-dialog" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown="key">
      <header><h2>{{ title }}</h2><button class="icon" :aria-label="'关闭' + title" @click="emit('close')"><X :size="20" /></button></header>
      <div class="reader-dialog-content"><slot /></div>
      <footer><button class="action" @click="emit('close')">取消</button><button class="action primary" @click="emit('confirm')">{{ confirmLabel }}</button></footer>
    </section>
  </div>
</template>
<style scoped>
.reader-dialog-scrim { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; background: #101c2866; padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); }
.reader-dialog { width: min(440px, 100%); max-height: 85dvh; overflow: auto; background: var(--panel); color: var(--ink); border: 1px solid var(--stroke); border-radius: 18px; padding: 20px; box-shadow: 0 16px 56px #101c2840; outline: none; }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 17px; margin: 0; }
.reader-dialog-content { margin-block: 18px; line-height: 1.7; overflow-wrap: anywhere; user-select: text; }
footer { justify-content: flex-end; }
button { min-height: 44px; min-width: 44px; }
</style>
