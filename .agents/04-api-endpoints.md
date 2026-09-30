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
| 删除比赛 | DELETE | /api/matches/:matchId | 删除单个比赛；响应额外回带 pagePush（推流选场清理结果，仅含发生变化的页面） | electron/socket-server.ts |
| 选择活动比赛 | POST | /api/matches/:matchId/select | 选择活动比赛 | electron/socket-server.ts |
| 开始小局 | POST | /api/matches/:matchId/start | 开始当前小局 | electron/socket-server.ts |
| 录入小局阵容 | POST | /api/matches/:matchId/games/:gameNumber/lineup | 为当前小局（待开始）录入双方阵容（body: selections.left/right；双侧合并一次写入 + 单次广播 matches:update，不触碰面板/记分牌/activeMatchId；比赛管理「录入阵容」用） | electron/socket-server.ts |
| 记录胜负 | POST | /api/matches/:matchId/winner | 记录本局胜负 | electron/socket-server.ts |
| 撤销操作 | POST | /api/matches/:matchId/undo | 撤销操作；系列赛对局会先跑 onMatchUndo 反向钩子（清节点胜者、必要时级联丢弃「自动锁定且未开打」的后续波），钩子失败则整个撤回 400、比赛不动（避免「比赛撤了、系列赛仍显示晋级」） | electron/socket-server.ts |
| 恢复操作 | POST | /api/matches/:matchId/redo | 恢复操作 | electron/socket-server.ts |
| 批量删除比赛 | POST | /api/matches/batch-delete | 批量删除比赛（body: matchIds）；响应额外回带 pagePush（推流选场清理结果，仅含发生变化的页面） | electron/socket-server.ts |
| 撤销删除 | POST | /api/matches/undo-delete | 撤销删除 | electron/socket-server.ts |

## 数据同步接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 导出同步包 | POST | /api/sync/export | 导出同步包（body: includeProfiles / includeAvatars）；比赛含全部场次（含空白/进行中，基线分发需要）+ 系列赛编排全量，头像 base64 内嵌且仅在包含档案时附带 | electron/socket-server.ts |
| 导入预览 | POST | /api/sync/preview | 只读解析同步包并返回逐条「新增/更新/跳过」（multipart: file + mode，mode = newer/bundle），不写入任何数据；另返回 `tournamentGroups`（按系列赛分组的比赛，含「普通对局」组）与 `hasTournaments`，供预览弹窗区分系列赛及其比赛 | electron/socket-server.ts |
| 应用导入 | POST | /api/sync/import | 按勾选条目合并比赛与档案、按需写头像（目标档案按「id 别名 → 源 id → 同名」解析、用本机 id 落盘；默认只补缺，`overwriteAvatars=true` 才覆盖本机已有头像/logo）；系列赛编排自动合并（不参与勾选）并补跑写回（幂等，波打齐自动推进）（multipart: file + mode + accepted（JSON 数组）+ excludeTournamentIds（JSON 数组，取消勾选的系列赛整条不导入：编排不合并且其名下比赛不写入）+ includeAvatars + overwriteAvatars），成功后广播 matches:update（含档案变更时另广播 profiles:update + avatar:update；系列赛有新增/更新/推进时另广播 tournament:update） | electron/socket-server.ts |

> 数据同步上传走独立 multer 实例（单文件，上限 SYNC_BUNDLE_MAX_BYTES = 64MB），不经过全局 express.json（2mb），避免大包被拦；超限/坏包统一 400 中文提示。

## 云同步接口（点击式 · Cloudflare Worker + KV 信箱）

