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
| DEFAULT_PAGE11_RANK_VISIBLE | true | 选手介绍（page11-13）排位排名 div 默认显示 | shared/constants.ts |
| DEFAULT_PAGE10_DURATION / DEFAULT_PAGE10_DURATION_UNIT | 10 / seconds | 胜负登记后自动切入 page10 的默认停留时长与单位 | shared/constants.ts |
| DEFAULT_NEXTGAME_DURATION / DEFAULT_NEXTGAME_DURATION_UNIT | 1 / minutes | 下场对局默认停留时长与单位（SUPPORTED_NEXTGAME_DURATION_UNITS = seconds/minutes） | shared/constants.ts |
| DEFAULT_COUNTDOWN_DURATION / DEFAULT_COUNTDOWN_THEME | 5 / dark | 倒计时默认时长（分钟）与配色（SUPPORTED_COUNTDOWN_THEMES = dark/light，COUNTDOWN_DURATION_MAX = 60） | shared/constants.ts |
| RANK_TEXT_MAX_LENGTH | 10 | 排位排名存储最大位数（超过 10000 显示 10000+） | shared/constants.ts |
| MVP_MAX_ITEMS / MVP_TAG_MAX_LENGTH / DEFAULT_MVP_RETURN_PAGE | 6 / 4 / page3 | MVP 结算（page4）精灵项上限、标签最大字数、关闭结算后切回的默认画面 | shared/constants.ts |

> 页面8（比赛预告）的比赛上限常量 PAGE8_MAX_MATCHES = 4 位于 electron/services/page8-service.ts，前台同值常量 PAGE8_MAX_MATCHES 位于 src/admin-antd/App.tsx。
>
> 页面9（团队积分榜）在 SUPPORTED_STAGE_PAGES 中；战队上限常量 PAGE9_MAX_TEAMS = 4 位于 electron/services/page9-service.ts，后台表单行数常量 PAGE9_TEAM_COUNT = 4 位于 src/admin-antd/App.tsx；单项积分最长 3 位数字（0-999）。
>
> 信息录入（profile-service.ts 内部常量）：选手上限 MAX_PLAYERS = 200、战队上限 MAX_TEAMS = 100、名字最长 32 字、宣言/常用精灵最长 120 字、排名最长 10 位数字；战队 id/选手 id 仅保留字母数字与 `-_`。

## 悬浮窗尺寸（electron/float-window.ts）

| 常量名 | 值 | 说明 |
|-------|-----|------|
| FLOAT_WINDOW_WIDTH / HEIGHT | 587 × 56 | 阵容悬浮窗尺寸（与 lineup 内容等大） |
| DEFAULT_FLOAT_SHAPE | {x:0,y:0,w:587,h:56} | 悬浮窗兜底可点击区域 |
| FLOAT_MENU_WIDTH / HEIGHT | 240 × 240 | 更换精灵菜单尺寸 |