<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renderMarkdown, type Heading } from './markdown'
import { closestAnchorBlock } from './position'
import './reader.css'
import { BookOpen, ChevronLeft, ChevronRight, List, RotateCw } from '@lucide/vue'
import { bytes, external, read, welcome } from '../documents/library'
import { localPath, markdown, nameOf } from '../documents/address'
import type { Anchor, Tab } from '../core/reading'

const props = defineProps<{ tab: Tab; outline: boolean; centered: boolean; compact: boolean; font: number; line: number; width: number; paged: boolean; animation: 'none' | 'slide' | 'curl'; previousDocument: boolean; nextDocument: boolean }>()
const emit = defineEmits<{ position: [Tab, Anchor]; navigate: [string, string]; linkMenu: [MouseEvent, string, string]; linkPointer: [PointerEvent, string, string, HTMLElement]; pageBoundary: [number]; outlineSelected: []; error: [string] }>()
const scroller = ref<HTMLElement>()
const article = ref<HTMLElement>()
const html = ref('')
const error = ref('')
const loading = ref(true)
const titles = ref<Heading[]>([])
const active = ref('')
const progress = ref(0)
const page = ref(0)
const pages = ref(1)
const pageHeight = ref(0)
const gap = 24
let effect: Animation | undefined
let userTurned = false
let clickOrigin: { x: number; y: number } | undefined

function stride() { return (article.value?.clientWidth || 0) + gap }
function paginate() {
  const view = scroller.value
  const body = article.value
  if (!props.paged || !view || !body) return
  pages.value = Math.max(1, 1 + Math.round((body.scrollWidth - body.clientWidth) / stride()))
}
function showPage(index: number) {
  const body = article.value
  if (!body) return
  page.value = Math.max(0, Math.min(pages.value - 1, index))
  body.scrollLeft = page.value * stride()
}
function pageFor(rect: DOMRect) {
  const body = article.value!
  return Math.max(0, Math.floor((rect.left - body.getBoundingClientRect().left + body.scrollLeft + 1) / stride()))
}
function animatePage(step: number) {
  const body = article.value
  if (!body || props.animation === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const from = props.animation === 'curl'
    ? { transform: 'perspective(900px) rotateY(' + (-step * 18) + 'deg)', opacity: .68, filter: 'brightness(.88)' }
    : { transform: 'translateX(' + (step * 48) + 'px)', opacity: .72 }
  effect = body.animate([from, { transform: 'none', opacity: 1, filter: 'none' }], {
    duration: props.animation === 'curl' ? 275 : 175, easing: 'ease-out',
  })
}
function canTurn(step: number) {
  return step < 0 ? page.value > 0 || props.previousDocument : page.value < pages.value - 1 || props.nextDocument
}
function turn(step: number) {
  if (!props.paged || !ready || !canTurn(step)) return
  effect?.cancel()
  interacted = true
  userTurned = true
  const target = page.value + step
  if (target < 0 || target >= pages.value) {
    flush()
    emit('pageBoundary', step)
    return
  }
  showPage(target)
  flush()
  animatePage(step)
}
function interactive(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('a, button, input, textarea, select, label, summary, pre, table, img, [tabindex]:not(.reading-scroll), [contenteditable]'))
}
function pointerDown(event: PointerEvent) {
  interacted = true
  clickOrigin = { x: event.clientX, y: event.clientY }
}
function tapPage(event: MouseEvent) {
  if (!props.paged || event.defaultPrevented || event.detail !== 1 || interactive(event.target) || getSelection()?.toString()) return
  const area = scroller.value?.getBoundingClientRect()
  if (!area || !clickOrigin || Math.hypot(event.clientX - clickOrigin.x, event.clientY - clickOrigin.y) > 6) return
  const x = (event.clientX - area.left) / area.width
  const y = (event.clientY - area.top) / area.height
  if (x >= .34 && x <= .66 && y >= .26 && y <= .74) return
  turn(x < .5 + (y - .5) * .32 ? -1 : 1)
}
function readerKey(event: KeyboardEvent) {
  interacted = true
  if (!props.paged || event.altKey || event.ctrlKey || event.metaKey || interactive(event.target)) return
  const step = ['ArrowLeft', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey) ? -1 :
    ['ArrowRight', 'PageDown', ' '].includes(event.key) ? 1 : 0
  if (step) { event.preventDefault(); turn(step) }
}
const isWelcome = computed(() => props.tab.path === welcome)
let generation = 0
let urls: string[] = []
let hash = ''
let headingsByBlock: string[] = []
let timer: number | undefined
let ready = false
let interacted = false
let position: Anchor | undefined

