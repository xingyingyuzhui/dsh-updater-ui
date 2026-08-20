import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { inject, _internal } from '../host.js'

const { normalizeRemote, isOfficialRemote, parsePackageVersion, SAFE_GIT_REF } = _internal

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

test('SAFE_GIT_REF rejects shell metacharacters', () => {
  assert.equal(SAFE_GIT_REF.test('master'), true)
  assert.equal(SAFE_GIT_REF.test('feature/foo'), true)
  assert.equal(SAFE_GIT_REF.test('master; rm -rf /'), false)
  assert.equal(SAFE_GIT_REF.test('a b'), false)
  assert.equal(SAFE_GIT_REF.test('$(touch /tmp/x)'), false)
})
