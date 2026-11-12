<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { GitBranch, X } from '@lucide/vue'
import { cloneRepository, connectRepository } from './remote'
import type { CloneProgress, LocalClone, Provider, RemoteRepository } from './types'
import { getPlatform } from '../platform'
const platform = getPlatform()

const props = defineProps<{ existing?: RemoteRepository; local?: LocalClone }>()
const emit = defineEmits<{ close: []; connected: [RemoteRepository]; cloned: [string, string] }>()
const initial = props.local?.source || props.existing
const storage = ref<'local' | 'online'>(props.local || !props.existing ? 'local' : 'online')
const provider = ref<Provider>(initial?.provider || 'github')
const url = ref(initial?.url || '')
const branch = ref(initial?.branch || '')
const directory = ref(props.local?.directory || props.existing?.directory || '')
const token = ref('')
const surface = ref<HTMLElement>()
const previous = document.activeElement as HTMLElement | null
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const items = [...surface.value!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]
  const first = items[0], last = items.at(-1)
  if (!first || !last) { event.preventDefault(); surface.value?.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === surface.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
const working = ref<'connect' | 'clone'>()
const error = ref('')
const cloneProgress = ref<CloneProgress>()
const cancelling = ref(false)
const source = computed(() => ({ provider: provider.value, url: url.value.trim(), branch: branch.value.trim() }))

async function connect() {
  if (working.value || provider.value === 'git' || !source.value.url) return
  working.value = 'connect'
  error.value = ''
  try {
    const repo = await connectRepository(source.value, directory.value, token.value.trim(), props.existing?.id)
    token.value = ''
    emit('connected', repo)
  } catch (failure) { error.value = typeof failure === 'string' ? failure : '无法连接该仓库。' }
  finally { working.value = undefined }
}

async function clone() {
  if (working.value || !source.value.url) return
  working.value = 'clone'
  error.value = ''
  try {
    const options = { token: token.value.trim(), directory: directory.value.trim().replace(/^\/+|\/+$/g, ''), progress: (value: CloneProgress) => cloneProgress.value = value }
    const path = props.local ? await platform.repositories.updateClone(props.local.path, source.value, options) : await cloneRepository(source.value, options)
    token.value = ''
    if (path) emit('cloned', path, new URL(source.value.url).pathname.replace(/\/$/, '').replace(/\.git$/, '').split('/').at(-1) || '仓库')
  } catch (failure) { error.value = typeof failure === 'string' ? failure : '无法克隆该仓库。' }
  finally { working.value = undefined; cloneProgress.value = undefined; cancelling.value = false }
}
async function cancelClone() {
  cancelling.value = true
  await platform.repositories.cancelClone?.()
}
const back = (event: Event) => {
  event.preventDefault()
  if (!working.value) emit('close')
}
onMounted(async () => { window.addEventListener('folio-back', back); await nextTick(); surface.value?.querySelector('input')?.focus() })
onBeforeUnmount(() => { window.removeEventListener('folio-back', back); if (previous?.isConnected) previous.focus({ preventScroll: true }) })
</script>

<template>
  <div class="remote-scrim" @pointerdown.self="!working && emit('close')" @keydown.esc.stop="!working && emit('close')">
    <section ref="surface" class="remote-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-heading" tabindex="-1" @keydown="trapFocus">
      <header class="settings-head">
        <div><GitBranch :size="18" /><h2 id="remote-heading">{{ existing || local ? '仓库设置' : '添加 Git 仓库' }}</h2></div>
        <button class="icon" aria-label="关闭远程仓库" :disabled="!!working" @click="emit('close')"><X :size="18" /></button>
      </header>
      <form @submit.prevent="storage === 'local' ? clone() : connect()">
        <fieldset class="provider-options"><legend>读取方式</legend><div>
          <button type="button" :aria-pressed="storage === 'local'" :disabled="!!working || !!existing || !!local" @click="storage = 'local'">保存到本地</button>
          <button type="button" :aria-pressed="storage === 'online'" :disabled="!!working || !!existing || !!local || provider === 'git'" @click="storage = 'online'">在线读取</button>
        </div></fieldset>
        <p>{{ storage === 'local' ? '保存离线副本；手动更新以远程内容覆盖本副本。本地修改可能被覆盖。' : '按需在线读取文档，不保存持久离线副本。' }}</p>
        <fieldset class="provider-options"><legend>托管平台</legend><div>
          <button type="button" :aria-pressed="provider === 'github'" :disabled="!!working" @click="provider = 'github'">GitHub</button>
          <button type="button" :aria-pressed="provider === 'gitlab'" :disabled="!!working" @click="provider = 'gitlab'">GitLab</button>
          <button v-if="platform.capabilities.cloneRepositories && !existing" type="button" :aria-pressed="provider === 'git'" :disabled="!!working" @click="provider = 'git'; storage = 'local'">其他 Git</button>
        </div></fieldset>
        <label>仓库 HTTPS 地址
          <input v-model="url" placeholder="https://github.com/owner/repo" required autofocus :disabled="!!working" />
        </label>
        <label>分支或标签
          <input v-model="branch" placeholder="留空使用仓库默认分支" :disabled="!!working" />
        </label>
        <template>
          <label>阅读目录
            <input v-model="directory" placeholder="例如 docs，留空使用仓库根目录" :disabled="!!working" />
          </label>
          <label v-if="platform.kind !== 'windows' || storage === 'online'">访问令牌
            <input v-model="token" type="password" autocomplete="new-password" placeholder="公开仓库可留空，私有仓库需读取权限" :disabled="!!working" />
          </label>
          <p>{{ platform.kind === 'windows' ? (storage === 'local' ? '本地克隆和更新使用系统 Git 自己的登录凭据。' : '令牌保存到 Windows 凭据管理器。已保存令牌可留空复用。') : '令牌由 Android Keystore 加密保存。' }}</p>
        </template>
        <p v-if="cloneProgress" role="status">{{ cloneProgress.phase }}<template v-if="cloneProgress.total > 0"> · {{ Math.min(100, Math.round(cloneProgress.completed / cloneProgress.total * 100)) }}%</template></p>
        <p v-if="working === 'clone' && platform.kind === 'android'">请保持应用在前台。取消或失败后会清理未完成数据，重试将从头开始。</p>
        <p v-if="error" class="remote-error" role="alert">{{ error }}</p>
        <footer>
          <button v-if="working === 'clone' && platform.repositories.cancelClone" class="action" type="button" :disabled="cancelling" @click="cancelClone">{{ cancelling ? '正在取消…' : '取消克隆' }}</button>
          <button class="action primary" type="submit" :disabled="!!working || !source.url"><GitBranch :size="15" />{{ working ? (local ? '正在更新…' : '正在连接…') : existing || local ? '保存并更新' : storage === 'local' ? '克隆到本地' : '只读连接' }}</button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.remote-scrim { position: fixed; inset: 0; z-index: 9; display: grid; place-items: center; padding: 14px; background: #101c2866; }
.remote-dialog { width: min(460px, 100%); max-height: 90vh; overflow: auto; border: 1px solid var(--stroke); border-radius: 12px; padding: 17px; color: var(--ink); background: var(--panel); box-shadow: 0 18px 56px #101c2840; }
.remote-dialog .settings-head > div { display: flex; align-items: center; gap: 8px; color: var(--accent); }
.remote-dialog h2 { font-size: 17px; margin: 0; }
.remote-dialog form { display: grid; gap: 12px; margin-top: 14px; }
.remote-dialog label { display: grid; gap: 5px; }
.remote-dialog input, .remote-dialog select { width: 100%; padding: 7px 9px; color: var(--ink); background: var(--paper); border: 1px solid var(--stroke); border-radius: 5px; }
.remote-dialog p { margin: 0; font-size: 12px; color: var(--muted); }
.remote-dialog .remote-error { color: #bd463b; }
.remote-dialog footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 4px; }

.provider-options { padding: 0; border: 0; margin: 0; min-width: 0; }
.provider-options legend { margin-bottom: 7px; }
.provider-options > div { display: flex; gap: 5px; padding: 4px; border-radius: 11px; background: var(--chrome); }
.provider-options button { flex: 1; min-height: 40px; border-radius: 8px; font-size: 13px; }
.provider-options button[aria-pressed=true] { background: var(--panel); color: var(--accent); font-weight: 650; box-shadow: 0 1px 4px #102c3a16; }
</style>
