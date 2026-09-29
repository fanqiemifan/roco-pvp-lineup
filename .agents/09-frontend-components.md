# 前端组件结构

## admin-antd（管理后台，React + Ant Design）

### 目录结构

- App.tsx — 主组件：Layout（Header/Sider/Content）、视图分发、工具栏按钮（阵容悬浮窗/打开预览/复制链接/刷新）、「开一局」创建赛事弹窗（选手名/排位排名/头像/赛制/标签）
- views/ — 各视图独立页面（RosterPanelEditor、StatsView、TournamentView、HistoryLineupEntryModal）
- components/ — 可复用小组件（SettingField、SpritePetCard、StageThumb、AttributeFilterChips、BracketBoard、TournamentNodeCard）
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
  - 保存全部自动：600ms 防抖静默 POST /api/panels/:side（无手动保存按钮，头部仅显「保存中」标签）；精灵筛选为全局面板单份状态（spriteFilter），搜索为共享 rosterSearch（useDeferredValue 防抖）。
  - 顶部「当前比赛」表单含左右选手名 + 排位排名（仅数字，PATCH 保存比赛信息时一并提交）。
  - 「比赛列表」卡片头部「快速创建比赛」弹窗：参赛选手在固定高度可滚动列表区逐条点选，列表按录入添加时间升序（档案 id 内嵌 base36 创建时间戳，数组顺序被打乱时仍按真实添加时间排，id 解析失败的按原数组顺序兜底在末尾）；顶部搜索框按名字实时过滤并派生勾选态，所选人数实时显示、奇数红字告警；再选「比赛赛制」与「赛事标签」，确认后 Fisher–Yates 随机洗牌 + 两两配对逐一 `POST /api/matches` 创建（公平起见随机分配，杜绝固定对阵），复用选手名字与排位排名；创建与「开一局」共用前端统一入口 `postCreateMatch`。
  - 「当前比赛」操作面板「开始本次对局」旁有「战队修改」按钮：创建时未选战队后续补填，PATCH `/api/matches/:id` 更新（联想录入战队复用 id 或手动输入）。
  - 小结局时编辑器数据源为赛事草稿（getPendingDraftContext + 草稿回填 effect，按 matchId|gameNumber 去重）；全局面板仅供推流页、不覆写编辑器（syncPanelFromApi pending 感知），推流页不显示未开局阵容。
  - 「筛选精灵」属性 chips 为共享组件 AttributeFilterChips（components/，赛事面板与本页「录入阵容」弹窗共用，改一处即两处同步）：图标 + 属性文案，chip 上 `container-type: inline-size` + `@container (max-width: 52px)` 在宽度不足时隐藏 `.attribute-filter-text` 退化为纯图标（title/aria-label 保留悬浮提示）。精灵形态 chips 为共享组件 FormFilterChips（同上共用），样式经 `.form-filter-chip` 对齐属性 chips（26px 高 / 10px 圆角 / 11px 字号，无图标），改样式即两处同时生效）。
- profiles - 信息录入（选手/战队档案，单卡片 + Segmented 切换选手/战队视图）
  - 「导入JSON」+「下载示例」：前端 JSON.parse 校验为数组并预览中文列名确认，导入白名单字段 name/rank/declaration/pets（后端再白名单校验兜底）；未命中 pets.json 的常用精灵走 review 兜底弹窗，逐条下拉（可搜索）选最多 5 个候选或忽略。
  - 「批量头像」：隐藏 file input 多选图片后先本地按文件名（去扩展名）匹配已录入选手，弹出「原头像 vs 新头像」左右对比预览（未设置显示默认占位图，未匹配文件警告列出且不上传），点确认才提交 `POST /api/upload/player-avatars/batch`；文件名列表随表单 `names` 字段以 JSON 传递规避 multipart 中文乱码；后端未命中/失败弹结果窗提醒。
  - 批量删除：选手/战队表格均带 `rowSelection` 复选框，「删除所选（N）」一键删除（确认弹窗列出名称清单，删除时按钮 loading 并禁用复选框）。
  - 新增/编辑选手弹窗「常用精灵」：固定两列网格——按 displayName 去重显示精灵头像（iconUrl 缺省回退立绘）+ 名字卡片点选，上限 6 个，顶部搜索框实时过滤，`Form.useWatch('pets')` 双向绑定、打开弹窗时按原 pets 拆分回显。
