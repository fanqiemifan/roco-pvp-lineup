# 前端组件结构

## admin-antd（管理后台，React + Ant Design）

### 目录结构
- App.tsx — 主组件：Layout（Header/Sider/Content）、视图分发、工具栏按钮（阵容悬浮窗/打开预览/复制链接/刷新）、「开一局」创建赛事弹窗（选手名/排位排名/头像/赛制/标签）
- views/ — 各视图独立页面
- components/ — 可复用小组件
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
- roster - 阵容编辑（RosterPanelEditor：左右面板编辑、精灵搜索、快速填充；顶部「当前比赛」表单含左右选手名+排位排名（仅数字，PATCH 保存比赛信息时一并提交）；「比赛列表」卡片头部有「快速创建比赛」按钮（参赛选手在固定高度可滚动列表区逐条点选、顶部搜索框过滤，双数校验奇数红字告警，再选赛制+标签，确认后 Fisher–Yates 随机洗牌两两配对逐一 `POST /api/matches` 创建，杜绝固定对阵）与「开一局」；「当前比赛」表单外有「战队修改」按钮（PATCH 补填/修改所属战队，联想录入战队或手动输入）；小结局时编辑器显示源为赛事草稿（getPendingDraftContext + 草稿回填 effect，按 matchId|gameNumber 去重），全局面板仅供推流页、不覆写编辑器（syncPanelFromApi pending 感知），推流页仍不显示未开局阵容）
- 信息录入 - 选手/战队档案（导航栏单卡片 + Segmented 切换；选手信息页顶部有「导入JSON」「批量头像」与「下载示例」按钮——批量头像用隐藏 file input 多选图片后先本地匹配出预览弹窗——按文件名（去扩展名）匹配已录入选手并左右对比「原头像 vs 新头像」（未设置显示默认占位图，未匹配文件警告列出且不上传），确认后才提交 POST /api/upload/player-avatars/batch 覆盖保存，文件名列表随表单 names 字段以 JSON 传递规避 multipart 中文乱码，后端未命中/失败弹结果窗提醒——导入白名单字段 name/rank/declaration/pets，前端 JSON.parse 校验为数组后预览中文列名与确认，后端再白名单校验兜底；未命中 pets.json 的常用精灵走 review 兜底弹窗：逐条下拉选最多 5 个候选或忽略；选手/战队表格行多选 +「删除所选（N）」一键批量删除（确认列出名称清单）；新增/编辑选手弹窗「常用精灵」为固定两列网格：头像（iconUrl 缺省回退立绘）+ 名字卡片点选、上限 6 个、顶部搜索过滤、Form.useWatch('pets') 双向绑定）
- live - 实时控制（比赛开始、胜负记录、撤销/恢复）
- history - 比赛历史（列表、删除、批量删除、撤销删除；「推送」勾选列推送比赛结果到页面6、「预告」勾选列推送比赛预告到页面8、「对局」勾选列配合「推送对局推送」按钮推送对局到页面7，可勾选待开始与进行中的对局）
- stats - 数据统计（StatsView：使用率/上场率排行、属性分布、标签趋势；1920px 断点布局）
- stage - 直播推流（推流页面切换、过渡效果、page5 口径；「推流页面3精灵图片」卡片；「推流页面3排位图标」开关；「页面2设置」卡片（赛事标题/阵容展示）；「对局信息文本输入」卡片（page7 主标题/温馨提示，对局勾选在比赛历史）；「团队积分榜设置（推流页面9）」卡片（主标题 + 4 行战队名称与 R1/R2/R3 积分，留空显示 `-`，排名与总积分自动计算）；底部「显示设置」卡片：推流页5标题、比分字号）
- preview - 页面预览（推流页面1-9 切换；页面8 附带「比赛预告设置」：主标题/副标题、壁纸图片1/图片2/自定义上传）
- about - 关于项目（更新日志）

### 核心状态（App.tsx）
- leftPanel / rightPanel、page4、scoreboard、matches、avatars、stage、page7 / page9（配置状态与对应草稿/保存中标记）
- stats 相关：statsRange / statsMetric / statsPlayer / statsTag / statsSearch
- socket - Socket.IO 连接实例

### 核心逻辑（lib/）
- request.ts - fetch 封装
- sprite.ts - 精灵数据辅助（buildSpriteLookup：id/文件名/别名多键查找）
- match.ts - 比赛操作辅助（getPendingDraftContext：当前小局 pending 且赛事未完赛时返回该局草稿槽位上下文）
- panel.ts - 面板状态辅助（draftSlotsToSelected：赛事草稿快照 pet_id → 编辑器槽位，查不到的精灵降级空槽位）
- live.ts - 实时控制辅助
- history.ts - 历史记录辅助
- stats.ts - 统计聚合（buildUsageStats、buildStatsCsv）
- format.ts - 格式化工具
- preview.ts - 预览链接构建

### 小组件（components/）
- Page4SlotVisual.tsx - page4 格子视觉
- SpritePetCard.tsx - 精灵卡片
- StageThumb.tsx - 推流页面缩略图

## login-antd（登录页面）

### 核心功能
- 用户登录表单（用户名、密码）
- 登录状态检查
- 登录成功后跳转至管理后台

## 推流/展示页面（原生 JS，src/pages + src/scripts + src/styles）

- index.html + stage-carrier.js — 推流载体，按 stage 配置用 iframe 加载对应页面
- roco-pvp-page1.html + overlay.js — Overlay 比分栏
- roco-pvp-page2.html + lineup-display.js — 全局阵容展示
- roco-pvp-page3.html + page3-display.js — 头像比分阵容；比分栏中央两侧排位排名图标（stage.page3RankVisible 控制显隐，开启但未输入排名时仅显示图标；排名超过 10000 显示 10000+，txt 位置按位数查表）
- roco-pvp-page4.html + page4-display.js — 仅显阵容
- roco-pvp-page5.html + page5-display.js — 登场/胜率排行
- roco-pvp-page6.html + page6-display.js — 比赛结果页（已结束比赛的结果展示）
- roco-pvp-page7.html + page7-display.js — 对局推送页（比赛历史勾选已结束比赛推送；多场比赛逐行滚动展示选手对局信息；主标题/温馨提示在「直播推流」设置，留空用默认值）
- roco-pvp-page8.html + page8-display.js — 比赛预告页（公开免鉴权，Match-Preview.jpg 背景板；主标题 YouSheBiaoTiHei 128 白色，最多 4 条比赛信息卡 1784×130（左右选手信息 div 820×130 背景 authorize-completed-.png：头像 84×84 + 选手名 64 白色居中 + 排位排名图标（复用 page3 rank 样式），中央 vs 72 黑色），支持 image/image-2/custom 背景切换）
- roco-pvp-page9.html + page9-display.js — 团队积分榜页（奶白卡片 + 金黄描边字 + 底部波浪装饰图 page9-back-1.png；标题后台可改留空用「团队积分榜」；战队名称与 R1/R2/R3 积分后台录入，留空显示「-」；按三轮总分降序自动排名与总积分，同分保持录入顺序；名称与积分全空的行不展示；行高/字号按战队数量自适应）
- float.html + float.js — 桌面阵容悬浮窗（透明置顶小窗）
- float-menu.html + float-menu.js — 更换精灵菜单（形态选择 / 全新精灵选择器）
