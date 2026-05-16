# douban-lite

`douban-lite` 是一个轻量的豆瓣 PWA，适合自托管使用。一个部署实例可以支持多人使用，但每个人都应使用自己的豆瓣账号登录，必要时再导入自己的豆瓣 Cookie；彼此的收藏、评分、标签、短评、动态和同步任务会分开存储。

> 在线演示
> Render 免费实例有冷启动，第一次打开可能会慢几秒到几十秒，但当前服务是可用的。[https://douban-lite.onrender.com](https://douban-lite.onrender.com) 仅作为演示，如需日常使用，最好部署在可靠的服务器上。

> 提醒
> `douban-lite` 需要接收真实登录态的豆瓣请求，并代替用户发起登录后的豆瓣操作。这类行为可能触发豆瓣风控，例如登录校验、Cookie 失效、临时限流，或账号侧的安全验证。最稳妥的使用方式是自己部署、自己使用。不要把它当成公开 SaaS，也不要让别人把真实的豆瓣登录态交给他们无法控制的第三方实例。

## 为什么做这个应用

我是一个用了十多年的豆瓣老用户。对我来说，豆瓣最有价值的部分，始终是书、电影、音乐这些内容本身，以及围绕它们产生的记录：看过什么、想看什么、打了什么分、写过什么短评、留下了哪些标签。

但近些年豆瓣 App 的重心越来越偏向社交分发和广告展示，尤其是经常推送一些乌烟瘴气、消耗注意力的豆瓣小组讨论，真正和书影音相关的核心路径反而变得更重、更绕，也更容易被打断。于是我做了 `douban-lite`：只保留书影音相关的核心功能，把搜索、详情、标记、评分、短评、标签、同步这些我最常用的能力留下来，尽量去掉与这些目标无关的社交化干扰。

它不是豆瓣官方 App 的完整替代品，而是一个更克制、更安静、更适合长期自用的版本。

## 功能说明

- 支持 `电影`、`音乐`、`图书`、`游戏`
- 支持二维码登录，并提供 Cookie 导入作为回退登录方式
- 支持搜索豆瓣条目并进入详情页
- 支持保存个人状态，包括收藏状态、评分、短评、标签和是否同步到动态
- 支持把每个用户自己的豆瓣收藏同步到本地 SQLite
- 支持查看榜单快照
- 支持查看当前登录用户的豆瓣动态
- 支持共享公共缓存，例如条目数据和榜单快照
- 支持作为 PWA 安装到手机和桌面端

### 功能总览

<table>
  <tr>
    <td align="center" valign="top" width="48%"><strong>PC 端</strong></td>
    <td align="center" valign="top" width="28%"><strong>Pad 端</strong></td>
    <td align="center" valign="top" width="24%"><strong>手机端</strong></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="docs/screenshots/feature-tour.gif" alt="douban-lite desktop feature tour" width="100%" /></td>
    <td align="center" valign="top"><img src="docs/screenshots/feature-tour-tablet.gif" alt="douban-lite tablet feature tour" width="100%" /></td>
    <td align="center" valign="top"><img src="docs/screenshots/feature-tour-mobile.gif" alt="douban-lite mobile feature tour" width="100%" /></td>
  </tr>
</table>

## PWA 使用说明

### 手机端 / Pad 端

手机端和平板端的使用方式相同，推荐直接把 douban-lite 加到系统主屏后再使用，这样打开时会更像一个独立 App。

#### iPhone / iPad（Safari）

1. 用 Safari 打开 douban-lite。
2. 点击底部或顶部工具栏里的 `分享` 按钮。
3. 在菜单里选择 `添加到主屏幕`。
4. 确认名称后点击 `添加`。
5. 回到主屏幕，点击新图标即可像 App 一样打开 douban-lite。

#### Android 手机 / 平板（Chrome 或 Edge）

1. 用 Chrome 或 Edge 打开 douban-lite。
2. 点击浏览器右上角菜单。
3. 选择 `添加到主屏幕`、`安装应用` 或 `Install app`（不同浏览器文案可能略有区别）。
4. 确认后，douban-lite 会出现在主屏幕或应用列表中。
5. 之后可直接从主屏幕或应用列表打开，使用方式会更接近原生 App。

### PC 端

推荐使用 Chrome 或 Edge 把 douban-lite 安装为桌面应用。

#### Chrome / Edge

1. 在浏览器中打开 douban-lite。
2. 查看地址栏右侧是否出现 `安装` 图标，或打开浏览器右上角菜单。
3. 选择 `安装 douban-lite`、`安装此网站为应用` 或类似选项。
4. 确认安装后，系统会创建一个独立窗口，并通常可固定到任务栏、开始菜单或桌面。
5. 以后直接从桌面图标、开始菜单或任务栏启动即可，体验会更像普通桌面 App。

补充说明：

- 第一次以 PWA 方式打开后，仍然需要在 douban-lite 的登录页完成一次登录；默认可直接扫码，遇到风控、切换账号或需要刷新会话时再改用 Cookie 导入。
- 如果浏览器没有显示安装入口，先确认当前访问的是 HTTPS 部署地址，或本地开发环境是否已正确启用 PWA 能力。

## 多用户模型

- v1 没有单独的 douban-lite 用户名和密码体系
- 用户通过二维码登录或导入自己的豆瓣 Cookie 登录
- 登录完成后，后端会校验当前豆瓣会话，解析对应的豆瓣 `peopleId`，创建或更新本地用户，并写入 httpOnly 会话 Cookie
- 后续请求使用的是 douban-lite 自己的会话 Cookie，而不是浏览器里原始的豆瓣 Cookie

### 数据隔离

- 按用户隔离的数据：
  `user_items`、`douban_sessions`、`timeline_snapshots`、`sync_jobs`、`sync_events`
- 所有用户共享的数据：
  `subjects`、`ranking_snapshots`

## 本地开发

环境要求：

- `Node.js >= 24`
- `npm >= 11`

安装并启动：

```bash
npm install
npm run dev
```

默认地址：

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

如果 `5173` 或 `8787` 已被占用，`npm run dev` 会自动顺延到附近的空闲端口，并在终端打印实际地址。

Vite 开发服务器会把 `/api` 和 `/health` 代理到 API 服务。

## 环境变量

项目不会自动加载根目录 `.env` 文件，请通过 shell、进程管理器或部署平台注入变量。

- `PORT`：API 端口，默认 `8787`
- `WEB_ORIGIN`：独立前端域名场景下用于配置 CORS
- `DATA_DIR`：SQLite 数据目录
- `WEB_DIST_DIR`：前端构建目录，默认 `./apps/web/dist`
- `APP_SECRET`：生产环境必填，用于 douban-lite 会话签名和豆瓣 Cookie 加密
- `SESSION_TTL_DAYS`：douban-lite 会话有效期，默认 `30`
- `DOUBAN_PUBLIC_BASE_URL`：豆瓣公开 / 移动端页面基地址
- `DOUBAN_WEB_BASE_URL`：豆瓣登录态 Web 页面基地址
- `SYNC_INTERVAL_HOURS`：定时同步间隔小时数
- `DISABLE_AUTO_SYNC`：设为 `true` 时关闭定时同步
- `VITE_API_BASE_URL`：前端 API 地址，留空时使用同源 `/api`
- `VITE_API_PROXY_TARGET`：本地 Vite 代理目标，默认 `http://localhost:8787`

## 常用命令

```bash
npm run typecheck
npm test
npm run build
npm start
```

`npm start` 会在 `npm run build` 之后由 API 进程托管前端构建产物。

## 用户如何登录

1. 打开部署后的应用。
2. 在“我的”页点击 `请先登录`，或直接进入 `登录` 页面。
3. 默认使用 `二维码登录`：用另一台已安装豆瓣 App 的手机扫码，并在手机上确认登录。
4. 如果二维码暂不可用、遇到图片验证、想切换账号，或只是想复用已有登录态，请切换到 `Cookie 登录`，粘贴已登录豆瓣浏览器里的 Cookie，例如 `dbcl2=...; ck=...;`。
5. 登录成功后，后端会把当前会话绑定到对应豆瓣账号的 `peopleId`，并为当前设备写入 douban-lite 的 httpOnly 会话 Cookie。
6. 之后回到“我的”“搜索”“榜单”“动态”“设置”等页面时，浏览器使用的是 douban-lite 自己的会话，而不是原始豆瓣 Cookie。

退出登录只会删除当前浏览器里的 douban-lite 会话 Cookie，不会删除服务端存储的该用户豆瓣会话记录。

## 如何获取 Cookie / 在登录页中使用 Cookie 登录

1. 在桌面 Chrome 或 Edge 中打开任一已登录的豆瓣页面。
2. 按 `F12` 打开开发者工具，进入 `Application` 或 `Storage`，再打开 `Cookies` 下的 `douban.com`。
3. 把需要的 Cookie 拼成 `name=value; name2=value2;` 的格式，例如 `dbcl2=...; ck=...;`。
4. 回到 douban-lite 的 `登录` 页面，切换到 `Cookie 登录`，粘贴 Cookie，点击 `导入并登录`。
5. 如果后续会话失效、同步失败或豆瓣要求重新验证，可以先尝试重新扫码；如果仍要手动导入，则重新回到浏览器复制最新 Cookie，再次导入即可。

注意事项：

- PWA 不会直接继承系统浏览器里的豆瓣登录态，因此安装到桌面或手机主屏后仍需要在 douban-lite 的登录页完成一次登录。
- 只应在你自己信任的自部署实例中粘贴 Cookie。
- 无论是扫码登录还是导入 Cookie，登录成功后浏览器保存的都是 douban-lite 自己的 httpOnly 会话，不需要长期保留原始豆瓣 Cookie。

## 部署说明

仓库内已经包含 `render.yaml`，可用于部署 Node Web Service。
完整部署细节见 [docs/render-deploy.md](./docs/render-deploy.md)，版本记录见 [CHANGELOG.md](./CHANGELOG.md)。

### Render Free 自用部署

- 当前仓库默认采用 `单个 Render Free Web Service` 部署，前后端不拆分。
- Render 直接运行现有 Node 进程：构建命令为 `npm ci --include=dev && npm run build`，启动命令为 `npm start`。
- API 继续托管 `apps/web/dist` 的前端静态产物，前端通过同源 `/api` 与后端通信，不需要额外设置 `VITE_API_BASE_URL`。

免费版限制：

- `render.yaml` 会把 `DEPLOYMENT_MODE` 设为 `render-demo`，并强制 `DISABLE_AUTO_SYNC=true`，因此不会依赖 Render Free 上不稳定的定时同步。
- `DATA_DIR=./data` 仍然指向 Render 实例本地文件系统，这个目录是临时的；服务重建、重新部署或实例替换后，SQLite 数据可能丢失。
- Render Free 会休眠，首次访问可能出现冷启动延迟。这个模式只适合“先上线、先自用、可随时重建”。

后续迁移方向：

- 如果后面需要正式长期使用，优先迁移到带持久磁盘的服务器或支持持久卷的平台。
- 到正式环境时，保持同一套应用结构即可，再补 Docker / Compose、备份和迁移脚本，不需要先为免费版重构数据库或拆前后端。

重要限制：

- SQLite 必须放在持久化存储上，才适合真实的多用户使用
- Render Free 的本地文件系统不适合长期保存共享数据
- 生产环境必须启用 HTTPS
- 生产环境必须配置 `APP_SECRET`

如果要给多人共享使用，建议：

- 选择带持久化磁盘的托管方案，或者后续迁移到外部数据库
- 只把访问地址分享给你信任的人
- 能自己部署自己用，就尽量不要做成公开或半公开部署

## 安全说明

- 最安全的方式仍然是自己部署、自己使用，部署者和豆瓣账号所有者是同一个人时风险最低
- 不要把自己的豆瓣登录态交给你无法控制的第三方部署实例；手动导入 Cookie 时尤其要谨慎
- 登录后抓取和同步行为可能触发豆瓣风控、会话失效或额外验证
- 无论是二维码登录拿到的会话，还是手动导入的 Cookie，本质上都是豆瓣登录凭证，必须按敏感信息处理
- 豆瓣会话 Cookie 在服务端会通过 `APP_SECRET` 加密存储
- douban-lite 使用 httpOnly 会话 Cookie，因此前端在登录后不需要继续持有原始豆瓣 Cookie
- 公共或共享部署依然属于敏感环境，因为用户交给它的是真实豆瓣登录态

## License

GPL-3.0-only. See [LICENSE](./LICENSE).
