# dsh-updater-ui · DSH 官方更新检查器

DeepSeek Harness（DSH）官方更新插件：在**设置 → DSH 更新**页一键检查并拉取官方仓库更新，自动后台检查 + 导航红点提醒。

它只做一件事：**同步官方 `deepseek-ai/deepseek-harness` 仓库的最新更新**。它不关心、不展示、不管理你本地比官方多出来的提交或插件。

## 功能

- **一键检查**：`git fetch` 后对比本地 HEAD 与官方远端
- **版本对比**：本地/官方远端 `package.json` 版本号，有更新时显示 `v旧 → v新`
- **更新说明**：可折叠列出官方新提交（短哈希 + 标题，前 15 条）
- **一键拉取**：`git pull --ff-only origin <branch>`——只允许快进到官方最新
- **自动检查**：Host 每 30 分钟后台检查（防重入），页面每 60 秒轮询缓存
- **红点提醒**：有官方更新时设置页导航显示「DSH 更新 ●」
- **安全拒绝**：本地存在未推送提交、分叉或冲突改动时安全拒绝，绝不覆盖本地内容

## 安装

前置：已安装 DSH（`dsh web` 可运行），并且本机有官方仓库的 git clone。

```sh
# 从 GitHub 安装
dsh plugin --profile web add github:xingyingyuzhui/dsh-updater-ui
```

装完**重启 DSH**，然后打开 **设置 → DSH 更新**。

## 使用

打开 **设置 → DSH 更新**：

- 页面显示当前官方更新状态（✅ 已是最新 / ⚠️ 落后 N 个提交）
- 点击 **一键拉取官方更新**：有更新则快进到官方最新并提示重启；已最新则提示无需更新；本地有分叉/未提交冲突则安全拒绝
- **重新检查** 随时强制刷新

## 仓库定位

插件默认操作：

```text
~/deepseek-harness
```

如果官方仓库在别的位置，可以通过环境变量指定：

```sh
DSH_REPO=/path/to/deepseek-harness
```

插件会校验该目录：

1. 必须是 git 仓库
2. `origin` 必须是 `deepseek-ai/deepseek-harness`
3. 必须能读取当前分支和上游分支

校验不通过会拒绝操作，避免误 pull 到 `/opt/homebrew` 等无关仓库。

## 安全设计

- 路由**仅接受 POST**
- 必须带自定义请求头 `X-DSH-Updater: 1`（跨站表单/图片无法触发）
- 如果带 `Origin`，只允许 `http://127.0.0.1` / `http://localhost`
- 拉取使用 **`--ff-only`**：只允许快进，本地有未推送提交/分叉/冲突时安全拒绝
- 所有 git 命令带超时与输出上限；错误一律返回结构化 JSON
- 无第三方依赖、无遥测

## 卸载

```sh
dsh plugin --profile web remove dsh-updater-ui
```

## 开发

```sh
pnpm install   # 无依赖，仅占位
pnpm test      # 基础契约测试
# 本地验证：dsh plugin --profile web add link:/path/to/dsh-updater-ui
```

## License

MIT
