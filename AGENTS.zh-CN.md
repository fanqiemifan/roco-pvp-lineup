# AGENTS.md（中文版）

洛克王国世界阵容同步推流（roco-pvp-lineup）— 洛克王国赛事推流控制台。Electron（Express + Socket.IO）后端 + React/AntD 管理后台。代码注释、提交信息以及 `.agents/` 里的文档均为中文。

## 常用命令（全部来自 `package.json` 的 scripts）

- `npm run build` — 构建 renderer + electron。会触发 `prebuild` → `npm run sync:sprites`，该脚本会**从网络下载精灵图片**（数据源为 `resources/data/pets.json` 的 `official_small_icon` 与 `icon_url`）。如果只想校验数据、不想下载图片，运行 `node scripts/sync-spirits-assets.mjs --skip-download`。
- `npm run dev` — 构建 renderer + electron，然后启动 Electron 桌面应用。
- `npm run serve:node` — 构建 + 无头 Node 服务器（默认 `--host 127.0.0.1 --port 9988`）。Docker 使用的就是这个模式。
- `npm run package` — 构建 + electron-builder，产出 Windows NSIS 安装包到 `release/`（已被 gitignore）。
- `npm test` — 运行全部测试（Vitest，详见下方「测试」）；`npm run test:watch` — watch 模式；`npm run typecheck:tests` — 测试与 vitest 配置的类型检查。
- **没有 lint、没有格式化工具。** 验证手段 = `npm test` + `npm run typecheck:frontend`（改了 electron 源码再加 `npm run build:electron`）。

## 两套独立的 TS 工程 — 注意差异

- Electron 侧：`tsconfig.json`（`NodeNext` ESM，输出到 `dist-electron/`）。相对导入**必须带 `.js` 后缀**（如 `../shared/events.js`）。它没有 `noEmit`，所以 Electron 侧的"类型检查"就是直接跑 `npm run build:electron`。
- 前端 React 侧：`tsconfig.frontend.json`（`Bundler` 解析，`noEmit`），用 `npm run typecheck:frontend` 检查，只覆盖 `src/admin-antd`、`src/login-antd`、`shared`。
- Vite（`vite.config.ts`）**只打包** `src/pages/admin-antd.html` 和 `src/pages/login.html` 到 `dist/`；`emptyOutDir: true` 每次构建会清空 `dist/`。
- 推流/展示页面（`src/pages/*.html`、`src/scripts/*.js`、`src/styles/*.css`）是纯原生 JS，静态伺服——**不属于 Vite 构建**。

## 测试

- Vitest（node 环境；`vitest.config.ts` 配置，`tsconfig.tests.json` 类型检查，互不影响两条构建链路）。测试文件放 `tests/`，按 `tests/electron/`（服务与 HTTP/socket 层）、`tests/admin-antd/`（前端纯函数）镜像源码结构。
- 服务层测试**不需要 Electron**：服务全部经 `AppPaths` 读写文件，`mkdtempSync` 临时目录 + `createAppPaths(root, root)`（补一句 `mkdirSync(paths.dataDir)`）即得完全隔离环境。精灵库夹具 = 往 `dataDir/pets.json` 写索引 + 在 `spritesDir` 放 `{pet_id}_{name}.png` 空文件（索引会过滤缺图条目）。
- HTTP/socket 层测试：`createLocalServer(paths, 0, '127.0.0.1')` 起真实服务器（**不传 authConfig = 关闭鉴权**），用 `fetch` 打路由、`socket.io-client` 订阅广播。socket 事件名以 `shared/events.ts` 的 `SOCKET_EVENTS` **值**为准（是 `matches:update` 这类带冒号的字符串，不是 TS 属性名 `matchesUpdate`）。
- 提交前验证：`npm test` + `npm run typecheck:tests`；改了 electron 源码再加 `npm run build:electron`。

## 两种运行模式 — 鉴权行为不同

