# 前端组件结构

## admin-antd（管理后台，React + Ant Design）

### 目录结构

- App.tsx — 主组件：Layout（Header/Sider/Content）、视图分发、工具栏按钮（阵容悬浮窗/打开预览/复制链接/刷新）、「开一局」创建赛事弹窗（选手名/排位排名/头像/赛制/标签）
- views/ — 各视图独立页面（RosterPanelEditor、Page4PanelEditor、Page4DeathPanel、StatsView、HistoryLineupEntryModal）
- components/ — 可复用小组件（Page4SlotVisual、SettingField、SpritePetCard、StageThumb、AttributeFilterChips）
- lib/ — 无状态纯函数（请求、统计、格式化等）
- constants.ts / types.ts — 本地常量与类型
- env.d.ts — `*.svg?raw` 模块声明（导航图标按原样字符串引入）

### 导航栏 / 顶部栏（App.tsx + styles.css）

- Sider 可收缩（`siderCollapsed`，展开 232px / 收起 64px，antd collapsible + trigger={null}，底部「收起导航/⇉」按钮）；收起后 Menu 仅显示图标，品牌区仅居中 logo。
- 图标：`src/assets/ui/*.svg` 经 `?raw` 引入到 `NAV_ICONS`（NavIconName → raw），`NavIcon` 组件把 `fill="black"` 替换为 `fill="currentColor"` 随文字/选中态配色（正则替换用 useMemo 缓存）；展开态图标与文字间距 8px（styles.css `.nav-icon` margin-right，收起态归零居中）。
- 品牌区：`logo.svg?raw`（左）+ 两行字（右）：`ROCO PVP LINEUP`（常规字重 #3d3d3d）/ `洛克王国世界阵容同步推流`（淡色 #999）。
- 顶栏 `admin-header`：单行显示当前导航名（共享 `VIEW_LABEL` 映射，与导航菜单 label 同源），右侧按钮区（阵容悬浮窗/打开当前预览/复制预览链接/刷新全部数据）。
- 行为注意：`menuItems` 的 `useMemo` 必须位于任何条件 return 之前（React Hooks 顺序约束，否则 loading 切换时抛 #310 白屏）。

### 视图页面（ViewKey）

- roster - 阵容编辑（RosterPanelEditor，单卡片合并编辑器）
  - 左右槽位并排（2×3 镜像布局）+ 左右双列快速填充（各带高亮「快速填充」/「选中清除」/「清除全部」与候选精灵）+ 共享精灵选择（一份属性/形态筛选与搜索，Segmented「点击精灵填入 左侧/右侧」决定目标侧，点槽位同样会切换目标侧）。
  - 保存全部自动：600ms 防抖静默 POST /api/panels/:side（无手动保存按钮，头部仅显「保存中」标签）；精灵筛选为全局面板单份状态（spriteFilter），搜索为共享 rosterSearch（useDeferredValue 防抖）；page4 仅显阵容视图仍是左右独立面板与筛选。
  - 顶部「当前比赛」表单含左右选手名 + 排位排名（仅数字，PATCH 保存比赛信息时一并提交）。
  - 「比赛列表」卡片头部「快速创建比赛」弹窗：参赛选手在固定高度可滚动列表区逐条点选，列表按录入添加时间升序（档案 id 内嵌 base36 创建时间戳，数组顺序被打乱时仍按真实添加时间排，id 解析失败的按原数组顺序兜底在末尾）；顶部搜索框按名字实时过滤并派生勾选态，所选人数实时显示、奇数红字告警；再选「比赛赛制」与「赛事标签」，确认后 Fisher–Yates 随机洗牌 + 两两配对逐一 `POST /api/matches` 创建（公平起见随机分配，杜绝固定对阵），复用选手名字与排位排名；创建与「开一局」共用前端统一入口 `postCreateMatch`。
  - 「当前比赛」操作面板「开始本次对局」旁有「战队修改」按钮：创建时未选战队后续补填，PATCH `/api/matches/:id` 更新（联想录入战队复用 id 或手动输入）。
  - 小结局时编辑器数据源为赛事草稿（getPendingDraftContext + 草稿回填 effect，按 matchId|gameNumber 去重）；全局面板仅供推流页、不覆写编辑器（syncPanelFromApi pending 感知），推流页不显示未开局阵容。
  - 「筛选精灵」属性 chips 为共享组件 AttributeFilterChips（components/，赛事面板与本页「录入阵容」弹窗共用，改一处即两处同步）：图标 + 属性文案，chip 上 `container-type: inline-size` + `@container (max-width: 52px)` 在宽度不足时隐藏 `.attribute-filter-text` 退化为纯图标（title/aria-label 保留悬浮提示）。精灵形态 chips 为共享组件 FormFilterChips（同上共用），样式经 `.form-filter-chip` 对齐属性 chips（26px 高 / 10px 圆角 / 11px 字号，无图标；page4 面板编辑器直接用该类，改样式三处同时生效）。
