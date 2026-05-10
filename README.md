# douban-lite

douban-lite 是一个单用户、移动优先的豆瓣轻量 PWA。它把豆瓣公开条目、榜单、动态和个人标记同步到本地 SQLite，适合自托管成自己的豆瓣随身库。

## 功能范围

- 支持电影、音乐、读书、游戏四类条目。
- 支持搜索、榜单、条目详情、短评、个人收藏/评分/标记、动态与手动同步。
- 通过导入豆瓣 Cookie 作为同步登录态。
- 前端是 React PWA，后端是 Node.js + Express + SQLite。

## 目录结构

- `apps/web`: React + Vite PWA 前端。
- `apps/api`: Express API、豆瓣 HTML 解析、同步任务和 SQLite 存储。
- `packages/shared`: 前后端共享类型、枚举和请求 schema。

## 环境要求

- Node.js 24 或更高版本。
- npm 11 或更高版本。

项目使用 `node:sqlite`，低版本 Node 不能运行后端。

## 本地开发

```bash
npm install
npm run dev
```

默认前端是 `http://localhost:5173`，API 是 `http://localhost:8787`。Vite 开发服务器会把 `/api` 和 `/health` 代理到 API 服务，所以前端代码默认使用同源请求。

环境变量可以按 `.env.example` 设置到 shell、进程管理器或部署平台中。当前代码不会自动加载根目录 `.env` 文件。

关键变量：

- `PORT`: API 监听端口，本地默认 `8787`，Render 会自动注入。
- `WEB_ORIGIN`: 独立前端域名时使用；同源部署可以不设置。
- `DATA_DIR`: SQLite 数据目录。
- `WEB_DIST_DIR`: 生产环境前端构建产物目录，默认 `./apps/web/dist`。
- `DOUBAN_PUBLIC_BASE_URL`: 豆瓣移动端公开页面地址。
- `DOUBAN_WEB_BASE_URL`: 豆瓣 Web 页面地址。
- `SYNC_INTERVAL_HOURS`: 自动同步间隔。
- `DISABLE_AUTO_SYNC`: 设为 `true` 可关闭自动同步。
- `VITE_API_BASE_URL`: 前端 API 地址；留空时使用同源 `/api`。
- `VITE_API_PROXY_TARGET`: 本地 Vite 代理目标，默认 `http://localhost:8787`。

## 常用命令

```bash
npm run typecheck
npm test
npm run build
npm start
```

`npm start` 需要先执行 `npm run build`，它会启动 API 并托管 `apps/web/dist`，适合本地生产冒烟和 Render 单服务部署。

## GitHub 发布前检查

```bash
git status --short
npm run typecheck
npm test
npm run build
```

仓库会忽略本地数据库、构建产物、运行日志、截图、`.env` 和 `design/` 设计交付目录。请不要提交真实豆瓣 Cookie、SQLite 数据库或线上密钥。

如果还没有远程仓库：

```bash
git remote add origin https://github.com/<your-name>/douban-lite.git
git push -u origin main
```

## Render 预览部署

仓库包含 `render.yaml`，用于通过 Render Blueprint 创建一个 Node Web Service：

- `plan: free`
- `buildCommand: npm ci && npm run build`
- `startCommand: npm start`
- `healthCheckPath: /health`

上线步骤：

1. 把代码提交并推送到 GitHub。
2. 打开 `https://dashboard.render.com/blueprint/new?repo=<你的 GitHub 仓库 HTTPS 地址>`。
3. 部署完成后访问 `/health`，应返回 `status: ok`。

Render Free 适合预览，但会休眠、冷启动，并且本项目当前 SQLite 写在实例本地文件系统中；免费实例重启、重新部署或迁移后数据可能丢失。需要长期个人使用时，建议二选一：

- 保留 SQLite，升级到支持 Persistent Disk 的 Render 付费服务。
- 迁移到外部数据库，例如 Postgres、Supabase 或 Neon，再改造当前 `node:sqlite` 存储层。

参考文档：

- [Render Free](https://render.com/docs/free)
- [Render Web Services](https://render.com/docs/web-services)
- [Render Disks](https://render.com/docs/disks)

## 安全提示

- 豆瓣 Cookie 等同于登录态，不要提交到 GitHub，也不要放进截图或 issue。
- 公开预览环境不建议导入真实长期使用的 Cookie。
- SQLite 文件包含个人同步数据，备份和迁移时按敏感数据处理。

## License

GPL-3.0-only. See [LICENSE](./LICENSE).
