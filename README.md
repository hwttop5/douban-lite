# douban-lite

`douban-lite` 是一个轻量的、干净整洁的、没有多余功能的豆瓣 PWA 应用。它面向单用户、自托管和移动端使用场景，把你真正会反复打开的几件事收拢到一起：搜索条目、看榜单、看动态、管理自己的标记与评分，并把同步结果保存到本地 SQLite。

## 功能概览

- 支持 `电影 / 音乐 / 图书 / 游戏` 四类条目。
- 支持豆瓣搜索，直接进入条目详情页查看简介、短评、公开评分和个人状态。
- 支持个人收藏状态管理，包括 `想看 / 在看 / 看过`、`想读 / 在读 / 读过`、`想玩 / 在玩 / 玩过` 等标记。
- 支持在标记时填写短评、选择标签、决定是否同步到豆瓣动态，并进入本地待写回队列。
- 支持榜单浏览，按媒介查看热门榜单内容并快速跳转到条目详情。
- 支持动态流，聚合自己和关注的人最近的标记内容。
- 支持同步状态反馈，区分 `已同步`、`待写回`、`需处理`，方便追踪本地与豆瓣之间的状态差异。
- 支持导入豆瓣 Cookie 作为登录态，用于抓取个人数据和写回标记。
- 支持 PWA 安装，适合放到手机桌面作为随手可开的个人豆瓣客户端。

## 适用场景

- 想要一个比豆瓣官方页面更轻、更聚焦的个人使用入口。
- 想把常看的收藏、评分、榜单和动态集中到一个移动端友好的界面里。
- 想自托管自己的豆瓣同步镜像，避免每次都回到原始网页里查找。

## 技术结构

- `apps/web`: React + Vite PWA 前端
- `apps/api`: Express API、豆瓣页面解析、同步任务和 SQLite 存储
- `packages/shared`: 前后端共享类型、枚举和请求 schema

前端默认通过同源 `/api` 调用后端。后端负责抓取豆瓣页面、解析 HTML、入库、排队写回和同步状态管理。

## 环境要求

- `Node.js >= 24`
- `npm >= 11`

项目使用 `node:sqlite`，低版本 Node 无法运行后端。

## 本地开发

```bash
npm install
npm run dev
```

默认情况下：

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

Vite 开发服务器会把 `/api` 和 `/health` 代理到 API 服务，所以前端代码默认使用同源请求。

## 环境变量

项目不会自动加载根目录 `.env`，请把变量注入到 shell、进程管理器或部署平台。

关键变量：

- `PORT`: API 监听端口，默认 `8787`
- `WEB_ORIGIN`: 独立前端域名时使用；同源部署可留空
- `DATA_DIR`: SQLite 数据目录
- `WEB_DIST_DIR`: 生产环境前端构建目录，默认 `./apps/web/dist`
- `DOUBAN_PUBLIC_BASE_URL`: 豆瓣移动端公开页面地址
- `DOUBAN_WEB_BASE_URL`: 豆瓣 Web 页面地址
- `SYNC_INTERVAL_HOURS`: 自动同步间隔
- `DISABLE_AUTO_SYNC`: 设为 `true` 可关闭自动同步
- `VITE_API_BASE_URL`: 前端 API 地址；留空时使用同源 `/api`
- `VITE_API_PROXY_TARGET`: 本地 Vite 代理目标，默认 `http://localhost:8787`

## 常用命令

```bash
npm run typecheck
npm test
npm run build
npm start
```

`npm start` 需要先执行 `npm run build`，它会启动 API 并托管 `apps/web/dist`，适合本地生产冒烟和单服务部署。

## 手机端使用说明

要把 PWA 添加到桌面，部署地址需要是 `https`，本地 `localhost` 仅适合开发调试。

### Android

推荐使用 Chrome 或 Edge：

1. 打开应用部署地址。
2. 等页面首次加载完成，确认底部导航和页面内容都正常。
3. 点击浏览器右上角菜单。
4. 选择 `添加到主屏幕`、`安装应用` 或 `Install app`。
5. 确认名称后添加到桌面。
6. 以后可以像普通 App 一样从桌面直接打开。

如果浏览器没有立即出现安装入口：

1. 先刷新一次页面。
2. 确认站点证书正常且不是 `http`。
3. 再次打开菜单查找安装入口。

### iPhone / iPad

推荐使用 Safari：

1. 打开应用部署地址。
2. 点击底部分享按钮。
3. 向下滑动操作列表。
4. 选择 `添加到主屏幕`。
5. 确认名称后点击右上角 `添加`。
6. 添加完成后可从桌面以独立窗口方式打开。

注意：

- iOS 不会显示 Android 那种“安装应用”弹窗，需要手动通过 Safari 分享菜单添加。
- 若使用第三方浏览器，通常仍然建议回到 Safari 完成添加。

## 发布前检查

```bash
git status --short
npm run typecheck
npm test
npm run build
```

请不要提交真实豆瓣 Cookie、SQLite 数据库、线上密钥或包含敏感信息的截图。

## Render 部署

仓库包含 `render.yaml`，可用于通过 Render Blueprint 创建一个 Node Web Service。

默认配置：

- `plan: free`
- `buildCommand: npm ci && npm run build`
- `startCommand: npm start`
- `healthCheckPath: /health`

上线步骤：

1. 将代码推送到 GitHub。
2. 在 Render 中使用 Blueprint 导入仓库。
3. 部署完成后访问 `/health`，确认返回 `status: ok`。

需要注意：

- Render Free 会休眠并有冷启动。
- 当前项目默认使用本地 SQLite，实例重启、迁移或重新部署后可能丢失数据。
- 如果要长期稳定使用，建议升级到支持持久化磁盘的方案，或者把存储迁移到外部数据库。

参考文档：

- [Render Free](https://render.com/docs/free)
- [Render Web Services](https://render.com/docs/web-services)
- [Render Disks](https://render.com/docs/disks)

## 安全提示

- 豆瓣 Cookie 等同于登录态，不要提交到 GitHub。
- 公共预览环境不建议导入长期使用的真实账号 Cookie。
- SQLite 文件包含个人同步数据，备份和迁移时应按敏感数据处理。

## License

GPL-3.0-only. See [LICENSE](./LICENSE).
