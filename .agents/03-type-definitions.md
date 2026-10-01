# 类型定义索引

## 精灵相关

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| SpriteRecord | 精灵记录（id, name, displayName, number, filename, path, iconUrl, attribute/attributeCodes/attributeIcon1/2, aliases, form, petForm, isFinalForm）。name 为全称（含形态后缀，如 海枝枝（碧蓝珊瑚）），displayName 为短名（海枝枝），无形态时两者相同。iconUrl 为精灵头像 URL（/resources/sprites-icon/{pet_id}_{name}.png，空串表示无头像，展示端回退立绘 path） | shared/types.ts |
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
| ScoreboardState | 记分牌状态（leftName, leftScore, leftRank, rightName, rightScore, rightRank, bestOf, scoreboardEnabled, eventTitle, eventTitleEnabled, page2LineupDisplayMode, page5Title, page6Title, nameFontSize, scoreFontSize, mtime）。leftRank/rightRank 为选手排位排名（仅数字字符串，空 = 未输入，由赛事同步）；page5Title/page6Title 为推流页5/6 的标题（后台「直播推流」显示设置） | shared/types.ts |

## 直播推流（stage）

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| StagePageKey | 推流页面 key：page1-overlay / page2 / page3 / page4 / page5 / page6 / page7 / page8 / page9 / page10 / page11 / page12 / page13 / page14 / blank。page4 为 MVP 结算画面；page11/12/13 为选手介绍三画面（同一页面文件 ?mode=left/right/versus）；page14 为晋级积分榜（只统计系列赛赛果，每页最多 32 行） | shared/types.ts |
| StageTransitionType | 过渡效果：none / blinds / wolf | shared/types.ts |
| StageConfig | 推流载体配置（page, transition, mirrorSides, page3SpriteSource, page3RankVisible, page3TeamVisible, page3RedLightMode, page11RankVisible, page5Player, page5TournamentId, page10Duration, page10DurationUnit, mtime）。mirrorSides 为页面1-3 阵容镜像反转（仅展示层左右互换，数据/胜负登记/红光判定口径不变，导播切视角用）；page3RankVisible 控制页面3排位排名图标显隐；page3TeamVisible 控制页面3左右两侧战队标识 div 显隐；page3RedLightMode 为页面3红光特效持久策略（off/auto）；page3RedLightInstant 为一次性「立即显示」（进入下一局自动清除，不影响策略）；page11RankVisible 控制选手介绍排位排名 div 显隐；page5TournamentId 为页面5系列赛过滤 id（空=全部，T 前缀白名单校验，展示名由排行接口解析下发）；page10Duration/page10DurationUnit 为胜负登记后自动切入 page10 的停留时长 | shared/types.ts |
| Page6State | 比赛结果页配置（matchIds 最多 9 个已结束比赛且顺序即卡片场序, title 大标题（空=前端兜底「比赛结果」）, startTime 第一场开始时间 HH:mm, matchTimes 按比赛 id 的固定时间（推送时固化、可手改）, mtime） | shared/types.ts |
| Page7State | 对局推送页配置（matchIds 最多 9 场任意状态比赛, title 主标题留空用默认「对局推送」, notice 温馨提示留空用默认, mtime） | shared/types.ts |
| Page8State | 比赛预告页配置（matchIds 最多 9 个待开始/进行中比赛且顺序即卡片场序, title 大标题（空=兜底「比赛预告」）, startTime, matchTimes 按比赛 id 的固定时间（推送时固化、可手改），mtime）。背景固定蓝色渐变无背景类型字段 | shared/types.ts |
| 场序时间排期 | normalizeHHmm / addMinutesToHHmm / computeScheduleTimes / formatScheduleLabel / CHINESE_ORDINALS / MATCH_SLOT_MINUTES_PER_BO(30)：第一场=startTime，之后每场按 Σ(BO×30 分钟) 累加，手动覆盖只替换该场不影响后续；electron 下发与后台选场弹窗共用 | shared/match-schedule.ts |
| Page9TeamEntry | 团队积分榜单支战队录入项（name 战队名称, r1/r2/r3 三轮积分仅数字字符串, 空字符串 = 未输入显示「-」） | shared/types.ts |
| Page9State | 团队积分榜配置（title 主标题留空用默认「团队积分榜」, teams 最多 4 支战队, 排名与总积分由页面自动计算不落盘, mtime） | shared/types.ts |
| StageStandingRow | 晋级积分榜单行选手战绩：playerId / name（档案名，缺失回退 id）/ rank（同分按种子顺序依次编号）/ wins / losses / score（10×胜 − 负，只用于排序）/ state（alive 存活 / promoted 已晋级 / eliminated 已淘汰，淘汰行页面压暗） | shared/types.ts |
| StageStandings | 某阶段完整榜单：stageIndex / stageName / format / bestOf / total / pageSize / pageCount（至少 1）/ completedMatches / totalMatches / rows（全部参赛者，分页由展示页按 pageSize 切片） | shared/types.ts |
| Page14State | 晋级积分榜配置：tournamentId（空 = 未选择）/ stageIndexes（可播阶段，弹窗一次性选中）/ activeStageIndex（-1 = 未选）/ page（0 起，每页 PAGE14_ROWS_PER_PAGE=32 行，由裁判端后台翻页）/ title / subtitle（留空各自兜底）/ mtime | shared/types.ts |
| Page11SideConfig | 选手介绍单侧配置（source: manual/match, name/rank/declaration/pets 手动填写, 留空字段回退「信息录入」按名字匹配值） | shared/types.ts |
| Page11State | 选手介绍（page11-13）状态（left, right 两侧 Page11SideConfig, mtime） | shared/types.ts |
| NextGameDurationUnit | 停留时长单位：seconds / minutes | shared/types.ts |
| NextGameState | 下场对局配置（matchId, visible, duration, durationUnit, shownAt 自动隐藏倒计时, mtime） | shared/types.ts |
| NextGamePayload | 下场对局完整载荷（state, match, avatars）——page3 / 后台 / 悬浮窗共用 | shared/types.ts |
| CountdownTheme | 倒计时配色：dark / light | shared/types.ts |
| CountdownState | 倒计时插件状态（visible, running, duration 分钟, remainingSeconds, endAt, theme, mtime） | shared/types.ts |
| CountdownPayload | 倒计时 API/Socket 载荷（state, serverNow 供客户端校准时钟偏差） | shared/types.ts |
| MvpSlotEntry | MVP 结算（page4）单个精灵项（petId 精灵主键, tag 标签最多四字可空, isMvp 是否标记 MVP——全页最多一个） | shared/types.ts |
| MvpState | MVP 结算（page4）状态（slots 最多 6 个精灵项顺序即页面从左到右, returnPage 关闭结算后切回的推流画面, winner 已载入的胜方快照或 null, mtime） | shared/types.ts |
| MvpWinnerSnapshot | MVP 结算（page4）胜方快照（matchId 胜方所属比赛 id 用于解析头像, side left/right, playerName 保存时的胜方选手名字）——后台「载入当前对局胜方」写入 mvp.json，切换对局不改变 | shared/types.ts |
| MvpWinnerInfo | MVP 结算（page4）胜方选手信息条（side left/right/null, playerName, avatarExists/avatarPath/avatarMtime——由已保存的胜方快照下发） | shared/types.ts |


