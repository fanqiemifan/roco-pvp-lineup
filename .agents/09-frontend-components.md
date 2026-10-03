# 前端组件结构

## admin-antd（管理后台，React + Ant Design）

### 目录结构

- App.tsx — 主组件：Layout（Header/Sider/Content）、视图分发、顶栏按钮（阵容悬浮窗 + 倒计时 / 下一场预告 / 画面设置 三个弹窗入口）、「开一局」创建赛事弹窗（选手名/排位排名/头像/赛制/标签）
- views/ — 各视图独立页面（RosterPanelEditor、StatsView、TournamentView、HistoryLineupEntryModal、MatchLineupDetailModal）
- components/ — 可复用小组件（SettingField、SpritePetCard、StageThumb、AttributeFilterChips、BracketBoard、TournamentNodeCard）
- lib/ — 无状态纯函数（请求、统计、格式化等）
- constants.ts / types.ts — 本地常量与类型
- env.d.ts — `*.svg?raw` 模块声明（导航图标按原样字符串引入）

### 导航栏 / 顶部栏（App.tsx + styles.css）

- Sider 可收缩（`siderCollapsed`，展开 232px / 收起 64px，antd collapsible + trigger={null}，底部「收起导航/⇉」按钮）；收起后 Menu 仅显示图标，品牌区仅居中 logo。
- 图标：`src/assets/ui/*.svg` 经 `?raw` 引入到 `NAV_ICONS`（NavIconName → raw），`NavIcon` 组件把 `fill="black"` 替换为 `fill="currentColor"` 随文字/选中态配色（正则替换用 useMemo 缓存）；展开态图标与文字间距 8px（styles.css `.nav-icon` margin-right，收起态归零居中）。
- 品牌区：`logo.svg?raw`（左）+ 两行字（右）：`ROCO PVP LINEUP`（常规字重 #3d3d3d）/ `洛克王国世界阵容同步推流`（淡色 #999）。
- 顶栏 `admin-header`：单行显示当前导航名（共享 `VIEW_LABEL` 映射，与导航菜单 label 同源），右侧按钮区（阵容悬浮窗/镜像反转/倒计时/下一场预告/画面设置；镜像反转是展示层开关按钮，开启时高亮并显示「镜像中」；后三个打开弹窗，弹窗内容见 stage 条目）。**2026-10 变更**：原「打开当前预览 / 复制预览链接 / 刷新全部数据」已移除——按页预览与复制走「页面预览」视图，打开/复制**推流地址**是「直播推流」卡片右上的两个按钮（顶栏不再重复）；数据本就由 socket 实时刷新，删掉手动刷新入口。
- 行为注意：`menuItems` 的 `useMemo` 必须位于任何条件 return 之前（React Hooks 顺序约束，否则 loading 切换时抛 #310 白屏）。

### 视图页面（ViewKey）

- roster - 阵容编辑（RosterPanelEditor，单卡片合并编辑器）
  - 左右槽位并排（2×3 镜像布局）+ 左右双列快速填充（各带高亮「快速填充」/「选中清除」/「清除全部」与候选精灵）+ 共享精灵选择（一份属性/形态筛选与搜索，Segmented「点击精灵填入 左侧/右侧」决定目标侧，点槽位同样会切换目标侧）。
  - 保存全部自动：600ms 防抖静默 POST /api/panels/:side（无手动保存按钮，头部仅显「保存中」标签）；精灵筛选为全局面板单份状态（spriteFilter），搜索为共享 rosterSearch（useDeferredValue 防抖）。
  - 顶部「当前比赛」表单含左右选手名 + 排位排名（仅数字，PATCH 保存比赛信息时一并提交）。**系列赛对局锁字段**：当前比赛带 tournamentRef 且该系列赛仍可见（非墓碑 / 非本机移除）时，左右选手名与「比赛赛制」置灰只读并在表单下方给一行说明（改名去「信息录入」、改赛制去阶段规则），战队与排位排名仍可保存；判定 `activeMatchTournamentLocked` 取自 `tournamentRecordMap`，与后端 PATCH 守卫同口径——选手名是系列赛写回的比对依据（改了登记胜负会被拒），赛制改小会让比赛按已有比分直接完赛却不写回系列赛。原样回填这三个字段会通过守卫（保存战队 / 排名时表单会一并带上），不必特判。这张「当前比赛」面板已抽成共享组件 `CurrentMatchPanel`：赛事面板（variant='inline'，本视图）与系列比赛卡片 Drawer（variant='drawer'）两处复用，本视图行为与外观保持不变；Drawer 侧细节见「tournament」条目。
  - 「比赛列表」卡片头部「快速创建比赛」弹窗：参赛选手在固定高度可滚动列表区逐条点选，列表按录入添加时间升序（档案 id 内嵌 base36 创建时间戳，数组顺序被打乱时仍按真实添加时间排，id 解析失败的按原数组顺序兜底在末尾）；顶部搜索框按名字实时过滤并派生勾选态，所选人数实时显示、奇数红字告警；再选「比赛赛制」与「标签」（自由标签，不再承载赛事身份），确认后 Fisher–Yates 随机洗牌 + 两两配对逐一 `POST /api/matches` 创建（公平起见随机分配，杜绝固定对阵），复用选手名字与排位排名；创建与「开一局」共用前端统一入口 `postCreateMatch`。
  - 「当前比赛」操作面板「开始本次对局」旁有「战队修改」按钮：创建时未选战队后续补填，PATCH `/api/matches/:id` 更新（联想录入战队复用 id 或手动输入）。
  - 建场头像（「开一局」弹窗）：从录入档案联想选人（`reusePlayerProfile`）**只设档案头像预览、不再复制一份赛事头像** —— 复制件会变成「赛事覆盖」，永久压住档案头像，之后在「信息录入」换头像这场比赛不跟着变；想让本场用别的头像走「选择头像」单独上传（那才会写 `cache/avatars/{matchId}` 赛事覆盖），留空则由服务端统一解析兜底档案头像。
  - 小结局时编辑器数据源为赛事草稿（getPendingDraftContext + 草稿回填 effect，按 matchId|gameNumber 去重）；全局面板仅供推流页、不覆写编辑器（syncPanelFromApi pending 感知），推流页不显示未开局阵容。
  - 「筛选精灵」属性 chips 为共享组件 AttributeFilterChips（components/，赛事面板与本页「录入阵容」弹窗共用，改一处即两处同步）：图标 + 属性文案，chip 上 `container-type: inline-size` + `@container (max-width: 52px)` 在宽度不足时隐藏 `.attribute-filter-text` 退化为纯图标（title/aria-label 保留悬浮提示）。精灵形态 chips 为共享组件 FormFilterChips（同上共用），样式经 `.form-filter-chip` 对齐属性 chips（26px 高 / 10px 圆角 / 11px 字号，无图标），改样式即两处同时生效）。
- profiles - 信息录入（选手/战队档案，单卡片 + Segmented 切换选手/战队视图）
  - 「导入JSON」+「下载示例」：前端 JSON.parse 校验为数组并预览中文列名确认，导入白名单字段 name/rank/declaration/pets（后端再白名单校验兜底）；未命中 pets.json 的常用精灵走 review 兜底弹窗，逐条下拉（可搜索）选最多 5 个候选或忽略。
  - 「批量头像」：隐藏 file input 多选图片后先本地按文件名（去扩展名）匹配已录入选手，弹出「原头像 vs 新头像」左右对比预览（未设置显示默认占位图，未匹配文件警告列出且不上传），点确认才提交 `POST /api/upload/player-avatars/batch`；文件名列表随表单 `names` 字段以 JSON 传递规避 multipart 中文乱码；后端未命中/失败弹结果窗提醒。
  - 批量删除：选手/战队表格均带 `rowSelection` 复选框，「删除所选（N）」一键删除（确认弹窗列出名称清单，删除时按钮 loading 并禁用复选框）。
  - 新增/编辑选手弹窗「常用精灵」：固定两列网格——按 displayName 去重显示精灵头像（iconUrl 缺省回退立绘）+ 名字卡片点选，上限 6 个，顶部搜索框实时过滤，`Form.useWatch('pets')` 双向绑定、打开弹窗时按原 pets 拆分回显。
