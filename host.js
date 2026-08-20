// dsh-updater-ui —— Host 面
//
// 只同步官方 DeepSeek Harness 仓库更新：
//   POST /dsh-updater/check —— 检查官方更新（10 分钟内返回缓存）
//   POST /dsh-updater/pull  —— 一键拉取官方更新（git pull --ff-only）
// timer 每 30 分钟自动检查并刷新缓存。
// 零第三方依赖：只使用 Node 内置模块。
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export const name = 'dsh-updater-ui'
export const inject = ['timer', 'webServer']

const defaultDshHome = (env = process.env, home = homedir()) =>
  env.DSH_HOME || join(home, '.dsh')

const repoCandidates = (env = process.env, home = homedir(), configRepo) => {
  const out = []
  const add = (p) => {
    if (p && out.indexOf(p) < 0) out.push(p)
  }
  add(configRepo)
  add(env.DSH_REPO)
  add(join(home, 'deepseek-harness'))
  add(join(defaultDshHome(env, home), 'deepseek-harness'))
  return out
}
const OFFICIAL_REMOTE_PATTERN = /(?:^|[/@:])deepseek-ai\/deepseek-harness(?:\.git)?$/i
const SAFE_GIT_REF = /^[A-Za-z0-9._\-/]+$/
const GIT_TIMEOUT_MS = 30000
const FETCH_TIMEOUT_MS = 60000
const PULL_TIMEOUT_MS = 90000

const normalizeRemote = (url) => {
  let value = String(url || '').trim()
  if (value.startsWith('git@')) value = value.replace(':', '/')
  if (value.startsWith('git@github.com/')) value = 'https://github.com/' + value.slice('git@github.com/'.length)
  value = value.replace(/^git\+/, '')
  value = value.replace(/\.git$/, '')
  return value
}

const isOfficialRemote = (url) => OFFICIAL_REMOTE_PATTERN.test(normalizeRemote(url))

const parsePackageVersion = (text) => {
  try {
    const version = JSON.parse(String(text || '')).version
    return typeof version === 'string' && version ? version : null
  } catch {
    return null
  }
}

