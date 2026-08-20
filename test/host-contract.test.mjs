import { test } from 'node:test'
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inject, _internal } from '../host.js'

const {
  normalizeRemote, isOfficialRemote, parsePackageVersion, compareVersion,
  npmKindFromDir, npxRootOf, updateCommand, defaultRegistries, latestUrl,
  classifyInstall, gitCandidatePaths, npmCandidatePaths, resolveGitBin, resolveNpmBin,
  resetGitCache, resetNpmCache, spawnGitError, repoCandidates, defaultDshHome,
  SAFE_GIT_REF, SAFE_NPM_VERSION,
} = _internal

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

test('repoCandidates do not treat ~/.dsh as the official source clone', () => {
  const home = 'C:\\Users\\qinlibang'
  const env = { DSH_HOME: join(home, '.dsh') }
  const list = repoCandidates(env, home)
  assert.equal(defaultDshHome(env, home), join(home, '.dsh'))
  assert.ok(list.includes(join(home, 'deepseek-harness')))
  assert.ok(list.includes(join(home, '.dsh', 'deepseek-harness')))
  assert.equal(list.includes(join(home, '.dsh')), false)
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

test('compareVersion orders official rc tags', () => {
  assert.equal(compareVersion('0.1.0-rc.6', '0.1.0-rc.7'), -1)
  assert.equal(compareVersion('0.1.0-rc.7', '0.1.0-rc.6'), 1)
  assert.equal(compareVersion('0.1.0-rc.7', '0.1.0-rc.7'), 0)
  assert.equal(compareVersion('0.1.0-rc.8', '0.1.0'), -1)
  assert.equal(compareVersion('0.1.0', '0.1.0-rc.8'), 1)
})

test('npmKindFromDir and npxRootOf distinguish npx vs global', () => {
  assert.equal(
    npmKindFromDir('/opt/homebrew/Cellar/node@24/24.18.0/lib/node_modules/@deepseek-ai/dsh'),
    'global',
  )
  const winNpx = 'C:\\Users\\qinlibang\\AppData\\Local\\npm-cache\\_npx\\abc123\\node_modules\\@deepseek-ai\\dsh'
  assert.equal(npmKindFromDir(winNpx), 'npx')
  assert.equal(npxRootOf(winNpx), 'C:\\Users\\qinlibang\\AppData\\Local\\npm-cache\\_npx\\abc123')
  assert.equal(
    npxRootOf('/Users/qin/.npm/_npx/hash/node_modules/@deepseek-ai/dsh'),
    '/Users/qin/.npm/_npx/hash',
  )
})

test('updateCommand never interpolates untrusted names', () => {
  assert.equal(updateCommand('npx', '0.1.0-rc.7'), 'npx --yes @deepseek-ai/dsh@0.1.0-rc.7 web')
  assert.equal(updateCommand('global', '0.1.0-rc.7'), 'npm install -g @deepseek-ai/dsh@0.1.0-rc.7')
  assert.equal(updateCommand('npx', '0.1.0; rm -rf /'), 'npx --yes @deepseek-ai/dsh@latest web')
  assert.equal(SAFE_NPM_VERSION.test('0.1.0-rc.7'), true)
  assert.equal(SAFE_NPM_VERSION.test('0.1.0;rm'), false)
})

test('defaultRegistries tries npmjs then npmmirror', () => {
  const list = defaultRegistries({}, null)
  assert.equal(list[0], 'https://registry.npmjs.org')
  assert.ok(list.includes('https://registry.npmmirror.com'))
  assert.equal(latestUrl('https://registry.npmjs.org/'), 'https://registry.npmjs.org/@deepseek-ai/dsh/latest')
})

test('npmCandidatePaths prefers node sibling and Windows npm.cmd', () => {
  resetNpmCache()
  const env = {
    PATH: '/usr/bin',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\qin\\AppData\\Local',
    APPDATA: 'C:\\Users\\qin\\AppData\\Roaming',
    USERPROFILE: 'C:\\Users\\qin',
    DSH_NPM: 'D:\\tools\\npm.cmd',
  }
  const execPath = 'C:\\Program Files\\nodejs\\node.exe'
  const win = npmCandidatePaths(env, 'win32', execPath)
  assert.equal(win[0], 'D:\\tools\\npm.cmd')
  assert.ok(win.some((p) => /nodejs[/\\]npm\.cmd$/i.test(p)))
  const want = win.find((p) => /nodejs[/\\]npm\.cmd$/i.test(p) && p.indexOf('Program Files') >= 0 && p.indexOf('(x86)') < 0)
  const hit = resolveNpmBin((p) => p === want, env, 'win32', execPath)
  assert.equal(hit, want)
  resetNpmCache()
})

test('classifyInstall detects npm global, npx, and source layouts', async () => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'dsh-upd-')))
  try {
    const globalPkg = join(root, 'lib', 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(join(globalPkg, 'lib'), { recursive: true })
    await writeFile(join(globalPkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.6' }))
    const globalBin = join(globalPkg, 'lib', 'bin.js')
    await writeFile(globalBin, '')
    const globalHit = classifyInstall(globalBin)
    assert.equal(globalHit.channel, 'npm')
    assert.equal(globalHit.kind, 'global')
    assert.equal(globalHit.version, '0.1.0-rc.6')

    const npxPkg = join(root, '_npx', 'hash', 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(npxPkg, { recursive: true })
    await writeFile(join(npxPkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.6' }))
    const npxHit = classifyInstall(join(npxPkg, 'package.json'))
    assert.equal(npxHit.channel, 'npm')
    assert.equal(npxHit.kind, 'npx')
    assert.equal(npxHit.npxRoot, join(root, '_npx', 'hash'))

    const srcRoot = join(root, 'deepseek-harness')
    const srcCli = join(srcRoot, 'apps', 'cli', 'lib')
    await mkdir(srcCli, { recursive: true })
    await writeFile(join(srcRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root', version: '0.1.0-rc.8' }))
    await writeFile(join(srcRoot, 'apps', 'cli', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.8' }))
    const srcBin = join(srcCli, 'bin.js')
    await writeFile(srcBin, '')
    const srcHit = classifyInstall(srcBin)
    assert.equal(srcHit.channel, 'source')
    assert.equal(srcHit.repo, srcRoot)
    assert.equal(srcHit.version, '0.1.0-rc.8')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