> 全部为 POST/GET 且**强制登录**：鉴权开启（Node/Docker 模式）时中间件对 `/api/cloud-sync/*` 单独拦截返回 401，不落入公开 GET 页面接口白名单。
> 写操作 body 统一带 `syncKey` + `syncToken` + `machineCode`（readCloudRequest 校验：密钥/令牌必须与已保存的一致、机器码必须已设置），否则 400 中文提示。

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 云同步状态（轮询用） | GET | /api/cloud-sync/status | 只读本机状态文件，**不产生任何云端请求**：config/version/appliedVersion/pending/inbox/roster/assignment/ownedTournamentIds/lastContact/lastError | electron/socket-server.ts |
| 红点轮询 | POST | /api/cloud-sync/poll | 只读云端**小键**：version（两端）+ ack:{本机码}（分控端清待回传标记）+ uplink:{各分控码}（主控端刷新收件箱）。**绝不读大包、绝不合并数据** | electron/socket-server.ts |
| 保存云同步设置 | POST | /api/cloud-sync/config | body: syncKey/syncToken/role/workerUrl/machineLabel/pollEnabled/pollIntervalSeconds/peerCodes（仅主控端填分控码列表）。落 runtime/config.json；peerCodes 并入名册 | electron/socket-server.ts |
| 检测 Worker 在线 | POST | /api/cloud-sync/test | body 可带 workerUrl/syncKey/syncToken（先按当前草稿存下来，省一步「保存设置」；`undefined` = 保持已保存值，空串 = 主动清空）。打 Worker `/health`：**不需要令牌也不碰 KV**，避免为测通白扣读写额度；返回 `ok` + 中文原因 + `health.tokenConfigured`（Worker 没配 SYNC_TOKEN 时明确提示去 `wrangler secret put`） | electron/socket-server.ts |
| 主控「同步分发」 | POST | /api/cloud-sync/push | 组包（matches + tournaments + profiles，**不带头像**）+ 指派规则 + 名册 → 写 downlink，再写 version（小键）。每次覆盖（幂等全量）；版本号 = 本机记录的版本 + 1 | electron/socket-server.ts |
| 分控「同步最新」（拉取 + 预览） | POST | /api/cloud-sync/pull | 读 downlink → 配对校验（本机码不能等于分发机码，否则 400）→ 落盘 cache/cloud-pending.json 并返回与「导入同步包」完全一致的预览（字段级 diff、逐条勾选），**不写入任何数据** | electron/socket-server.ts |
| 分控「确认合并」 | POST | /api/cloud-sync/apply | body: accepted（勾选 key 数组）+ mode（默认 newer：分控本地较新的登记不会被压掉）+ excludeTournamentIds（预览里取消勾选的系列赛：整条不导入，含其名下比赛）→ 走现有 applySyncImport 合并 → 重算待回传集 → 广播 matches:update + tournament:update | electron/socket-server.ts |
| 分控「无需改动，标记为已处理」 | POST | /api/cloud-sync/skip | 预览里全是「不用改」的条目时收尾状态（只推进 appliedVersion，不写入任何数据），避免红点一直挂着 | electron/socket-server.ts |
| 分控「回传」 | POST | /api/cloud-sync/upload | **现算**所有未 ack 比赛的累计集合（不是增量）→ 写 uplink:{本机码}，seq + 1；无待回传 400「无待回传」 | electron/socket-server.ts |
| 主控「检查回传」 | POST | /api/cloud-sync/check | body.code 可空（空取最近提交的分控端）；逐分控端读 uplink → 包装成 SyncBundle → 复用现有预览（matchItems）+ 每条附 impact 写回影响说明；**不写入任何数据** | electron/socket-server.ts |
| 主控确认（确认台） | POST | /api/cloud-sync/confirm | body: code + accepted。服务端重分类（不盲信分控端勾选）→ 只合并被确认的比赛（skipTournaments：编排结构绝不用分控副本覆盖）→ runTournamentWriteBack 推进波次 → 写回执 ack:{code} → 从收件箱移除已确认条目；广播 matches:update + tournament:update。**被勾选的条目即使是「内容一致（action=skip）」也照样确认**：这类不写数据、只回执 + 幂等补跑一次写回，否则主控会卡在「没有需要更新的内容」而对方永远停在「等主控确认」 | electron/socket-server.ts |
| 主控驳回 | POST | /api/cloud-sync/reject | body: code。**不写本地、不写回执**，分控端保持「待回传」 | electron/socket-server.ts |
| 保存指派规则 | POST | /api/cloud-sync/assignment | body.overrides = 比赛 id -> 登记机器码（空字符串 = 主控端自己登记）；自动清掉已不存在比赛的条目；随下次「同步分发」写入 downlink 生效 | electron/socket-server.ts |
| 登记入口判定 | POST | /api/cloud-sync/registration-scope | body.matchIds；返回逐场 {allowed, reason} + role + pending（待回传集）。一次问一批（列表逐行渲染，不能逐行打接口） | electron/socket-server.ts |

