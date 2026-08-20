// dsh-updater-ui —— Client 面（浏览器 bundle）
//
// DSH web 前端通过 __ModuleLoader__ 加载本 bundle（格式同第一方 ui 包）。
// 零外部依赖：React 由 loader 的 require 提供；检查/更新走同源 HTTP 路由
// （fetch('/dsh-updater/check') / fetch('/dsh-updater/pull')，由 host.js 注册）。
// npm/npx 安装显示 registry 版本；源码安装显示 git 提交。
// 注册设置页「DSH 更新」（settings.section），有官方更新时导航标签带 ● 红点。
window.__ModuleLoader__.load({
  id: 'dsh-updater-ui',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var name = 'dsh-updater-ui'
    var inject = ['slots', 'timer']

    var cardStyle = {
      display: 'flex', flexDirection: 'column', gap: 4,
      padding: '10px 12px', border: '1px solid rgba(128,128,128,.35)',
      borderRadius: 8, fontSize: 13, lineHeight: 1.5,
    }
    var rowStyle = { display: 'flex', gap: 8, alignItems: 'baseline' }
    var labelStyle = { opacity: 0.55, minWidth: 70, flex: 'none' }
    var monoStyle = { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', fontSize: 12, wordBreak: 'break-all' }
    var okStyle = { color: '#2e7d32', fontWeight: 600 }
    var warnStyle = { color: '#b26a00', fontWeight: 600 }
    var errStyle = { color: '#c62828' }
    var btnStyle = {
      padding: '4px 14px', borderRadius: 6, border: '1px solid rgba(128,128,128,.5)',
      background: 'transparent', cursor: 'pointer', fontSize: 12,
    }
    var pullBtnStyle = {
      padding: '4px 14px', borderRadius: 6, border: '1px solid rgba(59,130,246,.6)',
      background: 'rgba(59,130,246,.15)', color: 'inherit', cursor: 'pointer',
      fontSize: 12, fontWeight: 600,
    }
    var noteStyle = { opacity: 0.6, fontSize: 12, marginTop: 4 }

    function apply(ctx) {
      var slots = ctx.get('slots')
      var timer = ctx.get('timer')
      if (slots === undefined) return
      var hasUpdate = false
      var disposeInject = null
      var headers = { 'X-DSH-Updater': '1' }

      var callCheck = function () {
        return fetch('/dsh-updater/check', {
          method: 'POST', headers: headers, cache: 'no-store', signal: AbortSignal.timeout(30000)
        }).then(function (r) {
          if (!r.ok) throw new Error('check failed: ' + r.status)
          return r.json()
        })
      }
      var callPull = function () {
        return fetch('/dsh-updater/pull', {
          method: 'POST', headers: headers, cache: 'no-store', signal: AbortSignal.timeout(120000)
        }).then(function (r) {
          if (!r.ok) throw new Error('pull failed: ' + r.status)
          return r.json()
        })
      }

      var kindLabel = function (kind) {
        if (kind === 'npx') return 'npm（npx）'
        if (kind === 'global') return 'npm（全局）'
        if (kind === 'source') return '源码仓库'
        if (kind === 'npm') return 'npm'
        return kind || '—'
      }

      function UpdView() {
        var el = React.createElement
        var state0 = React.useState({ phase: 'running', data: null, error: null })
        var state = state0[0]
        var setState = state0[1]
        var pull0 = React.useState(null)
        var pull = pull0[0]
        var setPull = pull0[1]

        var applyData = function (data) {
          var next = !!(data && data.ok && data.behind !== null && data.behind > 0)
          if (next !== hasUpdate) {
            hasUpdate = next
            refreshInject()
          }
        }

        var runCheck = function () {
          setState({ phase: 'running', data: null, error: null })
          callCheck().then(function (data) {
            applyData(data)
            setState({ phase: 'done', data: data, error: null })
          }).catch(function (error) {
            setState({ phase: 'done', data: null, error: String((error && error.message) || error) })
          })
        }

        var pollCheck = function () {
          callCheck().then(function (data) {
            applyData(data)
            setState(function (s) { return s.phase === 'done' ? { phase: 'done', data: data, error: null } : s })
          }).catch(function () { /* 静默 */ })
        }

        var runPull = function () {
          setPull({ phase: 'running', result: null })
          callPull().then(function (result) {
            setPull({ phase: 'done', result: result })
            runCheck()
          }).catch(function (error) {
            setPull({ phase: 'done', result: { ok: false, error: String((error && error.message) || error) } })
          })
        }

        React.useEffect(function () {
          runCheck()
          if (timer !== undefined) {
            var dispose = timer.interval(function () { pollCheck() }, 60000)
            return function () { dispose() }
          }
        }, [])

        function row(label, value, mono) {
          return el('div', { style: rowStyle },
            el('span', { style: labelStyle }, label),
            el('span', { style: mono ? monoStyle : undefined }, value === null || value === undefined ? '—' : String(value)))
        }

        var statusLine
        if (state.phase === 'running') {
          statusLine = el('div', null, '正在检查官方更新…')
        } else if (state.error) {
          statusLine = el('div', { style: errStyle }, '检查失败: ' + state.error)
        } else if (!state.data || !state.data.ok) {
          statusLine = el('div', { style: errStyle }, '检查失败: ' + ((state.data && state.data.error) || '未知错误'))
        } else {
          var d = state.data
          if (d.behind === null) {
            var why = d.channel === 'npm' ? 'npm registry' : 'git fetch'
            statusLine = el('div', { style: warnStyle }, '无法确定官方远端状态' + (d.fetchFailed ? '（' + why + ' 失败: ' + (d.fetchError || '') + '）' : ''))
          } else if (d.behind === 0) {
            statusLine = el('div', { style: okStyle }, '✅ 已是最新版本')
          } else if (d.channel === 'npm') {
            statusLine = el('div', { style: warnStyle },
              '⚠️ 有官方更新：v' + (d.version || '?') + ' → v' + (d.remoteVersion || '?'))
          } else {
            var verNote = ''
            if (d.remoteVersion && d.version && d.remoteVersion !== d.version) {
              verNote = '（v' + d.version + ' → v' + d.remoteVersion + '）'
            } else if (d.remoteVersion && d.remoteVersion === d.version) {
              verNote = '（版本号未变）'
            }
            statusLine = el('div', { style: warnStyle }, '⚠️ 有官方更新：落后 ' + d.behind + ' 个提交' + verNote)
          }
        }

        var pullLine = null
        if (pull !== null) {
          if (pull.phase === 'running') {
            pullLine = el('div', null, (state.data && state.data.channel === 'npm') ? '正在更新官方 npm 包…' : '正在拉取官方更新…')
          } else if (pull.result && pull.result.ok) {
            var dirtyNote = pull.result.dirty
              ? el('div', { style: noteStyle }, '工作区原有 ' + pull.result.dirtyCount + ' 个未提交改动；本次未覆盖它们。')
              : null
            var restartNote = pull.result.needsRestart
              ? el('div', { style: Object.assign({ marginTop: 4 }, warnStyle) }, '⚠️ 新代码已就绪，重启 DSH 后更新才会生效')
              : null
            var cmdNote = pull.result.command
              ? el('div', { style: Object.assign({ marginTop: 4 }, monoStyle) }, pull.result.command)
              : null
            if (pull.result.channel === 'npm' && !pull.result.updated) {
              pullLine = el('div', null,
                el('div', { style: okStyle }, pull.result.hint || '请用下面的命令重启到官方最新'),
                cmdNote)
            } else if (pull.result.updated) {
              var range = pull.result.channel === 'npm'
                ? ((pull.result.beforeVersion && pull.result.version && pull.result.beforeVersion !== pull.result.version)
                  ? ('v' + pull.result.beforeVersion + ' → v' + pull.result.version)
                  : ('v' + (pull.result.version || pull.result.remoteVersion || '')))
                : ((pull.result.before || '').slice(0, 8) + ' → ' + (pull.result.after || '').slice(0, 8) +
                  (pull.result.beforeVersion && pull.result.version && pull.result.beforeVersion !== pull.result.version
                    ? '（v' + pull.result.beforeVersion + ' → v' + pull.result.version + '）' : ''))
              pullLine = el('div', null,
                el('div', { style: okStyle }, '✅ 已更新到官方最新: ' + range),
                restartNote,
                dirtyNote)
            } else {
              pullLine = el('div', null,
                el('div', { style: okStyle }, '已是最新，无需更新'),
                dirtyNote)
            }
          } else {
            pullLine = el('div', { style: errStyle },
              '更新失败: ' + ((pull.result && pull.result.error) || '未知错误') +
              ((pull.result && pull.result.hint) ? '（' + pull.result.hint + '）' : '') +
              (pull.result && pull.result.dirty ? '（工作区有 ' + pull.result.dirtyCount + ' 个未提交改动）' : ''))
            if (pull.result && pull.result.command) {
              pullLine = el('div', null, pullLine,
                el('div', { style: Object.assign({ marginTop: 4 }, monoStyle) }, pull.result.command))
            }
          }
        }

        var data = state.data
        var commits = data && data.ok && data.behind > 0 && Array.isArray(data.newCommits) && data.newCommits.length ? data.newCommits : []
        var logBox = null
        if (commits.length > 0) {
          var countNote = data.behind > commits.length ? ('前 ' + commits.length + ' 条，共 ' + data.behind + ' 条') : (commits.length + ' 条')
          logBox = el('details', null,
            el('summary', { style: { cursor: 'pointer' } }, '官方更新说明（' + countNote + '）'),
            el('div', { style: { marginTop: 2 } }, commits.map(function (c, index) {
              return el('div', { key: c + '-' + index, style: Object.assign({ marginLeft: 10 }, monoStyle) }, c)
            })))
        }

        var pullBusy = pull !== null && pull.phase === 'running'
        var isNpm = !!(data && data.channel === 'npm')
        var meta = null
        if (data && data.ok) {
          meta = isNpm
            ? el('div', null,
                row('安装方式', kindLabel(data.kind)),
                row('安装路径', data.install || data.repo, true),
                row('本地版本', data.version, true),
                row('官方版本', data.remoteVersion, true),
                data.command ? row('更新命令', data.command, true) : null,
                row('最近检查', data.checkedAt ? new Date(data.checkedAt).toLocaleTimeString() : '—'))
            : el('div', null,
                row('安装方式', '源码仓库'),
                row('仓库', data.repo, true),
                row('分支', data.branch, true),
                row('本地版本', data.version, true),
                row('官方版本', data.remoteVersion, true),
                row('本地', (data.localCommit || '').slice(0, 8) + (data.localDate ? '  ' + data.localDate : ''), true),
                row('官方', (data.remoteCommit || '').slice(0, 8) + (data.remoteDate ? '  ' + data.remoteDate : ''), true),
                row('最近检查', data.checkedAt ? new Date(data.checkedAt).toLocaleTimeString() : '—'))
        }
        var note = isNpm
          ? '当前进程来自 npm/npx，检查走官方 npm 包 @deepseek-ai/dsh，不 git pull 本机源码仓。自动检查每 30 分钟一次。更新后需重启 DSH。'
          : '当前进程来自源码仓库，只同步官方 deepseek-ai/deepseek-harness；拉取使用 git pull --ff-only，仅快进。自动检查每 30 分钟一次。'
        var pullLabel = pullBusy
          ? (isNpm ? '更新中…' : '拉取中…')
          : (isNpm ? '一键更新官方 npm 包' : '一键拉取官方更新')
        return el('div', { style: cardStyle },
          el('div', { style: { fontWeight: 600 } }, 'DSH 官方更新'),
          statusLine,
          meta,
          logBox,
          pullLine,
          el('div', { style: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' } },
            el('button', { style: pullBtnStyle, onClick: runPull, disabled: pullBusy }, pullLabel),
            el('button', { style: btnStyle, onClick: runCheck, disabled: state.phase === 'running' }, state.phase === 'running' ? '检查中…' : '重新检查')),
          el('div', { style: noteStyle }, note))
      }

      var refreshInject = function () {
        if (disposeInject) disposeInject()
        disposeInject = slots.inject('settings.section', function () {
          return slots.register(
            { name: 'settings.section', id: 'dsh-update', order: 30, label: function () { return hasUpdate ? 'DSH 更新 ●' : 'DSH 更新' } },
            function (props) { return React.createElement(UpdView, null) }
          )
        })
      }

      refreshInject()
      ctx.effect(function () { return function () { if (disposeInject) disposeInject() } })
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
