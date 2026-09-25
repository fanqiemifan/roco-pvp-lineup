# AGENTS.md

洛克王国世界阵容同步推流（roco-pvp-lineup）— 洛克王国赛事推流控制台。Electron（Express + Socket.IO）后端 + React/AntD 管理后台。代码注释、提交信息以及 `.agents/` 里的文档均为中文。

## 常用命令（全部来自 `package.json` 的 scripts）

- `npm run build` — 构建 renderer + electron。会触发 `prebuild` → `npm run sync:sprites`，该脚本会**从网络下载精灵图片**（数据源为 `resources/data/pets.json` 的 `official_small_icon` 与 `icon_url`）。只想校验数据、不下载图片：`node scripts/sync-spirits-assets.mjs --skip-download`。
- `npm run dev` — 构建 renderer + electron，然后启动 Electron 桌面应用。
- `npm run serve:node` — 构建 + 无头 Node 服务器（默认 `--host 0.0.0.0 --port 9989`），Docker 用的就是这个模式；无头/容器端口固定 9989，与桌面端默认 9988 错开，二者可同时运行。
- `npm run package` — 构建 + electron-builder，产出 Windows NSIS 安装包到 `release/`（已被 gitignore）。
- `npm test` — 全部测试（Vitest，见「测试」）；`npm run test:watch` — watch 模式；`npm run typecheck:tests` — 测试与 vitest 配置的类型检查。
- **没有 lint、没有格式化工具。** 验证手段 = `npm test` + `npm run typecheck:frontend`（改了 electron 源码再加 `npm run build:electron`）。

## 两套独立的 TS 工程 — 注意差异

- Electron 侧：`tsconfig.json`（`NodeNext` ESM，输出到 `dist-electron/`）。相对导入**必须带 `.js` 后缀**（如 `../shared/events.js`）。没有 `noEmit`，Electron 侧的「类型检查」就是 `npm run build:electron`。
- 前端 React 侧：`tsconfig.frontend.json`（`Bundler` 解析，`noEmit`），用 `npm run typecheck:frontend` 检查，只覆盖 `src/admin-antd`、`src/login-antd`、`shared`。
- Vite（`vite.config.ts`）**只打包** `src/pages/admin-antd.html` 和 `src/pages/login.html` 到 `dist/`；`emptyOutDir: true` 每次构建会清空 `dist/`。
- 推流/展示页面（`src/pages/*.html`、`src/scripts/*.js`、`src/styles/*.css`）是纯原生 JS，静态伺服，**不属于 Vite 构建**。

## 测试

- Vitest（node 环境）。测试文件放 `tests/`，按 `tests/electron/`（服务与 HTTP/socket 层）、`tests/admin-antd/`（前端纯函数）镜像源码结构。
- 服务层测试**不需要 Electron**：服务全部经 `AppPaths` 读写文件，`mkdtempSync` 临时目录 + `createAppPaths(root, root)`（补一句 `mkdirSync(paths.dataDir)`）即得完全隔离环境。精灵库夹具 = 往 `dataDir/pets.json` 写索引 + 在 `spritesDir` 放 `{pet_id}_{name}.png` 空文件（索引会过滤缺图条目）。
- HTTP/socket 层测试：`createLocalServer(paths, 0, '127.0.0.1')` 起真实服务器（**不传 authConfig = 关闭鉴权**），用 `fetch` 打路由、`socket.io-client` 订阅广播。socket 事件名以 `shared/events.ts` 的 `SOCKET_EVENTS` **值**为准（是 `matches:update` 这类带冒号的字符串，不是 TS 属性名 `matchesUpdate`）。
- 提交前验证：`npm test` + `npm run typecheck:tests`；改了 electron 源码再加 `npm run build:electron`。

## 两种运行模式 — 鉴权行为不同

- 桌面模式（`electron/main.ts`）：**关闭鉴权**，后台入口在 `/admin.html`。
- Node 服务器模式（`electron/server-entry.ts`，Dockerfile 同）：**开启鉴权**，默认账号密码 `admin` / `admin123`，可用 `ADMIN_USER` / `ADMIN_PASS` 覆盖；Docker compose 显式设置了这两个变量。

## 运行时数据（生成物，已被 gitignore — 切勿提交）

