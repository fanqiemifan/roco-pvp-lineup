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

- Vitest（node 环境）。测试文件放 `tests/`，按 `tests/electron/`（服务与 HTTP/socket 层）、`tests/admin-antd/`（前端纯函数）、`tests/pages/`（展示页原生脚本，用极简假 DOM + `node:vm` 跑真实脚本）镜像源码结构。
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

> 本节只画「地图」：说清每块在哪、干什么、有哪些不能违反的约束。**具体函数签名/字段见 `.agents/05`，前端视图与交互细节见 `.agents/09`，文件清单见 `.agents/01`，路由见 `.agents/04`/`.agents/08`。** 不在这重复像素级样式或逐字段规格。

- `electron/socket-server.ts` 是唯一的 Express + Socket.IO 服务器，持有所有 REST 路由和 socket 事件推送；`electron/services/*` 是纯文件型存储，**所有新文件路径都要加在 `path-service.ts` 里**。
- `shared/`：`types.ts`（全部类型）、`events.ts`（socket 事件）、`constants.ts`（默认值：端口 9988、BO7、6 格子、推流页面/过渡枚举）、`match-schedule.ts`（page6/8 场序时间排期）——electron 与 React 共用。
- `electron/float-window.ts`：桌面阵容悬浮窗（`float.html`）+ 更换精灵菜单（`float-menu.html`）+「下场对局」选择菜单（`float-nextgame.html`，由 float.js `window.open` 打开），经 `preload.ts` 的 `window.rocoFloat` IPC 驱动。
- 管理后台（React，`src/admin-antd/`）：十二视图（导航顺序）= 赛事面板/直播推流/系列比赛/结算画面/比赛管理/数据同步/信息录入/选手介绍/数据统计/页面预览/实时控制/关于项目；导航图标 `src/assets/ui/*.svg` 经 `?raw` 引入、`NavIcon` 换 `currentColor`。各视图交互与样式细节见 `.agents/09`。
- 推流/展示页面（纯原生 JS，`src/pages`+`src/scripts`+`src/styles`）：page1 比分栏、page2 全局阵容、page3 头像比分阵容、page4 MVP 结算（公开免鉴权）、page5 出场/胜率排行、page6 比赛结果、page7 对局推送、page8 比赛预告（公开免鉴权，与 page6 同构走 `match-prediction.js`）、page9 团队积分榜、page10 胜者结算、page11-13 选手介绍（同一页面 `?mode=left/right/versus`）、page14 晋级积分榜（只统计系列赛赛果、按阶段切换、每页最多 32 行由裁判端翻页，榜单由服务端算）、`float`/`float-menu`/`float-nextgame` 悬浮窗。**新增展示页要同时改 8 处注册点**（StagePageKey / SUPPORTED_STAGE_PAGES / STAGE_OPTIONS / PREVIEW_PAGES / 页面预览视图里那份内联硬编码选项 / stage-carrier.js 的 STAGE_PAGES / 免鉴权页面数组 / 公开 GET 白名单）。页面↔脚本对照见 `.agents/01`。**页面1-3 支持「阵容镜像反转」**（顶栏开关，`stage.mirrorSides`）：仅展示层左右互换（渲染时映射侧别），不改数据与胜负登记；禁止 CSS 整页翻转（立绘/文字会倒置）。
- MVP 结算（page4）：后台「载入当前对局胜方」把最近一个已分胜负小局的**胜方名字 + 阵容快照**（只收最终形态精灵）存进 `cache/mvp.json`，**切换对局不更新画面、须重新载入**；`POST /api/mvp/show` 记录 returnPage 并切屏、`/api/mvp/hide` 切回。实现 `mvp-service.ts` + `page4-display.js`；交互与渲染细节见 `.agents/09`。
- 入场动效：`stage-enter.css` + `stage-enter.js` 公共实现——载体 `stage-carrier.js` iframe 加载完成后 postMessage `stage-enter`，页面加 `is-stage-entered` 触发 `.fx-enter` 区块依次上浮淡入；page4 用同一时机播自定义逐项入场，page11-13 自带动效不接入。
- page10 自动切回：登记本局胜负时若当前画面是 page1-3，自动切入 page10 停留 `page10Duration` 后切回（socket-server 定时器驱动）。**只在登记的就是当前比赛时触发**（winner 路由 `matchId === activeMatchId` 守卫）——系列比赛卡片菜单 / Drawer 的 headless 登记不能把正在推流的画面顶掉、播出别人的比分。
- **选手头像统一解析**：所有展示页取「某场左右头像」统一走 `avatar-resolver.ts` 的 `resolveMatchAvatars`（批量用 `createAvatarResolver`，一次请求只建一次档案索引）。优先级 **赛事覆盖（`cache/avatars/{matchId}/**`，即后台「当前比赛」单独上传）> 档案头像（按 `match.leftPlayer/rightPlayer` 名字匹配信息录入）> 占位（`exists:false`）**——所以「信息录入」改头像会让已建比赛/系列赛对局一并更新，而赛事头像仍可单场覆盖。档案头像与赛事头像任一变化都广播 `avatar:update` 让所有头像页重解析（**选手名是匹配键，改名字/删选手/同步导入补档案也要触发**）。**跨机头像契约**：赛事覆盖头像（`cache/avatars/**`）只在本机存在、不进任何同步包，跨机一致性一律由**档案头像**保证——同步包只带 `cache/profiles/{players,teams}/<id>.png`（按档案 id），导入时目标档案按「id 别名 → 源 id → 同名」解析后**落盘到本机 id**，默认只补缺（要覆盖已有头像需在导入预览里勾选）。见 `.agents/05`（函数）、`.agents/06`（事件）。
- 信息录入（选手/战队档案）：服务 `profile-service.ts`，落盘 `cache/profiles.json`，头像/logo 存 `cache/profiles/{players,teams}/<id>.png` 经 `/runtime/profiles/**` 访问；创建赛事/page9 输入名字自动联想档案。JSON 批量导入只认白名单字段（见「注意事项」）。**档案 id 别名**：导入时遇「同名但不同 id」不再跳过，而是保留本机 id（比赛/头像目录都引用它）并登记 `playerAliases/teamAliases`（对方 id → 本机 id），展示端 `buildPlayerNameMap` 按「原名 → 别名」解析 —— 没有它，系列赛里来自另一台机器的 `playerIds` 只能显示一串 id（晋级图/波次卡片不显示选手名字就是这条）。
- 双机数据同步（「数据同步」视图，导航「比赛管理」之后；2026-10 从「比赛管理」底部卡片搬出）：同步包 = 单个 JSON（比赛 + 系列赛编排 + 可选档案/头像 base64），导入先预览（字段级 diff、逐条可勾选、冲突标记保留哪一边）再合并。合并规则/函数见 `.agents/05`（`sync-service.ts`）。**关键约束**：本机标识 `machineCode`（1-2 位大写字母）决定新比赛 id 形态 `20260928_A001`；**同一场比赛不能在两台机器分别创建**（会合并成两条）。「各登记一半」协作流程：A 建场导出基线 → B 导入 → 各自登记自己的场次 → B 导出回传 → A 导入（合并赛果 + 补写回推进）→ A 导出 → B 导入拿到下一波。**「系列比赛」列表内置「定向同步」（P1-A）**：一键导出只含该届的范围包（编排 + 名下对局 + 该届选手档案；已删届随行墓碑=定向删除），对端在「数据同步」照常导入——不把其他系列赛与普通对局带给对端。
- 云同步（点击式 · Cloudflare Worker + KV 信箱；**UI 全在「数据同步」视图，导航项带待办角标**；方案 `docs/cloud-sync-plan.html`，服务 `electron/services/cloud-sync-service.ts`，Worker 独立部署在 `cloudflare/`、`npm run cloud:deploy` 一键上线，运行时填 workerUrl / syncKey / 访问令牌 / 角色）：
  - 两组按钮：**主控端**（`role=main`，编排机 + 确认台）「同步分发 / 检查回传 / 确认台 / 指派」；**分控端**（`role=sub`，只读副本 + 登记点）「同步最新 / 回传」。**除前端红点轮询（只读 version/ack/uplink 小键、可关、绝不合并）外没有任何定时器会碰数据**，合并/推进/回执全靠点击，出问题可复现可暂停。
  - 四类 KV 键**全部带房间前缀** `room:{KEY}:`：`downlink`（主控写全量包，**不带头像**）、`version`（小版本键）、`uplink:{码}`（分控写）、`ack:{码}`（主控写回执）——不同 `syncKey` 就是完全不相交的键空间，一个 Worker 可挂任意多个房间。分发包 = 现有 `SyncBundle` + `cloud.roster`（名册）+ `cloud.assignment.overrides`（指派）。分控端头像缺图以占位/名字代替。
  - **Worker 鉴权（两把钥匙，都不进 URL）**：`X-Sync-Key` 房间密钥只做键空间隔离（**token 全局唯一、不按房间分，所以房间隔离不等于安全边界**：拿到 token 的人可以试任意房间号，房间不存在也只是回空信箱）；`X-Sync-Token` 是真正的大门（Worker secret `SYNC_TOKEN`，`npm run cloud:deploy` 会生成随机串并打印一次，重设用 `ROCO_SYNC_TOKEN` 环境变量重跑）。**没配 `SYNC_TOKEN` 时所有 `/room` 请求返回 503（fail closed）**，`/health` 会回 `tokenConfigured:false` 让界面直接提示。路由是 `GET/PUT/DELETE /room/{box}`，密钥不再出现在路径里（避免进 Cloudflare 日志）。
  - **回传 = 发送时现算的所有未 ack 比赛累计集合**（不是增量，否则两次回传之间主控未确认会覆盖丢失）；**确认 = 服务端重分类合并（不盲信分控端勾选）+ `runTournamentWriteBack` 推进波次 + 写回执**，走 `applySyncImport(mode:'bundle')` + `skipTournaments:true`（编排结构归编排机，绝不用分控副本覆盖）；驳回不写本地不回执。每次「同步最新」合并后重算待回传集，防主控回退后陈旧登记复活。
  - **指派**：主控勾选（按波次 / 按比赛），未指派 = 主控端登记、分控端入口置灰（闸门在 winner/start 路由，见 `.agents/04`），改派随下次分发生效。**归属本机放行**：本机自建系列赛的对局（tournamentRef 内嵌本机码）不受指派约束、登记直接放行——自建赛果不进待回传集（待回传集只收「指派给本机」的场次），所以自建赛事在云上保持「本地专属」，给对端要用文件同步。**已 ack 的赛果在分控端禁止撤回**（整条替换合并不触发 `onMatchUndo`，会状态分叉），修正走主控「回退上一波」（该波已有部分结果时引擎会拒绝整波回退，改走逐场撤回）→ 重新分发 → 分控重新登记回传；分控端「确认合并」时若发现本机已登记而云端仍是「未登记」，判定主控回退过这一波，自动撤回本机陈旧赛果（`resetMatchRegistrations`，保留 tournamentRef 但清掉比分/胜者）并不再计入已确认集，**旧登记不会复活**。
  - **配对校验**：同房间机器码必须互不相同（分控拉取时分发机码 == 本机码直接 400）；`role` 独立表达主/分，不靠 machineCode。**改 machineCode 有守卫**：有内嵌旧码的 running 系列赛直接拒绝，其余需二次确认（不做自动迁移 id）。
  - **换房间守卫**：改 syncKey 时若本机 `cache/cloud-sync.json` 仍有内容（版本水位 / 已确认集 / `ackedInboxSeq` 回传水位 / 名册 / 指派），`saveCloudSyncConfig` 抛带 `guard` 的错误 →「保存设置」与「测试能否连上云端」都回 409，界面弹「重置 / 保留」再重试；`cloudStateAction:'reset'` 必须先删该文件再写名册（顺序反了会清掉刚写的名册）。这些记录**不带房间标识**，带进新房间会让分控端因 `appliedVersion` 偏大被误判「已是最新」、主控端旧水位把新房间回传静默忽略。
  - **KV 最终一致**：写入异地最长约 60 秒（`cacheTtl` 最小 60，Worker 用默认值）才可见，「键不存在」的结果同样被缓存；界面常显版本/时间对比 + 等待重试提示，**不要连点刷**（读也计数）。免费额度读 10 万/天、写 1000/天，点击式消耗从容。`/api/cloud-sync/*` 强制登录（不在公开 GET 白名单里）。
  - **B1「记住上次排除」**：分控端「确认合并」时排除的系列赛记入本机状态，下次「同步最新」预览默认继续排除（弹窗顶部「已按上次选择默认排除 N 届」+「全部恢复导入」一键清除）；墓碑永不入列（删除指令不可取消）。
