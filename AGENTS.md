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

- 面板/记分牌/比赛/系列赛编排（tournaments.json）/导播台/头像/倒计时等状态，都以 JSON/PNG 形式存放在 userData 目录下的 `runtime/cache/`，路径解析在 `electron/services/path-service.ts`：
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
  - 十一视图（导航顺序即此）：赛事面板/直播推流/系列比赛/结算画面/比赛管理/信息录入/选手介绍/数据统计/页面预览/实时控制/关于项目，为 App.tsx 顶部可收缩的 `antd Menu`；顶栏单行显示当前视图名（与菜单共用 `VIEW_LABEL`）。
  - 导航图标：`src/assets/ui/*.svg` 经 `?raw` 引入，`NavIcon` 把 `fill="black"` 换成 `currentColor` 自适应配色；像素级样式细节见 `.agents/09-frontend-components.md`。
  - 赛事面板要点：「比赛列表」卡片头部「快速创建比赛」——固定高度可滚动选手列表逐条点选（按录入时间升序）、数量须为**双数**、再选赛制与标签，确认后随机洗牌两两配对逐一创建；「当前比赛」旁「战队修改」补填战队（PATCH `/api/matches/:id`）；创建统一走前端 `postCreateMatch`。
- 推流/展示页面（纯原生 JS）：page1 比分栏、page2 全局阵容、page3 头像比分阵容、page4 MVP 结算（公开免鉴权）、page5 出场/胜率排行、page6 比赛结果、page7 对局推送、page8 比赛预告（公开免鉴权）、page9 团队积分榜、page10 胜者结算、page11-13 选手介绍（同一页面 `?mode=left/right/versus`）、`float`/`float-menu`/`float-nextgame` 桌面悬浮窗。页面与脚本对照见 `.agents/01`，路由见 `.agents/08`。
- MVP 结算（page4）：后台「结算画面」点「载入当前对局胜方」把当前对局最近一个已分胜负小局的**胜方选手名字 + 胜者阵容**（只收最终形态精灵）快照保存进 `cache/mvp.json`（winner: matchId/side/playerName），切换对局不会改变推流画面、需重新载入保存才更新；标记 MVP（标签 ≤4 字、可留空）后 `POST /api/mvp/show` 切屏到页面4（记录 returnPage，`/api/mvp/hide` 切回）；精灵 webm 取 `resources/sprites-260-630-webm/{pet_id}_{name}.webm`；`GET /api/mvp` 下发 `state` 与胜方选手信息（MvpWinnerInfo，头像按快照 matchId+side 解析）；实现在 `mvp-service.ts` + `page4-display.js`（增量渲染）。
- 入场动效：`src/styles/stage-enter.css` + `src/scripts/stage-enter.js` 公共实现——推流载体 `stage-carrier.js` 完成 iframe 加载后 postMessage `stage-enter`，页面在根节点加 `is-stage-entered` 触发 `.fx-enter` 区块依次上浮淡入；page1/2/3/5/6/7/8/9/10 直接接入 `.fx-enter` 区块动画，page4 用同一 stage-enter 时机播自定义的逐项入场（过渡播完后再按槽位依次淡入），page3 切入还会额外播一次阵容入场，page11-13 自带动效不接入。
- page10 自动切回：登记本局胜负时若当前画面是 page1-3，自动切入 page10 停留 `page10Duration` 后切回原画面（socket-server 内定时器驱动）。
- 信息录入（选手/战队档案）：单卡片 + Segmented 切换，服务 `electron/services/profile-service.ts`，落盘 `cache/profiles.json`；头像/logo 存 `cache/profiles/{players,teams}/<id>.png`，经 `/runtime/profiles/**` 访问；创建赛事输入选手名自动联想已录入选手，「所属战队」可选录入战队或手填；page9 战队名称输入框同样联想。
- 双机数据同步（「比赛管理」视图的「数据同步」卡片）：同步包 = 单个 JSON（全部比赛 + 可选档案/头像 base64），导入先预览（左侧条目列表 + 右侧「本机 vs 包内」字段级 diff 面板，逐条可勾选）、确认后合并，广播复用 `matches:update` / `profiles:update`；预览列表按「更新 → 新增 → 跳过」排序（同级冲突优先）、两台机器都登记过同一场且内容不同时标记「冲突」并提示逐条 / 批量选择保留哪一边，档案项的头像/logo 变更同样进入 diff（本机 / 包内左右头像对照）。设置里配置本机标识 `machineCode`（1-2 位大写字母），新比赛 id 形如 `20260928_A001`，未设置则沿用旧格式；合并规则：比赛按 id（默认「较新覆盖」看 `updatedAt`，可切「以包为准」内容有差异即覆盖）、档案先 id 再同名（同名不同 id 跳过不覆盖）、头像只补缺；重复导入同一包全部跳过（幂等）。两种工作流：①两机各自创建自己负责的场次；②A 统一创建后导出基线给 B 导入、各登记自己的场次再回传；**同一场比赛不能在两台机器分别创建**（会合并成两条记录）。实现：`sync-service.ts` + `POST /api/sync/{export,preview,import}`（独立 multer，64MB 上限，不受全局 2mb JSON 限制）。
- 系列赛自动化编排（第 11 视图「系列赛」，引擎 `electron/services/tournament-service.ts`，编排落 `cache/tournaments.json`，API 前缀 `/api/tournaments`，广播 `tournament:update`、首连 snapshot 携带 tournaments，管理路由受鉴权保护）：
  - 参赛人数限 4/8/16/32（`SUPPORTED_TOURNAMENT_SIZES`）且必须全部来自信息录入档案、不可重复；系列赛 id = `T{YYYYMMDD}_{机器码}{NN}`（`TOURNAMENT_ID_REGEX`，同日期同机器码递增）。
  - 阶段模型 `stages`（默认模板 `buildDefaultStages`，如 8 人 = 8进4双败 → 4进2 → 总决赛单败）：`format` = `single-elim`（单败，配对 `bracket-seed` 标准种子位 / `random-round` 随机）或 `double-life`（双败，配对 `random-bucket` / `manual-bucket`），`bestOf` 仅 1/3，另含 `avoidRematch`、`requireConfirm`；双败 3 波收敛：W1 0-0 → W2 1-0/0-1 → W3 1-1，2 胜晋级 / 2 负淘汰（`TOURNAMENT_TARGET_WINS/LOSSES`），**W3（决胜波）的 1-1 池按经典双败交叉配对**（W1 取胜后掉下来的「胜者组掉落者」对 W1 落败后上扬的「败者组胜者」，两类人互不相遇，靠 `wonOpeningRound` 按 W1 胜负分池），阶段晋级半额后换批清零，总决赛阶段完赛自动产生冠军/亚军；**「总决赛」= 只剩 2 人的那个阶段，必须单败**（2 人双败打不出冠军，且 W2 在两个单人桶里配不出任何一场会把系列赛卡死，故 `createTournament` 直接拒绝；判据用阶段人数而非「最后一个阶段」，自定义列表的末阶段不一定是 2 人）。
  - RNG = mulberry32 注入式：抽签重洗只取决于 seed 与选手集合（同 seed 可复现，重抽 drawVersion+1）；每波 RNG 由系列赛 seed × stage/wave 位置混合，各波独立可复现。
  - 每个节点（node）的对决仍是普通比赛：引擎内部 `createMatch` 时打 `tournamentRef: {tournamentId,nodeId,stageIndex,waveIndex}`，自动标签 = 赛事名+阶段名+`W{波次}`（跨桶配对追加「跨桶」）；手动配对 / requireConfirm 的波先停在 `draft`（配对确认台 PUT 暂存中间态、可 `importPairings` 按 `A vs B` 文本或名字数组导入对阵），锁定时整体校验（每人恰好一次、双败同桶严格、跨桶须显式 `allowCrossBucket`、已交手仅警告）通过后才批量建场。
  - 赛果写回靠 socket-server 在登记胜负/弃权/撤回处调钩子：`onMatchCompleted` 写节点胜者与 entries 战绩，一波打齐自动生成下一波 / 下一阶段 / 冠军；`onMatchUndo` 反向回退（清节点胜者并按现存节点重算该阶段战绩；该波已自动推进时，只要后续波全是「自动锁定且一场未打」就一并丢弃回到结果待定，否则拒绝并提示走「回退上一波」；`POST /api/matches/:matchId/undo` 里反向钩子**先于**比赛撤回执行，无法回退时整个撤回失败，不留半吊子状态）；`rollback-wave` 三分支：整波刚打完→比赛复位 pending 保留波、部分进行→拒绝并提示逐场撤销、最后波未打→删未打比赛与波并重开上一波；pending 比赛可走 `forfeitMatch` + `POST /api/tournaments/:id/forfeit` 弃权判负（补决胜小局 +「弃权」标签）。
  - **删除系列赛**（`DELETE /api/tournaments/:id`，前端列表与详情页共用确认弹窗）：默认只删编排记录，先经 `detachMatchesFromTournament` 剥离全部关联比赛的 `tournamentRef`、对局保留为普通对局（标签/战绩不动）；body `deleteMatches=true` 时解绑后再连对局删除（走现有删除栈，比赛管理可「撤回最近删除」，因解绑在前恢复出的快照也是无关联普通对局）；`onMatchCompleted/onMatchUndo` 遇到系列赛已不存在的孤儿引用直接返回 null，按普通对局处理不阻断登记。
  - **比赛管理按系列赛区分**：筛选行有独立的紫色系列赛组（`普通对局` + 各系列赛 `🏆名称（N场）`，只列有关联赛局的、按近期对局排序，孤儿引用归普通对局），与标签筛选/搜索 AND 叠加；表格标签列对系列赛对局固定前置紫色奖杯 Tag（不受手改标签影响，点击即按该系列赛筛选）；纯函数 `buildHistoryTournamentFilters`/`getEffectiveTournamentId` 在 `src/admin-antd/lib/history.ts`。
  - **双机同步包不含 tournaments.json**：系列赛编排不跨机同步，同一系列赛只在一台机器上编排操作；同步的比赛记录带 `tournamentRef`，另一机因无对应系列赛记录会把这些对局按普通对局展示（不影响战绩）。
