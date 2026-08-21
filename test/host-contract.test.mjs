import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inject, _internal } from '../host.js'

const {
  normalizeRemote, isOfficialRemote, parsePackageVersion, compareVersion,
  npmKindFromDir, npxRootOf, globalPrefixOf, updateCommand, defaultRegistries, latestUrl,
  classifyInstall, gitCandidatePaths, npmCandidatePaths, npmCliCandidatePaths,
  resolveGitBin, resolveNpmBin, resolveNpmLaunch,
  needsWinShell, execFileOpts, quoteWinCmdArg, winCmdSpawn,
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

test('globalPrefixOf targets the running install, not default npm prefix', () => {
  assert.equal(
    globalPrefixOf('/opt/homebrew/Cellar/node@24/24.18.0/lib/node_modules/@deepseek-ai/dsh'),
    '/opt/homebrew/Cellar/node@24/24.18.0',
  )
  assert.equal(
    globalPrefixOf('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh'),
    '/opt/homebrew',
  )
  assert.equal(
    globalPrefixOf('C:\\Users\\qin\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh'),
    'C:\\Users\\qin\\AppData\\Roaming\\npm',
  )
})

test('updateCommand never interpolates untrusted names', () => {
  assert.equal(updateCommand('npx', '0.1.0-rc.7'), 'npx --yes @deepseek-ai/dsh@0.1.0-rc.7 web')
  assert.equal(updateCommand('global', '0.1.0-rc.7'), 'npm install -g @deepseek-ai/dsh@0.1.0-rc.7')
  assert.equal(
    updateCommand('global', '0.1.0-rc.7', '/opt/homebrew/Cellar/node@24/24.18.0'),
    'npm install -g --prefix /opt/homebrew/Cellar/node@24/24.18.0 @deepseek-ai/dsh@0.1.0-rc.7',
  )
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

test('Windows .cmd/.bat need a shell; .exe does not', () => {
  assert.equal(needsWinShell('C:\\Program Files\\nodejs\\npm.cmd', 'win32'), true)
  assert.equal(needsWinShell('C:\\Program Files\\nodejs\\npm.CMD', 'win32'), true)
  assert.equal(needsWinShell('D:\\tools\\git.bat', 'win32'), true)
  assert.equal(needsWinShell('C:\\Program Files\\Git\\cmd\\git.exe', 'win32'), false)
  assert.equal(needsWinShell('C:\\Program Files\\nodejs\\npm.cmd', 'darwin'), false)
  assert.equal(needsWinShell('/usr/bin/npm', 'linux'), false)
  assert.equal(execFileOpts('C:\\nodejs\\npm.cmd', { windowsHide: true }, 'win32').shell, true)
  assert.equal(execFileOpts('C:\\Git\\cmd\\git.exe', { windowsHide: true }, 'win32').shell, undefined)
  assert.equal(execFileOpts('/usr/bin/npm', { windowsHide: true }, 'linux').shell, undefined)
})

test('quoteWinCmdArg wraps paths that contain spaces', () => {
  assert.equal(
    quoteWinCmdArg('C:\\Program Files\\nodejs\\npm.cmd'),
    '"C:\\Program Files\\nodejs\\npm.cmd"',
  )
  assert.equal(quoteWinCmdArg('a"b'), '"a""b"')
})

test('winCmdSpawn wraps the command for cmd /s and keeps quotes verbatim', () => {
  const spawned = winCmdSpawn(
    'C:\\Program Files\\nodejs\\npm.cmd',
    ['install', '@deepseek-ai/dsh@1.2.3'],
    { windowsHide: true, encoding: 'utf8' },
    { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
  )
  assert.equal(spawned.file, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(spawned.argv.slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(
    spawned.argv[3],
    '""C:\\Program Files\\nodejs\\npm.cmd" "install" "@deepseek-ai/dsh@1.2.3""',
  )
  assert.equal(spawned.opts.windowsVerbatimArguments, true)
  assert.equal(spawned.opts.windowsHide, true)
})

test('resolveNpmLaunch prefers node.exe plus npm-cli.js over npm.cmd', () => {
  resetNpmCache()
  const env = {
    PATH: 'C:\\Program Files\\nodejs',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\qin\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\qin',
  }
  const execPath = 'C:\\Program Files\\nodejs\\node.exe'
  const candidates = npmCliCandidatePaths(env, 'win32', execPath)
  const cli = candidates.find((p) => /nodejs[/\\]node_modules[/\\]npm[/\\]bin[/\\]npm-cli\.js$/i.test(p) && p.indexOf('(x86)') < 0)
  assert.ok(cli)
  const npmCmd = join(env.ProgramFiles, 'nodejs', 'npm.cmd')
  const launch = resolveNpmLaunch((p) => p === cli || p === npmCmd, env, 'win32', execPath)
  assert.equal(launch.via, 'cli')
  assert.equal(launch.file, execPath)
  assert.deepEqual(launch.argv, [cli])
  resetNpmCache()
})

test('resolveNpmLaunch finds unix npm-cli.js next to the node prefix', () => {
  resetNpmCache()
  const execPath = '/opt/homebrew/opt/node@24/bin/node'
  const env = { PATH: '/opt/homebrew/opt/node@24/bin' }
  const candidates = npmCliCandidatePaths(env, 'darwin', execPath)
  const cli = candidates.find((p) => p.replace(/\\/g, '/').endsWith('lib/node_modules/npm/bin/npm-cli.js'))
  assert.ok(cli)
  const launch = resolveNpmLaunch((p) => p === cli, env, 'darwin', execPath)
  assert.equal(launch.via, 'cli')
  assert.equal(launch.file, execPath)
  assert.deepEqual(launch.argv, [cli])
  resetNpmCache()
})

test('resolveNpmLaunch falls back to npm.cmd only when npm-cli.js is missing', () => {
  resetNpmCache()
  const env = {
    PATH: 'C:\\Program Files\\nodejs',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\qin\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\qin',
  }
  const execPath = 'C:\\Program Files\\nodejs\\node.exe'
  const npmCmd = join(env.ProgramFiles, 'nodejs', 'npm.cmd')
  const launch = resolveNpmLaunch((p) => p === npmCmd, env, 'win32', execPath)
  assert.equal(launch.via, 'cmd')
  assert.equal(launch.file, npmCmd)
  resetNpmCache()
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
    assert.equal(globalHit.prefix, root)

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

test('host launches npm through resolveNpmLaunch, not a raw npm.cmd execFile', async () => {
  const source = await readFile(new URL('../host.js', import.meta.url), 'utf8')
  assert.match(source, /resolveNpmLaunch\(\)/)
  assert.doesNotMatch(source, /execFile\(npmBin/)
})

const liveLaunch = (() => {
  resetNpmCache()
  return resolveNpmLaunch()
})()

test('local node can run npm-cli.js --version without a shell', {
  skip: !liveLaunch || liveLaunch.via !== 'cli' ? 'npm-cli.js not found next to this node' : false,
}, async () => {
  const stdout = await new Promise((resolve, reject) => {
    execFile(liveLaunch.file, liveLaunch.argv.concat(['--version']), {
      timeout: 15000,
      windowsHide: true,
      encoding: 'utf8',
    }, (error, out, err) => {
      if (error) reject(new Error((err || error.message || '').slice(0, 400)))
      else resolve(String(out || ''))
    })
  })
  assert.match(stdout, /^\d+\.\d+/)
})
