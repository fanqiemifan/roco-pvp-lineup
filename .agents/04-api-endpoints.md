# API 接口索引

## 认证接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 用户登录 | POST | /api/auth/login | 登录 | electron/socket-server.ts |
| 用户登出 | POST | /api/auth/logout | 登出 | electron/socket-server.ts |
| 检查登录状态 | GET | /api/auth/check | 检查登录状态 | electron/socket-server.ts |

## 面板接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 保存面板 | POST | /api/panels/:position | 保存整个面板状态（position: left/right） | electron/socket-server.ts |
| 更新格子 | PATCH | /api/panels/:position/slots/:slot | 更新单个格子 | electron/socket-server.ts |
| 清空面板 | DELETE | /api/panels/:position | 清空面板 | electron/socket-server.ts |

## 记分牌接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取记分牌 | GET | /api/scoreboard | 获取记分牌状态 | electron/socket-server.ts |
| 保存记分牌 | POST | /api/scoreboard | 保存记分牌状态（排名字段 leftRank/rightRank 未携带时保留现值，避免清空赛事同步的排名） | electron/socket-server.ts |
| 更新赛制 | POST | /api/scoreboard/best-of | 更新赛制 | electron/socket-server.ts |

## 比赛接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取所有比赛 | GET | /api/matches | 获取所有比赛记录 | electron/socket-server.ts |
| 创建比赛 | POST | /api/matches | 创建新比赛（payload 可含 leftRank/rightRank 排位排名，仅数字、可选） | electron/socket-server.ts |
| 更新比赛 | PATCH | /api/matches/:matchId | 更新比赛信息（含选手名、排位排名、赛制，以及所属战队 leftTeamId/leftTeamName/rightTeamId/rightTeamName 可选，未传时保留原值；后台「保存比赛信息」与「战队修改」都走此接口） | electron/socket-server.ts |
| 更新比赛标签 | PATCH | /api/matches/:matchId/tags | 更新比赛标签 | electron/socket-server.ts |
| 批量添加标签 | POST | /api/matches/batch-tags | 为多场比赛追加标签（合并保留原有，body: matchIds/tags） | electron/socket-server.ts |
| 删除比赛 | DELETE | /api/matches/:matchId | 删除单个比赛 | electron/socket-server.ts |
| 选择活动比赛 | POST | /api/matches/:matchId/select | 选择活动比赛 | electron/socket-server.ts |
| 开始小局 | POST | /api/matches/:matchId/start | 开始当前小局 | electron/socket-server.ts |
| 记录胜负 | POST | /api/matches/:matchId/winner | 记录本局胜负 | electron/socket-server.ts |
| 撤销操作 | POST | /api/matches/:matchId/undo | 撤销操作 | electron/socket-server.ts |
| 恢复操作 | POST | /api/matches/:matchId/redo | 恢复操作 | electron/socket-server.ts |
| 批量删除比赛 | POST | /api/matches/history/delete | 批量删除比赛 | electron/socket-server.ts |
| 撤销删除 | POST | /api/matches/history/undo-delete | 撤销删除 | electron/socket-server.ts |

## 仅显阵容（page4）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取 page4 状态 | GET | /api/page4 | 获取 page4 双面板状态 | electron/socket-server.ts |
| 保存 page4 面板 | POST | /api/page4/:position | 保存 page4 面板（left/right） | electron/socket-server.ts |
| 更新 page4 格子 | PATCH | /api/page4/:position/slots/:slot | 更新 page4 单个格子 | electron/socket-server.ts |
| 清空 page4 面板 | DELETE | /api/page4/:position | 清空 page4 面板 | electron/socket-server.ts |

## 直播推流（stage）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取推流配置 | GET | /api/stage | 获取 stage 配置 | electron/socket-server.ts |
| 保存推流配置 | POST | /api/stage | 保存 stage 配置 | electron/socket-server.ts |

## 比赛结果（page6）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取比赛结果页状态与已选比赛 | GET | /api/page6 | 获取 page6 状态与完整比赛数据（公开 GET） | electron/socket-server.ts |
| 保存比赛结果配置 | POST | /api/page6 | 保存 page6 配置（matchIds 最多 8 个已结束比赛 / title 副标题） | electron/socket-server.ts |

## 比赛预告（page8）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取比赛预告页状态与已选比赛 | GET | /api/page8 | 获取 page8 状态、完整比赛数据（仅待开始/进行中，公开 GET）与按赛事隔离的选手头像 | electron/socket-server.ts |
| 保存比赛预告配置 | POST | /api/page8 | 保存 page8 配置（matchIds 最多 4 个待开始/进行中比赛 / title / background，已完成比赛会被过滤） | electron/socket-server.ts |
| 上传自定义壁纸 | POST | /api/page8/wallpaper | 上传 page8 壁纸（魔数校验，缩放宽高 1920×1080 压缩为 JPEG，自动切到 custom 背景） | electron/socket-server.ts |
| 删除自定义壁纸 | DELETE | /api/page8/wallpaper | 删除 page8 壁纸并回退到内置背景 | electron/socket-server.ts |

