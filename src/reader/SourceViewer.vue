<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, X } from '@lucide/vue'
import { bytes, read } from '../documents/library'
import { nameOf } from '../documents/address'
import { renderMarkdown } from './markdown'
import SettingSwitch from '../app/components/SettingSwitch.vue'
import { renderedLocation, sourceRatioAt, type SourceLocation } from './sourcePosition'

const props = defineProps<{ path: string; initial: SourceLocation; mobile: boolean; sourcePaged: boolean }>()
const emit = defineEmits<{ close: []; link: [string]; mode: [boolean] }>()
const surface = ref<HTMLElement>(), raw = ref<HTMLElement>(), rendered = ref<HTMLElement>()
const text = ref(''), html = ref(''), failure = ref(''), loading = ref(true)
const paged = ref(props.sourcePaged), compare = ref(false), linked = ref(true)
const page = ref(0), pages = ref(1), stride = ref(1), query = ref(''), matchIndex = ref(0)
const tail = ref(0)
const portrait = ref(true)
function orientation() { portrait.value = screen.orientation?.type ? screen.orientation.type.startsWith('portrait') : screen.height >= screen.width }
const lines = computed(() => text.value.split(/\r\n|\n|\r/))
const matches = computed(() => query.value ? lines.value.flatMap((line, index) => line.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()) ? [index] : []) : [])
let urls: string[] = [], disposed = false, observer: ResizeObserver | undefined, frame = 0
let leader: 'source' | 'rendered' = 'source'
let position: SourceLocation = { ...props.initial }
const previous = document.activeElement as HTMLElement | null
const rows = () => [...(raw.value?.querySelectorAll<HTMLElement>('.source-line') || [])]
function sourceLocation(): SourceLocation {
  const elements = rows(), top = raw.value?.scrollTop || 0
  let low = 0, high = elements.length
  while (low < high) { const middle = (low + high) >>> 1; if (elements[middle]!.offsetTop + elements[middle]!.offsetHeight <= top + 1) low = middle + 1; else high = middle }
  const index = Math.min(low, elements.length - 1), row = elements[index]
  return { line: Math.max(0, index), within: row ? Math.max(0, Math.min(.999, (top - row.offsetTop) / Math.max(1, row.offsetHeight))) : 0 }
}
function moveSource(target: SourceLocation) {
  const view = raw.value, row = rows()[Math.max(0, Math.min(lines.value.length - 1, target.line))]
  if (!view || !row) return
  const top = row.offsetTop + row.offsetHeight * target.within
  page.value = Math.max(0, Math.min(pages.value - 1, Math.floor(top / stride.value)))
  view.scrollTop = paged.value ? page.value * stride.value : top
}
function moveRendered(target: SourceLocation) {
  const view = rendered.value
  if (!view) return
  const elements = [...view.querySelectorAll<HTMLElement>('[data-source-start]')]
  const matching = elements.filter(el => Number(el.dataset.sourceStart) <= target.line && Number(el.dataset.sourceEnd) > target.line)
    .sort((a, b) => (Number(a.dataset.sourceEnd) - Number(a.dataset.sourceStart)) - (Number(b.dataset.sourceEnd) - Number(b.dataset.sourceStart)))
  const element = matching[0] || elements.find(el => Number(el.dataset.sourceStart) >= target.line) || elements.at(-1)
  if (!element) return
  const ratio = sourceRatioAt(Number(element.dataset.sourceStart), Number(element.dataset.sourceEnd), target)
  view.scrollTop += element.getBoundingClientRect().top - view.getBoundingClientRect().top + element.getBoundingClientRect().height * ratio
}
function onSourceScroll() {
  if (leader !== 'source') return
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => { position = sourceLocation(); page.value = Math.min(pages.value - 1, Math.floor((raw.value?.scrollTop || 0) / stride.value)); if (compare.value && linked.value) moveRendered(position) })
}
function onRenderedScroll() {
  if (leader !== 'rendered' || !linked.value) return
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => { if (rendered.value) { position = renderedLocation(rendered.value); moveSource(position) } })
}
function layout() {
  if (!raw.value) return
  stride.value = Math.max(22, Math.floor(raw.value.clientHeight / 22) * 22)
  const height = raw.value.querySelector<HTMLElement>('.source-text')?.offsetHeight || 0
  pages.value = Math.max(1, Math.ceil(height / stride.value))
  tail.value = paged.value ? Math.max(0, pages.value * stride.value - height + raw.value.clientHeight - stride.value) : 0
  const target = { ...position }
  void nextTick(() => {
    if (disposed) return
    leader = 'source'
    moveSource(target)
    if (compare.value && linked.value) moveRendered(target)
  })
}
function turn(step: number) {
  if (!raw.value) return
  leader = 'source'
  page.value = Math.max(0, Math.min(pages.value - 1, page.value + step))
  raw.value.scrollTop = page.value * stride.value
  position = sourceLocation()
  if (linked.value) moveRendered(position)
}
function find(step = 0) {
  if (!matches.value.length) return
  matchIndex.value = (matchIndex.value + step + matches.value.length) % matches.value.length
  position = { line: matches.value[matchIndex.value]!, within: 0 }
  leader = 'source'; moveSource(position); if (linked.value) moveRendered(position)
}
watch(query, () => { matchIndex.value = 0; find() })
watch(() => props.sourcePaged, value => { paged.value = value })
watch([paged, compare], async () => { emit('mode', paged.value); await nextTick(); layout() })
watch(linked, value => { if (value) { leader = 'source'; moveRendered(position) } })
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); return }
  if (event.key === 'Tab') {
    const items = [...surface.value!.querySelectorAll<HTMLElement>('button:not(:disabled),input,[tabindex="0"]')].filter(item => item.getClientRects().length)
    const first = items[0]!, last = items.at(-1)!
    if (event.shiftKey && (document.activeElement === first || document.activeElement === surface.value)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  if ((event.target as Element).closest('input,button') || !paged.value || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || getSelection()?.toString()) return
  if (['PageDown', 'ArrowRight', 'PageUp', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); turn(['PageDown', 'ArrowRight'].includes(event.key) ? 1 : -1) }
}
function back(event: Event) { if (event.defaultPrevented || document.querySelector('.reader-dialog')) return; event.preventDefault(); emit('close') }
function previewClick(event: MouseEvent) {
  const anchor = (event.target as Element).closest('a')
  if (anchor) { event.preventDefault(); emit('link', anchor.getAttribute('href') || '') }
}
onMounted(async () => {
  orientation()
  screen.orientation?.addEventListener('change', orientation)
  window.addEventListener('resize', orientation)
  window.addEventListener('folio-back', back)
  surface.value?.focus()
  try {
    const document = await read(props.path)
    if (disposed) return
    text.value = document.text
    const result = await renderMarkdown(document.text, props.path, bytes)
    if (disposed) { result.urls.forEach(url => URL.revokeObjectURL(url)); return }
    html.value = result.html; urls = result.urls; loading.value = false
    await nextTick(); layout()
    observer = new ResizeObserver(layout)
    if (raw.value) observer.observe(raw.value)
    rendered.value?.querySelectorAll('img').forEach(img => { void img.decode().then(() => { if (!disposed && linked.value) moveRendered(position) }).catch(() => {}) })
  } catch { if (!disposed) { failure.value = '无法读取源码，请关闭后刷新文档重试。'; loading.value = false } }
})
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); cancelAnimationFrame(frame); urls.forEach(url => URL.revokeObjectURL(url)); screen.orientation?.removeEventListener('change', orientation); window.removeEventListener('resize', orientation); window.removeEventListener('folio-back', back); if (previous?.isConnected) previous.focus({ preventScroll: true }) })
</script>
<template>
  <section ref="surface" class="source-viewer" :class="{ 'source-mobile': mobile, 'source-portrait': mobile && portrait }" role="dialog" aria-modal="true" aria-label="Markdown 源码" tabindex="-1" @keydown="key">
    <header><div><strong>Markdown 源码</strong><small>{{ nameOf(path) }} · 只读</small></div><button class="mobile-icon" aria-label="关闭源码" @click="emit('close')"><X :size="21" /></button></header>
    <div class="source-options">
      <div class="source-segments" aria-label="源码阅读模式"><button :aria-pressed="paged" @click="paged = true">分页</button><button :aria-pressed="!paged" @click="paged = false">滚动</button></div>
      <SettingSwitch label="对照阅读" :checked="compare" @change="compare = $event" />
      <SettingSwitch v-if="compare" label="同步位置" :checked="linked" @change="linked = $event" />
    </div>
    <form class="source-search" @submit.prevent="find(1)"><input v-model="query" type="search" placeholder="在源码中搜索" aria-label="搜索源码" /><output v-if="query">{{ matches.length ? matchIndex + 1 : 0 }} / {{ matches.length }}</output><button class="action" :disabled="!matches.length" type="submit">下一个</button></form>
    <p v-if="loading || failure" class="source-message">{{ failure || '正在读取源码…' }}</p>
    <div v-else class="source-panes" :class="{ comparing: compare }">
      <div class="source-column">
        <div ref="raw" class="source-scroll" :class="{ 'source-paged': paged }" tabindex="0" aria-label="只读 Markdown 原文" @scroll="onSourceScroll" @pointerdown="leader = 'source'" @wheel.passive="leader = 'source'" @keydown="leader = 'source'">
          <pre class="source-text"><span v-for="(line, index) in lines" :key="index" class="source-line" :class="{ 'source-match': query && matches[matchIndex] === index }" :data-label="index + 1">{{ line }}{{ index < lines.length - 1 ? '\n' : '' }}</span></pre><div aria-hidden="true" :style="{ height: tail + 'px' }"></div>
        </div>
        <nav v-if="paged" class="source-pagination" aria-label="源码翻页"><button class="action" :disabled="page <= 0" @click="turn(-1)"><ChevronLeft :size="16" />上一页</button><output>{{ page + 1 }} / {{ pages }}</output><button class="action" :disabled="page >= pages - 1" @click="turn(1)">下一页<ChevronRight :size="16" /></button></nav>
      </div>
      <div v-show="compare" ref="rendered" class="source-preview markdown" tabindex="0" aria-label="源码对照正文" @scroll="onRenderedScroll" @pointerdown="leader = 'rendered'" @wheel.passive="leader = 'rendered'" @keydown="leader = 'rendered'" @click="previewClick" v-html="html"></div>
    </div>
  </section>