- 选手 JSON 批量导入：只识别白名单字段 `name`/`rank`/`declaration`/`pets`（前后端双侧白名单防注入）；**常用精灵仅在命中 pets.json 时录入**，未命中走 `review` 弹窗逐条补录（每条最多 5 个模糊候选）；后端入口 `importPlayerProfiles` + `matchSpriteToken` + `POST /api/profiles/players/import`，成功广播 `profiles:update`。
- 批量操作：选手/战队表格可勾选多行一键删除（确认弹窗列出名称清单）；「批量头像」先按文件名本地匹配出「原头像 vs 新头像」预览弹窗，确认才提交覆盖保存；文件名经表单 `names` 字段以 JSON 传递，规避 multer 将 multipart 文件名按 latin1 解码的乱码问题。
- 战队标识（page3）：赛事携带 `leftTeamId/leftTeamName/rightTeamId/rightTeamName`，「直播推流」的 `page3TeamVisible` 控制显隐；logo 优先按 teamId 匹配录入战队，未录入仅显示名称色块；渲染细节见 `.agents/09`。
- 排位排名图标（page3 比分栏 / 选手介绍页）：创建弹窗或「当前比赛」表单输入（仅数字、可选），随对局存入 matches.json 并由 `syncScoreboardFromMatch` 同步到记分牌；`page3RankVisible` / `page11RankVisible` 控制推流页显隐（开启但未输入排名只显示图标，超 10000 显示 `10000+`）。
- 红光特效（page3）：「直播推流-推流页面3设置」含 `page3RedLightMode` 持久策略（关闭/自动开启）与 `page3RedLightInstant` 一次性「立即显示」（提前触发，进入下一局由服务端在 `emitMatchesUpdate` 广播出口统一清除，不影响策略）；素材 `src/assets/Effect/red-light.jpg` 由页面运行时去黑转 alpha 后以 `mix-blend-mode: screen` 叠加并呼吸显示；自动档任一侧阵亡 ≥3 只触发（阵亡中含卡瓦重/卡卡虫/丢丢时需 4 只），细节见 `.agents/09`。
- 详细索引（类型、API 路由、函数、socket 事件、常量、文件地图）在 `.agents/01..10-*.md` —— 遇到问题先查它们；行为有变化时要同步更新这些文档。