- 系列赛自动化编排（「系列比赛」视图，引擎 `tournament-service.ts`，编排落 `cache/tournaments.json`，API `/api/tournaments`，广播 `tournament:update`）：
  - 参赛人数限 4/8/16/32/64 且全部来自档案、不可重复（前端校验数组由 `SUPPORTED_TOURNAMENT_SIZES` 派生，别再硬编码）；阶段模型 `stages`（默认模板 `buildDefaultStages`），`format` = 单败 `single-elim` / 双败 `double-life`，双败按 3 波战绩桶收敛（W1 0-0 → W2 1-0/0-1 → W3 1-1，决胜波经典交叉配对）。**「总决赛」= 只剩 2 人的阶段，必须单败**（`createTournament` 直接拒绝，判据用阶段人数）。RNG = mulberry32 注入式，同 seed 可复现。
  - 每个节点的对决仍是普通比赛：引擎内部 `createMatch` 打 `tournamentRef`，赛事身份（赛事名/阶段/波次）由 ref + tournaments.json 实时解析、**不写入标签**（仅跨桶场次保留「跨桶」标注标签）；手动/需确认的波先停 `draft`（配对确认台），锁定校验通过后批量建场。
  - **季军赛 = 附加波次，不是阶段**（`TournamentWave.kind = 'third-place'`）：4 人阶段（半决赛）打完后自动取两名落败者建一场，**先于下一阶段首波入队**——`waves` 数组顺序即时间线，「回退上一波」/撤回级联/重开上一波都按它推导，排错位置会误伤季军赛或让总决赛再也推进不出来。赛制 = `record.thirdPlaceBestOf`（创建向导可选，0 = 不安排，旧数据缺省按「与总决赛同赛制」解析）。它**不在晋级链上**：推进、阶段战绩重算、page14 榜单、冠军判定一律跳过，季军只记节点 `winnerId`（不进 `record.result`）；撤回与回退只作用于这一场，季军赛可以晚于总决赛打完。判据是**阶段人数 = 4** 而不是阶段名，双败的 4进2 同样适用。它在分发/指派之后才建场 → 未指派时**分控端登记入口置灰**，要在主控「指派」里补勾。分支语义见 `.agents/05`，展示口径见 `.agents/09`。
  - 赛果写回靠 socket-server 在登记胜负/弃权/撤回处调钩子 `onMatchCompleted`/`onMatchUndo`（幂等，波打齐自动推进 / 反向回退）；`rollback-wave` 回退上一波，pending 比赛可弃权判负。**各钩子/回退的完整分支语义见 `.agents/05`。**
  - **系列赛对局的选手名与赛制锁死**（别在赛事面板改）：`leftPlayer/rightPlayer/bestOf` 是建场快照——名字是完成钩子的写回比对依据、赛制决定完赛局数，赛事面板置灰 + PATCH 守卫 `assertTournamentMatchFieldsEditable` 拒绝改（战队/排名仍可改）。「信息录入」改名由 `syncTournamentMatchNames` 回写对局快照；登记赛果**必须先过 `prepareTournamentWriteBack` 再落盘**（钩子在落盘后才跑，抛错会留下「比分已写入、系列赛没推进」且不能再登记的半吊子状态，名字不一致时该函数先自愈）。删除参与中的选手档案会让该场无法登记（提示走「回退上一波」），**不要**把写回校验挪回钩子里。
  - **删除系列赛 = 写墓碑，不物理移除**（`DELETE /api/tournaments/:id`）：删除写 `deletedAt` + 对局名单（`deletedMatchIds`/`deletedMatches`），墓碑随同步包传播——接收端清副本并**留存墓碑**（墓碑永远优先于存活副本，旧包/回传不复活；鉴权 = 包作者码 == id 内嵌码）；对外读取（`getTournamentStore`）过滤墓碑，含墓碑访问器仅供同步。变更仍先经 `detachMatchesFromTournament` 解绑、`deleteMatches=true` 再连对局删除（可撤回）；合并侧不变量：每次合并后引用墓碑的比赛一律解绑、名单对局从合并/导出两侧过滤，`mutateRecord`/写回钩子把墓碑当「不存在」。孤儿引用按普通对局处理不阻断登记。预览与合并同口径：被「连同对局删除」名单拦截的对局在预览中标「已删名单拦截」（不再显示为新增，防"预览说新增却从不写入"的误导）。
  - **编排机所有权**：系列赛归创建它的机器码所有，只有编排机能变更（变更入口与写回钩子都有闸门），其余机器是只读副本；`tournaments.json` 随同步包流转、导入自动合并，赛果回传编排机后由 `runTournamentWriteBack` 补跑推进。详见 `.agents/05`。
  - **阵容表批量导出 / 导入**（系列比赛详情工具栏，只读副本也开放——均非编排操作）：导出「待开始比赛第 1 局」填写模板（一场两行 CSV：系列赛/阶段/对局ID/位置/选手 + 精灵1..6，已录阵容回显；弹窗选范围：整届 / 按阶段 / 仅当前波）。导入支持 CSV / 粘贴表格（TSV）/ JSON：前端按「对局ID + 位置」配对合并，服务端逐格解析名字（复用快速填充匹配，支持 `pet_id 名字` / `编号 名字` 写法，pet_id 是唯一主键）后批量写入。门槛与单场「录入阵容」完全一致（比赛待开始 + 第 1 局未开赛；已开赛 / 已完赛 / 非本系列赛整场跳过），一次落盘 + 单次 `matches:update` 广播；纯函数在 `lib/lineup-sheet.ts`，细节见 `.agents/04` / `.agents/09`。
  - 前端「比赛管理」与「推流选场」都按系列赛分组（紫色奖杯 Tag / 阶段·语义轮次分组），纯函数在 `lib/history.ts`、`lib/tournament.ts`；渲染细节见 `.agents/09`。**选场上限：page6/page8 = 9 场**（3×3 卡片网格的结构决定），**page7 不限**（一屏 4 行 + 整屏过渡，行数不影响 DOM 规模，支持整届 / 按阶段·波次整组勾选）——别把三者一起"统一"；page7 的 `PAGE7_MAX_MATCHES = 200` 只是兜底。**整屏切换间隔在「画面设置」里配**（`stage.page7SwitchSeconds`，默认 10 秒；展示页经 `/api/stage` + `stage:update` 消费，故 `ROLES_FOR_STAGE` 必须含 `page7`）。
  - **卡片就地登记（headless）**：系列比赛详情里，对局卡片**右键直接打开对局面板**、点「⋯」弹菜单（打开对局面板 / 左赢 / 右赢 / 开始 / 撤回 / 取消撤回 / 查看阵容 / 弃权 / 进入管理），「打开对局面板」在右侧 Drawer 里复用「当前比赛」面板（`CurrentMatchPanel`，与赛事面板同一组件、以目标 match 为参数）。**流程动作默认 headless**：服务端本就按 matchId 工作，开始 / 登记胜负 / 撤回只写目标那场，**不切当前比赛、不覆写推流画面**（服务端写后的面板/记分牌同步对非当前比赛是空操作；page10 另有上面那条守卫）；只有显式的「设为当前比赛」才覆写画面。可用性由 `lib/match-actions.ts` 的 `deriveMatchActionAvailability` 一次算齐（撤回状态取 `undo.byMatch[matchId]`，见 `.agents/05`）+ 云闸门，按钮提前置灰而不是点了才报错。头像与实时面板阵容编辑仍硬绑 activeMatchId，非当前比赛时禁用（改阵容走「录入阵容」）。前端视图与交互细节见 `.agents/09`。
  - **本机移除 / 恢复（分控端对非本机系列赛）**：本机视图层隐藏（`localOnly` 墓碑，仅本机存在）：出站包剔除（不传播）、本机墓碑优先（不复活）、不解绑/不删对局、不改 updatedAt；「恢复」立即回显、下次同步补齐；编排机真删到达时替换为真墓碑照常清理。路由 `POST /api/tournaments/:id/local-remove|local-restore` 与 `GET /api/tournaments/local-removed`（须注册在 `/:tournamentId` 之前）；其对局在「比赛管理 / 推流选场 / 赛事面板快捷列表 / 下场对局下拉」一并隐藏（推送选场的候选过滤、已选解析仍用全量，已推送的隐藏对局不丢场序与时间）。详见 `.agents/05`/`.agents/09`。
