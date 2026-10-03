# 洛克王国 PVP WebUI - 项目概览

## 项目架构

```
roco-pvp-lineup/
├── electron/           # Electron 主进程
│   ├── services/       # 核心业务服务（纯文件型存储）
│   ├── ipc/            # IPC 通信
│   ├── main.ts         # 应用入口（窗口/托盘/服务器启动）
│   ├── server-entry.ts # 独立服务器入口（无窗口）
│   ├── socket-server.ts # HTTP + Socket.IO 服务器
│   ├── preload.ts      # 预加载脚本（暴露 rocoDesktop / rocoFloat）
│   └── float-window.ts # 桌面阵容悬浮窗 + 更换精灵菜单窗口
├── shared/             # 共享类型和常量
│   ├── types.ts        # TypeScript 类型定义
│   ├── events.ts       # Socket 事件常量
│   └── constants.ts    # 全局常量（端口、阵容/推流/过渡）
├── src/
│   ├── admin-antd/     # 管理后台（Ant Design，React）
│   │   ├── App.tsx     # 主组件（视图分发）
│   │   ├── views/      # 各视图页面
│   │   ├── components/ # 小组件
│   │   └── lib/        # 通用逻辑（请求、统计、格式化等）
│   ├── login-antd/     # 登录页面（Ant Design）
│   ├── pages/          # 原生 HTML 页面模板（推流/展示/悬浮窗）
│   ├── scripts/        # 原生 JS 展示脚本
│   ├── styles/         # 原生 CSS 样式
│   └── assets/         # UI 资源（图标、字体）
├── tests/              # Vitest 测试（tests/electron/ 服务与 HTTP 层、tests/admin-antd/ 前端纯函数，镜像源码结构）
├── cloudflare/         # 云同步信箱 Worker（独立部署，不进 Electron 构建：worker.js + wrangler.toml）
├── scripts/            # 构建/资源脚本（sync-spirits-assets.mjs 下载精灵图、deploy-cloud-sync.mjs 一键部署 Worker）
└── resources/          # 游戏资源
    ├── sprites-img/    # 精灵立绘（official_small_icon，/img/）
    ├── sprites-icon/   # 精灵头像（icon_url + 原 Thumbnail 迁移，/resources/sprites-icon/）
    ├── sprites-alt/    # 备用精灵图片（/img-2/）
    ├── data/           # 数据文件（pets.json、attribute_mapping.json 等）
    └── ...
```

## 文件目录索引

### Electron 主进程

| 文件路径 | 说明 |
|---------|------|
| electron/main.ts | Electron 应用主入口，主/子窗口管理、托盘、服务器启动、window.open 拦截 |
| electron/server-entry.ts | 独立服务器模式入口（无 Electron 窗口） |
| electron/socket-server.ts | Express + Socket.IO 服务器，全部 REST 路由定义 |
| electron/preload.ts | 预加载脚本，暴露 rocoDesktop（文件/剪贴板）与 rocoFloat（悬浮窗 IPC） |
| electron/float-window.ts | 桌面阵容悬浮窗（float.html）与更换精灵菜单（float-menu.html） |
| electron/ipc/window-ipc.ts | IPC 通道注册（文件读写、剪贴板、对话框） |
| electron/electron-env.d.ts | 渲染进程 window 全局类型声明 |

### 服务模块

| 文件路径 | 说明 |
|---------|------|
| electron/services/match-service.ts | 比赛管理核心服务（创建、更新、胜负、撤销/恢复） |
| electron/services/lineup-xlsx-service.ts | 系列赛阵容模板 .xlsx 服务端解表（exceljs → 二维字符串表，供导入解析） |
| electron/services/state-service.ts | 面板（panels）与记分牌状态管理 |
| electron/services/sprite-service.ts | 精灵数据加载、搜索、快速填充 |
| electron/services/image-service.ts | 头像上传/删除/读取（含魔数校验） |
| electron/services/config-service.ts | 运行时配置（端口、本机标识 machineCode）管理 |
| electron/services/path-service.ts | 文件路径管理和路径工厂 |
| electron/services/page6-service.ts | 比赛结果页（page6）状态管理 |
| electron/services/page7-service.ts | 战绩详情页（page7）状态管理 |
| electron/services/page8-service.ts | 比赛预告页（page8）状态管理 |
| electron/services/page9-service.ts | 团队积分榜页（page9）状态管理 |
| electron/services/page14-service.ts | 晋级积分榜页（page14）状态管理（选题系列赛 + 可播阶段 + 当前阶段/页码 + 标题副标题；榜单经 tournament-service.resolveStageStandings 现算） |
| electron/services/page11-service.ts | 选手介绍页（page11-13）左右两侧配置管理 |
| electron/services/nextgame-service.ts | 下场对局（page3 下场对局展示 + 悬浮窗选择）状态管理 |
| electron/services/countdown-service.ts | 倒计时插件状态管理（显隐/启停/重置） |
| electron/services/stage-service.ts | 直播推流载体配置管理 |
| electron/services/profile-service.ts | 选手/战队信息录入（增删改、JSON 批量导入 importPlayerProfiles、常用精灵命中判定 matchSpriteToken） |
| electron/services/stats-service.ts | 精灵精灵登场/胜率排行统计（/api/stats/ranking） |
| electron/services/sync-service.ts | 双机数据同步（导出同步包 exportSyncBundle / 导入预览 previewSyncImport / 合并应用 applySyncImport——含系列赛自动合并与写回补跑） |
| electron/services/cloud-sync-service.ts | 云同步（点击式 · Cloudflare Worker + KV 信箱）：主控 pushCloudSync（分发）/ checkCloudSync + confirmCloudSync（确认台 + 回执）/ rejectCloudSync，分控 previewCloudPull + finalizeCloudPull（同步最新）/ uploadCloudSync（回传），两端共用的 pollCloudSync（红点轮询，只读小键）、saveCloudAssignment（指派）、checkMachineCodeChange（改码守卫）、canRegisterMatch / checkSubUndoAllowed（登记与撤回闸门）；本机状态落 cache/cloud-sync.json，待合并包落 cache/cloud-pending.json |
| electron/services/tournament-service.ts | 系列赛自动化引擎（创建/抽签/分桶配对/完成与撤回钩子/波次回退/弃权/删除，删除时经 match-service 解绑 tournamentRef 或连对局一并删除；编排落 cache/tournaments.json；双机编排机所有权闸门 + mergeTournamentRecords / runTournamentWriteBack） |