> 登记闸门（分控端只能登记指派给本机的比赛）：`POST /api/matches/:matchId/winner`、`/start` 经 `canRegisterMatch` 校验，`/undo` 经 `checkSubUndoAllowed` 校验（已 ack 禁撤回）。未启用云同步（没填 syncKey/机器码）时闸门放行，保持单机行为。

## 系列赛接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取系列赛列表 | GET | /api/tournaments | 获取全部系列赛编排记录（公开 GET 未列入白名单——V1 仅管理端用，开启鉴权时需登录） | electron/socket-server.ts |
| 获取系列赛详情 | GET | /api/tournaments/:tournamentId | 获取单个系列赛；不存在 404 | electron/socket-server.ts |
| 创建系列赛 | POST | /api/tournaments | 创建 setup 草稿（body: name/playerIds/stages?/seed?）；playerIds 必须全部来自信息录入档案、人数 4/8/16/32；stages 省略时用 buildDefaultStages 默认模板；**只剩 2 人的阶段（总决赛）必须为单败，否则 400「总决赛阶段必须为单败」**；成功广播 tournament:update | electron/socket-server.ts |
| （重）抽签 | POST | /api/tournaments/:tournamentId/draw | 仅 setup 可用；按新 seed（body.seed 可传）重洗种子顺序、drawVersion +1；重抽结果只取决于 seed 与选手集合（从字典序做位置洗牌，可复现） | electron/socket-server.ts |
| 首波对阵预览 | GET | /api/tournaments/:tournamentId/opening-wave | 只读：按当前 seed 走与 materializeWave 相同的 generateDraftPairs 返回首波配对（pairs），不落盘不建场；仅 setup 可用，开赛后/不存在 400。供抽签面板展示「重抽换了什么」 | electron/socket-server.ts |
| 开赛 | POST | /api/tournaments/:tournamentId/start | setup → running，生成阶段 0 第 1 波：随机自动且无需确认 → 锁定并批量建场；手动配对/requireConfirm → 停在 draft。建场后另广播 matches:update | electron/socket-server.ts |
| 确认推进 | POST | /api/tournaments/:tournamentId/advance | requireConfirm 的确认动作：对最后波 draft（随机配对）重新随机并锁定建场；手动配对波拒绝（请在配对确认台编辑后锁定） | electron/socket-server.ts |
| 暂存配对草稿 | PUT | /api/tournaments/:tournamentId/waves/:waveGlobalIndex/pairings | 配对确认台编辑即存（body: pairings）；中间态允许漏配/重复，仅做字段白名单与选手范围校验，不建场 | electron/socket-server.ts |
| 锁定配对 | POST | /api/tournaments/:tournamentId/waves/:waveGlobalIndex/pairings/lock | 校验（每人恰好一次/同桶严格/跨桶需 body.allowCrossBucket）通过后批量 createMatch，比赛带 tournamentRef 与自动标签（赛事名+阶段名+W波次，跨桶加「跨桶」）；广播 matches:update + tournament:update | electron/socket-server.ts |
| 导入外部对阵 | POST | /api/tournaments/:tournamentId/waves/:waveGlobalIndex/pairings/import | body.text（每行 `A vs B`）或 body.pairs（名字数组）；匹配池仅本波选手，先精确后子串模糊，未唯一匹配的行进入 unmatched，已匹配的回填草稿（不锁定） | electron/socket-server.ts |
| 回退上一波 | POST | /api/tournaments/:tournamentId/rollback-wave | 管理级回退：仅最后波、且该波比赛全部 pending 无小局结果；删除未打比赛（deleteMatches 可恢复）、清节点胜者并复位战绩；跨阶段时 currentStageIndex 回落。广播 matches:update + tournament:update | electron/socket-server.ts |
| 弃权判负 | POST | /api/tournaments/:tournamentId/forfeit | body: matchId + loserSide(left/right)；校验比赛属于本系列赛且 pending，补决胜小局（BO1=1:0、BO3=2:0）+「弃权」标签，completed 后走完成钩子写回节点 | electron/socket-server.ts |
| 删除系列赛 | DELETE | /api/tournaments/:tournamentId | body.deleteMatches 可空：默认只删编排记录，关联比赛先解除 tournamentRef 再保留（转为普通对局，标签/战绩不动）；deleteMatches=true 时解绑后再 deleteMatches 连对局一起删（进删除栈，比赛管理可「撤回最近删除」，恢复后也是无关联普通对局）。广播 matches:update + tournament:update；不存在 400 | electron/socket-server.ts |

