# 关键常量索引

| 常量名 | 值 | 说明 | 文件 |
|-------|-----|------|------|
| DEFAULT_PORT | 9988 | 默认服务端口 | shared/constants.ts |
| APP_DATA_DIRNAME | LuokePVPWebui | Node/Docker 模式数据目录名 | shared/constants.ts |
| MAX_SELECTION_COUNT | 6 | 最大选择数量（阵容格子数） | shared/constants.ts |
| DEFAULT_OPACITY | 0.5 | 默认透明度 | shared/constants.ts |
| DEFAULT_SATURATION | 1.0 | 默认饱和度 | shared/constants.ts |
| DEFAULT_HEALTH_PERCENT | 100 | 默认血量百分比 | shared/constants.ts |
| DEFAULT_ENERGY_VALUE | 10 | 默认能量值 | shared/constants.ts |
| DEFAULT_BEST_OF | 7 | 默认赛制（BO7） | shared/constants.ts |
| DEFAULT_EVENT_TITLE | '' | 默认赛事标题 | shared/constants.ts |
| SUPPORTED_IMAGE_EXTENSIONS | {.png,.jpg,.jpeg,.webp} | 支持的头像图片扩展名 | shared/constants.ts |
| SUPPORTED_BEST_OF | {1,3,5,7} | 支持的赛制 | shared/constants.ts |
| DEFAULT_STAGE_PAGE | page3 | 默认推流页面 | shared/constants.ts |
| SUPPORTED_STAGE_PAGES | {page1-overlay,page2,page3,page4,page5,page6,page7,page8,page9,page10,page11,page12,page13,blank} | 支持的推流页面（page4 = MVP 结算画面；page11/12/13 = 选手介绍三画面，共用同一页面文件） | shared/constants.ts |
| DEFAULT_STAGE_TRANSITION | blinds | 默认切换过渡 | shared/constants.ts |
| SUPPORTED_STAGE_TRANSITIONS | {none,blinds,wolf} | 支持的过渡效果 | shared/constants.ts |
| DEFAULT_PAGE3_SPRITE_SOURCE | sprite | 页面3精灵图片来源默认值（sprite / thumbnail） | shared/constants.ts |
| SUPPORTED_PAGE3_SPRITE_SOURCES | {sprite,thumbnail} | 页面3精灵图片来源枚举 | shared/constants.ts |
| DEFAULT_PAGE3_RANK_VISIBLE | false | 页面3排位排名图标默认隐藏 | shared/constants.ts |
| DEFAULT_PAGE3_TEAM_VISIBLE | false | 页面3战队标识 div 默认隐藏 | shared/constants.ts |
| DEFAULT_PAGE3_RED_LIGHT_MODE / DEFAULT_PAGE3_RED_LIGHT_INSTANT | off / false | 页面3红光特效持久策略默认值（SUPPORTED_PAGE3_RED_LIGHT_MODES = off/auto）与「立即显示」一次性触发默认值 | shared/constants.ts |
| DEFAULT_PAGE11_RANK_VISIBLE | true | 选手介绍（page11-13）排位排名 div 默认显示 | shared/constants.ts |
| DEFAULT_PAGE10_DURATION / DEFAULT_PAGE10_DURATION_UNIT | 10 / seconds | 胜负登记后自动切入 page10 的默认停留时长与单位 | shared/constants.ts |
| DEFAULT_NEXTGAME_DURATION / DEFAULT_NEXTGAME_DURATION_UNIT | 1 / minutes | 下场对局默认停留时长与单位（SUPPORTED_NEXTGAME_DURATION_UNITS = seconds/minutes） | shared/constants.ts |
| DEFAULT_COUNTDOWN_DURATION / DEFAULT_COUNTDOWN_THEME | 5 / dark | 倒计时默认时长（分钟）与配色（SUPPORTED_COUNTDOWN_THEMES = dark/light，COUNTDOWN_DURATION_MAX = 60） | shared/constants.ts |
| RANK_TEXT_MAX_LENGTH | 10 | 排位排名存储最大位数（超过 10000 显示 10000+） | shared/constants.ts |
| MVP_MAX_ITEMS / MVP_TAG_MAX_LENGTH / DEFAULT_MVP_RETURN_PAGE | 6 / 4 / page3 | MVP 结算（page4）精灵项上限、标签最大字数、关闭结算后切回的默认画面 | shared/constants.ts |
| SYNC_APP_ID / SYNC_BUNDLE_SCHEMA / SYNC_BUNDLE_MAX_BYTES | roco-pvp-lineup / 1 / 64MB | 双机同步包的应用标识、结构版本与文件大小上限（导入上传限制 + 前端预检） | shared/constants.ts |
| MACHINE_CODE_REGEX / MATCH_ID_REGEX | ^[A-Z]{1,2}$ / ^(\d{8})_([A-Za-z]{0,2})(\d+)$ | 本机标识（1-2 位大写字母，空 = 未设置）与比赛 id（日期 + 机器码 + 序号；解析端容忍小写，机器码只允许字母避免与序号歧义） | shared/constants.ts |
| TOURNAMENT_TARGET_WINS / TOURNAMENT_TARGET_LOSSES | 2 / 2 | 双败阶段晋级线（2胜）与淘汰线（2败） | shared/constants.ts |
| SUPPORTED_TOURNAMENT_SIZES | {4,8,16,32} | V1 系列赛允许人数（2 的幂，桶恒偶零轮空） | shared/constants.ts |
| TOURNAMENT_ID_REGEX | ^T(\d{8})_([A-Za-z]{0,2})(\d+)$ | 系列赛 id 白名单：T 前缀 + 日期 + 机器码 + 序号（如 T20260928_A01），外部导入必过该校验防路径穿越 | shared/constants.ts |
| TOURNAMENT_CROSS_BUCKET_TAG / TOURNAMENT_FORFEIT_TAG | 跨桶 / 弃权 | 自动标签：跨桶配对 / 弃权场次标注 | shared/constants.ts |
| CLOUD_SYNC_ROLES / CLOUD_SYNC_ROSTER_MAX | {main,sub} / 8 | 云同步角色枚举（主控 / 分控）与房间名册容量上限（1 主 + N 分，机器码必须互不相同） | shared/constants.ts |
| CLOUD_SYNC_POLL_INTERVALS / DEFAULT_CLOUD_SYNC_POLL_INTERVAL / DEFAULT_CLOUD_SYNC_POLL_ENABLED | [30,60,120,300] / 60 / true | 红点轮询间隔可选值（秒）、默认值、默认开关（只读小键，最低 30s；调更密拿不到更新且白扣读额度） | shared/constants.ts |
| CLOUD_SYNC_UPLINK_MAX_MATCHES | 200 | 单次「回传」最多携带的比赛数（KV 单值上限充裕，这里只是防误操作） | shared/constants.ts |
| CLOUD_SYNC_REQUEST_TIMEOUT_MS | 20000 | 访问 Worker 的 HTTP 超时（超时给中文提示而不是让界面空转） | shared/constants.ts |
| CLOUD_SYNC_STALE_MINUTES | 30 | 主控端提示「对端尚未分发/回传」的展示阈值（分钟） | shared/constants.ts |