## 比赛记录

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| MatchSlotSnapshot | 比赛格子快照（slot, pet_id, name, form 及外观/血量字段） | shared/types.ts |
| GameRecord | 单局比赛记录（gameNumber, status, leftLineup, rightLineup, winner） | shared/types.ts |
| MatchRecord | 完整比赛记录（id, createdAt, updatedAt, status, leftPlayer, rightPlayer, leftRank, rightRank, leftTeamId, leftTeamName, rightTeamId, rightTeamName, bestOf, games, leftScore, rightScore, winner, completedAt, tags, 可选 tournamentRef）。leftRank/rightRank 为左右选手排位排名（仅数字字符串，空 = 未输入）；leftTeamId/rightTeamId 为所属战队 id（命中「信息录入」战队时有值），leftTeamName/rightTeamName 为战队名称（空 = 未填写）；tournamentRef 为系列赛关联（tournamentId/nodeId/stageIndex/waveIndex），普通手建比赛无此字段 | shared/types.ts |
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
| ProfileStoreState | 录入存储状态（players, teams, **playerAliases/teamAliases** = 外部档案 id → 本机 id 的别名表, mtime），落盘 cache/profiles.json | shared/types.ts |
| PetSuggestionReview | 常用精灵导入未命中 pets.json 的兜底回执（name 选手名, input 未命中输入, candidates 最多 5 个候选含 name/number） | electron/services/profile-service.ts |