- stage - 直播推流（卡片式设置）
  - 推流页面5-精灵出场胜率-统计口径（page5Player/page5Tag 过滤）；推流页面3设置（精灵图片来源 sprite/thumbnail、排位图标开关、战队标识开关、红光特效：关闭/自动开启分段 + 「立即显示」一次性触发按钮）。
  - 倒计时插件（时长/主题/显隐，走 `/api/countdown`）；下场对局（选择待开始比赛 + 停留时长，page3 的下场对局展示）。
  - 画面切换行为（过渡效果 none/blinds/wolf；page10 胜者结算自动切入与停留时长 page10Duration）。
  - 推流页面2设置（赛事标题/阵容展示）、推流页面6标题与背景、选手介绍显示（page11-13 排位 div 开关 page11RankVisible）、团队积分榜设置（page9）、底部「显示设置」（推流页5标题、比分字号）。
- page11 - 选手介绍（画面切换 left/right/versus；「选手介绍数据」按侧配置来源 manual/match，手动填写字段留空回退「信息录入」按名字匹配值）
- live - 实时控制（比赛开始、胜负记录、撤销/恢复）
- mvp - 结算画面（MVP 结算 / 推流页面4；导航图标 结算页面.svg）
  - 载入胜方：`载入当前对局胜方` 把当前对局「最近一个已分胜负小局」胜者一侧（lib/match.ts `getRecentWinnerLineup`，优先槽位快照 pet_id、回退小局阵容）的**选手名字+阵容快照**一并保存进 mvp.json（winner: matchId/side/playerName）；**只收最终形态精灵**（`sprite.isFinalForm`），胜者阵容无可用精灵时仅载入名字；保存后切换对局不会改变推流画面，需重新载入保存才更新，当前对局胜方与已载入不一致时给出提示。
  - 显示控制：`显示 MVP 结算`（POST /api/mvp/show：记录当前画面到 returnPage 并切 stage 到 page4）/ `关闭`（POST /api/mvp/hide：切回 returnPage）；状态标签显示已标记精灵 n/6、标签是否完整、是否已标记 MVP；另展示**已载入胜方头像（56 圆形，`.mvp-winner-avatar`）+ 名字 + 侧/比赛 id**（头像按快照 matchId+side 解析、带 mtime 缓存参数，未上传回退 left/right-avatar.png 占位图，数据取 GET /api/mvp 的 winner，mvp:update 用 payload、avatar:update 时重拉）；未标记 MVP 时禁用「显示」（标签可留空，不要求全部填完）。
  - 精灵项（最多 6 行）：点选当前对局胜者阵容精灵填入第一个空槽（再次点击移除），每行可填标签（预设 MVP_TAG_PRESETS + 手动输入 ≤4 字，选择即时保存、手动输入失焦/回车保存）、标记 MVP（全页互斥，最多一个）、清空；空槽位不可编辑。
  - 草稿同步：服务端 mvp.slots 变化时按内容比较回填（一致则保持原引用，避免编辑中标签被覆盖）。