- profiles - 信息录入（选手/战队档案，单卡片 + Segmented 切换选手/战队视图）
  - 「导入JSON」+「下载示例」：前端 JSON.parse 校验为数组并预览中文列名确认，导入白名单字段 name/rank/declaration/pets（后端再白名单校验兜底）；未命中 pets.json 的常用精灵走 review 兜底弹窗，逐条下拉（可搜索）选最多 5 个候选或忽略。
  - 「批量头像」：隐藏 file input 多选图片后先本地按文件名（去扩展名）匹配已录入选手，弹出「原头像 vs 新头像」左右对比预览（未设置显示默认占位图，未匹配文件警告列出且不上传），点确认才提交 `POST /api/upload/player-avatars/batch`；文件名列表随表单 `names` 字段以 JSON 传递规避 multipart 中文乱码；后端未命中/失败弹结果窗提醒。
  - 批量删除：选手/战队表格均带 `rowSelection` 复选框，「删除所选（N）」一键删除（确认弹窗列出名称清单，删除时按钮 loading 并禁用复选框）。
  - 新增/编辑选手弹窗「常用精灵」：固定两列网格——按 displayName 去重显示精灵头像（iconUrl 缺省回退立绘）+ 名字卡片点选，上限 6 个，顶部搜索框实时过滤，`Form.useWatch('pets')` 双向绑定、打开弹窗时按原 pets 拆分回显。
- stage - 直播推流（卡片式设置）
  - 推流页面5-精灵出场胜率-统计口径（page5Player/page5Tag 过滤）；推流页面3设置（精灵图片来源 sprite/thumbnail、排位图标开关、战队标识开关）。
  - 倒计时插件（时长/主题/显隐，走 `/api/countdown`）；下场对局（选择待开始比赛 + 停留时长，page3 的下场对局展示）。
  - 画面切换行为（过渡效果 none/blinds/wolf；page10 胜者结算自动切入与停留时长 page10Duration）。
  - 推流页面2设置（赛事标题/阵容展示）、推流页面6标题与背景、推流页面7标题文本（主标题/温馨提示）、选手介绍显示（page11-13 排位 div 开关 page11RankVisible）、团队积分榜设置（page9）、底部「显示设置」（推流页5标题、比分字号）。
- page11 - 选手介绍（画面切换 left/right/versus；「选手介绍数据」按侧配置来源 manual/match，手动填写字段留空回退「信息录入」按名字匹配值）
- live - 实时控制（比赛开始、胜负记录、撤销/恢复）
- history - 比赛历史（列表、删除、批量删除、撤销删除；「推送」勾选列→页面6、「预告」勾选列→页面8、「对局」勾选列配合「推送对局推送」按钮→页面7，可勾选待开始与进行中的对局；「录入阵容」弹窗 HistoryLineupEntryModal 为待开始小局录入双方阵容）
- stats - 数据统计（StatsView：使用率/上场率排行、属性分布、标签趋势；1920px 断点布局）
- preview - 页面预览（推流页面1-13 切换，`PREVIEW_PAGES` 定义于 constants.ts；页面8 附带「比赛预告设置」：主标题/副标题、壁纸图片1/图片2/自定义上传）
- page4 - 仅显阵容（Page4PanelEditor + Page4DeathPanel）
- about - 关于项目（项目链接、作者与许可、字体说明、数据来源）

### 核心状态（App.tsx）

- leftPanel / rightPanel、page4、scoreboard、matches、avatars、stage、page7 / page9 / page11（配置状态与对应草稿/保存中标记）
- stats 相关：statsRange / statsMetric / statsPlayer / statsTag / statsSearch
- socket - Socket.IO 连接实例

### 核心逻辑（lib/）

- request.ts - fetch 封装
- sprite.ts - 精灵数据辅助（buildSpriteLookup：id/文件名/别名多键查找）
- match.ts - 比赛操作辅助（getPendingDraftContext：当前小局 pending 且赛事未完赛时返回该局草稿槽位上下文）
- panel.ts - 面板状态辅助（draftSlotsToSelected：赛事草稿快照 pet_id → 编辑器槽位，查不到的精灵降级空槽位）
- live.ts - 实时控制辅助
- history.ts - 历史记录辅助（getLineupEntryBlockReason：录入阵容入口锁定文案）
- stats.ts - 统计聚合（buildUsageStats、buildStatsCsv）
- format.ts - 格式化工具
- preview.ts - 预览链接构建

