# dsh-updater-ui · DSH 官方更新检查器

DeepSeek Harness（DSH）官方更新插件：在**设置 → DSH 更新**页一键检查并更新官方 DSH。自动后台检查 + 导航红点提醒。

它看的是**当前正在跑的那个 DSH 进程**怎么安装的，而不是磁盘上碰巧有没有一份源码：

| 当前进程 | 检查 | 一键更新 |
|---|---|---|
| `npx @deepseek-ai/dsh web` | npm registry 上的 `@deepseek-ai/dsh` | 更新 npx 缓存里的官方包，然后重启 |
| `npm i -g @deepseek-ai/dsh` / 全局 `dsh web` | 同上 | `npm install -g @deepseek-ai/dsh@<官方版本>`，然后重启 |
| `git clone` 后 `pnpm dsh web` | `git fetch` 对比官方远端 | `git pull --ff-only` |

Mac / Windows 同一套逻辑。本机另有一份 `~/deepseek-harness` 但进程其实是 npx/全局 npm 时，**不会**去 git pull 那份源码。

## 功能

- **识别安装方式**：源码仓库 / npm 全局 / npx
- **一键检查**：源码 `git fetch`；npm 查询官方 registry（失败则试 npmmirror）
- **版本对比**：本地 vs 官方 `package.json` 版本号
- **更新说明**：源码可折叠列出官方新提交（短哈希 + 标题，前 15 条）
- **一键更新**：源码只允许快进；npm 只安装官方包名 `@deepseek-ai/dsh` 和已校验的版本号
- **自动检查**：Host 每 30 分钟后台检查（防重入），页面每 60 秒轮询缓存
- **红点提醒**：有官方更新时设置页导航显示「DSH 更新 ●」
- **安全拒绝**：源码本地存在未推送提交、分叉或冲突改动时拒绝覆盖；npm 安装失败时给出可复制命令

## 安装

前置：已安装 DSH（`dsh web` 或 `npx @deepseek-ai/dsh web` 可运行）。npm 通道需要能访问 npm registry；源码通道需要本机 git 和官方 clone。

```sh
# 从 GitHub 安装
dsh plugin --profile web add github:xingyingyuzhui/dsh-updater-ui
```

装完**重启 DSH**，然后打开 **设置 → DSH 更新**。

## 使用

打开 **设置 → DSH 更新**：

- 页面显示当前安装方式和官方更新状态（✅ 已是最新 / ⚠️ 有官方更新）
- 点击 **一键更新官方 npm 包** 或 **一键拉取官方更新**
- 更新成功后重启 DSH 才会加载新代码
- 若 npm 安装被运行中的进程锁住（常见于 Windows），页面会给出对应命令，停掉 DSH 后再跑

`npx` 用户也可直接：

```sh
npx --yes @deepseek-ai/dsh@latest web
```

## 源码仓库定位

仅当**当前进程来自官方源码 clone**时才会用 git。查找顺序：

1. 正在运行的 `@deepseek-ai/dsh-root` 目录
2. 配置 `repo` / 环境变量 `DSH_REPO`
3. `~/deepseek-harness`
4. `~/.dsh/deepseek-harness`

`~/.dsh` 是设置、插件和会话数据，不能 `git pull` 当官方源码。

插件会校验该目录：

1. 必须是 git 仓库
2. `origin` 必须是 `deepseek-ai/deepseek-harness`
3. 必须能读取当前分支和上游分支

校验不通过会拒绝操作，避免误 pull 到 `/opt/homebrew` 等无关仓库。

## npm 通道

- 查询 `https://registry.npmjs.org/@deepseek-ai/dsh/latest`，失败则试 `https://registry.npmmirror.com`
- 可用 `DSH_NPM_REGISTRY` 或 `npm_config_registry` 指定 registry
- Windows 下 npm 可执行文件按 `DSH_NPM`、与 `node.exe` 同目录的 `npm.cmd`、常见 Node.js 安装路径查找
- 不会对 `~/.dsh` 做 npm install，也不会安装官方包以外的任何名字

## 安全设计

- 路由**仅接受 POST**
- 必须带自定义请求头 `X-DSH-Updater: 1`（跨站表单/图片无法触发）
- 如果带 `Origin`，只允许 `http://127.0.0.1` / `http://localhost`
- 源码拉取使用 **`--ff-only`**
- npm 安装包名写死为 `@deepseek-ai/dsh`，版本号须匹配安全字符集
- 所有外部命令带超时与输出上限；错误一律返回结构化 JSON
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