- history - 比赛管理（列表、删除、批量删除、撤销删除；**表格分页「N 条/页」下拉走 `showSizeChanger` 传 SelectProps（antd 6 支持对象形式）：`getPopupContainer: () => document.body` + `popupMatchSelectWidth: false`**——原来布尔形式下下拉跟随很窄的触发器、又处于卡片底部，选项文字会被裁掉/看不到；筛选区分两行维度且 AND 叠加：紫色「系列赛」组 = 普通对局 + 各系列赛 🏆名称（N场），按对局首次出现顺序，只含有关联赛局的系列赛，孤儿引用（系列赛已删）归普通对局；蓝色「标签」组 = 全部/未分类/各标签；标签单元格对系列赛对局固定前置紫色奖杯 Tag（不可随标签编辑删除，点击即按该系列赛筛选），纯函数 buildHistoryTournamentFilters/getEffectiveTournamentId 在 lib/history.ts；**推流选场不在表格内勾选**：表格上方三个 MatchPushCard（推送比赛结果 / 推送对局推送 / 推送比赛预告，组件 components/MatchPushCard.tsx），点击「选择比赛」打开选场弹窗（左候选比赛表+搜索+资格过滤：page6 仅已结束、page8 待开始/进行中、page7 任意；右已选区按勾选顺序=卡片场序，可上移/下移/移除；page6/8 弹窗内另可编辑大标题、第一场开始时间与每场时间（自动时间走 shared/match-schedule 的 computeScheduleTimes，输入框 placeholder 为自动值），page7 弹窗内编辑主标题与温馨提示），确认即 POST 推送，三页上限均 9；「录入阵容」弹窗 HistoryLineupEntryModal 为待开始小局录入双方阵容；「数据同步」卡片 = 本机标识 + 导出同步包 + 导入预览弹窗，弹窗为「左条目列表 + 右侧本机 vs 包内字段级 diff 面板」，列表按「更新 → 新增 → 跳过」排序（同级冲突优先），冲突场次红色标记并可逐条/批量选择保留哪一边，档案项的头像/logo 变更在 diff 中显示「本机 / 包内」左右对照图）
- stats - 数据统计（StatsView：使用率/上场率排行、属性分布、标签趋势；1920px 断点布局）
- preview - 页面预览（推流页面1-13 切换，含页面4 MVP 结算，`PREVIEW_PAGES` 定义于 constants.ts；page6/7/8 仅提示去「比赛管理」上方功能卡片选场推送，标题/时间在选场弹窗内编辑）
- tournament - 系列比赛（TournamentView：列表 + 4 步创建向导 + 详情；导航图标 系列比赛.svg；菜单顺序为 赛事面板 → 直播推流 → 系列比赛 → 结算画面…，「实时控制」移到「页面预览」之后）
  - 「系列赛列表」表格：名称（点击打开详情）、人数、当前位置（阶段名·波次）、已完成/已建场次、状态标签、操作（打开详情 + 红色「删除」）；头部「＋ 创建系列赛」开导向导。删除走统一确认弹窗（summarizeTournamentMatches 给出关联对局总数与已完成/进行中/未开始分布）：默认仅删编排记录、对局保留转普通；勾选「同时删除 N 场对局」则连对局删除（比赛管理可撤回最近删除），DELETE /api/tournaments/:id。
  - 创建向导 4 步：①名称 → ②选手勾选（搜索 + 固定高度滚动 Checkbox 列表，实时校验人数 ∈ 4/8/16/32）→ ③阶段规则可编辑表（阶段名/双败单败分段/BO1·BO3·BO5·BO7/配对方式/避重复/需确认；人数变化时重填 buildDefaultStages 默认模板；**只剩 2 人的阶段（总决赛）的「双败」选项 disabled**，表格 footer 说明「固定为单败」——`isFinalStage(playerCount, index)` 与后端判据一致）点「创建草稿」POST → ④抽签与首波对阵面板（seed + 配对基准顺序标签流 + **首波对阵预览**——按当前 seed 走 `GET /api/tournaments/:id/opening-wave` 只读生成、不建场，随 `seed/drawVersion` 变化自动刷新；「重新抽签」/「确认开赛」；开赛后提示已生成第 1 波）。setup 记录可随时在列表「继续配置」。
  - 详情：阶段进度 Steps（finish/process/wait）+ setup 时复用抽签面板 + 视图切换 Segmented「晋级图 / 波次列表」（**默认晋级图**，仅非 setup 显示；setup 固定走抽签面板）。波次列表视图：波次卡片（最新在前）：draft → 配对确认台；locked → 节点卡片网格，卡片由 **TournamentNodeCard** 渲染（与晋级图同一组件，内容与色调完全一致）。波次标题以「第 N 波」为主标题（保留原有表述），其后追加标注：轮次名（`getWaveRoundLabels`，双败 W1 = `胜者组 R1`、W2 = `败者组 R1 / 胜者组 R2`、W3 = `败者组 R2`，单败阶段为空）+ `阶段名 · 双败/单败` Tag + `配对方式 · 配对草稿/已锁定` Tag（配对方式用 `getPairingLabel`：随机配对/手动配对/每轮随机/沿对阵树）+ 波状态 Tag。头部 Popconfirm「回退上一波」与红色「删除系列赛」（复用列表的删除确认弹窗）；冠军结果显示冠亚军标签。
  - 晋级图（BracketBoard，components/）：**双败按战绩桶拆列**（同一波的 1-0 / 0-1 拆成两列），列序 胜者组 R1 → 败者组 R1 → 胜者组 R2 → 败者组 R2，**单败一阶段一列**，横向可滚动。列头显示轮次标签（首列附阶段名 `胜者组 R1 · 8进4`，决胜列附晋级人数 `败者组 R2 · 决出4强`；单败直接用阶段名）+ 双败/单败 + 波状态。列内每个节点一张卡片（状态 Tag、「跨桶」Tag、节点 id、双方槽位行、复用「切换为当前比赛」与「弃权判负」）。**槽位样式参照 bracket-reference**：整行左侧 3px 状态色条 + 名称省略号（title 完整名）+ 战绩脚注 + 右侧比分块；`.bracket-row-won` = 绿条/绿字加粗/绿底比分，`.bracket-row-lost` = 红条 + 文字置灰 + 半透明 + 红底白字比分（**无删除线**），`.bracket-row-tbd` = 名称置灰。**列间晋级连线由 buildBracketGraph 推导的槽位关系（上一次出战赢=胜者实线 #2d7a58 / 输=败者虚线 #c24635，首轮登场无连线）经 getBoundingClientRect 量测后画正交折线 SVG**（量测取**内容坐标系**：视口坐标 + `scrollLeft/scrollTop`，否则横向滚动状态下重算会整体偏移一个 scrollLeft），布局变化由 ResizeObserver 重算，并在首帧后补两帧 + `document.fonts.ready` 各再量一次（卡片 Tag/换行/字体加载会让高度在首帧后才稳定，而 RO 只对尺寸变化生效）。**连线默认全部隐藏，点击某张卡片（`.bracket-card-hitbox`，点按钮不触发）才显示该场链路 = 上游全部祖先连线 + 从它出发的下游连线，选中卡片加 `.bracket-card-active` 高亮、相关节点集合（选中卡片 + 全部祖先 + 下游一场，由 activeEdges 两端推导）之外的卡片加 `.bracket-card-dimmed`（opacity .4）压暗但保持可点击，再点一次或点空白取消**；**各列等高、列体 `justify-content: space-around`，卡片按数量均匀分布形成扇形/三角趋势（不再全部顶部对齐）**；**超宽时由 `.bracket-board-scroller` 在卡片内部横向滚动**（`.admin-content > * { min-width: 0 }` + `.bracket-board { min-width: 0; max-width: 100% }` 防 grid 子项被 max-content 撑开页面）。**按住鼠标拖动可平移视图**（pointerdown/move/up 改 `scrollLeft/scrollTop`；位移 < 4px 仍按点击处理，越过阈值才 `setPointerCapture` 以免捕获把 click 重定向导致卡片选不中；拖动结束的 click 被 `suppressClickRef` 吞掉不影响选中；拖动中容器加 `.is-dragging` 换 grabbing 光标并禁选文本）。draft 波渲染为只读候选配对 + 提示去波次列表完成配对确认。数据源纯函数 buildBracketGraph 在 lib/tournament.ts（跳过 setup 无波次 → Empty 占位；节点所属桶与槽位战绩脚注都由「按波次顺序累计的阶段内战绩」推导，跨桶配对取左位战绩入列并打标记；**脚注不能读 `record.entries`**——阶段推进时 entries 会被换成下一阶段的 0-0/alive，回头看已完成阶段就会显示成「0-0 存活」、已淘汰者更是查不到而留空，故 `createBracketCardContext` 另建 `节点id|选手id → 该场结算后战绩` 表，`getPlayerStateText(format, state)` 据此出「已晋级/已淘汰/存活」）。
  - 配对确认台：桶结构固定按 getDraftBucketSpecs 渲染（初始池/胜者池/败者池/决胜池，空桶也显示），每场两个 Select（严格模式仅本桶选项；勾选「允许跨桶」后列出全部选手并带桶后缀），编辑 500ms 防抖自动 PUT 暂存；「🎲 桶内随机重排」（RNG 洗牌；**决胜池走 `crossPairDeciderPool` 经典交叉配对**——按 W1 胜负分成胜者组掉落者/败者组上扬者两池后交叉配对，两类人互不相遇，与后端 `generateDraftPairs` 同口径）、「📋 导入对阵表」（TextArea 每行 A vs B，未匹配行弹窗列出）、实时校验信息（错误红/警告橙，已交手仅提醒）、「🔒 锁定并创建 N 场」（跨桶二次确认 modal）。
  - 对局卡片（TournamentNodeCard，components/）：晋级图与波次列表**共用同一组件**——头部状态 Tag + 「跨桶」Tag + 节点 id，两行槽位（左侧 3px 状态色条、名称省略、阶段战绩脚注、右侧比分块），底部「切换为当前比赛」（无 matchId 时禁用）+ pending 已建场时的「弃权判负」。卡片数据由 `buildWaveCards`（波次列表）/ `buildBracketGraph`（晋级图）产出，两者共用 `createBracketCardContext`，保证内容与色调一致。