- 面板/记分牌/比赛/导播台/头像/倒计时等状态，都以 JSON/PNG 形式存放在 userData 目录下的 `runtime/cache/`，路径解析在 `electron/services/path-service.ts`：
  - 桌面模式：Electron `app.getPath('userData')`。
  - Node/Docker 模式：`<项目根目录>/LuokePVPWebui`（可用 `ROCO_DATA_DIR` 覆盖）。
- 精灵索引与图片：
  - 源数据 `resources/data/pets.json`（勿手改字段名）；`resources/sprites-img/`（立绘，经 `/img/` 伺服）与 `resources/sprites-icon/`（头像，经 `/resources/sprites-icon/` 伺服，各展示页头像统一用它）。
  - 图片由 `scripts/sync-spirits-assets.mjs` 按 `{pet_id}_{name}.png` 命名下载；数据变化后先更新 pets.json 再跑脚本；图片已存在会跳过（幂等），源图缺失自动降级（small→official_icon→image_url / icon_url→official_icon）。
- 精灵字段映射（`sprite-service.ts` 的 `normalizePetRecord`）：
  - 编号=handbook_no、名称=name、属性=elements（经 `attribute_mapping.json` 转属性码）、形态=stage（1=一阶 2=二阶 3=三阶 4=首领）。
  - 多形态记录 `name` 带形态后缀（如 卡瓦重（草地附近的样子）），`displayName` 保持纯名。
- **名称字段只保留 `name`（全称）/ `displayName`（短名）两个**（`shared/types.ts` 的 SpriteRecord），所有消费点统一读这两个字段；统计行 StatsRankingRow 同口径（page5 用 `row.displayName || row.name`）。
- **持久化精灵主键 = `pet_id`**：比赛快照/阵容/历史（matches.json）统一用 `pet_id`；**不做旧数据兼容**，pet_id 必须是精灵索引中存在的 id。

## 架构

- `electron/socket-server.ts` 是唯一的 Express + Socket.IO 服务器，持有所有 REST 路由和 socket 事件推送；`electron/services/*` 是纯文件型存储，**所有新文件路径都要加在 `path-service.ts` 里**。
- `shared/`：`types.ts`（全部类型）、`events.ts`（socket 事件）、`constants.ts`（默认值：端口 9988、BO7、6 格子、推流页面/过渡枚举）——electron 与 React 共用。
- `electron/float-window.ts`：桌面阵容悬浮窗（`float.html`，透明置顶 587×56）与更换精灵菜单（`float-menu.html`，240×240），经 `preload.ts` 的 `window.rocoFloat` IPC 驱动；「下场对局」选择菜单（`float-nextgame.html`，300×320）由 float.js 用 `window.open` 打开。
- 管理后台（React，`src/admin-antd/`）：
  - 十视图：赛事面板/直播推流/实时控制/结算画面/比赛历史/信息录入/选手介绍/数据统计/页面预览/关于项目，为 App.tsx 顶部可收缩的 `antd Menu`；顶栏单行显示当前视图名（与菜单共用 `VIEW_LABEL`）。
  - 导航图标：`src/assets/ui/*.svg` 经 `?raw` 引入，`NavIcon` 把 `fill="black"` 换成 `currentColor` 自适应配色；像素级样式细节见 `.agents/09-frontend-components.md`。
  - 赛事面板要点：「比赛列表」卡片头部「快速创建比赛」——固定高度可滚动选手列表逐条点选（按录入时间升序）、数量须为**双数**、再选赛制与标签，确认后随机洗牌两两配对逐一创建；「当前比赛」旁「战队修改」补填战队（PATCH `/api/matches/:id`）；创建统一走前端 `postCreateMatch`。