- 桌面模式（`electron/main.ts`）：**关闭鉴权**，后台入口在 `/admin.html`。
- Node 服务器模式（`electron/server-entry.ts`，Dockerfile 也是用这个）：**开启鉴权**；默认账号密码为 `admin` / `admin123`，除非设置了 `ADMIN_USER` / `ADMIN_PASS` 环境变量。Docker compose 里显式设置了这两个变量。

## 运行时数据（生成物，已被 gitignore — 切勿提交）

- 面板/记分牌/比赛/page4/导播台/头像状态以及端口配置，都以 JSON/PNG 形式存放在某个 userData 目录下的 `runtime/cache/` 中，路径解析逻辑在 `electron/services/path-service.ts`：
  - 桌面模式：Electron `app.getPath('userData')`。
  - Node/Docker 模式：`<项目根目录>/LuokePVPWebui`（可用 `ROCO_DATA_DIR` 覆盖）。
- 精灵数据索引是 `resources/data/pets.json`（源数据，勿手改字段名）；`resources/sprites-img/`（official_small_icon 精灵立绘）与 `resources/sprites-icon/`（icon_url 精灵头像）由 `scripts/sync-spirits-assets.mjs` 按 `{pet_id}_{name}.png` 命名下载（sprites-img 目录就是 `/img/` 伺服的那个目录；sprites-icon 经 `/resources/sprites-icon/` 伺服，petsdiv 头像统一用它）。精灵数据变化后更新 pets.json 再重新跑脚本；图片已存在时会跳过（幂等），源图缺失自动降级（small→official_icon→image_url / icon_url→official_icon）。
- **精灵字段映射**（`sprite-service.ts` 的 `normalizePetRecord`）：精灵编号=handbook_no、精灵名称=name、精灵属性=elements（经 `attribute_mapping.json` 转属性码，与 pets.json 的 element_id 已校验一致）、精灵形态=stage（1=一阶 2=二阶 3=三阶 4=首领）。多形态记录：`name` 带形态后缀（如 卡瓦重（草地附近的样子）），`displayName` 保持纯名。
- **名称字段只保留 `name`/`displayName` 两个**（`shared/types.ts` 的 SpriteRecord）：已删除恒等重复的 `chineseName`（=name 全称）与 `cardName`（=displayName 短名），所有名称消费点（后台搜索/查找表、page1/3/4 短名链、float/float-menu 全称链、lineup-display）改为读这两个字段；磁盘旧 JSON 中残留的旧字段无害，随保存自然消失。统计排行结构 StatsRankingRow（`stats-service.ts`）同步删除 `cardName`，现仅 `name`（全称）+ `displayName`（短名），page5 消费改为 `row.displayName || row.name`。注：布局函数 `getCardNameLeft`/`getSpriteCardNameLeft`（入参为名字长度，返回名字元素 CSS `--pet-name-left` 定位值）与 `.sprite-pet-card*` CSS 类属「卡片」UI 命名，与已删字段无关，保留。
- **持久化精灵主键字段 = `pet_id`**（精灵 id）：比赛快照/阵容/历史（matches.json）、page4 面板的槽位字段统一叫 `pet_id`，与其余快照字段（name/form）同口径。不做旧数据兼容——pet_id 必须是精灵索引中存在的 id。

## 架构