## 双机数据同步

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| SyncBundle | 同步包（app/schema/machine/exportedAt/matches/tournaments，可选 profiles 与 avatars——头像 base64 按档案 id 归属） | shared/types.ts |
| SyncBundlePlayerProfile / SyncBundleTeamProfile | 同步包内嵌档案条目（Pick 去掉 avatarExists/logoMtime 等本地派生字段） | shared/types.ts |
| SyncConflictMode | 导入冲突策略（newer 较新覆盖 / bundle 以包为准） | shared/types.ts |
| SyncImportItem | 导入预览明细项（key/kind/id/label/action/reason/localUpdatedAt/incomingUpdatedAt，conflict 双方都登记过且内容不同、diff 字段级差异列表、avatarCompare 档案项的头像左右对照、blocked 命中本机「已删对局名单」拦截＝合并不会写入） | shared/types.ts |
| SyncImportDiffField | 导入预览的字段级差异项（label 字段名, local 本机值, incoming 包内值） | shared/types.ts |
| SyncImportAvatarCompare | 导入预览的头像/logo 左右对照（localUrl 本机头像地址、incomingDataUrl 包内头像 data URL、note 处理说明） | shared/types.ts |
| SyncImportPreview | 导入预览（meta/sameMachine/mode/matchItems/playerItems/teamItems/tournamentGroups/hasTournaments/summary/avatars 统计） | shared/types.ts |
| SyncImportTournamentGroup | 预览里的系列赛分组（key/id/name/incoming 本包含编排/existsLocally/playerCount/stageSummary/matchKeys/selectableCount/tombstone 上游墓碑不可取消/localRemoved 已本机移除保持隐藏/localTombstone 本机已删除名单对局将被拦截），用于「这条系列赛包含哪些比赛」与整条勾选 | shared/types.ts |
| SyncImportResult | 导入结果（store/profiles/avatarsWritten/tournaments/warnings/applied） | shared/types.ts |
| SyncTournamentReport | 系列赛导入合并与写回统计（added/updated/skipped/rejected/advanced——advanced = 写回补跑是否真正改动系列赛） | shared/types.ts |
| SyncImportCounts / SyncAvatarCounts | 逐类 新增/更新/跳过 计数；头像 补缺/已有/无法对应 计数 | shared/types.ts |
| NormalizedMatchImport / MatchImportDecision / MergeMatchRecordsReport | 比赛导入：规范化结果、逐条判定、合并回报 | electron/services/match-service.ts |
| ProfileImportInput / ProfileImportDiff / MergeProfileRecordsReport | 档案导入：输入、逐条判定与合并回报（报告带 `aliases`：本次登记的 id 别名） | electron/services/profile-service.ts |

## 云同步（点击式：Cloudflare Worker + KV 信箱）

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| CloudSyncRole | 角色（main 主控端 = 编排机 + 确认台 / sub 分控端 = 只读副本 + 登记点）。**主/分不靠 machineCode 表达** | shared/types.ts |
| CloudSyncOffer | 随分发包下发的策略载荷（roster 名册 + assignment.overrides 指派规则），挂在 SyncBundle.cloud 上 | shared/types.ts |
| CloudSyncRosterEntry | 名册条目（code 机器码 + label 显示名，label 纯展示） | shared/types.ts |
| CloudSyncVersion | 云端小版本键（v 版本号 / at 时间 / from 分发机码），供红点轮询不读大包 | shared/types.ts |
| CloudSyncUplinkPayload | 分控回传载荷（from/seq/submittedAt/matches，matches 是**未 ack 的累计集合**而非增量） | shared/types.ts |
| CloudSyncAckPayload | 主控回执（ackedMatchIds/ackedSeq/at；逐场确认时只带已确认的 matchId） | shared/types.ts |
| CloudSyncPendingMatch / CloudSyncPendingQueue | 待回传集（分控现算：已完赛 + 归本机登记 + 未 ack）及其序号、回执 id | shared/types.ts |
| CloudSyncInboxEntry | 主控收件箱条目（按分控端分组：code/label/seq/submittedAt/pending） | shared/types.ts |
| CloudSyncStatus | 云同步状态（config/configured/version/appliedVersion/pending/inbox/roster/assignment/excludedTournamentIds B1 记忆的默认排除/lastContact/lastError），两端共用 | shared/types.ts |
| CloudSyncPollResult | 红点轮询结果（version/changed/inbox/status），只读小键、绝不合并 | shared/types.ts |
| CloudSyncAckItem / CloudSyncAckSource | 确认台条目（item = 复用 SyncImportItem，record = 待合并比赛，impact = 写回影响说明）与分控端分组 | shared/types.ts |
| CloudSyncPushResult / CloudSyncPullResult / CloudSyncUploadResult / CloudSyncCheckResult / CloudSyncConfirmResult / CloudSyncRejectResult / CloudSyncTestResult | 四类点击动作与自检的结果载荷 | shared/types.ts |
| CloudSyncActionResult<T> | 云动作通用回执（status 更新后的 CloudSyncStatus + data 动作自身结果） | shared/types.ts |
| MachineCodeGuardResult | 改 machineCode 守卫结果（blocked 拒绝 / requireConfirm 要求二次确认 / tournamentIds 受影响系列赛 / message 中文说明） | shared/types.ts |
| CloudSyncBoxName | KV 信箱名（downlink / version / uplink/{码} / ack/{码}） | shared/types.ts |