### 小组件（components/）

- Page4SlotVisual.tsx - page4 格子视觉
- SettingField.tsx - 设置项字段封装
- SpritePetCard.tsx - 精灵卡片
- StageThumb.tsx - 推流页面缩略图

## login-antd（登录页面）

### 核心功能

- 用户登录表单（用户名、密码）
- 登录状态检查
- 登录成功后跳转至管理后台

## 推流/展示页面（原生 JS，src/pages + src/scripts + src/styles）

> 渲染约束：所有页面的数据刷新都必须增量更新——只改发生变化的节点/区域，禁止整页 innerHTML 重写或全量重渲染，避免画面闪烁。

- index.html + stage-carrier.js — 推流载体，按 stage 配置用 iframe 加载对应页面；page11/12/13 共用 `/roco-pvp-page11.html?mode=left/right/versus`（INTRO_FAMILY 映射）
- roco-pvp-page1.html + overlay.js — Overlay 比分栏
- roco-pvp-page2.html + lineup-display.js — 全局阵容展示
- roco-pvp-page3.html + page3-display.js — 头像比分阵容
  - 比分栏中央两侧排位排名图标（stage.page3RankVisible 控制显隐，开启但未输入排名时仅显示图标；排名超过 10000 显示 10000+，txt 位置按位数查表）
  - 战队标识 div（stage.page3TeamVisible 控制显隐）：左右各一（左 x257 y958 / 右 x1569 y958），94×94 圆角 18，外描边 2px C9C9C9（box-shadow），底部 24px 高 F2ECDF 色块叠加战队名称（MiSans-Semibold 15px #585858，`buildTeamNameImage` 用 canvas 渲染 PNG 缓存规避字体兼容问题）；logo 优先按 teamId 匹配录入战队，未录入仅显示名称色块
- roco-pvp-page4.html + page4-display.js — 仅显阵容
- roco-pvp-page5.html + page5-display.js — 登场/胜率排行
- roco-pvp-page6.html + page6-display.js — 比赛结果页（已结束比赛的结果展示）
- roco-pvp-page7.html + page7-display.js — 对局推送页（比赛历史勾选已结束比赛推送；多场比赛逐行滚动展示选手对局信息；主标题/温馨提示在「直播推流」设置，留空用默认值）
- roco-pvp-page8.html + page8-display.js — 比赛预告页（公开免鉴权，Match-Preview.jpg 背景板；主标题 YouSheBiaoTiHei 128 白色，最多 4 条比赛信息卡 1784×130（左右选手信息 div 820×130 背景 authorize-completed-.png：头像 84×84 + 选手名 64 白色居中 + 排位排名图标（复用 page3 rank 样式），中央 vs 72 黑色），支持 image/image-2/custom 背景切换）
- roco-pvp-page9.html + page9-display.js — 团队积分榜页（奶白卡片 + 金黄描边字 + 底部波浪装饰图 page9-back-1.png；标题后台可改留空用「团队积分榜」；战队名称与 R1/R2/R3 积分后台录入，留空显示「-」；按三轮总分降序自动排名与总积分，同分保持录入顺序；名称与积分全空的行不展示；行高/字号按战队数量自适应）
- roco-pvp-page10.html + page10-display.js — 胜者结算画面（数据 `GET /api/page10`：当前活跃比赛 + 双方头像，页面自行解析最近一个已分胜负的小局胜者；胜负登记后由 socket-server 自动切入并按时长切回）
- roco-pvp-page11.html + page11-display.js — 选手介绍页（page11-13 共用，`?mode=left/right/versus` 区分画面；数据 `GET /api/page11`：配置 + 信息录入 + 当前赛事 + 实时阵容面板；source=manual 用手动填写内容、留空字段回退「信息录入」匹配值；page11RankVisible 控制排位排名 div 显隐，无排名自动隐藏；自带动效不接入 stage-enter）
- float.html + float.js — 桌面阵容悬浮窗（透明置顶小窗）
- float-menu.html + float-menu.js — 更换精灵菜单（形态选择 / 全新精灵选择器）
- float-nextgame.html + float-nextgame.js — 「下场对局」选择菜单（300×320 popup，由 float.js 用 window.open 打开；列出待开始比赛、支持搜索，选中后走 `/api/nextgame/show` 保存并展示）
- countdown-overlay.js — 倒计时插件（叠加在推流载体页顶部；数据 `GET /api/countdown`：state + serverNow 校准时钟偏差；visible=false 播退场动效后隐藏）