## 对局推送（page7）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取对局推送页状态 | GET | /api/page7 | 获取 page7 状态与已选比赛数据（公开 GET） | electron/socket-server.ts |
| 保存对局推送配置 | POST | /api/page7 | 保存 page7 配置（matchIds 已结束比赛 / title 主标题 / notice 温馨提示） | electron/socket-server.ts |

## 团队积分榜（page9）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取团队积分榜状态 | GET | /api/page9 | 获取 page9 标题与战队积分列表（公开 GET） | electron/socket-server.ts |
| 保存团队积分榜配置 | POST | /api/page9 | 保存 page9 配置（title 主标题 / teams 最多 4 支战队的名称与 R1/R2/R3 积分，排名与总积分由前端自动计算） | electron/socket-server.ts |

## 统计接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 精灵排行 | GET | /api/stats/ranking | 精灵使用率/上场率/胜率排行（支持 tag / player 参数，统计全部历史对局） | electron/socket-server.ts |

> 推流页面仅用于展示，以下 GET 接口公开免鉴权：`/api/stage`、`/api/scoreboard`、`/api/stats/ranking`、`/api/page4`、`/api/page6`、`/api/page7`、`/api/page8`、`/api/page9`、`/api/panels`、`/api/matches`、`/api/sprites`、`/api/nextgame`、`/api/profiles`、`/api/avatars`；同名 POST/DELETE 写操作仍受保护。

## 信息录入（选手/战队档案）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取录入列表 | GET | /api/profiles | 获取选手与战队录入（公开 GET，推流页9 战队联想/页面3 战队标识依赖） | electron/socket-server.ts |
| 保存选手录入 | POST | /api/profiles/players | 新增/更新选手（未传 id 但同名视为更新；name 必填） | electron/socket-server.ts |
| 导入选手（JSON 批量） | POST | /api/profiles/players/import | 批量导入选手，接受数组或 `{players:[...]}`；每条仅识别 name/rank/declaration/pets（其余键忽略防注入），rank 仅纯数字、缺 name 跳过、同名沿用旧 id 更新；pets 仅命中 pets.json 才录入，未命中返回 `review`（含最多 5 个候选）由前端兜底人工确认；响应 `{ success, profiles, review }`；成功广播 profiles:update | electron/socket-server.ts |
| 删除选手录入 | DELETE | /api/profiles/players/:playerId | 删除选手（连同头像文件） | electron/socket-server.ts |
| 保存战队录入 | POST | /api/profiles/teams | 新增/更新战队（未传 id 但同名视为更新；name 必填） | electron/socket-server.ts |
| 删除战队录入 | DELETE | /api/profiles/teams/:teamId | 删除战队（连同 logo 文件） | electron/socket-server.ts |
| 上传选手头像 | POST | /api/upload/player-avatar/:playerId | 上传选手头像（魔数校验，sharp 裁剪为方形 PNG，存 cache/profiles/players/<id>.png） | electron/socket-server.ts |
| 批量上传选手头像 | POST | /api/upload/player-avatars/batch | multipart 多文件（字段 files，单批上限 100）：图片文件名（去扩展名）精确匹配已录入选手名字（同名取先录入者），命中走 saveProfilePlayerAvatar 同管线（魔数校验 + sharp 480×480 PNG 落盘），未命中/失败不落盘并在回执 `{ success, profiles, matched, unmatched, failed }` 中列出由前端弹窗提醒；中文文件名经表单字段 names（JSON 数组，与文件顺序对齐）传递（multer 将 multipart 文件名按 latin1 解码会乱码，字段值按 UTF-8），names 缺失时回退 originalname 的 latin1→utf8 修复；成功广播 profiles:update | electron/socket-server.ts |
| 上传战队 logo | POST | /api/upload/team-logo/:teamId | 上传战队 logo（魔数校验，sharp cover 铺满裁剪 192×192 PNG，存 cache/profiles/teams/<id>.png） | electron/socket-server.ts |

## 精灵接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 搜索精灵 | GET | /api/sprites | 搜索精灵（支持 q 参数），返回 `{ sprites, count }`；每条记录含 id / path（立绘）/ iconUrl（头像，/resources/sprites-icon/{pet_id}_{name}.png，空串回退立绘） | electron/socket-server.ts |
| 快速填充 | POST | /api/quick-fill | 快速填充阵容 | electron/socket-server.ts |

## 图片接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取双面板 | GET | /api/images | 获取双面板状态 | electron/socket-server.ts |
| 获取头像 | GET | /api/avatars | 获取左右头像状态 | electron/socket-server.ts |
| 上传头像 | POST | /api/upload/avatar/:side | 上传头像（side: left/right） | electron/socket-server.ts |
| 删除头像 | DELETE | /api/delete/avatar/:side | 删除头像 | electron/socket-server.ts |
| 读取左头像图片 | GET | /api/avatar/left-avatar.png | 输出左侧头像图片 | electron/socket-server.ts |
| 读取右头像图片 | GET | /api/avatar/right-avatar.png | 输出右侧头像图片 | electron/socket-server.ts |

## 配置接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取运行时配置 | GET | /api/runtime-config | 获取运行时配置 | electron/socket-server.ts |
| 保存运行时配置 | POST | /api/runtime-config | 保存运行时配置 | electron/socket-server.ts |