## 快照和通信

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| SnapshotPayload | Socket 快照负载（panels, scoreboard, avatars, store 即 MatchStoreState, stage, page6, page7, page8, page9, page11, page14, nextgame, profiles, countdown, mvp, tournaments）。注意字段名是 `store` 不是 `matches`；tournaments 为系列赛编排记录列表；page14 只有配置，榜单要另取 GET /api/page14；locallyRemoved = 本机已「本机移除」的系列赛（localOnly，仅本机读取口径、绝不外传） | shared/types.ts |
| SOCKET_EVENTS | Socket 事件名称常量对象 | shared/events.ts |

## 数据统计（管理后台本地）

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| SpriteUsageRow | 精灵统计行（name, usagePercent, appearancePercent, winRate, attributes, dailyGames, key 等） | src/admin-antd/lib/stats.ts |
| StatsMetricKey | 统计口径：pickRate / appearanceRate | src/admin-antd/lib/stats.ts |
| StatsRangeKey | 统计范围：today / 7d / 30d / all | src/admin-antd/lib/stats.ts |

## 系列赛自动化管理

| 类型名称 | 说明 | 文件 |
|---------|------|------|
| StageFormat | 阶段晋级赛制：'double-life'（双败积分：2胜晋级/2败淘汰、最多 3 波）/ 'single-elim'（单败：1 波定胜负） | shared/types.ts |
| PairingRule | 配对规则：'random-bucket'（双败同桶随机）/ 'manual-bucket'（双败同桶手动，配对确认台）/ 'bracket-seed'（单败种子位沿树推进）/ 'random-round'（单败每轮重新随机，备选） | shared/types.ts |
| StageRule | 阶段规则（id, name 阶段名, format, bestOf 1/3/5/7, pairing, avoidRematch, requireConfirm）。requireConfirm = 下一波/下一阶段需手动确认（否则自动锁定建场） | shared/types.ts |
| TournamentEntry | 选手当前阶段战绩（playerId, stageWins, stageLosses, state: alive/promoted/eliminated），换阶段清零 | shared/types.ts |
| TournamentNode | 系列赛节点（id 形如 s0-w2-n03, matchId 关联比赛, playerAId/playerBId, winnerId, isBye, next? 单败树连线——V1 单败每阶段一波未用） | shared/types.ts |
| TournamentWave | 波次（stageIndex, waveIndex 双败1..3/单败1, status: pending/running/completed, pairingStatus: draft/locked, pairingDraft? 草稿, nodes） | shared/types.ts |
| PairingSlot | 配对确认台槽位（bucketKey? 桶 key，单败 undefined, playerId 可空） | shared/types.ts |
| TournamentRecord | 系列赛记录（id 形如 T20260928_A01, name, createdAt/updatedAt, status: setup/running/completed, seed, drawVersion, playerIds, stages, currentStageIndex, entries, waves, result? championId/runnerUpId）；墓碑字段 deletedAt/deletedMatchIds/deletedMatches（随同步传播）；localOnly = 本机移除标记（仅本机存在、绝不外传、不解绑/不删对局、恢复即清） | shared/types.ts |
| PairingValidation | 配对校验结果（valid, errors, warnings——已交手仅提醒不阻断） | shared/types.ts |
| PairingImportResult | 外部对阵导入结果（tournament, unmatched 未能唯一匹配档案的行） | shared/types.ts |