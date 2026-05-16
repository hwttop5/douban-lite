# Render 部署说明

本文档对应当前仓库自带的 [render.yaml](../render.yaml)，目标是用单个 Render Web Service 运行 `douban-lite`。

## 当前部署形态

- 服务类型：`Web Service`
- 运行时：`Node`
- 部署方式：单服务，前后端不拆分
- 健康检查：`/health`
- 构建命令：`npm ci --include=dev && npm run build`
- 启动命令：`npm start`

之所以在 Render 上使用 `npm ci --include=dev`，是因为仓库包含 `prepare: husky`，如果生产构建阶段不安装 `devDependencies`，构建会在 `husky: not found` 处失败。

## 环境变量

当前 `render.yaml` 已经声明了这组默认值：

- `NODE_VERSION=24.14.0`
- `NODE_ENV=production`
- `DATA_DIR=./data`
- `APP_SECRET`：由 Render 自动生成
- `SESSION_TTL_DAYS=30`
- `DOUBAN_PUBLIC_BASE_URL=https://m.douban.com`
- `DOUBAN_WEB_BASE_URL=https://www.douban.com`
- `SYNC_INTERVAL_HOURS=12`
- `DEPLOYMENT_MODE=render-demo`
- `DISABLE_AUTO_SYNC=true`

补充说明：

- `APP_SECRET` 是生产环境必填项。无论是通过 `render.yaml` 自动生成，还是手动建服务，都必须保证它存在。
- 当前仓库默认不要求额外设置 `VITE_API_BASE_URL`，因为前端走同源 `/api`。
- `DOUBAN_ACCOUNTS_BASE_URL`、`DOUBAN_PROXY_LOGIN_ENABLED` 等变量如果没有显式配置，会使用后端默认值。

## 验收方式

部署完成后，优先检查健康接口：

```bash
curl.exe -i https://your-service.onrender.com/health
```

健康响应应类似：

```json
{"status":"ok","app":"douban-lite","schedulerEnabled":false,"deploymentMode":"render-demo"}
```

然后再打开站点首页或以下前端路由确认页面可用：

- `/me`
- `/search`
- `/settings`

如果是 Render 免费实例，第一次访问可能遇到冷启动，先等待一轮再判断是否异常。

## Render Free 限制

- `DEPLOYMENT_MODE=render-demo` 且 `DISABLE_AUTO_SYNC=true`，表示当前线上实例以演示、自用为主，不依赖免费实例上的定时同步。
- `DATA_DIR=./data` 落在 Render 实例本地文件系统上，不是持久化磁盘。重建实例、重新部署或实例替换后，SQLite 数据可能丢失。
- Render Free 有休眠和冷启动，不适合高频、稳定、长期在线的日常使用。

## 故障排查

如果部署失败，先看这几项：

1. `APP_SECRET` 是否存在。生产环境缺少它时，服务会在启动阶段直接退出。
2. 构建命令是否仍为 `npm ci --include=dev && npm run build`。如果退回到 `npm ci && npm run build`，可能再次触发 `husky: not found`。
3. `/health` 是否返回 `200 OK`。这是判断服务是否真正启动完成的最快方式。
4. 是否把本地开发专用逻辑带到了生产环境。当前仓库已经避免在生产环境写 `.codex-run/dev-targets.json`。

## 日常使用建议

- 演示地址只适合体验功能，不适合承载长期个人数据。
- 如果要长期使用，优先迁移到有持久化磁盘的服务器或平台。
- 如果要给多人用，至少要先解决持久化存储、备份和恢复问题。
