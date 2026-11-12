<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, Columns2, FilePlus2, FolderPlus, GitBranch, Layers, Library, List, Maximize, MoreHorizontal, RotateCw, Settings2, X } from '@lucide/vue'
import MobileSheet from './MobileSheet.vue'
import type { Group, Tab, Workspace } from '../../core/reading'
import type { ReaderStatus } from '../readerRegistry'
import { nameOf } from '../../documents/address'
export type MobilePanel = 'library' | 'contents' | 'tabs' | 'more' | 'settings' | 'path' | undefined
const props = defineProps<{ state: Workspace; current?: Tab; status?: ReaderStatus; crumbs: { path: string; label: string }[]; panel?: MobilePanel; immersive: boolean; paged: boolean; refreshing: boolean; remote: boolean; canBack: boolean; canForward: boolean }>()
const emit = defineEmits<{
  'update:panel': [MobilePanel]; reveal: []; immersive: []; history: ['back' | 'forward']; split: []; pick: [boolean]; refresh: []; remote: []; heading: [string]; source: []
  selectTab: [Group, Tab]; closeTab: [Group, Tab]; tabMenu: [MouseEvent, Group, Tab]; browse: [MouseEvent, string]
}>()
const tabCount = computed(() => props.state.groups.reduce((sum, group) => sum + group.tabs.length, 0))
const titles: Record<NonNullable<MobilePanel>, string> = { library: '文档库', contents: '文章目录', tabs: '已打开的文档', more: '阅读工具', settings: '阅读外观', path: '文档路径' }
const open = (panel: MobilePanel) => emit('update:panel', panel)
const act = (action: () => void) => { open(undefined); action() }
</script>
<template>
  <header v-if="!immersive" class="mobile-topbar">
    <button class="mobile-icon" aria-label="上一步" :disabled="!canBack" @click="emit('history', 'back')"><ArrowLeft :size="21" /></button>
    <button class="mobile-document-title" aria-label="查看文档路径" @click="open('path')"><strong>{{ current ? nameOf(current.path) : 'Folio' }}</strong><small>{{ crumbs.at(-1)?.label || '让阅读从容一些' }}<ChevronRight :size="11" /></small></button>
    <button class="mobile-tab-count mobile-icon" aria-label="已打开的文档" @click="open('tabs')"><Layers :size="21" /><span>{{ tabCount }}</span></button>
  </header>
  <nav v-if="!immersive" class="mobile-dock" aria-label="阅读工具">
    <button aria-label="打开文档库" @click="open('library')"><Library :size="21" /><span>文档库</span></button>
    <button aria-label="文章目录" :disabled="!current" @click="open('contents')"><List :size="22" /><span>目录</span></button>
    <button aria-label="切换分屏" :aria-pressed="state.groups.length > 1" :disabled="!current" @click="emit('split')"><Columns2 :size="21" /><span>{{ state.groups.length > 1 ? '合并' : '分屏' }}</span></button>
    <button aria-label="阅读设置" @click="open('settings')"><Settings2 :size="21" /><span>外观</span></button>
    <button aria-label="更多阅读工具" @click="open('more')"><MoreHorizontal :size="23" /><span>更多</span></button>
  </nav>
  <MobileSheet v-if="panel" :title="titles[panel]" :subtitle="panel === 'tabs' ? tabCount + ' 篇文档 · 各自记住阅读位置' : panel === 'contents' ? (current ? nameOf(current.path) : '') : undefined" @close="open(undefined)">
    <template v-if="panel === 'library'">
      <div class="mobile-imports"><button @click="emit('pick', true)"><FolderPlus :size="24" /><strong>打开文件夹</strong><small>系列文档，一起读</small></button><button @click="emit('pick', false)"><FilePlus2 :size="24" /><strong>打开文件</strong><small>添加单篇 Markdown</small></button></div>
      <slot name="library" />
    </template>
    <template v-else-if="panel === 'settings'"><slot name="settings" /></template>
    <template v-else-if="panel === 'contents'">
      <div class="mobile-reading-progress"><span>已读 {{ Math.round((status?.progress || 0) * 100) }}%</span><span v-if="status && paged">{{ status.page }} / {{ status.pages }}</span><i><b :style="{ width: (status?.progress || 0) * 100 + '%' }"></b></i></div>
      <div v-if="status?.headings.length" class="mobile-toc"><button v-for="heading in status.headings" :key="heading.id" :aria-current="status.active === heading.id ? 'location' : undefined" :style="{ paddingLeft: 14 + Math.min(4, heading.level - 1) * 14 + 'px' }" @click="act(() => emit('heading', heading.id))">{{ heading.text }}</button></div>
      <p v-else class="mobile-empty-note">这篇文档暂时没有标题目录，仍可正常阅读。</p>
    </template>
    <template v-else-if="panel === 'tabs'">
      <section v-for="(group, index) in state.groups" :key="group.id" class="mobile-tabs-section">
        <h3>{{ state.groups.length > 1 ? '阅读区 ' + (index + 1) : '阅读列表' }}<span v-if="state.focused === group.id">当前阅读区</span></h3>
        <div v-for="tab in group.tabs" :key="tab.id" class="mobile-tab-row" :class="{ active: group.active === tab.id }">
          <button class="mobile-tab-select" @click="act(() => emit('selectTab', group, tab))"><BookOpen :size="18" /><span><strong>{{ nameOf(tab.path) }}</strong><small>{{ tab.path }}</small></span></button>
          <button class="mobile-icon" :aria-label="'操作 ' + nameOf(tab.path)" @click="emit('tabMenu', $event, group, tab)"><MoreHorizontal :size="20" /></button>
          <button class="mobile-icon" :aria-label="'关闭 ' + nameOf(tab.path)" @click="emit('closeTab', group, tab)"><X :size="18" /></button>
        </div>
        <p v-if="!group.tabs.length" class="mobile-empty-note">从文档库挑选一篇文章。</p>
      </section>
    </template>
    <template v-else-if="panel === 'path'">
      <p class="mobile-path-caption">点击文件夹浏览同目录文档</p>
      <button v-for="(crumb, index) in crumbs" :key="crumb.path" class="mobile-path-row" :style="{ paddingLeft: index * 16 + 'px' }" @click="emit('browse', $event, crumb.path)"><Library :size="18" />{{ crumb.label }}<ChevronRight :size="17" /></button>
      <div class="mobile-path-file"><BookOpen :size="18" />{{ current ? nameOf(current.path) : '未打开文档' }}</div>
    </template>
    <template v-else-if="panel === 'more'">
      <div class="mobile-history-controls"><button :disabled="!canBack" @click="act(() => emit('history', 'back'))"><ArrowLeft :size="19" />上一步</button><button :disabled="!canForward" @click="act(() => emit('history', 'forward'))">下一步<ArrowRight :size="19" /></button></div>
      <div class="mobile-tool-grid">
        <button @click="act(() => emit('immersive'))"><Maximize :size="23" /><span>专注阅读</span><small>中间点按可唤回工具</small></button>
        <button :disabled="refreshing" @click="act(() => emit('refresh'))"><RotateCw :size="23" /><span>{{ refreshing ? '正在刷新…' : '全局更新' }}</span><small>重新读取全部来源</small></button>
        <button v-if="remote" @click="act(() => emit('remote'))"><GitBranch :size="23" /><span>远程仓库</span><small>连接或手动克隆</small></button>
        <button @click="open('tabs')"><Layers :size="23" /><span>文档管理</span><small>切换、关闭与整理标签</small></button>
      </div>
      <button class="mobile-source-entry" :disabled="!current" @click="act(() => emit('source'))">查看 Markdown 源码</button>
      <p class="mobile-gesture-note">单页模式：左滑下一页，右滑上一页。链接、选字、可滚动表格和代码优先响应自己的交互。</p>
    </template>
  </MobileSheet>
</template>
