<script setup lang="ts">
defineProps<{ label: string; description?: string; checked: boolean }>()
defineEmits<{ change: [boolean] }>()
</script>
<template>
  <button class="setting-switch-row" role="switch" :aria-checked="checked" :aria-label="label" @click="$emit('change', !checked)">
    <span><strong>{{ label }}</strong><small v-if="description">{{ description }}</small></span><span class="setting-switch" :class="{ on: checked }" aria-hidden="true"><i></i></span>
  </button>
</template>
<style scoped>
.setting-switch-row { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 18px; min-height: 58px; text-align: left; padding: 10px 0; }
.setting-switch-row strong { display: block; font-size: 14px; font-weight: 550; }
.setting-switch-row small { display: block; margin-top: 5px; color: var(--muted); line-height: 1.5; font-size: 12px; }
.setting-switch { width: 44px; height: 26px; padding: 3px; border-radius: 20px; background: var(--stroke); flex: none; transition: background .15s; }
.setting-switch i { display: block; width: 20px; height: 20px; border-radius: 50%; background: var(--panel); box-shadow: 0 1px 4px #102c3a30; transition: transform .15s; }
.setting-switch.on { background: var(--accent); }
.setting-switch.on i { transform: translateX(18px); }
@media (prefers-reduced-motion: reduce) { .setting-switch, .setting-switch i { transition: none; } }
</style>
