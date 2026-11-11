import assert from 'node:assert/strict'
import test from 'node:test'
import { capabilitiesFor, splitDirection } from '../src/platform/policy.ts'
import { localPath, pathKey, restorable } from '../src/documents/address.ts'

test('Android uses in-app splits and never enables independent windows', () => {
  const android = capabilitiesFor('android')
  assert.equal(android.independentWindows, false)
  assert.equal(android.nativeFiles, true)
  assert.equal(android.cloneRepositories, true)
  assert.equal(android.automaticSplitDirection, true)
  assert.equal(splitDirection(412, 915), 'column')
  assert.equal(splitDirection(915, 412), 'row')
  assert.equal(splitDirection(600, 600), 'column')
})

test('Windows keeps its existing window capability and manual split direction', () => {
  const windows = capabilitiesFor('windows')
  assert.equal(windows.independentWindows, true)
  assert.equal(windows.automaticSplitDirection, false)
  assert.equal(windows.cloneRepositories, true)
})

test('native shells and browser imports have different filesystem guarantees', () => {
  assert.equal(capabilitiesFor('browser').nativeFiles, false)
  assert.equal(capabilitiesFor('windows').nativeFiles, true)
  assert.equal(capabilitiesFor('browser').remoteRepositories, false)
  assert.equal(restorable('import:/batch/notes.md'), false)
  assert.equal(restorable('remote:/repository/docs/notes.md'), true)
})

test('document IDs and relative links retain existing Windows and remote semantics', () => {
  assert.equal(pathKey('D:/Docs/README.md'), pathKey('d:/docs/readme.md'))
  assert.notEqual(pathKey('remote:/id/README.md'), pathKey('remote:/id/readme.md'))
  assert.deepEqual(localPath('D:/docs/a.md', './b.md#安装'), { path: 'D:/docs/b.md', fragment: '安装' })
  assert.deepEqual(localPath('//server/share/a.md', 'b.md'), { path: '//server/share/b.md', fragment: '' })
  assert.deepEqual(localPath('remote:/id/docs/a.md', '../b.md'), { path: 'remote:/id/b.md', fragment: '' })
  assert.equal(localPath('remote:/id/a.md', '../../outside.md'), null)
  assert.deepEqual(localPath('saf:/id/docs/a.md', '../b.md#part'), { path: 'saf:/id/b.md', fragment: 'part' })
  assert.equal(localPath('saf:/id/a.md', '../../outside.md'), null)
  assert.equal(restorable('saf:/id/a.md'), true)
  assert.equal(localPath('D:/docs/a.md', 'javascript:alert(1)'), null)
})

test('updated documents with repeated paragraphs restore the closest matching block', async () => {
  const { closestAnchorBlock } = await import('../src/reader/position.ts')
  assert.equal(closestAnchorBlock(['New title', 'Same text', 'Same text', 'Same text'], 'Same text', 3, 0, 4), 3)
  assert.equal(closestAnchorBlock(['Same text', 'Section', 'Same text'], 'Same text', 0, 1, 3), 2)
  assert.equal(closestAnchorBlock(['Other'], 'Deleted', 0, 0, 1), -1)
})

test('shared UI and reading modules access Tauri only through platform adapters', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const sources = readdirSync('src', { recursive: true }).map(String)
  const violations = sources.filter(path => /\.(ts|vue)$/.test(path) && !path.replaceAll('\\', '/').startsWith('platform/'))
    .filter(path => /(?:from\s*|import\s*\()['"]@tauri-apps\//.test(readFileSync(resolve('src', path), 'utf8')))
  assert.deepEqual(violations, [])
})