> 系列赛关联保护：DELETE /api/matches/:matchId 与批量删除遇 tournamentRef 一律 400（提示用回退上一波）；POST /api/matches 公开入口会剥离 body.tournamentRef（系列赛比赛只能由引擎锁定时内部创建）。解除关联的唯一正规入口是 DELETE /api/tournaments/:tournamentId（删除系列赛）；onMatchCompleted/onMatchUndo 遇到已删除系列赛的孤儿引用时返回 null（按普通对局处理，不阻断比分登记/撤回）。

## 直播推流（stage）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取推流配置 | GET | /api/stage | 获取 stage 配置 | electron/socket-server.ts |
| 保存推流配置 | POST | /api/stage | 保存 stage 配置 | electron/socket-server.ts |

## 比赛结果（page6）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取比赛结果页状态与已选比赛 | GET | /api/page6 | 获取 page6 状态、完整比赛数据（公开 GET）、按赛事隔离的选手头像 avatars、场序时间 scheduleTimes（开始时间 + BO×30 分钟累加），以及系列赛阶段语义标签 tournamentLabels（仅系列赛对局有值，如「8进4·胜者组」，普通对局/孤儿引用缺席；由 tournament-service 的 resolveTournamentLabels 解析）；对局未填排位排名时按选手名回退「信息录入」档案排名（对局已填值优先，仅响应层兜底不落盘）；下发的 state.matchIds 先按「比赛仍存在 + 已结束」过滤（见下方推流选场一致性说明） | electron/socket-server.ts |
| 保存比赛结果配置 | POST | /api/page6 | 保存 page6 配置（matchIds 最多 9 个已结束比赛 / title 大标题 / startTime 第一场开始时间 HH:mm / matchTimes 手动时间覆盖） | electron/socket-server.ts |

## 比赛预告（page8）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取比赛预告页状态与已选比赛 | GET | /api/page8 | 获取 page8 状态、完整比赛数据（仅待开始/进行中，公开 GET）、按赛事隔离的选手头像 avatars、场序时间 scheduleTimes，以及系列赛阶段语义标签 tournamentLabels（与 page6 同口径）；排位排名兜底与 page6 一致（未填则按选手名回退档案排名）；下发的 state.matchIds 先按「比赛仍存在 + 待开始/进行中」过滤（见下方推流选场一致性说明） | electron/socket-server.ts |
| 保存比赛预告配置 | POST | /api/page8 | 保存 page8 配置（matchIds 最多 9 个待开始/进行中比赛 / title / startTime / matchTimes，已完成比赛会被过滤） | electron/socket-server.ts |

## 对局推送（page7）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取对局推送页状态 | GET | /api/page7 | 获取 page7 状态与已选比赛数据（公开 GET）；下发的 state.matchIds 先过滤已删除比赛的悬空引用（见下方推流选场一致性说明） | electron/socket-server.ts |
| 保存对局推送配置 | POST | /api/page7 | 保存 page7 配置（matchIds 最多 9 场任意状态比赛 / title 主标题 / notice 温馨提示） | electron/socket-server.ts |

> **推流选场一致性（page6/7/8 通用）**：选场 matchIds 会随比赛数据自动清理——比赛被删除（悬空引用）或状态不再符合该页收录口径（page6 需已结束、page8 需待开始/进行中、page7 不限状态）时，服务端在比赛广播出口 `emitMatchesUpdate` 落盘清理该页选场（`prunePage6State`/`prunePage7State`/`prunePage8State`），**只对发生变化的页面广播 pageN:update**（后台卡片「已选 N/9」随之刷新）；三个 GET 下发前同样按「比赛仍存在 + 符合收录状态」过滤 state.matchIds，保证与 matches 同源（历史遗留悬空数据兜底）。删除类接口（DELETE /api/matches/:matchId、POST /api/matches/batch-delete、删除系列赛连对局、回退上一波）在响应中回带 pagePush（仅含发生变化的页面状态）。

## 团队积分榜（page9）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取团队积分榜状态 | GET | /api/page9 | 获取 page9 标题与战队积分列表（公开 GET） | electron/socket-server.ts |
| 保存团队积分榜配置 | POST | /api/page9 | 保存 page9 配置（title 主标题 / teams 最多 4 支战队的名称与 R1/R2/R3 积分，排名与总积分由前端自动计算） | electron/socket-server.ts |