function blocks() { return Array.from(article.value?.children || []) as HTMLElement[] }
function textKey(el: HTMLElement) { return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 150) }
function measure() {
  if (!ready || !scroller.value) return
  const view = scroller.value
  const top = view.getBoundingClientRect().top
  const elements = blocks()
  if (props.paged && article.value) {
    const body = article.value
    page.value = Math.min(pages.value - 1, Math.round(body.scrollLeft / stride()))
    const left = body.getBoundingClientRect().left
    for (const [index, item] of elements.entries()) {
      const rects = [...item.getClientRects()]
      const first = rects.findIndex(rect => rect.right > left + 1 && rect.left < left + body.clientWidth - 1)
      if (first < 0) continue
      const heading = headingsByBlock[index] || ''
      active.value = heading || titles.value[0]?.id || ''
      progress.value = page.value / Math.max(1, pages.value - 1)
      const height = rects.reduce((sum, rect) => sum + rect.height, 0)
      const before = rects.slice(0, first).reduce((sum, rect) => sum + rect.height, 0)
      position = { heading, index, block: textKey(item), within: before / Math.max(1, height), progress: progress.value, hash }
      break
    }
    return
  }
  let low = 0
  let high = elements.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (elements[mid].getBoundingClientRect().bottom <= top + 3) low = mid + 1
    else high = mid
  }
  const index = Math.min(low, elements.length - 1)
  const item = elements[index]
  const heading = headingsByBlock[index] || ''
  active.value = heading || titles.value[0]?.id || ''
  progress.value = Math.min(1, view.scrollTop / Math.max(1, view.scrollHeight - view.clientHeight))
  position = { heading, index, block: item ? textKey(item) : '', within: item ? (top - item.getBoundingClientRect().top) / Math.max(1, item.offsetHeight) : 0, progress: progress.value, hash }
}
function flush() {
  clearTimeout(timer)
  if (ready && interacted) {
    measure()
    if (position) emit('position', props.tab, position)
  }
}
function onScroll() {
  measure()
  if (!ready || !interacted) return
  clearTimeout(timer)
  timer = window.setTimeout(flush, 180)
}
function jump(id: string) {
  const view = scroller.value
  const target = blocks().find(el => el.id === id)
  if (!view || !target) return
  effect?.cancel()
  if (props.paged) showPage(pageFor(target.getClientRects()[0] || target.getBoundingClientRect()))
  else view.scrollTop += target.getBoundingClientRect().top - view.getBoundingClientRect().top - 18
  measure()
}
function restore(anchor?: Anchor) {
  const view = scroller.value
  if (!view || !anchor) return
  const elements = blocks()
  const heading = elements.find(el => el.id === anchor.heading)
  const start = heading ? elements.indexOf(heading) : 0
  const end = heading ? elements.findIndex((el, i) => i > start && /^H[1-6]$/.test(el.tagName)) : -1
  const matchingIndex = closestAnchorBlock(elements.map(textKey), anchor.block, anchor.index, start, end < 0 ? elements.length : end)
  const item = (hash === anchor.hash && elements[anchor.index] && textKey(elements[anchor.index]!) === anchor.block ? elements[anchor.index] : undefined)
    || elements[matchingIndex]
  effect?.cancel()
  if (props.paged) {
    if (item) {
      const rects = [...item.getClientRects()]
      let remaining = Math.max(0, anchor.within) * rects.reduce((sum, rect) => sum + rect.height, 0)
      const rect = rects.find(rect => (remaining -= rect.height) < 1) || rects.at(-1)
      if (rect) showPage(pageFor(rect))
    } else if (heading) jump(anchor.heading)
    else showPage(Math.round((pages.value - 1) * anchor.progress))
    return
  }
  if (item) view.scrollTop += item.getBoundingClientRect().top - view.getBoundingClientRect().top + item.offsetHeight * anchor.within
  else if (heading) jump(anchor.heading)
  else view.scrollTop = (view.scrollHeight - view.clientHeight) * anchor.progress
}
function release() { urls.forEach(url => URL.revokeObjectURL(url)); urls = [] }

