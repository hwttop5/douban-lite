# douban-lite

单用户、移动优先的 Douban PWA。仓库分成三个 workspace：

- `apps/web`: React PWA 前端
- `apps/api`: Node.js 同步服务与 SQLite 存储
- `packages/shared`: 共享类型、枚举和请求 schema

## 开发

```bash
npm install
npm run dev
```

默认前端跑在 `http://localhost:5173`，API 跑在 `http://localhost:8787`。

## 环境变量

复制 `.env.example` 后至少设置：

- `APP_PASSWORD`
- `APP_SESSION_SECRET`
- `DOUBAN_PUBLIC_BASE_URL`
- `DOUBAN_WEB_BASE_URL`

## 说明

- 第一版只支持 `电影 / 音乐 / 读书 / 游戏 / 我的`
- 同步节点是单用户模型，采用 Cookie 导入方式接入豆瓣登录态
- 对豆瓣的公共数据抓取和个人同步都经过 HTML 解析层，仓库内附带 fixture 测试

