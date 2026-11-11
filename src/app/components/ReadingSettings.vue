<script setup lang="ts">
import { X } from '@lucide/vue'
import { defaultSettings, type ReadingSettings } from '../useReadingSettings'

const props = defineProps<{ settings: ReadingSettings }>()
const emit = defineEmits<{ update: [ReadingSettings]; close: [] }>()
const update = <K extends keyof ReadingSettings>(key: K, value: ReadingSettings[K]) =>
  emit('update', { ...props.settings, [key]: value })
</script>

<template>
    <section class="settings" aria-label="阅读设置">
      <div class="settings-head"><h2>阅读设置</h2><button class="icon" aria-label="关闭阅读设置" @click="emit('close')"><X :size="16" /></button></div>
      <div class="theme-options">
        <button v-for="item in [{ id: 'light', name: '浅色' }, { id: 'paper', name: '暖纸' }, { id: 'dark', name: '深色' }]" :key="item.id"
          :class="[item.id, { chosen: settings.theme === item.id && !settings.tint }]" @click="emit('update', { ...settings, theme: item.id, tint: '' })"><span>Aa</span>{{ item.name }}</button>
      </div>
      <label>字号 <output>{{ settings.font }} px</output><input :value="settings.font" @input="update('font', Number(($event.target as HTMLInputElement).value))" type="range" min="13" max="28" /></label>
      <label>行距 <output>{{ settings.line }}</output><input :value="settings.line" @input="update('line', Number(($event.target as HTMLInputElement).value))" type="range" min="1.3" max="2.4" step=".1" /></label>
      <label>正文宽度 <output>{{ settings.width }} px</output><input :value="settings.width" @input="update('width', Number(($event.target as HTMLInputElement).value))" type="range" min="480" max="980" step="20" /></label>
      <label class="color-control">自定义背景<input type="color" :value="settings.tint || '#ffffff'" @input="update('tint', ($event.target as HTMLInputElement).value)" /></label>
      <label>阅读模式
        <select :value="settings.readingMode" @change="update('readingMode', ($event.target as HTMLSelectElement).value as ReadingSettings['readingMode'])" aria-label="阅读模式"><option value="scroll">连续滚动</option><option value="paged">单页翻页</option></select>
      </label>
      <label v-if="settings.readingMode === 'paged'">翻页动画
        <select :value="settings.pageAnimation" @change="update('pageAnimation', ($event.target as HTMLSelectElement).value as ReadingSettings['pageAnimation'])" aria-label="翻页动画"><option value="none">无动画</option><option value="slide">平移</option><option value="curl">仿真翻折</option></select>
      </label>
      <label>打开文档
        <select :value="settings.openMode" @change="update('openMode', ($event.target as HTMLSelectElement).value as ReadingSettings['openMode'])" aria-label="默认打开方式">
          <option value="new">新标签</option>
          <option value="current">当前标签</option>
        </select>
      </label>
      <button class="action" @click="emit('update', { ...defaultSettings })">恢复默认</button>
    </section>
</template>

<style scoped>
.settings { position: fixed; z-index: 3; top: 54px; right: 13px; width: min(296px, calc(100% - 26px)); padding: 14px; border: 1px solid var(--stroke); border-radius: 10px; background: var(--panel); box-shadow: 0 12px 30px #102c3a26; }
.settings-head { display: flex; align-items: center; justify-content: space-between; }
.settings h2 { font-size: 15px; margin: 0; }
.theme-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 10px 0 16px; }
.theme-options button { border: 1px solid var(--stroke); border-radius: 5px; padding: 4px 2px; }
.theme-options button.chosen { outline: 2px solid var(--accent); outline-offset: -2px; }
.theme-options span { display: block; font: 22px Georgia, serif; }
.theme-options .light { background: #fff; color: #20343e; }
.theme-options .paper { background: #f6efd9; color: #3c3a2b; margin: 0; }
.theme-options .dark { background: #202c34; color: #e5edf0; }
.settings label { display: grid; grid-template-columns: 1fr auto; gap: 5px; margin: 11px 0; }
.settings input[type=range] { grid-column: span 2; width: 100%; accent-color: var(--accent); }
.color-control { align-items: center; }
.settings select { color: var(--ink); background: var(--panel); border: 1px solid var(--stroke); border-radius: 4px; }
</style>
