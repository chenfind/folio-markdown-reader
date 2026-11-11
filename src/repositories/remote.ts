import { getPlatform } from '../platform'
import { load, save } from '../core/persistence'
import type { CloneOptions, RemoteEntry, RemoteRepository, RemoteSource } from './types'
const caches = new Map<string, Promise<RemoteEntry[]>>()
const trees = new Map<string, Promise<Map<string, RemoteEntry[]> | null>>()

export const repositories = () => load<RemoteRepository[]>('remote-repositories', [])
export const remoteRoot = (repo: RemoteRepository) => 'remote:/' + repo.id + (repo.directory ? '/' + repo.directory : '')
export const remoteName = (repo: RemoteSource) => new URL(repo.url).pathname.replace(/\/$|\.git$/g, '').slice(1)

function repositoryFor(path: string) {
  const [, id, ...parts] = path.split('/')
  return { repo: repositories().find(item => item.id === id), relative: parts.join('/') }
}

export function remoteLabel(path: string) {
  const { repo } = repositoryFor(path)
  return repo && path === remoteRoot(repo) ? remoteName(repo) + (repo.directory ? ' / ' + repo.directory : '') : undefined
}

function normalizeDirectory(path: string) { return path.trim().replace(/^\/+|\/+$/g, '') }
export async function connectRepository(source: RemoteSource, directory: string, token: string, id: string = crypto.randomUUID()) {
  const selected = normalizeDirectory(directory)
  const revision = await getPlatform().repositories.resolve(source, selected, token)
  const repo = { ...source, id, directory: selected, revision }
  save('remote-repositories', [...repositories().filter(item => item.id !== id), repo])
  return repo
}

export async function syncRepositories() {
  const existing = repositories()
  const updates = await Promise.allSettled(existing.map(async repo => ({
    ...repo, revision: await getPlatform().repositories.resolve(repo, '', null),
  })))
  const revisions = new Map(updates.flatMap(result => result.status === 'fulfilled' ? [[result.value.id, result.value] as const] : []))
  save('remote-repositories', repositories().map(repo => {
    const updated = revisions.get(repo.id)
    return updated && repo.url === updated.url && repo.branch === updated.branch && repo.provider === updated.provider
      ? { ...repo, revision: updated.revision }
      : repo
  }))
  return updates.filter(result => result.status === 'rejected').length
}

export function forgetRepository(path: string) {
  const { repo } = repositoryFor(path)
  if (repo) save('remote-repositories', repositories().filter(item => item.id !== repo.id))
}

async function githubTree(repo: RemoteRepository) {
  if (!repo.revision.tree) return null
  const key = repo.id + ':' + repo.revision.tree
  let promise = trees.get(key)
  if (!promise) {
    promise = getPlatform().repositories.tree(repo, repo.revision.tree).then(entries => {
      if (!entries) return null
      const index = new Map<string, RemoteEntry[]>()
      for (const entry of entries) {
        if (!['tree', 'blob'].includes(entry.type) || entry.mode === '120000') continue
        const split = entry.path.lastIndexOf('/')
        const parent = entry.path.slice(0, split < 0 ? 0 : split)
        const directory = index.get(parent) || []
        directory.push({ name: entry.path.slice(split + 1), directory: entry.type === 'tree' })
        index.set(parent, directory)
      }
      return index
    }).catch(error => { trees.delete(key); throw error })
    trees.set(key, promise)
  }
  return promise
}

export function clearRemoteDirectories() { caches.clear(); trees.clear() }

export async function listRemote(path: string) {
  const { repo, relative } = repositoryFor(path)
  if (!repo) throw new Error('该远程仓库已从文档库移除。')
  const tree = repo.provider === 'github' ? await githubTree(repo).catch(() => null) : null
  if (tree) return tree.get(relative) || []
  const key = path + ':' + repo.revision.commit
  let promise = caches.get(key)
  if (!promise) {
    promise = getPlatform().repositories.list(repo, repo.revision.commit, relative)
      .catch(error => { caches.delete(key); throw error })
    caches.set(key, promise)
  }
  return promise
}

export async function readRemote(path: string) {
  const { repo, relative } = repositoryFor(path)
  if (!repo) throw new Error('该远程仓库已从文档库移除。')
  return getPlatform().repositories.read(repo, repo.revision.commit, relative)
}

export const cloneRepository = (source: RemoteSource, options?: CloneOptions) => getPlatform().repositories.clone(source, options)