- `electron/socket-server.ts` 是唯一的 Express + Socket.IO 服务器，持有所有 REST 路由和 socket 事件推送。`electron/services/*` 是纯文件型存储；所有新路径都要加在 `path-service.ts` 里。
- `electron/float-window.ts` 负责桌面阵容悬浮窗（`float.html`，透明置顶 587×56）与更换精灵菜单（`float-menu.html`，240×240），通过 `preload.ts` 暴露的 `window.rocoFloat` IPC 通道驱动。
- `shared/types.ts`（全部类型）、`shared/events.ts`（socket 事件）、`shared/constants.ts`（默认值：端口 9988、BO7、6 个格子、推流页面/过渡枚举）——electron 和 React 代码都会引用。
- 管理后台：「赛事面板/直播推流/实时控制/比赛历史/信息录入/选手介绍/数据统计/页面预览/仅显阵容/关于项目」十视图为 App.tsx 顶部**可收缩**（siderCollapsed，展开 232px / 收起 64px）的 `antd Menu`。图标是 `src/assets/ui/*.svg` 经 `?raw` 引入、`NavIcon` 组件把 `fill="black"` 替换为 `currentColor` 自适应配色（类型声明在 `env.d.ts`，`*.svg?raw`）；展开态图标与文字间隔 8px（`.nav-icon` margin-right，收起态归零居中）。品牌区 = 左侧 logo（`logo.svg?raw`）+ 右侧两行字（`ROCO PVP LINEUP` 常规字重 / `洛克王国世界阵容同步推流` 淡色），收起时仅居中 logo。顶部 `admin-header` 单行显示当前导航对应名（共享 `VIEW_LABEL` 映射，与导航菜单同源），右侧为阵容悬浮窗/打开当前预览/复制预览链接/刷新按钮。
- 赛事面板操作：「比赛列表」卡片头部在「开一局」旁有「快速创建比赛」——弹窗内参赛选手在**固定高度的可滚动选手列表区域**逐条点选（选手列表按**信息录入添加时间升序**排列：档案 id 内嵌 base36 创建时间戳，数组顺序被打乱时仍按真实添加时间排，id 解析失败的按原数组顺序兜底在末尾；顶部搜索框按名字实时过滤、派生出勾选态，所选人数实时显示、奇数红色告警），数量须为**双数**，再选「比赛赛制」与「赛事标签」，确认后用 **Fisher–Yates 随机洗牌 + 两两配对**逐一创建对局（公平起见随机分配，杜绝固定对阵），复用选手名字与排位排名；「当前比赛」操作面板在「开始本次对局」旁有「战队修改」——因创建时未选战队后续补填，从「信息录入」战队联想复用 id 或手动输入，PATCH `/api/matches/:id` 更新。创建比赛走统一入口 `postCreateMatch`（在前端抽取，创建与快速创建共用）。
- 推流/展示页面是纯原生 JS（`src/pages/*.html` + `src/scripts/*.js` + `src/styles/*.css`），其中 `page4`/`page5` 分别是仅显阵容页与使用率/胜率排行页，`page7` 是对局推送页（比赛历史勾选推送，标题/温馨提示在「直播推流」设置），`page9` 是团队积分榜页（后台录入战队名称与 R1/R2/R3 积分，留空显示 `-`，排名与总积分按总分降序自动计算），`float`/`float-menu` 是桌面悬浮窗页面。
- 推流页面切换入场动效（fadeUp）：`src/styles/stage-enter.css` + `src/scripts/stage-enter.js` 是页面内入场动效的公共实现——推流载体（`stage-carrier.js`）完成 iframe 加载后 postMessage `stage-enter`，页面脚本在根节点加 `is-stage-entered` 触发 `.fx-enter` 区块依次上浮淡入（内联 `--fx-delay` 控制延迟）；推流页面 1/2/3/5/6/7/8/9/10 均已接入，page3 每次切入额外播放一次阵容入场（`page3-display.js` 监听 `stage-enter` 调 `animateLineup('enter')`），page11-13 自带元素动效不接入。
- 排位排名（page3 比分栏图标）：在「开一局」创建弹窗或赛事面板「当前比赛」表单输入（仅数字、可选），随对局存入 `matches.json` 并由 `syncScoreboardFromMatch` 同步到记分牌；「直播推流」面板的 `page3RankVisible` 开关控制推流页显隐（开启但未输入排名只显示图标，超过 10000 显示 `10000+`）。
- 信息录入（选手/战队档案）：导航栏「信息录入」单卡片 + Segmented 切换选手/战队视图，服务在 `electron/services/profile-service.ts`，数据落盘 `cache/profiles.json`；选手头像与战队 logo 存于 `cache/profiles/{players,teams}/<id>.png`，经公开静态路径 `/runtime/profiles/**` 访问。创建赛事时输入选手名字自动联想已录入选手（复用头像/排名），「所属战队」可选录入战队或手填；page9 团队积分榜战队名称输入框同样联想录入战队。
- 选手 JSON 批量导入（选手信息页）：「信息录入 → 选手信息」顶部有「导入JSON」与「下载示例」。导入文件须为数组，每条**只识别白名单字段** `name`（选手名字，必填）/ `rank`（排位排名，仅纯数字）/ `declaration`（宣言）/ `pets`（常用精灵，英文键，字符串或数组，支持 `、/，,` 分隔）——其余任何键（id、头像、`__proto__`、脚本等）一律忽略，前后端双侧白名单防注入；异常字段、超长文本会被裁剪，缺 `name` 的记录跳过。**常用精灵仅在命中 pets.json（按名字/编号/别名精确匹配）时录入**；未命中的精灵不录入、其余信息正常导入，后端返回的 `review` 携带每条的**最多 5 个模糊候选**，前端弹窗列出未匹配项让用户逐条从下拉（可搜索）选候选补录或忽略。命名规范为英文字段名 + 中文界面标签。后端入口 `importPlayerProfiles`（返回 `{ profiles, review }`）+ `matchSpriteToken`（命中判定与兜底候选）+ `POST /api/profiles/players/import`（接受数组或 `{players:[...]}`），提交后广播 `profiles:update`。
- 战队标识（page3 战队 div）：赛事携带 `leftTeamId/leftTeamName/rightTeamId/rightTeamName`，「直播推流」面板的 `page3TeamVisible` 开关控制显隐；开启后页面3 左右两侧（左 x257 y958 / 右 x1569 y958）显示 94×94 圆角 18 的战队 div，外描边 2px C9C9C9（box-shadow），底部 24px 高 F2ECDF 色块叠加战队名称（MiSans-Semibold 15px #585858，canvas 渲染 PNG 缓存避免字体兼容问题）；logo 优先按 teamId 匹配录入战队，未录入仅显示名称色块。
- 信息录入批量操作：选手/战队表格均带 `rowSelection` 复选框，可**勾选多行一键删除**（删除所选按钮按当前 tab 显示数量，0 项禁用；确认弹窗列出名称清单，逐条调既有单删接口，删除时按钮 loading 并禁用复选框，切换 tab 或删除后清空勾选）。「批量头像」按钮用隐藏 file input 一次多选图片后**先做本地匹配预览**：前端按图片文件名（去扩展名）精确匹配已录入选手名字，弹出「原头像 vs 新头像」左右对比弹窗（原头像未设置时显示默认占位图；未匹配文件以警告列出且不上传），点确认才提交 `POST /api/upload/player-avatars/batch` 覆盖保存（命中走单头像压缩管线）；文件名列表随表单 `names` 字段以 JSON 传递，规避 multer 将 multipart 文件名按 latin1 解码导致的中文乱码（字段值始终按 UTF-8）。新增/编辑选手的「常用精灵」为**固定两列网格**：按 displayName 去重后显示精灵头像（iconUrl，缺失回退立绘）+ 名字，点卡片选中/取消（上限 6 个），顶部搜索框实时过滤，用 `Form.useWatch('pets')` 绑定表单值、打开弹窗时按原 pets 拆分回显。
- 详细索引（类型、API 路由、函数、socket 事件、常量、文件地图）在 `.agents/01..10-*.md` —— 遇到问题先查它们；行为有变化时要同步更新这些文档。

## 注意事项

- `.npmrc` 固定了 npmmirror 源和 Electron 二进制镜像；离线时安装可能失败。`sync:sprites` 需要联网，除非加 `--skip-download`。
- 头像上传会校验文件魔数（`image-service.ts` 中的存储型 XSS 防护）——改动时务必保留该检查。
- **React Hooks 顺序约束**（曾踩坑）：任何 `useMemo`/`useEffect` 等 hook 都必须放在组件内的**条件 return（如 `if (loading) return ...`）之前**，否则 loading 切换时 hook 数量变化会抛 `Minified React error #310` 导致整页白屏。App.tsx 中的 `menuItems` useMemo 即因此被移到 early return 前。
- `antd` skill 可用（`.agents/skills/antd`），Ant Design 相关开发建议加载。
- 提交风格：conventional commits，中文 scope/正文，例如 `feat(stage): ...`、`fix(security): ...`。
