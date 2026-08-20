import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inject, _internal } from '../host.js'

const { normalizeRemote, isOfficialRemote, parsePackageVersion, gitCandidatePaths, resolveGitBin, resetGitCache, spawnGitError, SAFE_GIT_REF } = _internal

test('host does not spawn node or POSIX head', async () => {
  const source = await readFile(new URL('../host.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /node -e/)
  assert.doesNotMatch(source, /\| head /)
  assert.deepEqual(inject, ['timer', 'webServer'])
})

test('normalizeRemote handles common GitHub URL forms', () => {
  assert.equal(
    normalizeRemote('https://github.com/deepseek-ai/deepseek-harness.git'),
    'https://github.com/deepseek-ai/deepseek-harness',
  )
  assert.equal(
    normalizeRemote('git@github.com:deepseek-ai/deepseek-harness.git'),
    'https://github.com/deepseek-ai/deepseek-harness',
  )
  assert.equal(
    normalizeRemote('git+https://github.com/deepseek-ai/deepseek-harness.git'),
    'https://github.com/deepseek-ai/deepseek-harness',
  )
})

test('isOfficialRemote only accepts deepseek-ai/deepseek-harness', () => {
  assert.equal(isOfficialRemote('https://github.com/deepseek-ai/deepseek-harness.git'), true)
  assert.equal(isOfficialRemote('git@github.com:deepseek-ai/deepseek-harness.git'), true)
  assert.equal(isOfficialRemote('https://github.com/deepseek-ai/deepseek-harness'), true)
  assert.equal(isOfficialRemote('https://github.com/other/deepseek-harness.git'), false)
  assert.equal(isOfficialRemote('https://github.com/deepseek-ai/other.git'), false)
  assert.equal(isOfficialRemote('/opt/homebrew'), false)
})

test('parsePackageVersion reads version without spawning node', () => {
  assert.equal(parsePackageVersion('{"version":"0.1.0-rc.6"}'), '0.1.0-rc.6')
  assert.equal(parsePackageVersion('not json'), null)
  assert.equal(parsePackageVersion('{"name":"x"}'), null)
})

test('resolveGitBin searches PATH and common Windows Git folders', () => {
  resetGitCache()
  const env = {
    PATH: '/usr/bin',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\qin\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\qin',
    DSH_GIT: 'D:\\tools\\git.exe',
  }
  const win = gitCandidatePaths(env, 'win32')
  assert.equal(win[0], 'D:\\tools\\git.exe')
  assert.ok(win.some((p) => /Git[/\\]cmd[/\\]git\.exe$/i.test(p)))
  const want = win.find((p) => /Git[/\\]cmd[/\\]git\.exe$/i.test(p) && p.indexOf('Program Files') >= 0 && p.indexOf('(x86)') < 0)
  const hit = resolveGitBin((p) => p === want, env, 'win32')
  assert.equal(hit, want)
  resetGitCache()
})

test('spawnGitError names a missing repo directory instead of blaming git', () => {
  const missing = join('/tmp', 'no-such-dsh-repo-' + Date.now())
  assert.match(spawnGitError('C:\\Program Files\\Git\\cmd\\git.exe', missing), /仓库目录不存在/)
  assert.match(spawnGitError('C:\\Program Files\\Git\\cmd\\git.exe', missing), /DSH_REPO/)
})

test('SAFE_GIT_REF rejects shell metacharacters', () => {
  assert.equal(SAFE_GIT_REF.test('master'), true)
  assert.equal(SAFE_GIT_REF.test('feature/foo'), true)
  assert.equal(SAFE_GIT_REF.test('master; rm -rf /'), false)
  assert.equal(SAFE_GIT_REF.test('a b'), false)
  assert.equal(SAFE_GIT_REF.test('$(touch /tmp/x)'), false)
})
