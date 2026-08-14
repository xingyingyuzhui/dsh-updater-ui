# dsh-updater-ui · DSH 更新检查器

DeepSeek Harness（DSH）更新检查插件：在**设置 → DSH 更新**页一键检查并拉取更新，自动后台检查 + 导航红点提醒。

## 功能

- **一键检查**：`git fetch` 后对比本地 HEAD 与远端 `master` 的落后/领先提交数
- **版本对比**：本地/远端 `package.json` 版本号，有更新时显示 `v旧 → v新`
- **更新说明**：可折叠列出新提交（短哈希 + 标题，前 15 条）
- **一键拉取**：`git pull --ff-only origin master`——仅快进，本地有未推送提交或分叉时**安全拒绝**，绝不产生合并冲突
- **自动检查**：Host 每 30 分钟后台检查（防重入），页面每 60 秒轮询缓存（零网络开销）
- **红点提醒**：有更新时设置页导航显示「DSH 更新 ●」
- **重启提示**：拉取成功后提示重启 DSH 使新代码生效

## 安装

前置：已安装 DSH（`dsh web` 可运行）。

```sh
# npm 源
dsh plugin --profile web add dsh-updater-ui

# 或直接从 GitHub 安装
dsh plugin --profile web add github:xingyingyuzhui/dsh-updater-ui
```

装完**重启 DSH**（`dsh --profile web`），然后打开 **设置 → DSH 更新**。

## 使用

打开 **设置 → DSH 更新**：

- 页面自动显示当前状态（✅ 已是最新 / ⚠️ 落后 N 个提交）
- 点击 **一键拉取更新**：有更新则快进到最新并提示重启；已最新则提示无需更新；本地有分叉则安全拒绝并给出原因
- **重新检查** 随时强制刷新

## 工作原理

| 面 | 文件 | 说明 |
| --- | --- | --- |
| Host | `host.js` | 注册两条 HTTP 路由（`POST /dsh-updater/check`、`POST /dsh-updater/pull`，仅 POST 防跨站触发）+ 30 分钟自动检查 timer。零 import，不依赖部署的 node_modules |
| Client | `client.js` | `__ModuleLoader__` bundle：注册设置页「DSH 更新」+ 导航红点，通过同源 `fetch` 调用 Host 路由 |

仓库定位不硬编码：通过 `agentPresets` 服务找到部署配置目录，再 `git rev-parse --show-toplevel` 向上定位仓库根，随部署迁移自动跟随。

## 安全设计

- 路由**仅接受 POST**（GET 可被任意网页 `<img>` 跨站触发；跨站 POST 会被浏览器 CORS 预检拦截）
- 拉取使用 **`--ff-only`**：只允许快进，本地未推送提交/分叉时拒绝，不会破坏本地工作区
- 所有 git 命令带超时与输出上限；错误一律返回结构化 JSON
- 无第三方依赖、无遥测

## 卸载

```sh
dsh plugin --profile web remove dsh-updater-ui
```

## 开发

```sh
pnpm install   # 无依赖，仅占位
# 本地验证：dsh plugin --profile web add link:/path/to/dsh-updater-ui
```

## License

MIT