## 晋级积分榜（page14）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取晋级积分榜配置与榜单 | GET | /api/page14 | 返回 page14 配置（tournamentId / stageIndexes / activeStageIndex / page / title / subtitle，均按系列赛现状夹紧）+ `standings: StageStandings \| null`。榜单由 `resolveStageStandings` **按该阶段现存节点重算**（胜 +1 / 负 +1，排序分 = 10×胜 − 负，同分按种子顺序），只统计系列赛内的比赛；系列赛不存在（被删 / 未同步到本机）或阶段未开打时返回 null / 空行（公开 GET） | electron/socket-server.ts |
| 保存晋级积分榜配置 | POST | /api/page14 | 保存配置后广播 page14:update 并**在响应里带上重算后的 standings**（后台卡片据此立即刷新）。页码越界按 `standings.pageCount` 夹紧；`activeStageIndex` 必须属于 `stageIndexes`，失效时回退第一个已选阶段；阶段索引必须存在于该系列赛 | electron/socket-server.ts |

> **page14 与 page6/7/8 的选场清理无关**：它不保存 matchIds，榜单每次现算，因此没有 `prune*State` 链路；系列赛被删除后 GET 会返回空榜单，后台卡片显示「系列赛不存在或尚未同步到本机」，重新选择即可。
>
> **为什么榜单在服务端算**：`GET /api/tournaments` 不在公开 GET 白名单里（免鉴权的展示页拿不到编排数据），且服务端重算才能规避 `record.entries` 换阶段清零的坑（历史阶段必须按 waves 节点重放）。

## 胜者结算（page10）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取胜者结算画面数据 | GET | /api/page10 | 返回当前活跃比赛与双方头像（公开 GET），页面自行解析最近一个已分胜负的小局胜者 | electron/socket-server.ts |

## 选手介绍（page11-13）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取选手介绍页数据 | GET | /api/page11 | 返回配置 + 信息录入 + 当前赛事（含头像）+ 实时阵容面板 + stage（公开 GET），页面按 mode 自行解析两侧选手 | electron/socket-server.ts |
| 保存选手介绍配置 | POST | /api/page11 | 保存 page11 左右两侧配置（Page11SideConfig：source manual/match + 手动字段），广播 page11:update | electron/socket-server.ts |

## 下场对局（nextgame）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取下场对局状态 | GET | /api/nextgame | 返回 NextGamePayload（state + match + avatars，公开 GET） | electron/socket-server.ts |
| 保存下场对局配置 | POST | /api/nextgame | 保存配置（matchId/duration/durationUnit），广播 nextgame:update，并重排到期自动隐藏定时器 | electron/socket-server.ts |
| 显示下场对局 | POST | /api/nextgame/show | 开启显示（记录 shownAt，按停留时长自动隐藏），广播 nextgame:update | electron/socket-server.ts |
| 隐藏下场对局 | POST | /api/nextgame/hide | 关闭显示，广播 nextgame:update | electron/socket-server.ts |

## 倒计时插件（countdown）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取倒计时状态 | GET | /api/countdown | 返回 CountdownPayload（state + serverNow，公开 GET） | electron/socket-server.ts |
| 保存倒计时配置 | POST | /api/countdown | 保存 duration/theme/visible，广播 countdown:update（state + serverNow） | electron/socket-server.ts |
| 倒计时操作 | POST | /api/countdown/:action | action ∈ show / hide / start / pause / reset，广播 countdown:update | electron/socket-server.ts |

## MVP 结算（page4）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取 MVP 结算状态 | GET | /api/mvp | 返回 `{ state: MvpState, winner: MvpWinnerInfo }`（公开 GET，推流页面4 首拉；winner 由已保存的胜方快照下发，切换对局不改变） | electron/socket-server.ts |
| 保存 MVP 结算配置 | POST | /api/mvp | 保存 slots（最多 6 个精灵项：petId/tag≤4 字/isMvp）、returnPage 与 winner 胜方快照（matchId+side+playerName，传 null 清除；未传字段保留当前值），广播 mvp:update | electron/socket-server.ts |
| 显示 MVP 结算 | POST | /api/mvp/show | 记录当前推流画面到 returnPage，并把 stage.page 切到 page4，广播 mvp:update + stage:update | electron/socket-server.ts |
| 关闭 MVP 结算 | POST | /api/mvp/hide | 把 stage.page 切回 returnPage，广播 stage:update | electron/socket-server.ts |