</template>
<style scoped>
.source-viewer { position: fixed; inset: 0; z-index: 25; display: flex; flex-direction: column; background: var(--paper); color: var(--ink); padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); outline: none; }
header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; border-bottom: 1px solid var(--stroke); background: var(--panel); }
header > div { display: grid; gap: 4px; min-width: 0; }
header small { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-options { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; padding: 8px 20px; }
.source-options :deep(.setting-switch-row) { width: auto; gap: 12px; padding-block: 4px; min-height: 44px; }
.source-segments { display: flex; background: var(--chrome); border-radius: 9px; padding: 3px; }
.source-segments button { min-height: 44px; min-width: 60px; border-radius: 6px; }
.source-segments [aria-pressed=true] { background: var(--selection); color: var(--accent); }
.source-search { display: flex; gap: 10px; align-items: center; margin: 0 20px 12px; }
.source-search input { min-width: 0; flex: 1; max-width: 480px; min-height: 44px; padding: 8px 10px; border: 1px solid var(--stroke); border-radius: 8px; background: var(--panel); color: var(--ink); }
.source-search output { white-space: nowrap; font-size: 12px; }
.source-panes { flex: 1; display: flex; min-height: 0; min-width: 0; }
.source-column { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.source-scroll { flex: 1; min-height: 0; overflow: auto; position: relative; overscroll-behavior: contain; }
.source-scroll.source-paged { overflow: hidden; }
.source-scroll:focus-visible, .source-preview:focus-visible { outline: none; }
.source-text { margin: 0; font: 13px/22px Consolas, 'Cascadia Mono', monospace; white-space: pre-wrap; tab-size: 4; }
.source-line { display: block; min-height: 22px; padding-left: 64px; padding-right: 16px; position: relative; overflow-wrap: anywhere; }
.source-line::before { content: attr(data-label); position: absolute; left: 0; top: 0; width: 48px; padding-right: 10px; text-align: right; color: var(--muted); border-right: 1px solid var(--stroke); user-select: none; }
.source-match { background: var(--selection); }
.source-pagination { display: flex; align-items: center; justify-content: space-between; padding: 7px 20px; border-top: 1px solid var(--stroke); gap: 8px; }
.source-pagination button, .source-search button { min-height: 44px; }
.source-preview { flex: 1; min-height: 0; min-width: 0; overflow: auto; margin: 0; padding: 20px; border-left: 1px solid var(--stroke); overscroll-behavior: contain; font-size: 16px; line-height: 1.8; }
.source-message { padding: 20px; }
.source-mobile.source-portrait .source-panes.comparing { flex-direction: column; }
.source-mobile.source-portrait .source-preview { border-left: 0; border-top: 1px solid var(--stroke); }
@media (max-width: 500px) { .source-options { gap: 4px 12px; padding-inline: 12px; } .source-search { margin-inline: 12px; } header { padding-inline: 12px; } }
</style>
