<script setup lang="ts">
import { ChevronRight, FileText, Folder, FolderOpen, GitBranch, X } from '@lucide/vue'
import { isRemote, nameOf } from './address'
import type { Entry } from './types'
defineProps<{ entries: Entry[]; expanded: string[]; contents: Record<string, Entry[]>; current?: string; depth?: number; removable?: boolean; touch?: boolean }>()
const emit = defineEmits<{ select: [Entry]; remove: [Entry]; documentPointer: [PointerEvent, Entry]; fileMenu: [MouseEvent, Entry] }>()
</script>

<template>
  <ul class="tree">
    <li v-for="entry in entries" :key="entry.path">
      <div class="tree-line" :class="{ selected: current === entry.path }">
        <button class="tree-button" :style="{ paddingLeft: 9 + (depth || 0) * 16 + 'px' }" :title="entry.path"
          :aria-expanded="entry.directory ? expanded.includes(entry.path) : undefined" :class="{ draggable: !entry.directory && !touch }"
          @contextmenu="(!entry.directory || (removable && isRemote(entry.path))) && emit('fileMenu', $event, entry)"
          @pointerdown="!touch && !entry.directory && emit('documentPointer', $event, entry)" @click="(entry.directory || touch || $event.detail === 0) && emit('select', entry)">
          <ChevronRight v-if="entry.directory" class="chevron" :class="{ expanded: expanded.includes(entry.path) }" :size="13" />
          <span v-else class="tree-spacer"></span>
          <component :is="removable && isRemote(entry.path) ? GitBranch : entry.directory ? expanded.includes(entry.path) ? FolderOpen : Folder : FileText" :size="16" />
          <span>{{ entry.label || nameOf(entry.path) }}</span>
        </button>
        <button v-if="removable" class="icon tree-remove" title="移出文档库" aria-label="移出文档库" @click="emit('remove', entry)"><X :size="14" /></button>
      </div>
      <template v-if="entry.directory && expanded.includes(entry.path)">
        <FileTree :touch="touch" v-if="contents[entry.path]?.length" :entries="contents[entry.path]!" :expanded="expanded" :contents="contents"
          :depth="(depth || 0) + 1" :current="current" @select="emit('select', $event)" @document-pointer="(event, entry) => emit('documentPointer', event, entry)" @file-menu="(event, entry) => emit('fileMenu', event, entry)" />
        <small v-else class="tree-empty" :style="{ paddingLeft: 40 + (depth || 0) * 16 + 'px' }">{{ contents[entry.path] ? '没有 Markdown 文件' : '正在读取…' }}</small>
      </template>
    </li>
  </ul>
</template>