async function render() {
  const current = ++generation
  ready = false
  interacted = false
  userTurned = false
  loading.value = true
  error.value = ''
  titles.value = []
  html.value = ''
  release()
  const anchor = props.tab.anchor
  const path = props.tab.path
  try {
    const doc = await read(path)
    if (current !== generation) return
    const rendered = await renderMarkdown(doc.text, path, bytes)
    if (current !== generation) { rendered.urls.forEach(url => URL.revokeObjectURL(url)); return }
    urls = rendered.urls
    hash = doc.hash
    titles.value = rendered.headings
    html.value = rendered.html
    loading.value = false
    await nextTick()
    if (current !== generation) return
    let heading = ''
    headingsByBlock = blocks().map(element => {
      if (/^H[1-6]$/.test(element.tagName)) heading = element.id
      return heading
    })
    if (scroller.value) scroller.value.scrollTop = 0
    paginate()
    const edge = props.paged ? props.tab.pageEdge : undefined
    if (edge) showPage(edge === 'last' ? pages.value - 1 : 0)
    else if (props.tab.fragment) jump(props.tab.fragment)
    else restore(anchor)
    ready = true
    measure()
    if (edge) { interacted = true; flush(); animatePage(edge === 'last' ? -1 : 1) }
    const imagesInView = Array.from(article.value?.querySelectorAll('img') || [])
    if (imagesInView.length) void Promise.allSettled(imagesInView.map(image => image.decode())).then(() => {
      if (current !== generation) return
      paginate()
      if (edge && !userTurned) showPage(edge === 'last' ? pages.value - 1 : 0)
      else if (interacted) return
      else if (props.tab.fragment) jump(props.tab.fragment)
      else restore(anchor)
      measure()
      if (edge) flush()
    })
  } catch (failure) {
    if (current !== generation) return
    loading.value = false
    error.value = path.startsWith('remote:/') && typeof failure === 'string'
      ? failure
      : '无法读取此文件。请确认文件仍在原位置，或重新打开所在文件夹。'
  }
}

