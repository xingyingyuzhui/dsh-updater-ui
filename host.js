// dsh-updater-ui —— Host 面
//
// 通过 HTTP 路由暴露检查/拉取接口给浏览器端设置页（仅接受 POST，防跨站触发）：
//   POST /dsh-updater/check —— 检查更新（10 分钟内返回缓存）
//   POST /dsh-updater/pull  —— 一键拉取（git pull --ff-only）
// timer 每 30 分钟自动检查并刷新缓存。
// 零 import、纯 ESM：不依赖部署的 node_modules 解析，可随目录迁移。
export const name = 'dsh-updater-ui'
export const inject = ['shell', 'agentPresets', 'timer', 'webServer']

export function apply(ctx) {
  let cached = null
  let checking = false
  let pulling = false

  const runGit = async (command, workdir, timeoutMs) => {
    const spec = ctx.shell.resolve({
      command,
      workdir,
      timeoutMs: timeoutMs || 30000,
      stdoutMaxBytes: 131072,
    })
    return ctx.shell.run(spec)
  }

  const locateRepo = async () => {
    const list = await ctx.agentPresets.list()
    const preset = list.find((p) => p.id === 'cordis') || list[0]
    if (!preset) return { error: '未找到任何 agent preset' }
    const suffix = '/agent-presets/' + preset.id + '/agent.cordis.yml'
    if (!preset.path.endsWith(suffix)) return { error: '意外的 preset 路径: ' + preset.path }
    const configDir = preset.path.slice(0, -suffix.length)
    const top = await runGit('git rev-parse --show-toplevel', configDir)
    if (top.exitCode !== 0) {
      const detail = top.stderr && top.stderr.text ? ' (' + top.stderr.text.trim().slice(0, 200) + ')' : ''
      return { error: '部署目录不在 git 仓库内: ' + configDir + detail }
    }
    return { repo: top.stdout.text.trim() }
  }

  const readVersion = async (repo) => {
    const res = await runGit('grep -m1 \'"version"\' package.json | cut -d\'"\' -f4', repo)
    return res.exitCode === 0 ? res.stdout.text.trim() : null
  }

  const readRemoteVersion = async (repo) => {
    const res = await runGit("git show origin/master:package.json | grep -m1 '\"version\"' | cut -d'\"' -f4", repo)
    return res.exitCode === 0 ? res.stdout.text.trim() : null
  }

  const readNewCommits = async (repo, limit) => {
    const res = await runGit('git log --format=%h %s HEAD..origin/master | head -' + (limit || 15), repo)
    if (res.exitCode !== 0) return []
    return res.stdout.text.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)
  }

  const statusOf = async (repo) => {
    const local = await runGit('git rev-parse HEAD', repo)
    const localDate = await runGit('git log -1 --format=%ci HEAD', repo)
    const remote = await runGit('git rev-parse --verify origin/master', repo)
    let behind = null
    let ahead = null
    let remoteDate = null
    if (remote.exitCode === 0) {
      const behindRes = await runGit('git rev-list --count HEAD..origin/master', repo)
      if (behindRes.exitCode === 0) behind = Number(behindRes.stdout.text.trim())
      const aheadRes = await runGit('git rev-list --count origin/master..HEAD', repo)
      if (aheadRes.exitCode === 0) ahead = Number(aheadRes.stdout.text.trim())
      const remoteDateRes = await runGit('git log -1 --format=%ci origin/master', repo)
      if (remoteDateRes.exitCode === 0) remoteDate = remoteDateRes.stdout.text.trim()
    }
    return {
      localCommit: local.exitCode === 0 ? local.stdout.text.trim() : null,
      localDate: localDate.exitCode === 0 ? localDate.stdout.text.trim() : null,
      remoteCommit: remote.exitCode === 0 ? remote.stdout.text.trim() : null,
      remoteDate,
      behind,
      ahead,
    }
  }

  const runFullCheck = async () => {
    const found = await locateRepo()
    if (found.error) return { ok: false, error: found.error }
    const repo = found.repo
    const fetchRes = await runGit('git fetch origin master', repo, 60000)
    const st = await statusOf(repo)
    const version = await readVersion(repo)
    let remoteVersion = null
    let newCommits = []
    if (st.remoteCommit !== null) {
      remoteVersion = await readRemoteVersion(repo)
      if (st.behind !== null && st.behind > 0) {
        newCommits = await readNewCommits(repo, 15)
      }
    }
    return {
      ok: true,
      repo,
      version,
      remoteVersion,
      newCommits,
      localCommit: st.localCommit,
      localDate: st.localDate,
      remoteCommit: st.remoteCommit,
      remoteDate: st.remoteDate,
      behind: st.behind,
      ahead: st.ahead,
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
      const found = await locateRepo()
      if (found.error) return { ok: false, error: found.error }
      const repo = found.repo
      const beforeRes = await runGit('git rev-parse HEAD', repo)
      const before = beforeRes.exitCode === 0 ? beforeRes.stdout.text.trim() : null
      const beforeVersion = await readVersion(repo)
      const pullRes = await runGit('git pull --ff-only origin master', repo, 90000)
      if (pullRes.exitCode !== 0) {
        const errText = ((pullRes.stderr && pullRes.stderr.text) || '').trim().slice(0, 400)
        const isAhead = errText.indexOf('fast-forward') !== -1 || errText.indexOf('diverged') !== -1
        return {
          ok: false,
          error: errText || ('git pull 退出码 ' + String(pullRes.exitCode)),
          hint: isAhead
            ? '本地存在未推送提交或与远端分叉；--ff-only 拒绝合并。请先处理本地提交（推送或 rebase）后再试。'
            : null,
          before,
          beforeVersion,
        }
      }
      const afterRes = await runGit('git rev-parse HEAD', repo)
      const after = afterRes.exitCode === 0 ? afterRes.stdout.text.trim() : null
      const updated = before !== null && after !== null && before !== after
      const st = await statusOf(repo)
      const version = await readVersion(repo)
      let remoteVersion = null
      if (st.remoteCommit !== null) {
        remoteVersion = await readRemoteVersion(repo)
      }
      const result = {
        ok: true,
        repo,
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
        ahead: st.ahead,
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
    // 仅接受 POST：GET 可被任意网页的 <img>/<a> 跨站触发（CSRF 面），POST 没有
    // 简单触发方式（跨站 POST 需 CORS 预检，本服务不发 CORS 头会被浏览器拦截）。
    if (req.method !== 'POST') {
      const text = JSON.stringify({ ok: false, error: 'method not allowed' })
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
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