- page3 附加特性（战队标识 / 排位排名图标 / 红光特效）：显隐各由 `stage.*` 开关控制，行为规则与踩坑见 `.agents/09`。排位排名随对局存 `leftRank/rightRank`、由 `syncScoreboardFromMatch` 同步记分牌，系列赛建场时从档案快照，`/api/page6`·`/api/page8` 对空排名按选手名回退档案。
- 详细索引（类型、API 路由、函数、socket 事件、常量、文件地图）在 `.agents/01..10-*.md` —— 遇到问题先查它们；行为有变化时要同步更新这些文档。

## 注意事项

- `.npmrc` 固定了 npmmirror 源和 Electron 二进制镜像；离线时安装可能失败。`sync:sprites` 需要联网，除非加 `--skip-download`。
- 头像上传会校验文件魔数（`image-service.ts` 中的存储型 XSS 防护）——改动时务必保留该检查。
- **导入外部 JSON 必须过 id 白名单**：match id 会被拼进头像目录，`normalizeMatchRecord` 只接受 `YYYYMMDD_[机器码]NNN` 形态（防路径穿越）——新增导入入口时务必复用该规范化路径。
- **tournamentRef 只能由系列赛引擎内部写入**：公开 `POST /api/matches` 会剥离 body.tournamentRef（`normalizeTournamentRef` 白名单透传仅供内部建场）；带 tournamentRef 的比赛不能直接 `DELETE /api/matches/:id`（400，提示用回退上一波），删对局要走系列赛「回退上一波」或 `DELETE /api/tournaments/:id`（解绑保留 / 连对局删除）。tournaments.json 随同步包流转，编辑权归编排机（见上文「双机同步包含系列赛编排」）。
- **React Hooks 顺序约束**（曾踩坑）：任何 hook 都必须放在组件内的条件 return（如 `if (loading) return ...`）之前，否则 loading 切换时 hook 数量变化会抛 `Minified React error #310` 导致整页白屏。
- **tournaments.json 损坏保护**：库文件原子写（同目录 tmp + rename）；解析失败先备份 `.corrupt` 再抛错，**绝不静默当空库**（空库 + 下一次写会把整库永久覆盖，`createTournament` 只剩新系列赛、合并只剩包内容）——不要改回静默返回 `[]`。
- **新增或改动的推流/展示画面必须增量更新**：只更新发生变化的节点/区域，禁止整页 innerHTML 重写或全量重渲染，避免画面闪烁。
- `antd` skill 可用（`.agents/skills/antd`），Ant Design 相关开发建议加载。
- 提交风格：conventional commits，中文 scope/正文，例如 `feat(stage): ...`、`fix(security): ...`。