- about - 关于项目（项目链接、作者与许可、字体说明、数据来源）

### 核心状态（App.tsx）

- leftPanel / rightPanel、scoreboard、matches、avatars、stage、page7 / page9 / page11（配置状态与对应草稿/保存中标记）、tournaments（系列赛编排记录列表）
- stats 相关：statsRange / statsMetric / statsPlayer / statsTag / statsSearch
- socket - Socket.IO 连接实例

### 核心逻辑（lib/）

- request.ts - fetch 封装
- tournament.ts - 系列赛纯函数（状态文案/阶段与波次定位/桶规格 getDraftBucketSpecs/草稿校验 validateDraftPairs/桶内洗牌 shuffleBucketPairs/关联对局状态统计 summarizeTournamentMatches/晋级图数据源 buildBracketGraph + 波次列表卡片 buildWaveCards（同源 createBracketCardContext）/轮次表述 getWaveRoundLabels + 配对方式表述 getPairingLabel + BracketSlot·BracketCard·BracketColumn·BracketGraph 类型等，不依赖 DOM 可在 node 环境单测）
- tournament-api.ts - 系列赛 API 层（12 个端点封装，含 deleteTournamentApi 删除系列赛，依赖 request）
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
  - 比分栏选手名字号阶梯自适应（`fitPlayerName`，左右各自独立）：以配置字号为起点（`--page3-name-size` 默认 36px，自适应封顶 36、下限 28），渲染后按 scrollWidth > clientWidth 判定超宽，按 2px 逐级缩小（36→34→32→30→28）并写内联 font-size；28px 仍放不下则保留 nowrap + text-overflow:ellipsis 省略号截断；MiSans 为异步 @font-face，`document.fonts.ready` 后用缓存数据 `refitPlayerNames` 重测一次
  - 红光特效层（stage.page3RedLightMode 策略 + page3RedLightInstant 一次性触发）：`.page3-red-light`（z-index 10，pointer-events none）内 canvas 承载 `src/assets/Effect/red-light.jpg`；图片为黑底红光，页面本身是透明叠层，因此 `prepareRedLightLayer` 在运行时按亮度把黑底转成 alpha（反预乘，叠加结果近似滤色），canvas 自身 `mix-blend-mode: screen` 与页面内元素做真滤色；显示 = 600ms 淡入后进入 2.4s 一轮 opacity 1↔0.55 的呼吸动画（`.is-visible`）。可见性 = 立即显示 ||（自动档 && 阈值）：自动档任一侧阵亡 ≥3 只显示，若该侧阵亡精灵中含卡瓦重/卡卡虫/丢丢（按 displayName 比对，任意形态）则阈值提升为 4；「立即显示」进入下一局（换比赛 / 新小局开始）由服务端在 `emitMatchesUpdate` 广播出口统一清除并广播 stage:update，后台按钮无需推流页在场也能复位