function onLink(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest('a')
  if (!link) return
  event.preventDefault()
  const href = link.getAttribute('href') || ''
  if (/^https?:\/\//i.test(href)) { void Promise.resolve(external(href)).catch(() => emit('error', '无法打开此链接。')); return }
  const target = localPath(props.tab.path, href)
  if (target && markdown.test(target.path)) emit('navigate', target.path, target.fragment)
  else emit('error', '此链接未指向可打开的 Markdown 文件。')
}

function linkTarget(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest('a')
  const target = link && localPath(props.tab.path, link.getAttribute('href') || '')
  if (link && target && markdown.test(target.path)) return { link, ...target }
}
function onLinkPointer(event: PointerEvent) {
  const target = linkTarget(event)
  if (target) emit('linkPointer', event, target.path, target.fragment, target.link)
}
function onLinkDrag(event: DragEvent) {
  if (linkTarget(event)) event.preventDefault()
}
function onLinkMenu(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest('a')
  if (!link) return
  const target = localPath(props.tab.path, link.getAttribute('href') || '')
  if (target && markdown.test(target.path)) emit('linkMenu', event, target.path, target.fragment)
}

watch(() => props.tab.fragment, id => { if (id && ready) { interacted = true; jump(id); flush() } })
watch(() => [props.font, props.line, props.width, props.outline, props.compact, props.paged], async () => {
  const previous = position
  await nextTick()
  if (ready) {
    if (props.paged && scroller.value) scroller.value.scrollTop = 0
    paginate(); restore(previous); measure()
  }
})
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  void render()
  window.addEventListener('pagehide', flush)
  if (scroller.value) {
    resizeObserver = new ResizeObserver(async () => {
      const view = scroller.value
      if (!view) return
      const previous = position
      pageHeight.value = Math.max(72, view.clientHeight - 44)
      await nextTick()
      if (ready) { paginate(); restore(previous); measure() }
    })
    pageHeight.value = Math.max(72, scroller.value.clientHeight - 44)
    resizeObserver.observe(scroller.value)
  }
})
onBeforeUnmount(() => { effect?.cancel(); flush(); generation++; release(); resizeObserver?.disconnect(); window.removeEventListener('pagehide', flush) })
async function refresh() {
  effect?.cancel()
  if (ready) { interacted = true; flush() }
  await render()
  return !error.value
}
defineExpose({ flush, turn, refresh })
</script>

<template>
  <div class="reader" :class="{ compact, centered, paged }" :style="{ '--doc-width': width + 'px', '--page-height': pageHeight + 'px', '--page-gap': gap + 'px' }">
    <div class="reading-column">
      <div ref="scroller" class="reading-scroll" tabindex="0" @scroll.passive="onScroll" @wheel.passive="interacted = true" @pointerdown="pointerDown" @keydown="readerKey" @click="tapPage" @touchstart.passive="interacted = true">
        <div v-if="loading || error" class="reader-message" role="status">
          <BookOpen :size="26" />
          <p>{{ error || '正在打开文档…' }}</p>
          <button v-if="error" class="action" @click="render"><RotateCw :size="14" />重新读取</button>
        </div>
        <div v-else class="paper" :style="{ '--doc-size': font + 'px', '--doc-line': line }">
          <div v-if="!paged && isWelcome" class="edition"><span></span> Folio 使用手册</div>
          <div v-else-if="!paged" class="edition"><span></span> {{ nameOf(tab.path) }}</div>
          <article ref="article" class="markdown" @click="onLink" @contextmenu="onLinkMenu" @pointerdown="onLinkPointer" @dragstart="onLinkDrag" v-html="html"></article>
        </div>
      </div>
      <nav v-if="paged" class="document-nav page-nav" aria-label="翻页">
        <button class="action previous-document" :disabled="!canTurn(-1) || loading" @click="turn(-1)"><ChevronLeft :size="15" />上一页</button>
        <output class="page-number" aria-live="polite">{{ page + 1 }} / {{ pages }}</output>
        <button class="action next-document" :disabled="!canTurn(1) || loading" @click="turn(1)">下一页<ChevronRight :size="15" /></button>
      </nav>
      <slot name="navigation" />
    </div>
    <aside v-if="outline && titles.length" class="outline" aria-label="文章目录">
      <div class="outline-title"><List :size="15" />本文目录</div>
      <button v-for="title in titles" :key="title.id" :class="{ current: active === title.id }"
        :style="{ paddingLeft: 11 + Math.max(0, title.level - 2) * 10 + 'px' }" @click="interacted = true; jump(title.id); flush(); emit('outlineSelected')">{{ title.text }}</button>
      <div class="progress"><span>阅读进度</span><b>{{ Math.round(progress * 100) }}%</b><i><em :style="{ width: progress * 100 + '%' }"></em></i></div>
    </aside>
  </div>
</template>