## 注意事项

- `.npmrc` 固定了 npmmirror 源和 Electron 二进制镜像；离线时安装可能失败。`sync:sprites` 需要联网，除非加 `--skip-download`。
- 头像上传会校验文件魔数（`image-service.ts` 中的存储型 XSS 防护）——改动时务必保留该检查。
- **导入外部 JSON 必须过 id 白名单**：match id 会被拼进头像目录，`normalizeMatchRecord` 只接受 `YYYYMMDD_[机器码]NNN` 形态（防路径穿越）——新增导入入口时务必复用该规范化路径。
- **tournamentRef 只能由系列赛引擎内部写入**：公开 `POST /api/matches` 会剥离 body.tournamentRef（`normalizeTournamentRef` 白名单透传仅供内部建场）；带 tournamentRef 的比赛不能直接 `DELETE /api/matches/:id`（400，提示用回退上一波），删对局要走系列赛「回退上一波」或 `DELETE /api/tournaments/:id`（解绑保留 / 连对局删除）。tournaments.json 不进双机同步包。
- **React Hooks 顺序约束**（曾踩坑）：任何 hook 都必须放在组件内的条件 return（如 `if (loading) return ...`）之前，否则 loading 切换时 hook 数量变化会抛 `Minified React error #310` 导致整页白屏。
- **新增或改动的推流/展示画面必须增量更新**：只更新发生变化的节点/区域，禁止整页 innerHTML 重写或全量重渲染，避免画面闪烁。
- `antd` skill 可用（`.agents/skills/antd`），Ant Design 相关开发建议加载。
- 提交风格：conventional commits，中文 scope/正文，例如 `feat(stage): ...`、`fix(security): ...`。