- 推流/展示页面（纯原生 JS）：page1 比分栏、page2 全局阵容、page3 头像比分阵容、page4 MVP 结算（公开免鉴权）、page5 出场/胜率排行、page6 比赛结果、page7 对局推送、page8 比赛预告（公开免鉴权）、page9 团队积分榜、page10 胜者结算、page11-13 选手介绍（同一页面 `?mode=left/right/versus`）、`float`/`float-menu`/`float-nextgame` 桌面悬浮窗。页面与脚本对照见 `.agents/01`，路由见 `.agents/08`。
- MVP 结算（page4）：后台「结算画面」取当前对局最近一个已分胜负小局的**胜者阵容**（只收最终形态精灵），标记标签（≤4 字）与 MVP 后 `POST /api/mvp/show` 切屏到页面4（记录 returnPage，`/api/mvp/hide` 切回）；状态落盘 `cache/mvp.json`，精灵 webm 取 `resources/sprites-260-630-webm/{pet_id}_{name}.webm`；`GET /api/mvp` 同时下发胜方选手名字与头像（MvpWinnerInfo，口径同 page10）；实现在 `mvp-service.ts` + `page4-display.js`（增量渲染）。
- 入场动效：`src/styles/stage-enter.css` + `src/scripts/stage-enter.js` 公共实现——推流载体 `stage-carrier.js` 完成 iframe 加载后 postMessage `stage-enter`，页面在根节点加 `is-stage-entered` 触发 `.fx-enter` 区块依次上浮淡入；page1/2/3/5/6/7/8/9/10 直接接入 `.fx-enter` 区块动画，page4 用同一 stage-enter 时机播自定义的逐项入场（过渡播完后再按槽位依次淡入），page3 切入还会额外播一次阵容入场，page11-13 自带动效不接入。
- page10 自动切回：登记本局胜负时若当前画面是 page1-3，自动切入 page10 停留 `page10Duration` 后切回原画面（socket-server 内定时器驱动）。
- 信息录入（选手/战队档案）：单卡片 + Segmented 切换，服务 `electron/services/profile-service.ts`，落盘 `cache/profiles.json`；头像/logo 存 `cache/profiles/{players,teams}/<id>.png`，经 `/runtime/profiles/**` 访问；创建赛事输入选手名自动联想已录入选手，「所属战队」可选录入战队或手填；page9 战队名称输入框同样联想。
- 选手 JSON 批量导入：只识别白名单字段 `name`/`rank`/`declaration`/`pets`（前后端双侧白名单防注入）；**常用精灵仅在命中 pets.json 时录入**，未命中走 `review` 弹窗逐条补录（每条最多 5 个模糊候选）；后端入口 `importPlayerProfiles` + `matchSpriteToken` + `POST /api/profiles/players/import`，成功广播 `profiles:update`。
- 批量操作：选手/战队表格可勾选多行一键删除（确认弹窗列出名称清单）；「批量头像」先按文件名本地匹配出「原头像 vs 新头像」预览弹窗，确认才提交覆盖保存；文件名经表单 `names` 字段以 JSON 传递，规避 multer 将 multipart 文件名按 latin1 解码的乱码问题。
- 战队标识（page3）：赛事携带 `leftTeamId/leftTeamName/rightTeamId/rightTeamName`，「直播推流」的 `page3TeamVisible` 控制显隐；logo 优先按 teamId 匹配录入战队，未录入仅显示名称色块；渲染细节见 `.agents/09`。
- 排位排名图标（page3 比分栏 / 选手介绍页）：创建弹窗或「当前比赛」表单输入（仅数字、可选），随对局存入 matches.json 并由 `syncScoreboardFromMatch` 同步到记分牌；`page3RankVisible` / `page11RankVisible` 控制推流页显隐（开启但未输入排名只显示图标，超 10000 显示 `10000+`）。
- 详细索引（类型、API 路由、函数、socket 事件、常量、文件地图）在 `.agents/01..10-*.md` —— 遇到问题先查它们；行为有变化时要同步更新这些文档。

## 注意事项

- `.npmrc` 固定了 npmmirror 源和 Electron 二进制镜像；离线时安装可能失败。`sync:sprites` 需要联网，除非加 `--skip-download`。
- 头像上传会校验文件魔数（`image-service.ts` 中的存储型 XSS 防护）——改动时务必保留该检查。
- **React Hooks 顺序约束**（曾踩坑）：任何 hook 都必须放在组件内的条件 return（如 `if (loading) return ...`）之前，否则 loading 切换时 hook 数量变化会抛 `Minified React error #310` 导致整页白屏。
- **新增或改动的推流/展示画面必须增量更新**：只更新发生变化的节点/区域，禁止整页 innerHTML 重写或全量重渲染，避免画面闪烁。
- `antd` skill 可用（`.agents/skills/antd`），Ant Design 相关开发建议加载。
- 提交风格：conventional commits，中文 scope/正文，例如 `feat(stage): ...`、`fix(security): ...`。
