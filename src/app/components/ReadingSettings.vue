<script setup lang="ts">
import { Minus, Plus, RotateCcw, X } from '@lucide/vue'
import { defaultSettings, type ReadingSettings } from '../useReadingSettings'
import SettingSwitch from './SettingSwitch.vue'
const props = defineProps<{ settings: ReadingSettings; mobile?: boolean }>()
const emit = defineEmits<{ update: [ReadingSettings]; close: [] }>()
const update = <K extends keyof ReadingSettings>(key: K, value: ReadingSettings[K]) => emit('update', { ...props.settings, [key]: value })
const themes = [{ id: 'light', name: '清白' }, { id: 'paper', name: '暖纸' }, { id: 'dark', name: '夜读' }]
const animations = [{ id: 'none', name: '无动画' }, { id: 'slide', name: '平移' }, { id: 'curl', name: '翻折' }] as const
</script>
<template>
  <section class="settings" :class="{ 'settings-inline': mobile }" aria-label="阅读设置">
    <div v-if="!mobile" class="settings-head"><h2>阅读设置</h2><button class="icon" aria-label="关闭阅读设置" @click="emit('close')"><X :size="18" /></button></div>
    <div class="settings-section">
      <h3>纸张与配色</h3>
      <div class="theme-options" aria-label="阅读主题">
        <button v-for="item in themes" :key="item.id" :class="[item.id, { chosen: settings.theme === item.id && !settings.tint }]" :aria-pressed="settings.theme === item.id && !settings.tint" @click="emit('update', { ...settings, theme: item.id, tint: '' })"><span>Aa</span>{{ item.name }}</button>
      </div>
      <label class="color-control">自定义背景<input type="color" aria-label="自定义背景" :value="settings.tint || '#ffffff'" @input="update('tint', ($event.target as HTMLInputElement).value)" /></label>
    </div>
    <div class="settings-section">
      <h3>文字排版</h3>
      <div class="font-control"><span>字号</span><div><button class="step-button" aria-label="减小字号" :disabled="settings.font <= 13" @click="update('font', Math.max(13, settings.font - 1))"><Minus :size="18" /></button><output>{{ settings.font }}<small> px</small></output><button class="step-button" aria-label="增大字号" :disabled="settings.font >= 28" @click="update('font', Math.min(28, settings.font + 1))"><Plus :size="18" /></button></div></div>
      <label class="range-control">字号微调<input :value="settings.font" @input="update('font', Number(($event.target as HTMLInputElement).value))" aria-label="字号" type="range" min="13" max="28" /></label>
      <label class="range-control">行距 <output>{{ settings.line.toFixed(1) }}</output><input :value="settings.line" @input="update('line', Number(($event.target as HTMLInputElement).value))" aria-label="行距" type="range" min="1.3" max="2.4" step=".1" /></label>
      <label v-if="!mobile" class="range-control">正文宽度 <output>{{ settings.width }} px</output><input :value="settings.width" @input="update('width', Number(($event.target as HTMLInputElement).value))" aria-label="正文宽度" type="range" min="480" max="980" step="20" /></label>
      <template v-else><p class="option-label">页面留白</p><div class="segmented" aria-label="页面留白"><button v-for="item in [{ value: 16, label: '紧凑' }, { value: 24, label: '舒适' }, { value: 32, label: '宽松' }]" :key="item.value" :aria-pressed="settings.mobilePadding === item.value" @click="update('mobilePadding', item.value)">{{ item.label }}</button></div></template>
    </div>
    <div class="settings-section">
      <h3>阅读方式</h3>
      <SettingSwitch label="单页翻页" description="关闭后连续滚动阅读" :checked="settings.readingMode === 'paged'" @change="update('readingMode', $event ? 'paged' : 'scroll')" />
      <template v-if="settings.readingMode === 'paged'">
        <p class="option-label">翻页动画</p><div class="segmented" aria-label="翻页动画"><button v-for="item in animations" :key="item.id" :aria-pressed="settings.pageAnimation === item.id" @click="update('pageAnimation', item.id)">{{ item.name }}</button></div>
        <SettingSwitch label="左右滑动翻页" description="向左下一页，向右上一页；可滚动内容优先" :checked="settings.swipePaging" @change="update('swipePaging', $event)" />
        <SettingSwitch label="点按边缘翻页" description="中间区域保留给阅读工具与选字" :checked="settings.tapPaging" @change="update('tapPaging', $event)" />
      </template>
      <SettingSwitch label="默认在新标签打开" description="关闭后替换当前标签；上下文档始终在当前标签打开" :checked="settings.openMode === 'new'" @change="update('openMode', $event ? 'new' : 'current')" />
      <SettingSwitch label="移出文档库前确认" description="移除文档、文件夹或远程连接前提醒，不删除原文件" :checked="settings.confirmRemoval" @change="update('confirmRemoval', $event)" />
    </div>
    <button class="reset-settings" @click="emit('update', { ...defaultSettings })"><RotateCcw :size="16" />恢复默认设置</button>
  </section>
</template>
<style scoped>
.settings { position: fixed; z-index: 7; top: 67px; right: 14px; width: min(340px, calc(100% - 28px)); max-height: calc(100dvh - 82px); overflow: auto; padding: 20px; border: 1px solid var(--stroke); border-radius: 16px; background: var(--panel); box-shadow: 0 12px 40px #102c3a26; overscroll-behavior: contain; }
.settings-inline { position: static; width: auto; max-height: none; border: 0; padding: 0; border-radius: 0; overflow: visible; box-shadow: none; background: none; }
.settings-head { display: flex; align-items: center; justify-content: space-between; }
h2 { font-size: 16px; margin: 0; }
.settings-section { padding: 16px 0; border-bottom: 1px solid var(--stroke); }
.settings-section:first-of-type { padding-top: 8px; }
h3 { margin: 0 0 14px; color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: .12em; }
.theme-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.theme-options button { border: 1px solid var(--stroke); border-radius: 12px; padding: 10px 2px; min-height: 76px; font-size: 12px; }
.theme-options button.chosen { outline: 2px solid var(--accent); outline-offset: 2px; }
.theme-options span { display: block; font: 26px Georgia, serif; margin-bottom: 6px; }
.theme-options .light { background: #fff; color: #20343e; }
.theme-options .paper { background: #f6efd9; color: #3c3a2b; }
.theme-options .dark { background: #202c34; color: #e5edf0; }
.color-control, .font-control { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; font-size: 14px; }
.color-control input { width: 44px; height: 44px; padding: 3px; border: 1px solid var(--stroke); border-radius: 8px; background: var(--paper); }
.font-control > div { display: flex; align-items: center; gap: 8px; }
.font-control output { min-width: 50px; text-align: center; font-size: 22px; font-variant-numeric: tabular-nums; }
.font-control small { font-size: 11px; color: var(--muted); }
.step-button { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid var(--stroke); border-radius: 12px; }
.range-control { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin: 16px 0; font-size: 13px; }
.range-control input { grid-column: span 2; width: 100%; min-height: 28px; accent-color: var(--accent); touch-action: pan-y; }
.option-label { margin: 12px 0 8px; font-size: 12px; color: var(--muted); }
.segmented { display: flex; padding: 4px; border-radius: 12px; background: var(--chrome); gap: 3px; }
.segmented button { flex: 1; min-height: 40px; border-radius: 9px; font-size: 13px; }
.segmented [aria-pressed=true] { background: var(--panel); color: var(--accent); box-shadow: 0 1px 5px #102c3a16; font-weight: 650; }
.reset-settings { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 48px; margin-top: 14px; color: var(--muted); }
</style>