### 共享模块

| 文件路径 | 说明 |
|---------|------|
| shared/types.ts | 所有 TypeScript 类型定义 |
| shared/events.ts | Socket.IO 事件名称常量 |
| shared/constants.ts | 全局常量（端口、默认值、推流页面/过渡枚举） |
| shared/match-schedule.ts | page6/8 卡片场序时间排期纯函数（开始时间 + BO×30 分钟累加、手动覆盖、中文序数文案），electron 下发与后台选场弹窗共用 |

### 管理后台（src/admin-antd）

| 文件路径 | 说明 |
|---------|------|
| App.tsx | 主组件：九视图分发（roster/stage/live/history/profiles/page11/stats/preview/about）、可收缩 Sider 导航（SVG 图标 via `?raw`）、工具栏 |
| views/RosterPanelEditor.tsx | 阵容编辑（左右面板、精灵搜索、快速填充） |
| views/HistoryLineupEntryModal.tsx | 比赛管理「录入阵容」弹窗（为待开始小局录入双方阵容） |
| views/MatchLineupDetailModal.tsx | 系列赛「阵容详情」弹窗（晋级图/波次卡片入口；逐局只读阵容 + 仅当前小局放开录入） |
| views/StatsView.tsx | 数据统计视图（使用率/胜率排行、属性分布、各系列赛阶段趋势；系列赛 / 标签 / 选手筛选） |
| views/TournamentLineupExportModal.tsx | 系列赛「导出阵容模板」弹窗（范围过滤 → 一场两行 .xlsx，精灵列带下拉） |
| views/TournamentLineupImportModal.tsx | 系列赛「导入阵容」弹窗（.xlsx/CSV/TSV/JSON → 预览消歧 → 批量写入） |
| views/MatchLineupEntryCard.tsx | 比赛管理顶部「阵容录入」入口卡（复用上面两个系列赛弹窗，单场录入仍在表格展开行） |
| components/CardGuideDrawer.tsx | 「本页怎么用」抽屉（顶栏唯一说明入口：当前视图的步骤清单 + 开模拟会话 / 悬浮窗练习），内容取自 lib/guide 的视图注册表 |
| demo/ | 「模拟会话」内核：demo-store（内存假数据 store + fetch/XHR/WebSocket 拦截）/ demo-fixtures（示例赛事种子）/ demo-session（渲染前装拦截层与横幅）/ demo-socket（假 socket） |
| components/ | SettingField、SpritePetCard、StageThumb、MatchPushCard（比赛管理推流选场卡片+弹窗）、AdvanceRankCard（比赛管理第四张卡片：晋级积分榜，选系列赛+一次性选中阶段+内联切阶段/翻页）、BracketBoard（系列赛晋级图）、TournamentNodeCard（系列赛对局卡片，晋级图与波次列表共用）、CurrentMatchPanel（「当前比赛」面板，赛事面板与系列赛 Drawer 共用）等小组件 |
| lib/ | format、guide（「本页怎么用」的每视图步骤注册表 `VIEW_GUIDES` + localStorage `guide:roco-pvp:v1:visits`）、socket（socket 连接工厂：模拟会话走假连接）、history、last-tournament（系列赛「上次操作」本地记忆）、lineup-sheet（系列赛阵容表：模板计划与回填解析）、lineup-template-xlsx（xlsx 模板渲染：隐藏「精灵列表」+ 跨表下拉）、match-actions（对局卡片动作可用性判据）、live、match、panel、preview、request、sprite、stats 通用逻辑 |
| constants.ts / types.ts | 管理后台本地常量与类型 |
| env.d.ts | `*.svg?raw` 模块类型声明（导航图标字符串引入） |
| styles.css | 管理后台样式 |