- stage - 直播推流（**2026-10 起精简为「画面切换 + 团队积分榜」**，设置项全部移出本页）：OBS 固定捕获根路径 `/`；主体 = STAGE_OPTIONS 画面卡片网格（点击即 `saveStage` 切画面、当前画面绿标）；卡片右上保留「打开推流页面 / 复制推流页地址」两个按钮。**卡片标题为语意化名称**（阵容展示1/2/3、MVP结算展示、精灵出场胜率、比赛结果展示、战绩详情、比赛预告展示、团队赛积分展示、胜者结算画面、系列赛晋级积分榜；页面11-13 沿用「选手介绍-左侧/右侧/对战页」）——label 只用于展示（卡片标题、缩略图水印、切画面提示文案），**页面身份一律以 value（page1-overlay/page2/…）为准**，别拿 label 当 key 或反查页面。
  - 顶栏弹窗「倒计时」：时长/主题/显隐操作，走 `/api/countdown`（原「倒计时插件」卡片）。
  - 顶栏弹窗「下一场预告」：选择待开始比赛 + 停留时长（page3 下场对局展示；原「下场对局」卡片，仅入口名改为「下一场预告」，按钮仍叫「显示下场对局」）。
  - 顶栏弹窗「画面设置」（一个弹窗内 Tabs 四组）：推流页面2设置（赛事标题/阵容展示）；推流页面3设置（精灵图片来源 sprite/thumbnail、排位图标开关、战队标识开关、红光特效：关闭/自动开启 + 「立即显示」一次性触发）；选手介绍显示（page11-13 排位开关 page11RankVisible）；画面切换行为（过渡效果 none/blinds/wolf；胜者结算自动切入与停留时长 page10Duration；**战绩详情切屏间隔 page7SwitchSeconds，秒、默认 10**）。全部即时保存生效。
  - 顶栏「镜像反转」（stage.mirrorSides，导播切视角用）：**仅页面1-3 主画面的左右展示互换**——三个脚本渲染时按「视图侧 → 数据侧」映射（各自实现 `mapSide`：overlay.js / lineup-display.js / page3-display.js），page1/page2 为此新增 stage:update 订阅与启动时 GET /api/stage；**不改数据、胜负登记、头像解析与统计口径**，下场对局浮层 / 悬浮窗 / 结算页保持真实左右。**禁止用 CSS 翻转整页实现（立绘与文字会倒置）**；切换时清空渲染签名并按新映射增量重渲染（避免整页重载闪烁）。
  - 「推流页面5-统计口径」移入「数据统计」视图（见 stats 条目）；「团队积分榜设置（page9）」因批量录入 + 保存按钮保留在本页。
- page11 - 选手介绍（画面切换 left/right/versus；「选手介绍数据」按侧配置来源 manual/match，手动填写字段留空回退「信息录入」按名字匹配值）
- live - 实时控制（比赛开始、胜负记录、撤销/恢复）
- mvp - 结算画面（MVP 结算 / 推流页面4；导航图标 结算页面.svg）
  - 载入胜方：`载入当前对局胜方` 把当前对局「最近一个已分胜负小局」胜者一侧（lib/match.ts `getRecentWinnerLineup`，优先槽位快照 pet_id、回退小局阵容）的**选手名字+阵容快照**一并保存进 mvp.json（winner: matchId/side/playerName）；**只收最终形态精灵**（`sprite.isFinalForm`），胜者阵容无可用精灵时仅载入名字；保存后切换对局不会改变推流画面，需重新载入保存才更新，当前对局胜方与已载入不一致时给出提示。
  - 显示控制：`显示 MVP 结算`（POST /api/mvp/show：记录当前画面到 returnPage 并切 stage 到 page4）/ `关闭`（POST /api/mvp/hide：切回 returnPage）；状态标签显示已标记精灵 n/6、标签是否完整、是否已标记 MVP；另展示**已载入胜方头像（56 圆形，`.mvp-winner-avatar`）+ 名字 + 侧/比赛 id**（头像按快照 matchId+side 解析、带 mtime 缓存参数，未上传回退 left/right-avatar.png 占位图，数据取 GET /api/mvp 的 winner，mvp:update 用 payload、avatar:update 时重拉）；未标记 MVP 时禁用「显示」（标签可留空，不要求全部填完）。
  - 精灵项（最多 6 行）：点选当前对局胜者阵容精灵填入第一个空槽（再次点击移除），每行可填标签（预设 MVP_TAG_PRESETS + 手动输入 ≤4 字，选择即时保存、手动输入失焦/回车保存）、标记 MVP（全页互斥，最多一个）、清空；空槽位不可编辑。
  - 草稿同步：服务端 mvp.slots 变化时按内容比较回填（一致则保持原引用，避免编辑中标签被覆盖）。
