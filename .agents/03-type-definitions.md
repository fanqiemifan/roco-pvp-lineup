# 类型定义索引

## 精灵相关

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| SpriteRecord | 精灵记录（id, name, displayName, chineseName, number, variant, filename, path, iconUrl, attributes, aliases, form）。iconUrl 为精灵头像 URL（/resources/sprites-icon/{pet_id}_{name}.png，空串表示无头像，展示端回退立绘 path） | shared/types.ts |
| QuickFillMatch | 快速填充匹配结果（sprite, formLabel, rank） | shared/types.ts |
| QuickFillPreview | 快速填充预览结果汇总（matches, message） | shared/types.ts |

## 面板状态

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| SlotState | 单个格子状态（slotIndex, sprite, opacity, saturation, healthPercent, energyValue） | shared/types.ts |
| PanelState | 面板状态（position, count, selected, mtime） | shared/types.ts |

## 记分牌

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| ScoreboardState | 记分牌状态（leftName, leftScore, leftRank, rightName, rightScore, rightRank, bestOf, scoreboardEnabled, eventTitle, eventTitleEnabled, page2LineupDisplayMode, nameFontSize, scoreFontSize, mtime）。leftRank/rightRank 为选手排位排名（仅数字字符串，空 = 未输入，由赛事同步） | shared/types.ts |

## 仅显阵容（page4）

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| Page4SlotState | page4 单个格子（slotIndex, sprite, opacityEnabled, opacity, saturation, healthEnabled, healthPercent, energyValue） | shared/types.ts |
| Page4PanelState | page4 面板（position, count, selected, mtime） | shared/types.ts |
| Page4State | page4 整体状态（left, right） | shared/types.ts |

## 直播推流（stage）

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| StagePageKey | 推流页面 key：page1-overlay / page2 / page3 / page5 / page6 / page7 / page9 / blank | shared/types.ts |
| StageTransitionType | 过渡效果：none / blinds / zoom | shared/types.ts |
| StageConfig | 推流载体配置（page, transition, page3SpriteSource, page3RankVisible, page3TeamVisible, page5Title, page5Player, page5Tag, mtime）。page3RankVisible 控制页面3排位排名图标显隐；page3TeamVisible 控制页面3左右两侧战队标识 div 显隐 | shared/types.ts |
| Page6State | 比赛结果页配置（matchIds 最多 8 个已结束比赛, title 副标题, mtime） | shared/types.ts |
| Page7State | 对局推送页配置（matchIds 已结束比赛, title 主标题留空用默认「对局推送」, notice 温馨提示留空用默认, mtime） | shared/types.ts |
| Page8State | 比赛预告页配置（matchIds 最多 4 个待开始/进行中比赛, title, background image/image-2/custom, wallpaperUrl, mtime） | shared/types.ts |
| Page8Background | 页面8背景类型：image / image-2 / custom（自定义上传壁纸） | shared/types.ts |
| Page9TeamEntry | 团队积分榜单支战队录入项（name 战队名称, r1/r2/r3 三轮积分仅数字字符串, 空字符串 = 未输入显示「-」） | shared/types.ts |
| Page9State | 团队积分榜配置（title 主标题留空用默认「团队积分榜」, teams 最多 4 支战队, 排名与总积分由页面自动计算不落盘, mtime） | shared/types.ts |


## 比赛记录

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| MatchSlotSnapshot | 比赛格子快照（slot, pet_id, name, form 及外观/血量字段） | shared/types.ts |
| GameRecord | 单局比赛记录（gameNumber, status, leftLineup, rightLineup, winner） | shared/types.ts |
| MatchRecord | 完整比赛记录（id, createdAt, updatedAt, status, leftPlayer, rightPlayer, leftRank, rightRank, leftTeamId, leftTeamName, rightTeamId, rightTeamName, bestOf, games, leftScore, rightScore, winner, completedAt, tags）。leftRank/rightRank 为左右选手排位排名（仅数字字符串，空 = 未输入）；leftTeamId/rightTeamId 为所属战队 id（命中「信息录入」战队时有值），leftTeamName/rightTeamName 为战队名称（空 = 未填写） | shared/types.ts |
| MatchStoreState | 比赛存储状态（matches, activeMatchId, mtime） | shared/types.ts |

## 头像

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| AvatarState | 单个头像状态（side, exists, path, size, mtime） | shared/types.ts |
| AvatarCollectionState | 左右头像集合（left, right） | shared/types.ts |

## 信息录入（选手/战队档案）

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| PlayerProfile | 选手录入（id, name, pets 常用精灵, declaration 宣言, rank 排名仅数字, avatarExists, avatarMtime） | shared/types.ts |
| TeamProfile | 战队录入（id, name, captain 队长, declaration 宣言, logoExists, logoMtime） | shared/types.ts |
| ProfileStoreState | 录入存储状态（players, teams, mtime），落盘 cache/profiles.json | shared/types.ts |
| PetSuggestionReview | 常用精灵导入未命中 pets.json 的兜底回执（name 选手名, input 未命中输入, candidates 最多 5 个候选含 name/number） | electron/services/profile-service.ts |

## 快照和通信

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| SnapshotPayload | Socket 快照负载（panels, page4, scoreboard, avatars, matches, stage, page6, page7, page8, page9, nextgame, profiles） | shared/types.ts |
| SOCKET_EVENTS | Socket 事件名称常量对象 | shared/events.ts |

## 数据统计（管理后台本地）

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| SpriteUsageRow | 精灵统计行（name, usagePercent, appearancePercent, winRate, attributes, dailyGames, key 等） | src/admin-antd/lib/stats.ts |
| StatsMetricKey | 统计口径：pickRate / appearanceRate | src/admin-antd/lib/stats.ts |
| StatsRangeKey | 统计范围：today / 7d / 30d / all | src/admin-antd/lib/stats.ts |