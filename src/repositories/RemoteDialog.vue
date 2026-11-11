<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Download, GitBranch, X } from '@lucide/vue'
import { cloneRepository, connectRepository } from './remote'
import type { CloneProgress, Provider, RemoteRepository } from './types'
import { getPlatform } from '../platform'
const platform = getPlatform()

const props = defineProps<{ existing?: RemoteRepository }>()
const emit = defineEmits<{ close: []; connected: [RemoteRepository]; cloned: [string, string] }>()
const provider = ref<Provider>(props.existing?.provider || 'github')
const url = ref(props.existing?.url || '')
const branch = ref(props.existing?.branch || '')
const directory = ref(props.existing?.directory || '')
const token = ref('')
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
    const path = await cloneRepository(source.value, { token: token.value.trim(), progress: value => cloneProgress.value = value })
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
onMounted(() => window.addEventListener('folio-back', back))
onBeforeUnmount(() => window.removeEventListener('folio-back', back))
</script>

<template>
  <div class="remote-scrim" @pointerdown.self="!working && emit('close')" @keydown.esc.stop="!working && emit('close')">
    <section class="remote-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-heading">
      <header class="settings-head">
        <div><GitBranch :size="18" /><h2 id="remote-heading">{{ existing ? '远程仓库设置' : '添加远程仓库' }}</h2></div>
        <button class="icon" aria-label="关闭远程仓库" :disabled="!!working" @click="emit('close')"><X :size="18" /></button>
      </header>
      <form @submit.prevent="provider === 'git' ? clone() : connect()">
        <label>托管平台
          <select v-model="provider" :disabled="!!working">
            <option value="github">GitHub / GitHub Enterprise Server</option>
            <option value="gitlab">GitLab / 自建 GitLab</option>
            <option v-if="platform.capabilities.cloneRepositories" value="git">其他 Git 服务（手动克隆）</option>
          </select>
        </label>
        <label>仓库 HTTPS 地址
          <input v-model="url" placeholder="https://github.com/owner/repo" required autofocus :disabled="!!working" />
        </label>
        <label>分支或标签
          <input v-model="branch" placeholder="留空使用仓库默认分支" :disabled="!!working" />
        </label>
        <template v-if="provider !== 'git'">
          <label>阅读目录
            <input v-model="directory" placeholder="例如 docs，留空使用仓库根目录" :disabled="!!working" />
          </label>
          <label>访问令牌
            <input v-model="token" type="password" autocomplete="new-password" placeholder="公开仓库可留空，私有仓库需读取权限" :disabled="!!working" />
          </label>
          <p>{{ platform.kind === 'windows' ? '令牌保存到 Windows 凭据管理器。已保存令牌可留空复用。' : '令牌由 Android Keystore 加密保存。' }}</p>
        </template>
        <label v-if="provider === 'git' && platform.kind === 'android'">访问令牌<input v-model="token" type="password" autocomplete="new-password" placeholder="公开仓库可留空" :disabled="!!working" /></label>
        <p v-if="cloneProgress" role="status">{{ cloneProgress.phase }}<template v-if="cloneProgress.total > 0"> · {{ Math.min(100, Math.round(cloneProgress.completed / cloneProgress.total * 100)) }}%</template></p>
        <p v-if="working === 'clone' && platform.kind === 'android'">请保持应用在前台。取消或失败后会清理未完成数据，重试将从头开始。</p>
        <p v-if="error" class="remote-error" role="alert">{{ error }}</p>
        <footer>
          <button v-if="working === 'clone' && platform.repositories.cancelClone" class="action" type="button" :disabled="cancelling" @click="cancelClone">{{ cancelling ? '正在取消…' : '取消克隆' }}</button>
          <button v-if="platform.capabilities.cloneRepositories" class="action" :class="{ primary: provider === 'git' }" :type="provider === 'git' ? 'submit' : 'button'" :disabled="!!working || !source.url" @click="provider !== 'git' && clone()"><Download :size="15" />{{ working === 'clone' ? '正在克隆…' : '克隆到本地' }}</button>
          <button v-if="provider !== 'git'" class="action primary" type="submit" :disabled="!!working || !source.url"><GitBranch :size="15" />{{ working === 'connect' ? '正在连接…' : '只读连接' }}</button>
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

</style>