## 统计接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 精灵排行 | GET | /api/stats/ranking | 精灵使用率/上场率/胜率排行（支持 tag / player 参数，统计全部历史对局） | electron/socket-server.ts |

> 推流页面仅用于展示，以下 GET 接口公开免鉴权：`/api/stage`、`/api/scoreboard`、`/api/stats/ranking`、`/api/page6`、`/api/page7`、`/api/page8`、`/api/page9`、`/api/page10`、`/api/page11`、`/api/page14`、`/api/mvp`、`/api/panels`、`/api/matches`、`/api/sprites`、`/api/nextgame`、`/api/profiles`、`/api/avatars`、`/api/countdown`；同名 POST/DELETE 写操作仍受保护。页面路由同理：`/roco-pvp-page14.html` 与其它推流页一起列在 `isPublicPage` 白名单里。

## 信息录入（选手/战队档案）接口

| 自然语言描述 | 方法 | 路径 | 说明 | 文件 |
|-------------|------|------|------|------|
| 获取录入列表 | GET | /api/profiles | 获取选手与战队录入（公开 GET，推流页9 战队联想/页面3 战队标识依赖） | electron/socket-server.ts |
| 保存选手录入 | POST | /api/profiles/players | 新增/更新选手（未传 id 但同名视为更新；name 必填） | electron/socket-server.ts |
| 导入选手（JSON 批量） | POST | /api/profiles/players/import | 接受数组或 `{players:[...]}`；每条仅识别白名单 name/rank/declaration/pets（其余键忽略防注入），rank 仅纯数字、缺 name 跳过、同名沿用旧 id 更新；pets 仅命中 pets.json 才录入，未命中返回 `review`（每条最多 5 个候选）由前端兜底人工确认；响应 `{ success, profiles, review }`，成功广播 profiles:update | electron/socket-server.ts |
| 删除选手录入 | DELETE | /api/profiles/players/:playerId | 删除选手（连同头像文件） | electron/socket-server.ts |
| 保存战队录入 | POST | /api/profiles/teams | 新增/更新战队（未传 id 但同名视为更新；name 必填） | electron/socket-server.ts |
| 删除战队录入 | DELETE | /api/profiles/teams/:teamId | 删除战队（连同 logo 文件） | electron/socket-server.ts |
| 上传选手头像 | POST | /api/upload/player-avatar/:playerId | 上传选手头像（魔数校验，sharp 裁剪为方形 PNG，存 cache/profiles/players/<id>.png） | electron/socket-server.ts |
| 批量上传选手头像 | POST | /api/upload/player-avatars/batch | multipart 多文件（字段 files，单批上限 100），按图片文件名（去扩展名）精确匹配已录入选手名字（同名取先录入者）；命中走 saveProfilePlayerAvatar 同管线（魔数校验 + sharp 480×480 PNG 落盘），未命中/失败不落盘并在回执 `{ success, profiles, matched, unmatched, failed }` 中列出由前端弹窗提醒；中文文件名经表单字段 names（JSON 数组，与文件顺序对齐）传递（规避 multer 将 multipart 文件名按 latin1 解码的乱码，字段值始终按 UTF-8），names 缺失时回退 originalname 的 latin1→utf8 修复；成功广播 profiles:update | electron/socket-server.ts |
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
| 获取运行时配置 | GET | /api/runtime-config | 获取运行时配置（port、machineCode 本机标识、machineLabel 显示名、syncKey/syncRole/workerUrl/cloudPollEnabled/cloudPollInterval，并附 syncConfig = 完整 CloudSyncStatus，前端「数据同步」卡片一次请求即可渲染云同步区） | electron/socket-server.ts |
| 保存运行时配置 | POST | /api/runtime-config | 保存运行时配置（合并语义：只覆盖传入字段——单传 machineCode 不会重置 port；machineCode 归一化为 1-2 位大写字母，空串 = 未设置）。**改机器码守卫**：有内嵌旧码的 running 系列赛 → 400 拒绝；仅有其它内嵌旧码的系列赛 → 409 要求 body.confirmMachineCodeChange=true 二次确认；响应带 guard 明细 | electron/socket-server.ts |