### 前端脚本（src/scripts，原生 JS）

| 文件路径 | 说明 |
|---------|------|
| overlay.js | 推流页面1（Overlay 比分栏）脚本 |
| lineup-display.js | 推流页面2（全局阵容展示）脚本 |
| page3-display.js | 推流页面3（头像比分阵容）脚本 |
| page4-display.js | 推流页面4（MVP 结算画面）脚本（按 pet_id 索引 webm/头像，增量渲染最多 6 个精灵项与标签、MVP 角标） |
| page5-display.js | 登场/胜率排行页（page5）脚本 |
| page6-display.js | 比赛结果页（page6）脚本（薄封装：调用共享 match-prediction.js，defaultTitle「比赛结果」） |
| page7-display.js | 战绩详情页（page7）脚本（多场比赛逐行滚动展示） |
| page8-display.js | 比赛预告页（page8）脚本（薄封装：调用共享 match-prediction.js，标题留空隐藏） |
| match-prediction.js | page6/8 共享卡片画面挂载器（蓝色渐变 + 标题/副标题 + 3×3 对局卡片网格 + 场序信息行，数据 GET /api/pageN，签名比对防闪烁） |
| page9-display.js | 团队积分榜页（page9）脚本（排名与总积分自动计算） |
| page14-display.js | 晋级积分榜页（page14）脚本（数据来自 GET /api/page14；按行数分 2/3 栏、每页最多 32 行，行元素按 playerId 增量复用不整页重写） |
| page10-display.js | 推流页面10（胜者结算画面）脚本（解析最近一个已分胜负的小局胜者） |
| page11-display.js | 选手介绍页脚本（page11-13 共用，`?mode=left/right/versus` 区分画面） |
| countdown-overlay.js | 倒计时插件脚本（叠加在推流载体页顶部，GET /api/countdown + serverNow 校准） |
| stage-carrier.js | 推流载体页（index.html）脚本，按 stage 配置加载对应页面（page11-13 映射同一页面文件的不同 mode）；iframe 加载完成后 postMessage 通知页面播放入场动效 |
| stage-enter.js | 推流页面入场动效控制脚本（配合 styles/stage-enter.css）：收载体 stage-enter 消息（或 onload 兜底）后加 is-stage-entered 并派发 stage-enter 事件，触发 .fx-enter 区块上浮淡入（fadeUp，内联 --fx-delay 控制延迟）；started 标志保证每页只播一次 |
| float.js | 桌面阵容悬浮窗脚本 |
| float-menu.js | 更换精灵菜单脚本 |
| float-nextgame.js | 「下场对局」选择菜单脚本（列出待开始比赛、搜索、选中后 /api/nextgame/show） |
| float-guide-demo.js | 悬浮窗操作练习页脚本（纯仿真：假数据 + 页内状态，不连 socket、不调 /api/panels、不写 localStorage） |

### 页面模板（src/pages）

| 文件路径 | 说明 |
|---------|------|
| index.html | 推流载体页（加载 stage 配置对应页面；切换时播全屏过渡 blinds/wolf，新页面加载完成后通知入场动效） |
| roco-pvp-page1.html | 推流页面1（Overlay 比分栏） |
| roco-pvp-page2.html | 推流页面2（全局阵容展示） |
| roco-pvp-page3.html | 推流页面3（头像比分阵容） |
| roco-pvp-page4.html | 推流页面4（MVP 结算画面，公开免鉴权，由后台「结算画面」切屏控制） |
| roco-pvp-page5.html | 登场/胜率排行页 |
| roco-pvp-page6.html | 比赛结果展示页 |
| roco-pvp-page7.html | 战绩详情展示页（直播推流可选画面） |
| roco-pvp-page8.html | 比赛预告展示页（公开免鉴权，不进直播推流可选画面） |
| roco-pvp-page9.html | 团队积分榜展示页（直播推流可选画面） |
| roco-pvp-page14.html | 晋级积分榜展示页（直播推流可选画面；只统计系列赛赛果，按阶段切换，每页最多 32 行由后台翻页） |
| roco-pvp-page10.html | 推流页面10（胜者结算画面，直播推流可选画面） |
| roco-pvp-page11.html | 选手介绍页（page11-13 共用，`?mode=left/right/versus` 区分三种画面） |
| float.html | 桌面阵容悬浮窗 |
| float-menu.html | 更换精灵菜单 |
| float-nextgame.html | 「下场对局」选择菜单（300×320 popup，float.js 打开） |
| float-guide-demo.html | 悬浮窗操作练习页（新手引导内嵌 iframe；公开免鉴权，不进推流画面注册点） |
| match-result.html | 赛后战绩展示（当前无路由与引用，未接线） |
| admin-antd.html | 管理后台入口（Vite 构建产物，位于 dist/） |
| admin-guide-demo.html | 「模拟会话」入口（同一份后台 bundle 的另一个入口，URL 带 ?demo / ?view 时进假数据模式；供卡片帮助内嵌 iframe） |
| login.html | 登录页入口（Vite 构建产物，位于 dist/） |
