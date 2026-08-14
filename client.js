// dsh-updater-ui —— Client 面（浏览器 bundle）
//
// DSH web 前端通过 __ModuleLoader__ 加载本 bundle（格式同第一方 ui 包）。
// 零外部依赖：React 由 loader 的 require 提供；检查/拉取走同源 HTTP 路由
// （fetch('/dsh-updater/check') / fetch('/dsh-updater/pull')，由 host.js 注册）。
// 注册设置页「DSH 更新」（settings.section），有更新时导航标签带 ● 红点。
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

      var callCheck = function () {
        return fetch('/dsh-updater/check', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(30000) })
          .then(function (r) { return r.json() })
      }
      var callPull = function () {
        return fetch('/dsh-updater/pull', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(60000) })
          .then(function (r) { return r.json() })
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
          hasUpdate = !!(data && data.ok && data.behind !== null && data.behind > 0)
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
          statusLine = el('div', null, '正在检查更新…')
        } else if (state.error) {
          statusLine = el('div', { style: errStyle }, '检查失败: ' + state.error)
        } else if (!state.data || !state.data.ok) {
          statusLine = el('div', { style: errStyle }, '检查失败: ' + ((state.data && state.data.error) || '未知错误'))
        } else {
          var d = state.data
          if (d.behind === null) {
            statusLine = el('div', { style: warnStyle }, '无法确定远端状态' + (d.fetchFailed ? '（git fetch 失败: ' + (d.fetchError || '') + '）' : ''))
          } else if (d.behind === 0 && d.ahead === 0) {
            statusLine = el('div', { style: okStyle }, '✅ 已是最新版本')
          } else if (d.behind > 0) {
            var verNote = ''
            if (d.remoteVersion && d.version && d.remoteVersion !== d.version) {
              verNote = '（v' + d.version + ' → v' + d.remoteVersion + '）'
            } else if (d.remoteVersion && d.remoteVersion === d.version) {
              verNote = '（版本号未变）'
            }
            statusLine = el('div', { style: warnStyle }, '⚠️ 有更新可用：落后 ' + d.behind + ' 个提交' + verNote)
          } else {
            statusLine = el('div', { style: okStyle }, '与远端一致，本地领先 ' + d.ahead + ' 个提交')
          }
        }

        var pullLine = null
        if (pull !== null) {
          if (pull.phase === 'running') {
            pullLine = el('div', null, '正在拉取更新…')
          } else if (pull.result && pull.result.ok) {
            pullLine = pull.result.updated
              ? el('div', null,
                  el('div', { style: okStyle },
                    '✅ 已更新: ' + (pull.result.before || '').slice(0, 8) + ' → ' + (pull.result.after || '').slice(0, 8) +
                    (pull.result.beforeVersion && pull.result.version && pull.result.beforeVersion !== pull.result.version
                      ? '（v' + pull.result.beforeVersion + ' → v' + pull.result.version + '）' : '')),
                  el('div', { style: Object.assign({ marginTop: 4 }, warnStyle) },
                    '⚠️ 新代码已拉取，重启 DSH 后更新才会生效'))
              : el('div', { style: okStyle }, '已是最新，无需更新')
          } else {
            pullLine = el('div', { style: errStyle }, '拉取失败: ' + ((pull.result && pull.result.error) || '未知错误') + ((pull.result && pull.result.hint) ? '（' + pull.result.hint + '）' : ''))
          }
        }

        var data = state.data
        var commits = data && data.ok && data.behind > 0 && Array.isArray(data.newCommits) && data.newCommits.length ? data.newCommits : []
        var logBox = null
        if (commits.length > 0) {
          var countNote = data.behind > commits.length ? ('前 ' + commits.length + ' 条，共 ' + data.behind + ' 条') : (commits.length + ' 条')
          logBox = el('details', null,
            el('summary', { style: { cursor: 'pointer' } }, '更新说明（' + countNote + '）'),
            el('div', { style: { marginTop: 2 } }, commits.map(function (c) {
              return el('div', { style: Object.assign({ marginLeft: 10 }, monoStyle) }, c)
            })))
        }

        var pullBusy = pull !== null && pull.phase === 'running'
        return el('div', { style: cardStyle },
          el('div', { style: { fontWeight: 600 } }, 'DSH 更新'),
          statusLine,
          data && data.ok ? el('div', null,
            row('本地版本', data.version, true),
            row('远端版本', data.remoteVersion, true),
            row('本地', (data.localCommit || '').slice(0, 8) + (data.localDate ? '  ' + data.localDate : ''), true),
            row('远端', (data.remoteCommit || '').slice(0, 8) + (data.remoteDate ? '  ' + data.remoteDate : ''), true),
            row('最近检查', data.checkedAt ? new Date(data.checkedAt).toLocaleTimeString() : '—')) : null,
          logBox,
          pullLine,
          el('div', { style: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' } },
            el('button', { style: pullBtnStyle, onClick: runPull, disabled: pullBusy }, pullBusy ? '拉取中…' : '一键拉取更新'),
            el('button', { style: btnStyle, onClick: runCheck, disabled: state.phase === 'running' }, state.phase === 'running' ? '检查中…' : '重新检查')),
          el('div', { style: noteStyle }, '自动检查每 30 分钟一次（页面每 60 秒刷新缓存结果）；拉取使用 git pull --ff-only，仅快进更新，本地存在未推送提交或分叉时会安全拒绝。'))
      }

      var disposeInject = slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'dsh-update', order: 30, label: function () { return hasUpdate ? 'DSH 更新 ●' : 'DSH 更新' } },
          function (props) { return React.createElement(UpdView, null) })
      })
      ctx.effect(function () { return function () { disposeInject() } })
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