> 系列赛默认阶段模板构建器 `buildDefaultStages(playerCount): StageRule[]` 位于 shared/constants.ts：32人=双败BO1×2（32进16/16进8）+ 单败BO3×3（8进4/4进2/总决赛），16/8/4 人类似递减；默认 avoidRematch=true、requireConfirm=false。

> 推流选场上限三页统一为 9：PAGE6_MAX_MATCHES / PAGE8_MAX_MATCHES 位于 electron/services/page6-service.ts、page8-service.ts，PAGE7_MAX_MATCHES 位于 page7-service.ts；后台同值常量 PAGE6/PAGE7/PAGE8_MAX_MATCHES 位于 src/admin-antd/App.tsx。场序排期常量 MATCH_SLOT_MINUTES_PER_BO = 30 位于 shared/match-schedule.ts（每场占用 = BO 数 × 30 分钟）。
>
> 页面9（团队积分榜）在 SUPPORTED_STAGE_PAGES 中；战队上限常量 PAGE9_MAX_TEAMS = 4 位于 electron/services/page9-service.ts，后台表单行数常量 PAGE9_TEAM_COUNT = 4 位于 src/admin-antd/App.tsx；单项积分最长 3 位数字（0-999）。
>
> 信息录入（profile-service.ts 内部常量）：选手上限 MAX_PLAYERS = 200、战队上限 MAX_TEAMS = 100、名字最长 32 字、宣言/常用精灵最长 120 字、排名最长 10 位数字；战队 id/选手 id 仅保留字母数字与 `-_`。
>
> 双机数据同步：`runtime/config.json` 含 `machineCode`（本机标识，1-2 位大写字母），参与新比赛 id 前缀与同步包来源标识；同步包为单个 JSON（头像 base64 内嵌），导入上限 SYNC_BUNDLE_MAX_BYTES = 64MB。
>
> 云同步：`runtime/config.json` 另含 `syncKey` / `syncRole` / `workerUrl` / `machineLabel` / `cloudPollEnabled` / `cloudPollInterval`（workerUrl 一次性每机设置，**不打包进 exe**；syncKey + 角色每次比赛填写/切换）。本机状态 `cache/cloud-sync.json`（名册 / 指派规则 / 回传 seq / 回执 / 收件箱快照），待合并包 `cache/cloud-pending.json`。KV 单值上限 25 MiB（Worker 侧 MAX_BODY_BYTES 同值），读取用默认 60 秒边缘缓存（Cloudflare 限制 cacheTtl 最小 60）。

## 悬浮窗尺寸（electron/float-window.ts）

| 常量名 | 值 | 说明 |
|-------|-----|------|
| FLOAT_WINDOW_WIDTH / HEIGHT | 587 × 56 | 阵容悬浮窗尺寸（与 lineup 内容等大） |
| DEFAULT_FLOAT_SHAPE | {x:0,y:0,w:587,h:56} | 悬浮窗兜底可点击区域 |
| FLOAT_MENU_WIDTH / HEIGHT | 240 × 240 | 更换精灵菜单尺寸 |