const gitCandidatePaths = (env = process.env, platform = process.platform) => {
  const names = platform === 'win32' ? ['git.exe', 'git.cmd'] : ['git']
  const out = []
  const override = env.DSH_GIT || env.GIT_PATH
  if (override) out.push(override)
  for (const dir of String(env.PATH || env.Path || '').split(delimiter)) {
    if (!dir) continue
    for (const name of names) out.push(join(dir, name))
  }
  if (platform === 'win32') {
    const pf = env.ProgramFiles || 'C:\\Program Files'
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const local = env.LOCALAPPDATA || join(env.USERPROFILE || env.HOME || '', 'AppData', 'Local')
    const user = env.USERPROFILE || env.HOME || ''
    out.push(
      join(pf, 'Git', 'cmd', 'git.exe'),
      join(pf, 'Git', 'bin', 'git.exe'),
      join(pf, 'Git', 'mingw64', 'bin', 'git.exe'),
      join(pf86, 'Git', 'cmd', 'git.exe'),
      join(local, 'Programs', 'Git', 'cmd', 'git.exe'),
      join(user, 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe'),
    )
  }
  return out.filter(Boolean)
}

let cachedGit = undefined

const isDir = (p) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

const resolveGitBin = (exists = existsSync, env = process.env, platform = process.platform) => {
  const useCache = exists === existsSync && env === process.env && platform === process.platform
  if (useCache && cachedGit !== undefined) return cachedGit
  for (const candidate of gitCandidatePaths(env, platform)) {
    try {
      if (exists(candidate)) {
        if (useCache) cachedGit = candidate
        return candidate
      }
    } catch { /* ignore unreadable candidates */ }
  }
  if (useCache) cachedGit = null
  return null
}

const spawnGitError = (gitBin, workdir) => {
  if (workdir && !isDir(workdir)) {
    return '仓库目录不存在: ' + workdir + '。请设置环境变量 DSH_REPO 为官方 deepseek-harness 的本地路径。'
  }
  return '无法在目录 ' + workdir + ' 启动 git（' + gitBin + '）。请确认该目录存在，或设置 DSH_REPO。'
}

const runGit = (args, workdir, timeoutMs) => new Promise((resolve, reject) => {
  const gitBin = resolveGitBin()
  if (!gitBin) {
    reject(new Error('找不到 git.exe。请安装 Git for Windows，或设置环境变量 DSH_GIT 为 git.exe 的完整路径。'))
    return
  }
  execFile(gitBin, args, {
    cwd: workdir,
    timeout: timeoutMs || GIT_TIMEOUT_MS,
    maxBuffer: 131072,
    windowsHide: true,
    encoding: 'utf8',
  }, (error, stdout, stderr) => {
    if (error && error.code === 'ENOENT') {
      reject(new Error(spawnGitError(gitBin, workdir)))
      return
    }
    const timedOut = !!(error && error.killed)
    resolve({
      exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      timedOut,
      stdout: { text: String(stdout || '') },
      stderr: { text: String(stderr || (error && error.message) || '') },
    })
  })
})

export function apply(ctx, config = {}) {
  let cached = null
  let checking = false
  let pulling = false

  const inspectRepo = async (repo) => {
    if (!isDir(repo)) return { error: 'missing' }
    const check = await runGit(['rev-parse', '--is-inside-work-tree'], repo)
    if (check.exitCode !== 0) return { error: 'not-git' }
    const remote = await runGit(['remote', 'get-url', 'origin'], repo)
    if (remote.exitCode !== 0 || !isOfficialRemote(remote.stdout.text.trim())) {
      return { error: 'not-official' }
    }
    return { repo, remote: remote.stdout.text.trim() }
  }

  const resolveRepo = async () => {
    const tried = repoCandidates(process.env, homedir(), config.repo)
    let last = null
    for (const repo of tried) {
      const found = await inspectRepo(repo)
      last = { repo, found }
      if (!found.error) {
        const branchRes = await runGit(['symbolic-ref', '--short', 'HEAD'], repo)
        if (branchRes.exitCode !== 0) {
          return { error: '无法读取当前分支（可能处于 detached HEAD）: ' + repo }
        }
        const branch = branchRes.stdout.text.trim()
        if (!SAFE_GIT_REF.test(branch)) {
          return { error: '当前分支名不合法，已拒绝操作' }
        }
        const upstreamRes = await runGit(['rev-parse', '--abbrev-ref', '@{upstream}'], repo)
        const upstream = upstreamRes.exitCode === 0 ? upstreamRes.stdout.text.trim() : null
        const remoteRef = upstream && upstream.startsWith('origin/') ? upstream : 'origin/' + branch
        if (!SAFE_GIT_REF.test(remoteRef)) {
          return { error: '上游分支名不合法，已拒绝操作' }
        }
        return { repo, branch, remoteRef }
      }
    }
    const listed = tried.join(' ; ')
    const hint = 'C:\\Users\\<user>\\.dsh 是 DSH 数据目录，不是官方源码。请 clone deepseek-ai/deepseek-harness，或设置 DSH_REPO 为该仓库的本地路径。'
    if (last && last.found && last.found.error === 'not-official') {
      return { error: '已找到目录但 origin 不是官方 deepseek-ai/deepseek-harness: ' + last.repo + '。' + hint }
    }
    return { error: '未找到官方 deepseek-harness git 仓库。已尝试: ' + listed + '。' + hint }
  }

  const readVersion = async (repo) => {
    try {
      return parsePackageVersion(await readFile(join(repo, 'package.json'), 'utf8'))
    } catch {
      return null
    }
  }

  const readRemoteVersion = async (repo, remoteRef) => {
    const res = await runGit(['show', remoteRef + ':package.json'], repo)
    if (res.exitCode !== 0) return null
    return parsePackageVersion(res.stdout.text)
  }

  const readNewCommits = async (repo, remoteRef, limit) => {
    const n = String(limit || 15)
    const res = await runGit(['log', '-n', n, '--format=%h %s', 'HEAD..' + remoteRef], repo)
    if (res.exitCode !== 0) return []
    return res.stdout.text.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)
  }

  const statusOf = async (repo, remoteRef) => {
    const local = await runGit(['rev-parse', 'HEAD'], repo)
    const localDate = await runGit(['log', '-1', '--format=%ci', 'HEAD'], repo)
    const remote = await runGit(['rev-parse', '--verify', remoteRef], repo)
    let behind = null
    let remoteDate = null
    if (remote.exitCode === 0) {
      const behindRes = await runGit(['rev-list', '--count', 'HEAD..' + remoteRef], repo)
      if (behindRes.exitCode === 0) behind = Number(behindRes.stdout.text.trim())
      const remoteDateRes = await runGit(['log', '-1', '--format=%ci', remoteRef], repo)
      if (remoteDateRes.exitCode === 0) remoteDate = remoteDateRes.stdout.text.trim()
    }
    return {
      localCommit: local.exitCode === 0 ? local.stdout.text.trim() : null,
      localDate: localDate.exitCode === 0 ? localDate.stdout.text.trim() : null,
      remoteCommit: remote.exitCode === 0 ? remote.stdout.text.trim() : null,
      remoteDate,
      behind,
    }
  }

  const runFullCheck = async () => {
    const found = await resolveRepo()
    if (found.error) return { ok: false, error: found.error }
    const { repo, branch, remoteRef } = found
    const fetchBranch = remoteRef.replace(/^origin\//, '')
    const fetchRes = await runGit(['fetch', 'origin', fetchBranch], repo, FETCH_TIMEOUT_MS)
    const st = await statusOf(repo, remoteRef)
    const version = await readVersion(repo)
    let remoteVersion = null
    let newCommits = []
    if (st.remoteCommit !== null) {
      remoteVersion = await readRemoteVersion(repo, remoteRef)
      if (st.behind !== null && st.behind > 0) {
        newCommits = await readNewCommits(repo, remoteRef, 15)
      }
    }
    return {
      ok: true,
      repo,
      branch,
      remoteRef,
      version,
      remoteVersion,
      newCommits,
      localCommit: st.localCommit,
      localDate: st.localDate,
      remoteCommit: st.remoteCommit,
      remoteDate: st.remoteDate,
      behind: st.behind,
      fetchFailed: fetchRes.exitCode !== 0,
      fetchError: fetchRes.exitCode !== 0 ? ((fetchRes.stderr && fetchRes.stderr.text) || '').trim().slice(0, 300) : null,
      checkedAt: Date.now(),
    }
  }

  const check = async () => {
    try {
      const now = Date.now()
      if (cached !== null && now - cached.at < 10 * 60 * 1000) {
        return { ...cached.data, cached: true }
      }
      // 与 timer 自动检查共享 checking 标志：进行中时直接返回已有缓存，避免并发 fetch
      if (checking) {
        if (cached !== null) return { ...cached.data, cached: true }
        // 无缓存且检查进行中：等待一轮（最多 40s）再返回结果或错误
        for (let i = 0; i < 40; i += 1) {
          if (!checking && cached !== null) return { ...cached.data, cached: true }
          await ctx.timer.timeout(1000)
        }
        return { ok: false, error: '检查超时，请稍后重试' }
      }
      checking = true
      try {
        const data = await runFullCheck()
        cached = { data, at: data.checkedAt || now }
        return { ...data, cached: false }
      } finally {
        checking = false
      }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error).slice(0, 500) }
    }
  }

  const pull = async () => {
    if (pulling) {
      return { ok: false, error: '一次只允许一个拉取操作，请稍候重试' }
    }
    pulling = true
    try {
      const found = await resolveRepo()
      if (found.error) return { ok: false, error: found.error }
      const { repo, branch, remoteRef } = found
      const pullBranch = remoteRef.replace(/^origin\//, '')

      const beforeRes = await runGit(['rev-parse', 'HEAD'], repo)
      const before = beforeRes.exitCode === 0 ? beforeRes.stdout.text.trim() : null
      const beforeVersion = await readVersion(repo)

      const dirtyRes = await runGit(['status', '--porcelain'], repo)
      const dirty = dirtyRes.exitCode === 0 && dirtyRes.stdout.text.trim().length > 0
      const dirtyCount = dirty ? dirtyRes.stdout.text.trim().split('\n').length : 0

      const pullRes = await runGit(['pull', '--ff-only', 'origin', pullBranch], repo, PULL_TIMEOUT_MS)
      if (pullRes.exitCode !== 0) {
        const errText = ((pullRes.stderr && pullRes.stderr.text) || '').trim().slice(0, 400)
        const isBlocked =
          errText.indexOf('fast-forward') !== -1 ||
          errText.indexOf('diverged') !== -1 ||
          errText.indexOf('local changes') !== -1
        return {
          ok: false,
          error: errText || ('git pull 退出码 ' + String(pullRes.exitCode)),
          hint: isBlocked
            ? '本地存在未推送提交、分叉或未提交改动；--ff-only 拒绝合并。请先处理本地状态后再同步官方更新。'
            : null,
          before,
          beforeVersion,
          dirty,
          dirtyCount,
        }
      }
      const afterRes = await runGit(['rev-parse', 'HEAD'], repo)
      const after = afterRes.exitCode === 0 ? afterRes.stdout.text.trim() : null
      const updated = before !== null && after !== null && before !== after
      const st = await statusOf(repo, remoteRef)
      const version = await readVersion(repo)
      let remoteVersion = null
      if (st.remoteCommit !== null) {
        remoteVersion = await readRemoteVersion(repo, remoteRef)
      }
      const result = {
        ok: true,
        repo,
        branch,
        remoteRef,
        before,
        after,
        updated,
        needsRestart: updated,
        beforeVersion,
        version,
        remoteVersion,
        localCommit: st.localCommit,
        remoteCommit: st.remoteCommit,
        behind: st.behind,
        dirty,
        dirtyCount,
      }
      const now = Date.now()
      cached = { data: { ...result, checkedAt: now }, at: now }
      return result
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error).slice(0, 500) }
    } finally {
      pulling = false
    }
  }

  const respond = async (req, res, fn) => {
    // 仅接受 POST，并要求自定义请求头，避免被跨站表单/图片/简单请求触发。
    if (req.method !== 'POST') {
      const text = JSON.stringify({ ok: false, error: 'method not allowed' })
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(text)
      return
    }
    const headers = req.headers || {}
    if (headers['x-dsh-updater'] !== '1' && headers['X-DSH-Updater'] !== '1') {
      const text = JSON.stringify({ ok: false, error: 'missing csrf header' })
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(text)
      return
    }
    const origin = headers['origin'] || headers['Origin']
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      const text = JSON.stringify({ ok: false, error: 'origin not allowed' })
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(text)
      return
    }
    let body
    try {
      body = await fn()
    } catch (error) {
      body = { ok: false, error: String((error && error.message) || error).slice(0, 500) }
    }
    const text = JSON.stringify(body)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(text)
  }

  const disposeCheckRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-updater/check',
    handler: (req, res) => respond(req, res, check),
  })
  const disposePullRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-updater/pull',
    handler: (req, res) => respond(req, res, pull),
  })

  let disposeTimer = null
  disposeTimer = ctx.timer.interval(() => {
    if (checking) return
    checking = true
    runFullCheck()
      .then((data) => { cached = { data, at: data.checkedAt } })
      .catch(() => { /* 静默失败，保留旧缓存 */ })
      .finally(() => { checking = false })
  }, 30 * 60 * 1000)

  ctx.effect(() => () => {
    disposeCheckRoute()
    disposePullRoute()
    if (disposeTimer) disposeTimer()
  })
}

export const _internal = {
  normalizeRemote,
  isOfficialRemote,
  parsePackageVersion,
  gitCandidatePaths,
  resolveGitBin,
  resetGitCache() { cachedGit = undefined },
  spawnGitError,
  isDir,
  repoCandidates,
  defaultDshHome,
  SAFE_GIT_REF,
}