- roco-pvp-page4.html + page4-display.js — MVP 结算画面（推流页面4，公开免鉴权；数据 `GET /api/mvp` + `/api/sprites`；背景 mvp-back.png，最多 6 个精灵项：最左 x80、单个 290×720、间隔 4px，自上而下 = tag div 290×110（tag-01.svg，文字 YouSheBiaoTiHei 40px 黑色、旋转 4.62°，空标签整块隐藏）→ webm 260×630（居中距顶 50px，按 pet_id 取 resources/sprites-260-630-webm/`{pet_id}_{name}.webm`）→ petsdiv3 头像 98×98（居中距顶 622px，圆形底托改金色渐变 E6B856→7A573B + 描边渐变 9A6C38→F9F086）；标记为 MVP 的精灵项额外叠加 MVP.png 280×280（y380 居中，z-index 3）；再往上层为叠加层 `back-mvp-1.png`（1920×1080 传送门效果，z-index 10，只压精灵项）+ 最顶层胜方选手信息条 550×150（水平居中距顶 906px，背景 mvp-payer-winner-back.png，头像 100×100 圆形 + 名字 YouSheBiaoTiHei 48 白色、彼此间隔 0px，数据取 `GET /api/mvp` 的 winner——由已保存的胜方快照下发，mvp:update/avatar:update 时重拉；切换对局不改变）。**不使用 fx-enter**：收 stage-enter 后再等 `ENTER_DELAY_MS`（900ms，等载体过渡播完）按槽位 `--mvp-item-order × 120ms` 依次淡入上浮（选手信息条排在最后一个精灵项之后），过渡期间新出现的槽位单独入场）
- roco-pvp-page5.html + page5-display.js — 登场/胜率排行
- roco-pvp-page6.html + page6-display.js — 比赛结果页（已结束比赛展示；page6/8 共用 match-prediction.js + match-prediction.css，薄封装传 defaultTitle「比赛结果」）
- roco-pvp-page7.html + page7-display.js — 对局推送页（多场比赛按小局逐行滚动展示选手阵容与胜负；主标题/温馨提示在「比赛管理 → 推送对局推送」弹窗内编辑，留空用默认值；**画面未参与卡片重构**，选场交互改为比赛管理上方功能卡片弹窗）
- roco-pvp-page8.html + page8-display.js — 比赛预告页（公开免鉴权；与 page6 同构，defaultTitle「比赛预告」=空值兜底）。page6/8 统一画面：蓝色渐变背景（#2A5EF2→#31B0FD，无背景图/视频/壁纸）；主标题 96px 白色居中 top100（后台可编辑），副标题固定「Match Prediction」40px；3×3 居中网格最多 9 张 412×166 卡片——Rectangle-01.svg 铺底、BO 文本 20px right4、场序数字 36px left16、左右选手条（x42 y8/y84，370×74 card-01.png：72 圆头像内描边 2px 黑 50% + 名字 24 白 left88/top42 + 比分 36 #63C0E9 right24/top36 无比分「-」 + rank 区 96×26 x88/y8 图标 18×21 + 13px MiSans-Heavy #FEC55E）；卡片上方场序信息行（20px 白，距卡片 8px）：`第一场 19:00`，时间取后端 scheduleTimes（startTime + ΣBO×30 分钟，matchTimes 手动覆盖），无开始时间只显「第N场」
- roco-pvp-page9.html + page9-display.js — 团队积分榜页（奶白卡片 + 金黄描边字 + 底部波浪装饰图 page9-back-1.png；标题后台可改留空用「团队积分榜」；战队名称与 R1/R2/R3 积分后台录入，留空显示「-」；按三轮总分降序自动排名与总积分，同分保持录入顺序；名称与积分全空的行不展示；行高/字号按战队数量自适应）
- roco-pvp-page10.html + page10-display.js — 胜者结算画面（数据 `GET /api/page10`：当前活跃比赛 + 双方头像，页面自行解析最近一个已分胜负的小局胜者；胜负登记后由 socket-server 自动切入并按时长切回）
- roco-pvp-page11.html + page11-display.js — 选手介绍页（page11-13 共用，`?mode=left/right/versus` 区分画面；数据 `GET /api/page11`：配置 + 信息录入 + 当前赛事 + 实时阵容面板；source=manual 用手动填写内容、留空字段回退「信息录入」匹配值；page11RankVisible 控制排位排名 div 显隐，无排名自动隐藏；自带动效不接入 stage-enter）
- float.html + float.js — 桌面阵容悬浮窗（透明置顶小窗）
- float-menu.html + float-menu.js — 更换精灵菜单（形态选择 / 全新精灵选择器）
- float-nextgame.html + float-nextgame.js — 「下场对局」选择菜单（300×320 popup，由 float.js 用 window.open 打开；列出待开始比赛、支持搜索，选中后走 `/api/nextgame/show` 保存并展示）
- countdown-overlay.js — 倒计时插件（叠加在推流载体页顶部；数据 `GET /api/countdown`：state + serverNow 校准时钟偏差；visible=false 播退场动效后隐藏）