- **比赛管理筛选项提示**：系列赛/标签/搜索任一筛选生效时，表格上方显示一条 `historyFilterHint`「当前只看…：显示 M / 共 N 场（有 K 场被筛选条件隐藏，刚同步来的比赛可能在其中）」+「清除筛选」按钮。**为什么必须有**：系列赛对局在「只看普通对局」筛选下会被隐藏，云同步拉进来的新比赛又常是系列赛对局，没有这条提示用户会误判成「同步没成功 / 比赛丢了」。
- history - 比赛管理（列表、删除、批量删除、撤销删除；**表格分页「N 条/页」下拉走 `showSizeChanger` 传 SelectProps（antd 6 支持对象形式）：`getPopupContainer: () => document.body` + `popupMatchSelectWidth: false`**——原来布尔形式下下拉跟随很窄的触发器、又处于卡片底部，选项文字会被裁掉/看不到；筛选区分两行维度且 AND 叠加：紫色「系列赛」组 = 普通对局 + 各系列赛 🏆名称（N场），按对局首次出现顺序，只含有关联赛局的系列赛，孤儿引用（系列赛已删）归普通对局；蓝色「标签」组 = 全部/无标签/各标签（自由标签；系列赛对局在建场时不再写入身份标签，身份一律走 🏆 系列赛维）；标签单元格对系列赛对局固定前置紫色奖杯 Tag（不可随标签编辑删除，点击即按该系列赛筛选），纯函数 buildHistoryTournamentFilters/getEffectiveTournamentId 在 lib/history.ts；**推流选场不在表格内勾选**：「比赛管理」卡片之外、视图顶部的独立一行四张推流功能卡片（前三张 MatchPushCard：推送比赛结果 / 推送战绩详情 / 推送比赛预告，组件 components/MatchPushCard.tsx；**四卡等高**——任一卡片内容变高（如晋级积分榜选中阶段后展开阶段切换/翻页快捷控制）时同排一起拉伸，样式 `.match-push-card-row`），点击「选择比赛」打开选场弹窗（左候选比赛表+搜索+资格过滤：page6 仅已结束、page8 待开始/进行中、page7 任意；**候选按系列赛「阶段 + 语义轮次」分组**——纯函数 `buildPushCandidateGroups`（lib/tournament.ts）：双败=胜者组 R1/胜者组 R2/败者组 R1/败者组 R2（W2 按节点两位选手第 1 波胜负判池，与服务端 resolveTournamentLabel 及 page6 卡片标签同口径）、单败=阶段名（如「总决赛」）、普通对局与孤儿引用归「普通对局」组，组序按组内首场比赛在候选列表中的位置；分组标题行为整行合并单元格，带头部 Checkbox 可整组勾选/取消（indeterminate 半选态，勾选按组内顺序加入；page6/page8 受 9 场上限约束、**page7 不限**），样式 `.match-push-group-row`；组标题右侧显示「第 N 波 · 共 M 场」（`PushCandidateGroup.waveIndex`，只有双败阶段有值；**整组勾选 = 按阶段·波次批量选**，如 32进16 首轮 16 场一次选满）；右已选区按勾选顺序=卡片场序，可上移/下移/移除；page6/8 弹窗内另可编辑大标题、第一场开始时间与每场时间（自动时间走 shared/match-schedule 的 computeScheduleTimes；两处时间输入走 antd TimePicker（HH:mm、5 分钟步进），清空 = 回落自动值，placeholder 即自动时间；**确认推送时把整条链固化成每场的独立值**——computeScheduleTimes 结果整份写入 payload.matchTimes，推送前调场序/开始时间仍实时重排预览；固化后比赛完赛被移出选场、或增删重排都不再按列表位置重算，时间跟着比赛 id 走；要整体重排点「按开始时间重新填充」按钮（Popconfirm 确认，覆盖全部手改值）），page7 弹窗内编辑主标题与温馨提示），确认即 POST 推送，page6/page8 上限 9 场（3×3 卡片网格结构决定，别跟着 page7 放开）；**page7 不限场数**（`maxCount` 不传 = 不限，卡片标签显示「N 场」），弹窗底部用「已选 N 场 ≈ M 屏」提示规模（`countPushRows` 在 lib/history.ts 按一屏 4 行折算，属于估算，与展示页口径允许有细微出入）；**第四张卡片 AdvanceRankCard（推送晋级积分榜）与前三张共用卡片/弹窗外壳，但选择语义不同：不是逐场勾选，而是「一次性选中一个阶段」**（选中即带入该阶段全部选手的比分，页面按系列赛赛果自动统计）；卡片上带**内联快捷控制**——阶段 Segmented 与 上一页/下一页（裁判演出中不该反复开关弹窗），弹窗负责首次配置（系列赛下拉 + 阶段表格勾选 + 当前展示阶段 + 页码 + 大标题/副标题），每次打开以服务端状态初始化草稿；系列赛缺失时卡片显示「系列赛不存在或尚未同步到本机」，改一行不阻断其它三张卡；「录入阵容」弹窗 HistoryLineupEntryModal 为待开始小局录入双方阵容）；**本机移除（localOnly）的系列赛对局在比赛管理 / 推流选场 / 赛事面板快捷列表 / 下场对局下拉一并隐藏**——纯前端过滤 filterLocallyRemovedMatches（lib/history.ts），数据/统计/回传不受影响；推流选场候选池用过滤后集合、**已选与摘要解析仍走全量 store**（已推送的隐藏对局仍可排序 / 编辑场序时间并保留在推送里，别把解析池也改成过滤后的）；列表与恢复弹窗状态由 tournament:update 载荷的 locallyRemoved 刷新；预览弹窗对这类系列赛显示「已在本机移除，保持隐藏」（导入后仍隐藏，恢复走系列比赛页）；本机已删除（墓碑）的系列赛组标「本机已删除（墓碑），名单内对局将被拦截」，被名单拦截的对局标「已删名单拦截」（橙色，不再显示为新增——预览与应用同口径）
- sync - 数据同步（导航独立视图，紧跟「比赛管理」；**2026-10 从「比赛管理」最底部那张卡片搬出来**——原来要进比赛管理再滑到底才能用，且云同步待办红点只有滚到那儿才看得见）：本机标识（machineCode，1-2 位大写字母，决定新比赛/系列赛 id 形态）+ 导出同步包（勾选档案/头像）+ 导入同步包（选文件 → 预览弹窗）+ 云同步区（设置 / 状态卡 / 操作按钮，见下文「云同步」小节）。**导航项带云同步待办角标**（主控 = 待确认场次数，分控 = 待回传场次数；分控有新版本且无待办时显示小圆点；口径与卡片里的 `cloudLiveBadge` 一致，`cloudNavPending` / `cloudNavNewVersion` 必须派生在 menuItems 之前——menuItems 是 useMemo，声明在它之后的派生值取不到）。导入预览弹窗：左列表 + 右「本机 vs 包内」字段级 diff 面板，弹窗宽度跟视口自适应（宽屏更宽），左列表吃剩余宽度、右侧面板封顶；**顶部提示压成两行**（第一行选项：冲突处理模式 + 头像复选；第二行计数速览 + 一行灰色说明小字），只有需要用户动作的（冲突批量按钮、同机器码告警、空状态）才单独用 Alert——原来七八条 Alert 平铺会把表格顶出可视区；列表行内选手名与比赛 id 同行。列表按「更新 → 新增 → 跳过」排序（同级冲突优先）——**排序管到三个层级**：组内比赛行、分组标题行（按组内最靠前那行的权重，让有要处理比赛的系列赛排前面；没有比赛行的组如墓碑 / 仅编排排最后）、以及未归组的兜底行；行不动原 `matchKeys` 数组（勾选/排除仍用它），默认选中的详情项也取列表首行。冲突场次红色标记并可逐条/批量选择保留哪一边，档案项的头像/logo 变更在 diff 中显示「本机 / 包内」左右对照图；**导入摘要**额外带「系列赛 新增/更新/跳过」统计，编排机补写回推进时标注「已补写回推进」
- stats - 数据统计（StatsView：使用率/上场率排行、属性分布、各系列赛阶段趋势；筛选维度 = 选手 / 系列赛（tournamentRef 精确匹配）/ 标签（自由标签），系列赛趋势列 = 所选系列赛使用率 − 全量；趋势轴 = 阶段·语义轮次（选定系列赛时按该系列赛拆桶，未选时按阶段名跨系列赛聚合并提示配合系列赛筛选），数据由 lib/stats.ts buildStatsStageAxis / buildUsageStats；1920px 断点布局）。**2026-10 起含「推流页面5 显示设置」卡片**（从「直播推流」移入）：页面5标题（失焦保存 scoreboard.page5Title）+ 系列赛（page5TournamentId，选项来自 buildHistoryTournamentFilters；展示用系列赛名由服务端在排行响应里解析下发，改名/删除后标题与榜单口径自动一致）+ 选手（page5Player）——三项控制**推流画面5的内容**，与同页的统计筛选（只影响本页表格）**相互独立**，勿混淆
- preview - 页面预览（推流页面1-13 与页面14 切换，含页面4 MVP 结算，`PREVIEW_PAGES` 定义于 constants.ts；**注意该视图的 Segmented 选项是内联硬编码数组，新增页面要同时改 `PREVIEW_PAGES` 与这份数组**；page6/7/8 仅提示去「比赛管理」上方功能卡片选场推送，标题/时间在选场弹窗内编辑）
- tournament - 系列比赛（TournamentView：列表 + 4 步创建向导 + 详情；**双机只读副本**：非本机编排的系列赛（id 机器码 ≠ 本机 machineCode）显示蓝色「只读副本 · 机器 X 编排」标签与说明行，列表删除按钮、详情内回退/删除/抽签/开赛/配对台/锁定/弃权全部禁用（判定纯函数 getTournamentOwnerCode / isTournamentOwnedByLocal 在 lib/tournament.ts，与服务端同口径）；导航图标 系列比赛.svg；菜单顺序为 赛事面板 → 直播推流 → 系列比赛 → 结算画面…，「实时控制」移到「页面预览」之后）；**本机移除 / 恢复（分控端）**：只读副本在列表操作列与详情工具栏（readOnly 时）提供「本机移除」（Popconfirm 说明仅本机隐藏、可在「已本机移除」恢复），列表卡头「已本机移除 (n)」打开恢复弹窗（名称 / 编排机 / 移除时间 / 逐条恢复；App 层 locallyRemoved 状态由首屏拉取 + 广播刷新）；只读说明文案同步更新（旧文案「删掉也会被合并回来」已失效）；**定向同步（P1-A）**：列表操作列与详情工具栏「定向同步」→ 弹窗说明后一键导出**只含这一届**的同步包（编排 + 名下全部对局 + 该届选手档案；已删届随行墓碑=定向删除），对端在「数据同步 → 导入」照常合并（不涉及其他系列赛与普通对局）
  - 「系列赛列表」表格：名称（点击打开详情）、人数、当前位置（阶段名·波次）、已完成/已建场次、状态标签、操作（打开详情 + 红色「删除」）；头部「＋ 创建系列赛」开导向导。删除走统一确认弹窗（summarizeTournamentMatches 给出关联对局总数与已完成/进行中/未开始分布）：默认仅删编排记录、对局保留转普通；勾选「同时删除 N 场对局」则连对局删除（比赛管理可撤回最近删除），DELETE /api/tournaments/:id。
  - **详情默认打开「上次操作」的那个系列赛**（不是列表第一条）：打开详情 / 向导创建完成的 id 由 lib/last-tournament.ts 记进 localStorage，本视图切走再切回（组件卸载重建）或刷新后仍回到它；没有记录、或记录的系列赛已不存在（被删除 / 本机没有该同步记录）时回退列表第一条；删除的正是记忆里那个时一并清除记录。
  - 创建向导 4 步：①名称 → ②选手勾选（搜索 + 固定高度滚动 Checkbox 列表，实时校验人数 ∈ 4/8/16/32）→ ③阶段规则可编辑表（阶段名/双败单败分段/BO1·BO3·BO5·BO7/配对方式/避重复/需确认；人数变化时重填 buildDefaultStages 默认模板；**只剩 2 人的阶段（总决赛）的「双败」选项 disabled**，表格 footer 说明「固定为单败」——`isFinalStage(playerCount, index)` 与后端判据一致；表格下方另有**「季军赛」一行**：Segmented「不安排 / BO1 / BO3 / BO5 / BO7」（默认 BO3），选定值随创建请求下发 `thirdPlaceBestOf`，选「不安排」（0）则该届不建季军赛）点「创建草稿」POST → ④抽签与首波对阵面板（seed + 配对基准顺序标签流 + **首波对阵预览**——按当前 seed 走 `GET /api/tournaments/:id/opening-wave` 只读生成、不建场，随 `seed/drawVersion` 变化自动刷新；「重新抽签」/「确认开赛」；开赛后提示已生成第 1 波）。setup 记录可随时在列表「继续配置」。
  - 详情：阶段进度 Steps（finish/process/wait）+ setup 时复用抽签面板 + 视图切换 Segmented「晋级图 / 波次列表」（**默认晋级图**，仅非 setup 显示；setup 固定走抽签面板）。波次列表视图：波次卡片（最新在前）：draft → 配对确认台；locked → 节点卡片网格，卡片由 **TournamentNodeCard** 渲染（与晋级图同一组件，内容与色调完全一致）。波次标题以「第 N 波」为主标题（保留原有表述；**季军赛波次改显示「季军赛」+ `单败 · BO{thirdPlaceBestOf}`，不写「第 N 波」，配对方式 Tag 也退化为「自动建场」**），其后追加标注：轮次名（`getWaveRoundLabels`，双败 W1 = `胜者组 R1`、W2 = `败者组 R1 / 胜者组 R2`、W3 = `败者组 R2`，单败阶段为空）+ `阶段名 · 双败/单败` Tag + `配对方式 · 配对草稿/已锁定` Tag（配对方式用 `getPairingLabel`：随机配对/手动配对/每轮随机/沿对阵树）+ 波状态 Tag。头部 Popconfirm「回退上一波」与红色「删除系列赛」（复用列表的删除确认弹窗）；冠军结果区显示冠/亚军标签，**季军赛分出胜负后追加「🥉 季军」**——名次直接读季军赛波次的节点胜者（`findThirdPlaceWave`），季军赛可能早于总决赛打完，所以不读 `record.result`。
  - 晋级图（BracketBoard，components/）：**按阶段分组区块** —— 同一阶段的列（双败按桶拆出的胜者组/败者组列）包进一个淡色底 + 边框的 `.bracket-stage-group`，相邻阶段按 `stageIndex % 5` 轮换底色（`.bracket-stage-group-0..4` 用 CSS 变量给底色/边框/序号圆标取色），区块横幅 = 序号圆标 + 阶段名 + 赛制·BO + 阶段状态 Tag（已完成/进行中/未开始，走 `getStageState`）；**季军赛自成一个区块**（横幅只写「季军赛 + 自己的 BO」，不带序号圆标与阶段状态 Tag，避免套用半决赛的阶段名与赛制），列体按 `BracketColumn.isThirdPlace` 分列、卡片脚注给「季军 / 殿军」而不是阶段战绩（`getThirdPlaceRankText`，否则按阶段口径会把季军算成「已晋级」）。**双败按战绩桶拆列**（同一波的 1-0 / 0-1 拆成两列），列序 胜者组 R1 → 败者组 R1 → 胜者组 R2 → 败者组 R2，**单败一阶段一列**，横向可滚动。列头只显示轮次标签（决胜列附晋级人数 `败者组 R2 · 决出4强`；**单败列无轮次细分 → 标题留空（`BracketColumn.label` 空串），阶段名不再逐列重复、由分组横幅承载**）+ 波状态。列内每个节点一张卡片（状态 Tag、「跨桶」Tag、节点 id、双方槽位行、复用「进入管理」与「弃权判负」）。**槽位样式参照 bracket-reference**：整行左侧 3px 状态色条 + 名称省略号（title 完整名）+ 战绩脚注 + 右侧比分块；`.bracket-row-won`/`.bracket-row-lost`/`.bracket-row-tbd` 三态区分胜/负/待定（**败者行无删除线**，配色见 CSS）。**列间晋级连线由 buildBracketGraph 推导的槽位关系（上一次出战赢=胜者实线 / 输=败者虚线，首轮登场无连线；配色见 CSS）经 getBoundingClientRect 量测后画正交折线 SVG**（量测取**内容坐标系**：视口坐标 + `scrollLeft/scrollTop`，否则横向滚动状态下重算会整体偏移一个 scrollLeft），布局变化由 ResizeObserver 重算，并在首帧后补两帧 + `document.fonts.ready` 各再量一次（卡片 Tag/换行/字体加载会让高度在首帧后才稳定，而 RO 只对尺寸变化生效）。**连线默认全部隐藏，点击卡片才显示相关链路、分两档：点选手槽位行（`.bracket-row` 的 `data-side`，该侧有选手时）= 单人链路——上游只沿该选手出场链递归（在上游卡片里按 playerId 定位其所在侧），下游在卡片已分出胜负时按来源侧（连线 key 的 `#fromSide`）过滤，未决卡片显示全部出发线（两条本就代表两名选手各自的可能去向）；点卡片其他区域（`.bracket-card-hitbox` 内、非按钮）= 整场链路（上游两侧合并 + 下游一场，原行为）。选中行加 `.bracket-row-active` 高亮、卡片加 `.bracket-card-active`、相关节点集合（activeEdges 两端 + 选中节点）之外的卡片加 `.bracket-card-dimmed`（opacity .4）压暗但保持可点击，同一目标再点一次或点空白取消**；**各阶段区块等高、区块内各列等高、列体 `justify-content: space-around`，卡片按数量均匀分布形成扇形/三角趋势（不再全部顶部对齐）**；**超宽时由 `.bracket-board-scroller` 在卡片内部横向滚动**（`.admin-content > * { min-width: 0 }` + `.bracket-board { min-width: 0; max-width: 100% }` 防 grid 子项被 max-content 撑开页面）。**按住鼠标拖动可平移视图**（pointerdown/move/up 改 `scrollLeft/scrollTop`；位移 < 4px 仍按点击处理，越过阈值才 `setPointerCapture` 以免捕获把 click 重定向导致卡片选不中；拖动结束的 click 被 `suppressClickRef` 吞掉不影响选中；拖动中容器加 `.is-dragging` 换 grabbing 光标并禁选文本）。draft 波渲染为只读候选配对 + 提示去波次列表完成配对确认。数据源纯函数 buildBracketGraph 在 lib/tournament.ts（跳过 setup 无波次 → Empty 占位；节点所属桶与槽位战绩脚注都由「按波次顺序累计的阶段内战绩」推导，跨桶配对取左位战绩入列并打标记；**脚注不能读 `record.entries`**——阶段推进时 entries 会被换成下一阶段的 0-0/alive，回头看已完成阶段就会显示成「0-0 存活」、已淘汰者更是查不到而留空，故 `createBracketCardContext` 另建 `节点id|选手id → 该场结算后战绩` 表，`getPlayerStateText(format, state)` 据此出「已晋级/已淘汰/存活」）。
  - 配对确认台：桶结构固定按 getDraftBucketSpecs 渲染（初始池/胜者池/败者池/决胜池，空桶也显示），每场两个 Select（严格模式仅本桶选项；勾选「允许跨桶」后列出全部选手并带桶后缀——**该开关是休眠选项**：标准双败流程用不到，仅非常规对阵 / 导入外部对阵表时才需要，锁定前二次确认），编辑 500ms 防抖自动 PUT 暂存；「🎲 桶内随机重排」（点击后先播抽卡动画：所有配对行名字就地快速滚动约 1s，再自首行起逐行定格揭晓，动画期间锁定其余编辑、全部揭晓后才把结果写入草稿并暂存；RNG 洗牌；**决胜池走 `crossPairDeciderPool` 经典交叉配对**——按 W1 胜负分成胜者组掉落者/败者组上扬者两池后交叉配对，两类人互不相遇，与后端 `generateDraftPairs` 同口径）、「📋 导入对阵表」（TextArea 每行 A vs B，未匹配行弹窗列出）、实时校验信息（错误红/警告橙，已交手仅提醒：本阶段重复与跨阶段重复相遇都提示，跨阶段附上次交手的「阶段 · 轮次」出处）、「🔒 锁定并创建 N 场」（跨桶二次确认 modal）。
  - 对局卡片（TournamentNodeCard，components/）：晋级图与波次列表**共用同一组件**——头部状态 Tag + 「跨桶」Tag + 节点 id，两行槽位（左侧 3px 状态色条、名称省略、阶段战绩脚注、右侧比分块），底部「进入管理」「查看阵容」（无 matchId 时禁用；前者切换为当前比赛并跳转赛事面板，后者开阵容详情弹窗）+ pending 已建场时的「弃权判负」。卡片数据由 `buildWaveCards`（波次列表）/`buildBracketGraph`（晋级图）产出，两者共用 `createBracketCardContext`，保证内容与色调一致。**右键卡片任意位置 = 直接打开对局面板（Drawer）**（不弹菜单，故卡片根 div 不走 Dropdown 包裹、`cardRef`/`slotRef` 仍留在卡片本体上，晋级图连线量测不受影响）；**点右上「⋯」= 弹菜单**：打开比赛面板 / 左右方赢（文案用选手名，如「小明赢了」）/ 开始本次对局 / 撤回上一步 / 取消撤回 / 查看阵容 / 弃权判负 / 进入管理；可用性由父级 `cardMenu.menuFor(matchId)`（TournamentView 顶层 useMemo）算好——`deriveMatchActionAvailability`（lib/match-actions.ts）给 isCurrent/canStart/canRegister/canUndo/canRedo，再并上云闸门 `registerGate`/`undoGate`，不可用项置灰并在右侧写原因。
  - **系列赛卡片「对局面板」Drawer（卡片菜单「打开比赛面板」）**：右侧滑出（`mask=false`，晋级图仍可点，点另一张卡片即切目标 → 连续登记多场），内容 = 顶部状态条 + 复用「当前比赛」面板（`CurrentMatchPanel` variant='drawer'，以目标 match 为参数）。状态条把**「当前推流是谁」单独一行重点展示**（本场=当前比赛 → 「本场正在推流 · X vs Y」；否则 → 「当前推流 · X vs Y」+ 「设为当前比赛」按钮），比赛身份（系列赛/轮次/状态/操作提示）与说明文字降级为次要行——别再把推流对象埋进长句里。**动作默认 headless**：开始 / 登记胜负 / 撤回都直接写目标那场（服务端按 matchId 工作），不切当前比赛、不改推流画面，成功后提示追加「（未切换当前比赛，推流画面保持不变）」；只有状态条里的「设为当前比赛」才 `selectMatch(id, { navigate:false })`（复用确认弹窗与「不再提示」记忆，但不跳视图）。**阵容区分两种形态（互斥）**：本场=当前比赛 → 由 `CurrentMatchPanel` 的 `rosterEditor` 插槽渲染可编辑的「当前阵容」面板（改的是推流面板）；本场≠当前比赛 → 渲染底部「双方阵容」卡，复用「查看阵容」的同一份正文（`MatchLineupDetailPanel`，读**目标比赛自己的 games 快照**、与推流面板无关，改用 antd `hideSummary` 去掉重复的比分摘要）。切换当前比赛后两种形态自动互换（条件就是 `matchPanelTarget.id === activeMatchId`）——别再给非当前比赛渲染可编辑面板，那会改到正在推流那场。卡里的「录入阵容」只写比赛记录（headless-safe），故录入弹窗挂在 App 根、由 Drawer 与比赛管理共用同一份 `lineupEntry` 状态。撤回按钮的可用性取 `resolveUndoState(matchId, activeMatchId, undo)`（优先 `undo.byMatch[matchId]`，非当前比赛也准；缺省双双置灰）。**Drawer 挂在 App 根且 `open` 上带 `view === 'tournament'` 守卫**：赛事面板（roster）与 Drawer 若同时存活会挂出两个 `RosterPanelEditor` 争用同一份全局面板草稿，守卫保证任意时刻只有一个编辑器（配 `destroyOnHidden`）。**Drawer 显式设 `zIndex` 低于弹窗基值（1000）**：antd 的 Modal 与 Drawer 默认 z-index 相同（都是 `zIndexPopupBase + 100`），谁在上面只由 portal 的 DOM 顺序决定，而 Drawer 的 portal 后创建、会压住从它内部打开的弹窗（「录入阵容」、切换当前比赛的确认框）——踩过的坑，别把 zIndex 去掉。
  - 详情工具栏「导出阵容模板 / 导入阵容」（只读副本不置灰——导出是纯读取、导入是比赛记录写入，均非编排操作）：**导出**弹窗选范围过滤（整届 / 按阶段 / 仅当前波），**先列出将要导出的具体对局供确认**（阶段·轮次 / 左右选手 / 对局ID / 阵容回显标记；`buildLineupTemplate` 的 `rows` 与 `targets` 同源，targets 即实际导出数据源）→ 生成「一场两行」Excel 模板（.xlsx：每行一场待开始比赛的第 1 局：系列赛 / 阶段 / 对局ID / 位置 / 选手 + 精灵1..6；已录阵容按 `pet_id_名字（形态）` 回显；行序 = 阶段→波次→节点，左行在前）。**精灵1..6 挂跨表下拉**：隐藏「精灵列表」sheet 放最终形态选项 `pet_id_名字（形态）`（口径 = 后台「只看最终形态」，范围公式随选项数动态生成；强校验但**粘贴可绕过**属软约束）；整表套**浅灰细线框**、并以「一场两行」为单位**隔场交替填充淡蓝底色**（奇数场留白，均仅视觉辅助），便于线下分辨每个格子与对局边界；渲染在 lib/lineup-template-xlsx.ts（exceljs）。**导入**弹窗四种等价输入（上传 .xlsx / CSV / 粘贴表格 TSV / JSON）→ xlsx 先经服务端 `POST /api/tournaments/:id/lineup-import/parse-xlsx` 解出二维表（只解格式不写数据），再与 CSV 共用同一入口 `parseLineupSheetTable` 按「对局ID + 位置」配对规范化（**表头定位与配对只有这一份实现**；缺一侧 = 单侧写入；同场同侧重复 = 黄标采用最后一行；「数字 + 空格 + 名字」与 `pet_id_名字` 写法不拆；CSV 解析容错：引号仅在字段开头开启包裹，字段中间游离的引号按字面保留，不会吞掉后续行）→ 服务端预览（按对局聚合：绿 = 已解析、黄 = 同名多候选点击切换、红 = 未匹配）只提交可导入场次批量写入，逐场报告结果。**弹窗每次重新打开都会重置到输入阶段**（清掉上次预览 / 结果，保留已粘贴文本与文件名）——组件由父级常驻挂载、只切换 open，不重置会让上次成功后的结果页残留、无法二次导入。纯函数在 lib/lineup-sheet.ts（buildLineupTemplate / buildLineupTemplateSheet / parseLineupSheetTable / parseLineupSheetText / parseLineupJsonText），API 封装在 lib/tournament-api.ts（previewLineupImportApi / applyLineupImportApi / parseLineupXlsxApi）。
  - 卡片「查看阵容」弹窗（MatchLineupDetailModal）：晋级图与波次列表共用。逐局展示双方 6v6 阵容快照（只读，槽位渲染复用比赛管理展开行的 buildHistoryBattleEntries + history-slot 样式），可见小局 = getHistoryVisibleGames（已打过的 + 当前未开始局，未轮到的空局不列）；空态显示「尚未录入阵容」。仅「当前小局且待开始」那局放开「录入阵容」（打开既有 HistoryLineupEntryModal），其余局置灰 + 锁定原因 Tooltip（复用 getLineupEntryBlockReason / LINEUP_ENTRY_BLOCK_TEXT），服务端门槛零改动；**只读副本同样可用**（比赛记录写入、非编排操作，与批量导入口径一致，会随回传承合并）。弹窗按 matchId 从最新 matches 解析（socket 更新自动跟随、比赛被删自动关闭），保存经 onMatchesStore → App applyServerState 立即应用，免等广播。