## 文档写作约定（维护 agents.md 与 `.agents/` 时遵守）

- **agents.md 只放常驻知识**：命令、架构地图、硬性约束、踩坑。每条尽量两三行内，细节下沉到 `.agents/`，用指针引用，别把规格说明书塞进来（它每次对话都进上下文）。
- **每条知识只有一个「家」**：同一事实不要在 agents.md 和 `.agents/` 各写一遍，改一处忘一处会让 agent 拿到矛盾信息。函数签名/字段→`.agents/05`，前端视图与交互→`.agents/09`，文件清单→`.agents/01`，路由→`.agents/04`/`08`。
- **不写像素级视觉常量**：坐标（x/y）、尺寸（宽×高、px）、颜色（十六进制/渐变）、字号、圆角、间距等一律**不进文档**——CSS/JS 源码是唯一真源，文档里抄一份只会在手改样式后变成假情报。需要说明视觉时，只写「在哪、由哪个开关/类名控制」，具体数值读代码。
- **要写的是代码读不出来的东西**：行为规则（触发阈值、显隐条件、幂等/回退语义）、设计取舍的「为什么」、以及踩过的坑（如量测要加 scrollLeft、fonts.ready 后补测、hooks 顺序约束）。这些才是文档的价值，别在瘦身时误删。
