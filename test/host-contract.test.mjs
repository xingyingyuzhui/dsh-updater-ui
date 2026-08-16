import { test } from 'node:test'
import assert from 'node:assert/strict'
import { _internal } from '../host.js'

const { normalizeRemote, isOfficialRemote, SAFE_GIT_REF } = _internal

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

test('SAFE_GIT_REF rejects shell metacharacters', () => {
  assert.equal(SAFE_GIT_REF.test('master'), true)
  assert.equal(SAFE_GIT_REF.test('feature/foo'), true)
  assert.equal(SAFE_GIT_REF.test('master; rm -rf /'), false)
  assert.equal(SAFE_GIT_REF.test('a b'), false)
  assert.equal(SAFE_GIT_REF.test('$(touch /tmp/x)'), false)
})