- about - 关于项目（项目链接、作者与许可、字体说明、数据来源）
- 「本页怎么用」（**唯一的新手说明入口**，顶栏一个按钮；逻辑在 `lib/guide.ts` + `components/CardGuideDrawer.tsx`）
  - **2026-10 调整**：原来那套「首访自动弹的线性漫游（antd Tour）+ 上下文提示卡 + 每张卡片一个『怎么用』按钮」已全部删除——用户只要一个随时能点、随时能关的说明入口。现在是：顶栏「本页怎么用」→ 右侧抽屉，按步骤讲清当前视图怎么操作。**没有自动弹、没有遮罩、没有 Tour**。
  - **每视图一套步骤注册表**（`VIEW_GUIDES`，12 个视图全覆盖）：每步带 `kind`（界面说明 / 操作流程）、`target`（`data-tour` 选择器，目前只做校验、抽屉不跑高亮）、`placement`，`flow` 类步骤必须带 `demoView`（测试钉住）。`viewGuideSteps` / `hasViewGuide` / `viewGuideDemoView` / `viewGuideTitle` 是全部对外接口。
  - **抽屉里两个动作**：`开模拟会话（假数据）`（`viewGuideDemoView(view)` 非空时才给）与 `悬浮窗操作练习`（只在赛事面板 / 直播推流 / 实时控制三个视图给，页面里不再单独放入口）。抽屉 `mask=false`（要对照界面看）、`zIndex=900`（低于弹窗基值，从抽屉里打开的选场/录入弹窗必须压在上面）。
  - **`data-tour` 锚点保留**：抽屉现在只展示文字，但锚点仍按 `[data-tour="xxx"]` 规范登记并用测试卡住格式——将来若要把某一步直接指到界面上（当前已无此功能），不必再补一遍锚点。给"卡片网格"打锚点时只标第一张卡（网格 8 张卡高约 1500px，指整块会把高亮区推出画面外）。
  - **记录只写 localStorage**：`guide:roco-pvp:v1:visits` 记"读过哪些视图"，读写失败静默降级；不建接口、不落 `runtime/cache/`、不进同步包。
  - **模拟会话（假数据）**：`admin-guide-demo.html` 是**同一份后台 bundle 的另一个入口**，URL 带 `?demo` / `?view=` 时 `main.tsx` 先 `await import('./demo/demo-session')` 再渲染：`demo-session` 把 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` 全换成内存 store（`demo-store` + `demo-fixtures`，一套完整的示例赛事），挂上横幅与「重置模拟数据」。界面是真的、数据是编的，**任何操作都不会碰真机数据、也不建真实长连接**。
  - **socket 分流在运行期判**：`lib/socket.ts` 只看 `window.__ROCO_CREATE_ADMIN_SOCKET__` 是否存在（demo-session 渲染前挂上）。**不要改成 `import.meta.env` 之类的构建期标志**——两个入口共用同一份 bundle，那种标志是整次构建全局的，按入口分不开（踩过：会导致模拟会话去连真 socket）。
  - **悬浮窗操作练习**：`float-guide-demo.html` 是独立的纯仿真页（假数据、页内状态，不连 socket、不调 `/api/panels`、不写 localStorage），因为真实悬浮窗是固定 587×56 的无边框透明窗且被 `setShape` 裁过，页内说明/高亮都会被裁掉；`float*.html` 与 `float-window.ts` 一行不改。
- 构建注意：`npm run build:renderer` 走 `scripts/build-renderer.mjs`（先清 dist 再 `vite build`），因为 `vite.config.ts` 里 `emptyOutDir` 关了、且多了 `admin-guide-demo` 这个入口。

### 核心状态（App.tsx）

- leftPanel / rightPanel、scoreboard、matches、avatars、stage、page7 / page9 / page11 / page14（配置状态与对应草稿/保存中标记；page14 另有 page14Standings = 服务端算好的当前阶段榜单）、tournaments（系列赛编排记录列表）
- stats 相关：statsMetric / statsPlayer / statsTag / statsTournamentId / statsSearch
- cloudStatus + 云同步草稿（cloudKeyDraft / cloudRoleDraft / cloudWorkerUrlDraft / cloudLabelDraft / cloudPeerDraft）、cloudPreviewFlow（pull / ack，复用同一份 syncPreview 状态与预览弹窗）、cloudAckSources / cloudAckSource / cloudAckCode（确认台按分控端分组）、cloudAssignDraft（指派工作台草稿）、cloudAckedMatchIds（分控端已确认集合）
- socket - Socket.IO 连接实例

### 核心逻辑（lib/）

- request.ts - fetch 封装
- tournament.ts - 系列赛纯函数（状态文案/阶段与波次定位/桶规格 getDraftBucketSpecs/草稿校验 validateDraftPairs/桶内洗牌 shuffleBucketPairs/关联对局状态统计 summarizeTournamentMatches/晋级图数据源 buildBracketGraph + 波次列表卡片 buildWaveCards（同源 createBracketCardContext）/轮次表述 getWaveRoundLabels + 配对方式表述 getPairingLabel + BracketSlot·BracketCard·BracketColumn·BracketGraph 类型等，不依赖 DOM 可在 node 环境单测）
- tournament-api.ts - 系列赛 API 层（12 个端点封装，含 deleteTournamentApi 删除系列赛，依赖 request）
- match-actions.ts - 对局卡片动作可用性（deriveMatchActionAvailability：isCurrent/canStart/canRegister/canUndo/canRedo；resolveUndoState：按比赛取 `undo.byMatch[matchId]`、缺省回落当前比赛的 canUndo/canRedo；formatWinnerActionLabel：菜单胜负项用选手名）
- last-tournament.ts - 系列赛「上次操作」本地记忆（readLastTournamentId / writeLastTournamentId，走 localStorage 且不可用时静默降级；不引用 DOM 类型以便 node 环境单测）
- sprite.ts - 精灵数据辅助（buildSpriteLookup：id/文件名/别名多键查找）
- match.ts - 比赛操作辅助（getPendingDraftContext：当前小局 pending 且赛事未完赛时返回该局草稿槽位上下文）
- panel.ts - 面板状态辅助（draftSlotsToSelected：赛事草稿快照 pet_id → 编辑器槽位，查不到的精灵降级空槽位）
- live.ts - 实时控制辅助
- history.ts - 历史记录辅助（getLineupEntryBlockReason：录入阵容入口锁定文案；buildHistoryTournamentFilters/getEffectiveTournamentId：系列赛筛选维度，PLAIN_HISTORY_MATCH_FILTER=普通对局）
- stats.ts - 统计聚合（buildUsageStats、buildStatsCsv）
- format.ts - 格式化工具
- preview.ts - 预览链接构建

### 小组件（components/）

- SettingField.tsx - 设置项字段封装
- SpritePetCard.tsx - 精灵卡片
- StageThumb.tsx - 推流页面缩略图
- CurrentMatchPanel.tsx - 「当前比赛」面板（赛事面板 inline 与系列赛 Drawer 共用）：以目标 match 为参数（不读全局 activeMatch），matchForm 归组件自有并按 match.id 回填，动作只回传 onAction(matchId, action, extra)（调接口 / 云闸门留在 App），阵容编辑器走 `rosterEditor` 插槽，`variant: 'inline' | 'drawer'` 控布局（Drawer 内把头像/比分收紧为「选手 · 比分 · 选手」紧凑横排，不竖向堆叠），头像不可用（非当前比赛）时显示占位图与 Tooltip

### 云同步（「数据同步」视图的云同步区 · 点击式）

- **同一张预览弹窗复用三种流程**：`syncPreview` 状态配 `cloudPreviewFlow`（null = U 盘导入 / 'pull' = 分控「同步最新」/ 'ack' = 主控确认台）。确认台流程下弹窗标题带分控端码、页脚换成「稍后再看 / ✗ 驳回 / ✓ 确认并推进」（隐藏 antd 默认 ok/cancel），顶部一个 Select 切换分控端（`switchCloudAckSource`，纯前端换条目，不重打接口）。
- **确认台的「内容一致」也要能勾**：对方交回的内容与本机完全相同时条目是 `action='skip'`，但勾选并确认它 = 给对方一个回执（不写任何数据）。因此确认台流程下这类行的勾选框**不禁用**（U 盘导入流程仍按原样禁用跳过项），标签显示「内容一致」，确认后的提示区分「写入 N 场」与「本机本来就一致，只回了收到」。**别把这里改回 disabled**：否则主控点不了确认，对方永远显示「等主控确认」。
- **状态自动轮询**：`GET /api/cloud-sync/status` 只读本机（不产生云端请求），红点轮询 `POST /api/cloud-sync/poll` 按 `cloudPollIntervalSeconds` 起 `setInterval`，`document.visibilityState !== 'visible'` 时跳过（后台标签页不刷云端）。轮询只更新提示，**绝不自动合并数据**；新版本提示按版本号去重（`cloudPollNotified`）。
- **同步状态卡**（`cloud-sync-status`，位于云同步设置区下方、操作按钮上方）：头部 = 状态圆点（`ok` 绿＝本机已最新 / `warn` 橙＝本机不是最新 / `main` 紫＝主控电脑 / `idle` 灰＝未配置或云端暂无内容）+ 状态文案 + 本机待办 Tag；中间三格 = 云端最新（版本 + 时间 + 上传者）/ 本机进度（已处理到第几版）/ 本机待办（待确认 / 待交回 / 等确认 + 下一步提示）；底部「本机记录」= 上传、交回、获取、确认四类动作按时间倒序取最近 4 条 + 半分钟延迟说明。数据来自 `cloudSyncState` / `cloudTodo` / `cloudTimeline` 三段派生，口径与红点 `cloudLiveBadge` 一致（**「已交回等确认」不等于「云端有新内容」**）。未配置时不渲染这块。
- **登记/撤回闸门是纯前端镜像**：`cloudRegisterGate(matchId)` / `cloudUndoGate(matchId)` 由 `cloudStatus.assignment` + `role` + `cloudAckedMatchIds` 现算，禁用按钮并挂 Tooltip（服务端在 winner/start/undo 路由上另有一道同口径校验，前端只是提前告知）。未配置云同步时两个闸门一律放行（保持单机行为）。
- **指派工作台**：`cloudAssignDraft` = 比赛 id -> 机器码（空串 = 主控端），按波次批量按钮只改当前列表里该波次的比赛；保存走 `POST /api/cloud-sync/assignment`，随下次「同步分发」生效。
- **本机移除（localOnly）与云同步**：分控端对已本机移除的系列赛，「同步最新」预览显示「已在本机移除，保持隐藏」，确认合并不改变隐藏状态（本机墓碑优先）；分发包与文件导出都剔除该记录（不传播、不影响主控端）；待回传集只看「已完赛 + 指派归本机 + 未 ack」，不受隐藏影响。
- **B1「记住上次排除」（分控端）**：确认合并时排除的系列赛记入本机（cloud-sync.json），下次「同步最新」预览默认继续排除，弹窗顶部提示「已按上次选择默认排除 N 届」+「全部恢复导入」一键清除记忆；墓碑永不入列（UI 也禁止勾除墓碑组）。
- **`/api/runtime-config` 顺带回带 `syncConfig`（完整 CloudSyncStatus）**：初始加载一次请求即可渲染设置区；「检测 Worker 在线」复用该接口回执里的 status。
- **改机器码守卫的前端配合**：`POST /api/runtime-config` 遇 409（有内嵌旧码的系列赛）弹 `modal.confirm`，确认后带 `confirmMachineCodeChange: true` 重发；400 直接报错（有 running 系列赛时禁止改码）。

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
  - 战队标识 div（stage.page3TeamVisible 控制显隐）：左右各一，底部色块叠加战队名称——`buildTeamNameImage` 用 canvas 渲染 PNG 缓存，规避字体兼容问题（这是不直接用 DOM 文字的原因）；logo 优先按 teamId 匹配录入战队，未录入仅显示名称色块。坐标/尺寸/配色见 styles 与 page3-display.js
  - 比分栏选手名字号阶梯自适应（`fitPlayerName`，左右各自独立）：以配置字号（`--page3-name-size`）为起点，渲染后按 scrollWidth > clientWidth 判定超宽则逐级缩小，到下限仍放不下就 nowrap + 省略号截断；MiSans 为异步 @font-face，`document.fonts.ready` 后用缓存数据 `refitPlayerNames` 重测一次（否则首帧按 fallback 字体量宽会算错）。具体字号阶梯见代码
  - 红光特效层（stage.page3RedLightMode 策略 + page3RedLightInstant 一次性触发）：`.page3-red-light` 内 canvas 承载 `src/assets/Effect/red-light-01.jpg`；图片为黑底红光、页面本身是透明叠层，因此 `prepareRedLightLayer` 运行时按亮度把黑底转成 alpha（反预乘，叠加结果近似滤色），canvas 再以 `mix-blend-mode: screen` 与页面元素做真滤色（这是素材要去黑而非直接叠的原因）；显示为淡入后进入呼吸动画（`.is-visible`）。可见性 = 立即显示 ||（自动档 && 阈值）：自动档任一侧阵亡 ≥3 只显示，若该侧阵亡含卡瓦重/卡卡虫/丢丢（按 displayName 比对、任意形态）则阈值提升为 4；「立即显示」进入下一局（换比赛 / 新小局）由服务端在 `emitMatchesUpdate` 广播出口统一清除并广播 stage:update，后台按钮无需推流页在场也能复位
- roco-pvp-page4.html + page4-display.js — MVP 结算画面（推流页面4，公开免鉴权；数据 `GET /api/mvp` + `/api/sprites`，最多 6 个精灵项）。每个精灵项自上而下 = tag 标签块（空标签整块隐藏）→ 精灵 webm（按 pet_id 取 `resources/sprites-260-630-webm/{pet_id}_{name}.webm`）→ 圆形头像底托；标记为 MVP 的项额外叠加 MVP 角标，再往上为传送门效果叠加层（只压精灵项）+ 最顶层胜方选手信息条（头像 + 名字，数据取 `GET /api/mvp` 的 winner = 已保存的胜方快照，mvp:update/avatar:update 时重拉，切换对局不改变）。**不使用 fx-enter**：收 stage-enter 后再等 `ENTER_DELAY_MS`（等载体过渡播完）按槽位 `--mvp-item-order` 依次淡入上浮（选手信息条排最后），过渡期间新出现的槽位单独入场。所有坐标/尺寸/配色/字体见 page4-display.js 与 styles
- roco-pvp-page5.html + page5-display.js — 登场/胜率排行
- roco-pvp-page6.html + page6-display.js — 比赛结果页（已结束比赛展示；page6/8 共用 match-prediction.js + match-prediction.css，薄封装传 defaultTitle「比赛结果」+ useTournamentLabel=true、showTimeWithLabel=false）。**卡片上方信息行由 mp-info-tag 胶囊组成**：系列赛对局显示语义阶段标签（如「8进4·胜者组 R2」，GET /api/page6 的 tournamentLabels，纯展示不落盘），不叠时间；普通对局显示时间胶囊（有 scheduleTimes 时）；两页都不再显示「第N场」（卡片内已有场序数字）
- roco-pvp-page7.html + page7-display.js — 战绩详情页（多场比赛按小局逐行展示选手阵容与胜负；主标题/温馨提示在「比赛管理 → 推送战绩详情」弹窗内编辑，留空用默认值；选场交互在比赛管理上方功能卡片弹窗）。**一屏固定 4 行、超过一屏整屏交叉淡入淡出（不再滚动、不再回卷）**：`page7-rows-track` 里只放两层 `.page7-rows-layer`（各 4 行，行元素总数恒定，选 200 场也只有 8 行 DOM），过渡 = 把新一屏建到隐藏层再同时翻两层透明度（700ms，与 CSS 一致）；数据更新走同一条路径并**保持当前屏**——旧实现每次数据变化都 `innerHTML` 整表重建 + 把位移归零，画面会闪一下并跳回第一场（踩过的坑，别再改回去）。**行首标签 `.page7-row-label`**：系列赛对局用 GET /api/page7 的 `tournamentLabels`（如「8进4·败者组 R2」）按 `·` 拆成两行显示（加 `.is-stacked` 略缩字号以容纳「64进32」），普通对局仍是全局 `GAME{n}` 序号；空位补「敬请期待」占位行。**切屏间隔来自「画面设置 → 战绩详情切屏间隔」**（`stage.page7SwitchSeconds`，默认 10 秒）：启动时 GET /api/stage、订阅 `stage:update` 实时改节奏，改完当前屏的停留定时器立即按新间隔重排；拉不到配置就回退默认值（出画面不依赖它）。最后一屏之后回到第一屏
- roco-pvp-page8.html + page8-display.js — 比赛预告页（公开免鉴权；与 page6 同构，共用 `match-prediction.js`，defaultTitle「比赛预告」= 空值兜底）。画面 = 蓝色渐变背景 + 可编辑主标题 + 3×3 居中网格最多 9 张对局卡片（每张含场序、BO、左右选手头像/名字/比分/排位）。卡片上方信息行 `.mp-info` 由 `.mp-info-tag` 胶囊组成：系列赛对局显示语义阶段标签（如「8进4·胜者组 R2」，来自 tournamentLabels，经 mount 参数 `useTournamentLabel` 开启）与/或时间（后端 `scheduleTimes` = startTime + ΣBO×30 分钟，`matchTimes` 可手动覆盖），两页都不再显示「第N场」（卡片内已有场序数字）。**差异：page8 传 `showTimeWithLabel=true`，系列赛对局同时显示标签 + 时间胶囊（普通对局只显示时间）；page6 不传，系列赛对局只显示标签。** 所有配色/坐标/尺寸/字体见 match-prediction.js 与 CSS
- roco-pvp-page9.html + page9-display.js — 团队积分榜页（标题后台可改、留空兜底「团队积分榜」；战队名称与 R1/R2/R3 积分后台录入，留空显示「-」；按三轮总分降序自动排名与总积分，同分保持录入顺序；名称与积分全空的行不展示；行高/字号按战队数量自适应）。视觉样式见 page9-display.js 与 CSS
- roco-pvp-page14.html + page14-display.js — 晋级积分榜页（数据 `GET /api/page14`：`{ state, standings }`，榜单由服务端按系列赛阶段的现存节点重算，**只统计系列赛内的比赛**；大标题与副标题后台可改、留空分别兜底「晋级积分榜」与按「阶段名 · 赛制 · BO」自动生成；行数 >24 分 3 栏、否则 2 栏，每页最多 32 行、当前页由后台控制，页数 >1 时页脚显示「第 x / y 页」；已淘汰行压暗、前三名名次金黄）。**增量更新**：行元素按 playerId 复用、只改文本与类名并按顺序 appendChild，签名一致时整段跳过渲染——切勿照抄 page9-display.js 的 `innerHTML = ''` 重建写法（直播会闪）。socket 收 page14:update / matches:update / tournament:update 后防抖重取接口，数据口径唯一来源在服务端
- roco-pvp-page10.html + page10-display.js — 胜者结算画面（数据 `GET /api/page10`：当前活跃比赛 + 双方头像，页面自行解析最近一个已分胜负的小局胜者；胜负登记后由 socket-server 自动切入并按时长切回）
- roco-pvp-page11.html + page11-display.js — 选手介绍页（page11-13 共用，`?mode=left/right/versus` 区分画面；数据 `GET /api/page11`：配置 + 信息录入 + 当前赛事 + 实时阵容面板；source=manual 用手动填写内容、留空字段回退「信息录入」匹配值；page11RankVisible 控制排位排名 div 显隐，无排名自动隐藏；自带动效不接入 stage-enter）
- float.html + float.js — 桌面阵容悬浮窗（透明置顶小窗）
- float-menu.html + float-menu.js — 更换精灵菜单（形态选择 / 全新精灵选择器）
- float-nextgame.html + float-nextgame.js — 「下场对局」选择菜单（300×320 popup，由 float.js 用 window.open 打开；列出待开始比赛、支持搜索，选中后走 `/api/nextgame/show` 保存并展示）
- countdown-overlay.js — 倒计时插件（叠加在推流载体页顶部；数据 `GET /api/countdown`：state + serverNow 校准时钟偏差；visible=false 播退场动效后隐藏）
