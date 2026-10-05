# 核心函数索引

## 比赛管理 (match-service.ts)

持久化精灵主键字段 = `pet_id`（精灵 id）：快照槽位/阵容/撤销重做栈/删除历史均存 pet_id。不做旧数据兼容——pet_id 必须是精灵索引中存在的 id。

性能/存储机制（2026-09 优化）：
- **进程内内存态**：matches.json 按 AppPaths 实例做 WeakMap 缓存，读路径一次 stat 比对 mtime 即返回内存态；写路径直接更新缓存，不再写后重读。外部手改文件（mtime 变化）会自动重新载入。
- **原子写**：`persistStoreFile` 先写 `matches.json.tmp-<pid>-<n>` 再 rename，防止写一半崩溃截断文件。
- **版本号迁移**：落盘带 `__version: 1`；版本命中时跳过「全量序列化比对」，无版本旧文件首次读取时规范化回写一次。
- **撤销栈 7 天过期**：`MatchFlowSnapshot.savedAt` 入栈时间；读（缓存命中时节流 6 小时）、写、迁移三条路径都会 prune 超过 `FLOW_HISTORY_TTL_MS`（7 天）的 undo/redo 快照；旧数据无 savedAt 时迁移补当前时间，给予完整 7 天保留期。
- **撤销栈读模型按比赛摘要**：`toPublicStore` 的 `undo` 除当前比赛的 `canUndo/canRedo` 外，另带 `byMatch: Record<matchId, { canUndo; canRedo }>`（由内部 `summarizeFlowHistory` 组装，只收有栈的场次、只透两个布尔）——系列比赛的卡片菜单 / Drawer 要判断「非当前比赛」能否撤回，收回调用的接口本身也是按 matchId 的（`flowHistory[matchId]`）；**绝不下发 flowHistory 本体**（含 7 天 TTL 的快照体，体积大）。前端消费口径见 `.agents/09`，类型见 `.agents/03`。

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取比赛列表 | getMatchStore | (paths: AppPaths) => MatchStoreState | 获取比赛存储状态 |
| 创建比赛 | createMatch | (paths: AppPaths, payload: unknown) => MatchStoreState | 创建新比赛，payload 包含 leftPlayer, rightPlayer, leftRank, rightRank, leftTeamId/leftTeamName/rightTeamId/rightTeamName（所属战队，选填）, bestOf, tags, 可选 tournamentRef（系列赛内部锁定用：tournamentId/nodeId/stageIndex/waveIndex，公开入口已剥离）；比赛 id = `YYYYMMDD_{机器码}{NNN}`（机器码取 runtime config 的 machineCode，1-2 位大写字母；未设置则沿用旧格式 `YYYYMMDD_NNN`），同日按「日期 + 机器码」簇独立递增 |
| 更新比赛信息 | updateMatch | (paths: AppPaths, matchId: string, payload: unknown) => MatchStoreState | 更新比赛信息（含排位排名与所属战队 leftTeamId/leftTeamName/rightTeamId/rightTeamName，未传时保留原值；syncScoreboardFromMatch 会把选手名与排名同步到记分牌） |
| 更新比赛标签 | updateMatchTags | (paths: AppPaths, matchId: string, payload: unknown) => MatchStoreState | 更新比赛标签 |
| 批量添加标签 | updateMatchesTags | (paths: AppPaths, matchIds: unknown, payload: unknown) => MatchStoreState | 为多场比赛追加标签（合并保留原有） |
| 选择活动比赛 | setActiveMatch | (paths: AppPaths, matchId: string) => MatchStoreState | 设置活动比赛 |
| 删除比赛 | deleteMatch | (paths: AppPaths, matchId: string) => MatchStoreState | 删除单个比赛 |
| 批量删除比赛 | deleteMatches | (paths: AppPaths, matchIds: unknown) => MatchStoreState | 批量删除比赛，matchIds 为字符串数组 |
| 撤销删除 | undoDeletedMatches | (paths: AppPaths) => MatchStoreState | 撤销最近一次批量删除 |
| 开始当前小局 | startCurrentGame | (paths: AppPaths, matchId: string) => MatchStoreState | 开始当前小局 |
| 记录比赛胜负 | recordMatchWinner | (paths: AppPaths, matchId: string, winner: 'left' | 'right') => MatchStoreState | 记录比赛胜负 |
| 撤销比赛操作 | undoMatchAction | (paths: AppPaths, matchId: string) => MatchStoreState | 撤销比赛操作 |
| 恢复比赛操作 | redoMatchAction | (paths: AppPaths, matchId: string) => MatchStoreState | 恢复比赛操作 |
| 保存比赛草稿面板 | saveDraftPanelStateForActiveMatch | (paths: AppPaths, position: 'left' | 'right', selectedSlots: unknown) => MatchStoreState | 保存活动比赛的面板草稿 |
| 保存比赛草稿格子 | saveDraftPanelSlotStateForActiveMatch | (paths: AppPaths, position: 'left' | 'right', slotIndex: number, slotData: unknown) => MatchStoreState | 保存活动比赛的单个格子草稿 |
| 录入小局阵容 | saveGameLineupForMatch | (paths: AppPaths, matchId: string, gameNumber: number, selections: { left?: unknown; right?: unknown }) => MatchStoreState | 为指定比赛的「当前小局且待开始」写入双方阵容：双侧合并一次写入，不触碰面板/记分牌/activeMatchId；只传一侧时另一侧保留，空数组 = 清空该侧；已开局/已完赛/未轮到均拒绝（前端锁定文案见 App.tsx + lib/history.ts 的 getLineupEntryBlockReason） |
| 阵容表导入预检 | inspectLineupImportTargets | (paths: AppPaths, tournamentId: string, matchIds: string[]) => LineupImportApplyResult[] | 系列赛阵容表批量导入的场次级预检（不写盘）：对局存在、tournamentRef 归属目标系列赛、比赛待开始、第 1 局尚未开赛；不满足返回 ok:false + reason（对局不存在 / 非本系列赛 / 该场已开赛 / 该场已完赛 / 第 1 局已开始）。门槛与 saveGameLineupForMatch 一致，仅把「当前小局」固定为第 1 局 |
| 批量导入阵容 | applyLineupImport | (paths: AppPaths, tournamentId: string, entries: LineupImportEntryInput[]) => { store: MatchStoreState; results: LineupImportApplyResult[] } | 读一次 store → 逐场校验 + 覆盖第 1 局 leftSlots/rightSlots（对局级原子：未知 pet_id / 两侧全空整场跳过）→ 写一次盘；广播由调用方（路由）负责一次 matches:update。entries.left/right 为 pet_id 数组（null / 省略 = 该侧保持原样） |
| 解析回传 xlsx 模板 | extractLineupSheetTable | (buffer: Buffer) => Promise<LineupXlsxTable> | 系列赛阵容模板 .xlsx 服务端解表（exceljs）：优先读「阵容」工作表、找不到退回第一个；逐格归一为字符串（富文本拼接 / 公式取结果 / 数字转串）→ 二维表。只解格式不写数据；表头定位与「对局ID + 位置」配对在前端 parseLineupSheetTable（与 CSV 同口径） |
| 规范化导入比赛 | normalizeImportedMatches | (paths: AppPaths, incoming: unknown[]) => NormalizedMatchImport | 双机同步导入：逐条过 normalizeMatchRecord（含 id 白名单，只接受 `YYYYMMDD_[机器码]NNN`，防止外部包把 id 拼进头像目录），返回可用记录与被拒明细 |
| 比赛导入分类 | diffMatchRecords | (paths: AppPaths, incoming: MatchRecord[], mode: SyncConflictMode) => MatchImportDecision[] | 只读：按 id 对比本机 store 逐条给出 add/update/skip 与原因（newer = 包内 updatedAt 较新才覆盖；bundle = 内容有差异即覆盖、相同跳过），并附带 conflict（两边都登记过且不一致）与字段级 diff |
| 比赛字段级差异 | buildMatchDiffFields | (local: MatchRecord, incoming: MatchRecord) => SyncImportDiffField[] | 只列出不同的字段（状态/比分/选手/赛制/标签 + 逐小局状态与双方阵容名称快照），最多 20 条；供导入预览弹窗做左右 diff 展示 |
| 合并导入比赛 | mergeMatchRecords | (paths: AppPaths, incoming: MatchRecord[], mode: SyncConflictMode) => MergeMatchRecordsReport | 双机同步落盘：不存在追加、已存在按冲突模式覆盖或跳过；复用 readStoreFile/writeStoreFile 缓存与原子写管线，不改 activeMatchId 与撤销栈 |
| 撤回本机登记（云同步专用） | resetMatchRegistrations | (paths: AppPaths, matchIds: string[]) => MatchStoreState | 把指定比赛退回「未登记」：只保留第 1 个待开始小局（含已录阵容），清掉其余小局与全部小局结果、比分、胜者、completedAt 与「弃权」标签；**保留 tournamentRef**（仍是系列赛对局），不走撤销栈。只给云同步回退防复活用（不在 applySyncImport 通用路径里） |
| 弃权判负 | forfeitMatch | (paths: AppPaths, matchId: string, loserSide: 'left' \| 'right') => MatchStoreState | 仅 pending 无结果比赛可用；补决胜小局（BO1=1:0、BO3=2:0，空阵容）+「弃权」标签，completed，入 undo 栈 |
| 批量复位未开始 | resetMatchesToPending | (paths: AppPaths, matchIds: string[]) => MatchStoreState | 系列赛回退专用：比赛直接置 pending（单空小局/0:0/无胜者），清 flowHistory；不进删除/撤销栈 |
| 赛制变更批量应用 | applyStageBestOfToMatches | (paths: AppPaths, updates: Array<{ matchId: string; bestOf: number }>) => { store: MatchStoreState; reopenedIds: string[]; updatedIds: string[] } | 编辑赛制专用（单次写盘）：干净未打只换 bestOf；有赛况（进行中/已完赛）则清比分/小局/胜者/completedAt/「弃权」标签并保留一局阵容（进行中保本局、已完赛保第 1 局）回到 pending；清该场 flowHistory，不进撤销栈；保留 tournamentRef |
| 解除系列赛关联 | detachMatchesFromTournament | (paths: AppPaths, tournamentId: string) => { store: MatchStoreState; matchIds: string[] } | 删除系列赛专用：剥离全部关联比赛的 tournamentRef（比赛保留为普通对局），不进删除/撤销栈；先解绑再删比赛可保证撤销栈快照无孤儿引用。同步合并后的「解绑不变量」也复用它 |
| 按墓碑名单移除对局 | purgeMatchesByIds | (paths: AppPaths, matchIds: unknown) => number | 同步合并专用：静默移除名单对局（不进撤销栈、缺失即跳过、返回实际移除数）。上游「连同对局删除」的墓碑到达时清本机副本，避免留下「能登记却发不出去」的孤儿；只在**新墓碑**到达时执行一次，后续由名单过滤拦截 |

## 系列赛管理 (tournament-service.ts)

编排层「搭在比赛系统之上」：赛程/战绩/晋级落 cache/tournaments.json；每场对决仍是普通 MatchRecord，经 createMatch 创建并打 tournamentRef。RNG = mulberry32（同 seed 可复现），波次 RNG 由 series seed 与 stage/wave 位置混合。系列赛归创建它的机器码所有：`mutateRecord`（全部变更入口）、`deleteTournament` 与写回钩子都有**编排机所有权闸门**，非编排机为只读副本（变更被拒「该系列赛由机器 X 编排」，登记赛果不写回，识别方式 = id 机器码 == 本机 machineCode）。**删除不物理移除**：`deleteTournament` 写墓碑（`deletedAt` + 对局名单 `deletedMatchIds`/`deletedMatches`），对外读取路径过滤墓碑（`getTournamentStore`），含墓碑访问器（`getTournamentRecordsIncludingTombstones`/`getTournamentTombstones`）仅供同步导出与合并；`mutateRecord`/写回钩子/写回摘要把墓碑当「不存在」（防陈旧比赛把内容写进墓碑）；id 分配与合并走含墓碑读路径（否则同日删后重建会复用 id 撞墓碑）。**本机移除（localOnly，分控端对非本机系列赛）**：写 localOnly 墓碑只在本机可见口径隐藏（getTournamentStore 过滤）、出站包剔除（绝不外传）、合并时本机墓碑优先（不复活）；编排机真墓碑到达时整条替换并清 localOnly，随后照常解绑/清理；「恢复」= 清标记立即回显，updatedAt 不变（下次同步按「较新覆盖」补齐）。**数据文件保护**：tournaments.json 原子写（同目录 tmp + rename，与 match-service 同口径）；解析失败**绝不静默返回空库**（空库 + 下一次写 = 整库被永久覆盖，createTournament/mergeTournamentRecords 尤甚）——先复制 `.corrupt` 备份再抛错，让所有读写路径一致中止等人工修复。**选手名 / 赛制锁定**：系列赛对局的 `leftPlayer/rightPlayer/bestOf` 是建场快照（名字 = 完成钩子的写回比对依据，赛制 = 完赛局数），赛事面板改不动（`assertTournamentMatchFieldsEditable`）；「信息录入」改名靠 `syncTournamentMatchNames` 回写快照；登记赛果必须**先**过 `prepareTournamentWriteBack` 再落盘。

**季军赛（附加波次，不占阶段）**：波次带 `TournamentWave.kind = 'third-place'`。4 人阶段（半决赛）打完后由 `progressFromWave` 调内部 `createThirdPlaceWave`：取本阶段两名 `state = eliminated` 的落败者建一场，波次下标接在本阶段主赛之后（双败 = 败者组 R2 之后，单败 = 第 2 波），且**先于下一阶段首波 push** —— `record.waves` 的数组顺序即时间线，「回退上一波」与撤回时的后续波丢弃都按它推导（顺序反了会误伤季军赛、或让总决赛再也推进不出来，`reopenStageLastWave` 也必须排除它）。赛制 = `record.thirdPlaceBestOf`（创建时选定，0 = 不安排；旧数据缺省按「与总决赛同赛制」解析，前端与引擎共用 `resolveThirdPlaceBestOf`）。它**不在晋级链上**：`applyGameResult` / `recomputeStageEntries` / `resolveStageStandings` 一律跳过（否则季军会被算成「阶段内多一胜」，单败口径下直接显示成已晋级），`progressFromWave` 直接返回（不推进、不改完赛状态，因此季军赛可以晚于总决赛打完），`onMatchUndo` / `rollbackWave` 只作用于这一场本身（绝不连带撤销冠军 / 改 currentStageIndex / 重算战绩）。**但重开该阶段主赛波（回退/撤回级联）时必须把它一起丢弃**（`discardThirdPlaceWave`）：两名落选者是阶段结果算出来的，改判决胜轮/半决赛会换人，留着旧波次就会拿旧对阵当季军赛名单（线上踩过），阶段再次收口时由 `createThirdPlaceWave` 重建。名次只记在节点 `winnerId`（季军 / 殿军由前端从节点推导，不进 `record.result`）。**跨机**：季军赛就是普通对局，走同一套同步与写回路径；但它在分发 / 指派之后才建场，**未指派 → 分控端登记入口置灰**，需要在主控「指派」里单独勾它（或按波次规则覆盖）。

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取系列赛列表 | getTournamentStore | (paths: AppPaths) => TournamentRecord[] | 读 tournaments.json（逐条白名单规范化）并**过滤墓碑**（已删除系列赛对外不可见，界面行为与物理删掉一致） |
| 含墓碑全量记录 | getTournamentRecordsIncludingTombstones | (paths: AppPaths) => TournamentRecord[] | 同步导出 / 合并用：墓碑看不到就传播不出去，接收端也就清不掉副本（删除的跨机语义全靠它）；也含 localOnly 本机移除记录（合并优先级 / 预览识别用，**出站包前必须剔除**） |
| 真实墓碑 | getTournamentTombstones | (paths: AppPaths) => TournamentRecord[] | 全部真实墓碑（含从别机传播留存的；**不含 localOnly 本机移除**）：合并后的解绑清理与「已删对局」名单拦截用——本机移除只做视图层隐藏，绝不触发解绑 / 清对局 |
| 本机移除清单 | getLocallyRemovedTournaments | (paths: AppPaths) => TournamentRecord[] | 本机已「本机移除」的系列赛（deletedAt + localOnly）：恢复弹窗、同步预览标记与前端对局过滤共用；绝不进出站同步包 |
| 创建系列赛 | createTournament | (paths: AppPaths, payload: unknown) => TournamentRecord | body: name/playerIds/stages?/seed?/thirdPlaceBestOf?（季军赛局数，0 = 不安排，省略 = 与总决赛同赛制）；校验人数 4/8/16/32、无重复、全部来自档案；stages 省略用 buildDefaultStages；**只剩 2 人的阶段（总决赛）必须为单败，否则抛「总决赛阶段必须为单败」**；id = `T{日期}_{机器码}{NN}`；返回 setup 草稿 |
| （重）抽签 | redrawTournament | (paths: AppPaths, tournamentId: string, payload?: unknown) => TournamentRecord | 仅 setup；重洗种子顺序、drawVersion+1；从字典序做位置洗牌，同 seed 永远同结果 |
| 首波对阵预览 | previewOpeningWave | (paths: AppPaths, tournamentId: string) => { pairs } | 只读：按当前 seed 调 generateDraftPairs 返回首波配对，不落盘不建场；仅 setup（否则抛错）。与开赛后实际 W1 节点逐场一致 |
| 开赛 | startTournament | (paths: AppPaths, tournamentId: string) => TournamentRecord | setup→running，materialize 阶段0 W1（自动锁定或 draft） |
| 确认推进 | advanceTournament | (paths: AppPaths, tournamentId: string) => TournamentRecord | 最后波 draft 且随机配对 → 重新随机并锁定建场；手动配对/非 draft 拒绝 |
| 暂存配对草稿 | savePairingDraft | (paths: AppPaths, tournamentId: string, waveGlobalIndex: unknown, payload: unknown) => TournamentRecord | 编辑中间态即存（白名单/范围校验，允许漏配重复），不建场 |
| 锁定配对 | lockPairings | (paths: AppPaths, tournamentId: string, waveGlobalIndex: unknown, payload: unknown) => TournamentRecord | 校验通过后批量 createMatch（draft→nodes）；建场不写身份标签（赛事名/阶段/波次由 tournamentRef 解析），仅跨桶场次加「跨桶」标注标签；并从选手档案快照 leftRank/rightRank（与前端「快速创建比赛」同口径）；**赛制按波次解析**（resolveWaveBestOf：W1/单败取 bestOf，双败 W2/W3 取 waveBestOf 覆盖） |
| 导入外部对阵 | importPairings | (paths: AppPaths, tournamentId: string, waveGlobalIndex: unknown, payload: unknown) => PairingImportResult | text（每行 A vs B）/pairs 名字数组；匹配池仅本波选手，精确→子串模糊，未唯一匹配进 unmatched，回填草稿不锁定 |
| 回退上一波 | rollbackWave | (paths: AppPaths, tournamentId: string) => TournamentRecord | 最后波三情形（**季军赛波次另走单独分支**：只复位 / 删除这一场，不撤销冠军、不动 currentStageIndex、不重算战绩；**重开某阶段最后主赛波时一并丢弃该阶段的季军赛**——它是阶段结果的产物）：①整波刚打完（总决赛完赛）→ 波保留，比赛复位 pending、清节点胜者、撤销冠军、recompute 战绩；②波未打（pending/draft）→ 删未打比赛与波（可恢复）、重开前一波；③部分进行 → 拒绝并提示逐场撤销。跨阶段回落 currentStageIndex |
| 编辑赛制（波次级 BO + 未开始阶段规则） | updateTournamentStages | (paths: AppPaths, tournamentId: string, payload: unknown) => UpdateTournamentStagesReport | body: stages[{index, bestOf?, waveBestOf?{2/3: 值或 null 清除}, format?/pairing?/avoidRematch?/requireConfirm?（阶段规则）}]（BO 白名单 + 形态/配对白名单；单败阶段拒绝 waveBestOf；覆盖值=基础值归一为跟随）/thirdPlaceBestOf（0/1/3/5/7，独立不联动总决赛）/confirmReopen。编排机专属（mutateRecord 内校验）；逐波比较 resolveWaveBestOf 生效值、只处理真正变化的波：未开打直接更新；有赛况必须 confirmReopen 走「重开该波」（清赛况保阵容 + 清节点胜者 + recomputeStageEntries），最早重开波之后的已建波按 isDiscardableTrailingWaves 作废（软删可恢复）——**更早的波一律不动**；**阶段规则只放开未开始阶段（setup 全部 + currentStageIndex 之后）：直接生效、不产生对局操作，形态切换时配对按兼容归一（双败=随机/手动，单败=沿树/每轮随机）、改单败清 waveBestOf、总决赛（isFinalStage）禁止双败，进行中/已结束阶段传规则字段拒绝**；返回 tournament/reopenedMatchIds/updatedMatchIds/discardedWaveCount，不进撤销栈 |
| 比赛完成钩子 | onMatchCompleted | (paths: AppPaths, matchId: string) => TournamentRecord \| null | 无 ref/未完成→null；系列赛已删除（孤儿引用）或本机只是只读副本（非编排机）→null 不报错；节点写胜者+更新战绩（幂等）；波齐→completed 并自动生成下一波/下一阶段或冠军 |
| 撤回小局钩子 | onMatchUndo | (paths: AppPaths, matchId: string) => TournamentRecord \| null | **季军赛波次单独分支：只清它自己的节点胜者**（不丢后续波、不回落 currentStageIndex、不重算战绩、不删冠军结果——季军赛可能晚于总决赛打完）；其余情况清节点胜者并用 recomputeStageEntries 重算该阶段战绩（同阶段撤回与跨阶段回退口径一致）；该波已自动推进时，若后续波全是「自动锁定（pairingStatus=locked）且一场未打」则级联丢弃（软删其比赛、回退 currentStageIndex、删冠军结果），否则抛错提示走「回退上一波」；节点无胜者（撤回非决胜小局）→null 不广播；孤儿引用或只读副本同样 →null。调用方（undo 路由）须先跑本钩子再撤比赛 |
| 写回前置校验 | prepareTournamentWriteBack | (paths: AppPaths, matchId: string) => { allowed: boolean; reason?: string } | 登记胜负 / 弃权的**前置**校验，必须跑在比分落盘前（钩子在落盘之后才跑，抛错会留下「比分已写入、系列赛没推进」且比赛已不能重登的半吊子状态）：无 ref / 系列赛已删除（含墓碑）/ 本机只是只读副本 / 节点已有胜者 → 放行（与钩子同口径）；节点档案缺失（选手被删）→ 拒绝并提示「回退上一波」；名字快照与节点档案名不一致（档案改过名 / 加守卫前的历史脏数据）→ 先 syncTournamentMatchNames 自愈再放行（避免死局） |
| 对局名字快照回写 | syncTournamentMatchNames | (paths: AppPaths, onlyMatchId?: string) => number | 把系列赛对局的 leftPlayer/rightPlayer 对齐到节点档案名（只改名字，不动比分 / 状态 / 关联；onlyMatchId 用于登记前单场自愈）；节点档案缺失则跳过（不猜测名字）；返回实际改动数。**为什么必须**：对局名字是建场快照、又是完成钩子的比对依据，档案改名后不回写 → 该场登记胜负被「比赛选手与系列赛节点不一致」拒绝 |
| 系列赛对局字段守卫 | assertTournamentMatchFieldsEditable | (paths: AppPaths, matchId: string, payload: unknown) => void | PATCH /api/matches/:id 守卫：系列赛对局的「选手名 / 赛制」由编排与档案决定（名字是写回比对依据、赛制决定完赛局数，调小会让比赛按已有比分直接完赛却不写回），只有值真被改动才抛错；原值回填 / 无 ref / 系列赛已删除（含墓碑）→ 放行，普通对局不受限 |
| 删除系列赛 | deleteTournament | (paths: AppPaths, tournamentId: string, options?: { deleteMatches?: boolean }) => DeleteTournamentResult | **写墓碑（deletedAt）取代物理移除**，墓碑随同步包跨机传播；不存在/已是墓碑抛错；非编排机拒绝（「该系列赛由机器 X 编排」，解绑前先校验）；关联比赛一律先 detachMatchesFromTournament 解绑：默认比赛保留为普通对局；deleteMatches=true 再走 deleteMatches 连对局删除（可撤回，恢复后无关联）；墓碑携带 matchIds/deletedMatches 名单（接收端据此清副本、两端据此拦截「已删对局回魂」）；返回 matchIds/matchesDeleted（对外行为与物理删除一致） |
| 合并导入系列赛 | mergeTournamentRecords | (paths: AppPaths, incoming: unknown[], mode: SyncConflictMode, options?: { authoredBy?: string }) => MergeTournamentRecordsReport | 双机同步自动合并（不参与勾选）：逐条 normalizeRecord 白名单校验（非法计数 rejected）；本机不存在→新增、内容相同→跳过（幂等）、有差异按「较新覆盖 / 以包为准」覆盖；只有编排机会修改系列赛，只读副本不会反向覆盖编排机。**墓碑语义**：包内墓碑→清本机副本并原样留存墓碑（接收端也免疫更老的旧包复活）；本机墓碑+包内存活副本→一律维持墓碑（不受覆盖模式与时间戳影响）；双墓碑→保留最早 deletedAt；**鉴权**只接受 authoredBy == id 内嵌机器码的墓碑（作者或内嵌码缺失时不鉴权）。**本机移除（localOnly）**：包内 localOnly 一律剥离（防外部注入）；本机 localOnly 墓碑对包内活副本 → 维持隐藏（与真墓碑同规则）；包内真墓碑到达 → 整条替换并清 localOnly（采用包内名单，随后照常解绑 / 清理） |
| 本机移除 | removeLocalTournament | (paths: AppPaths, tournamentId: string) => LocalRemovalResult | 分控端对「非本机编排」系列赛做视图层隐藏（幂等：已移除返回 changed=false）：写 deletedAt+localOnly、deletedMatchIds=[]/deletedMatches=false，**不解绑 / 不删对局、不改 updatedAt**；本机编排拒绝（提示用 deleteTournament）；真墓碑 / 不存在抛「系列赛不存在」 |
| 恢复本机移除 | restoreLocalTournament | (paths: AppPaths, tournamentId: string) => TournamentRecord | 仅 localOnly 记录可恢复（否则抛错）：清 deletedAt/localOnly/deletedMatchIds/deletedMatches，立即重新可见；**不 bump updatedAt**——bump 会让陈旧副本在 'newer' 合并中反压编排机更新 |
| 写回补跑 | runTournamentWriteBack | (paths: AppPaths) => TournamentWriteBackReport | 同步导入后对本机全部「已完成 + 带 tournamentRef」比赛逐场跑 onMatchCompleted（幂等）：最后一场补齐时自动推进（下一波/冠军），双机「各登记一半、汇合推进」的关键一步；只读副本自动跳过；advanced 按内容摘要（排除 updatedAt 空转）判断是否真正改动；失败与「赛果和已写回节点胜者不一致」（协作机撤回重登后回传）都记 warnings 不阻断导入，后者提示走「回退上一波」 |
| 阶段标注解析 | resolveTournamentLabels | (paths: AppPaths, matches: Array<Pick<MatchRecord, 'id' \| 'tournamentRef'>>) => Record<string, string> | page6/page8 卡片用（经 GET /api/page6、/api/page8 下发 tournamentLabels）：格式「阶段名·轮次」（`·` 两侧无空格）——单败阶段只给阶段名（如「总决赛」）；双败用 **W1=「胜者组 R1」、W2 按节点两位选手第 1 波胜负判池=「胜者组 R2 / 败者组 R1」、W3=「败者组 R2」**（文案取自 shared/constants 的 `DOUBLE_LIFE_ROUND_LABELS`，与晋级图/波次列表同一份）；跨桶等拿不到一致池归属退回阶段名；**季军赛波次固定返回「季军赛」**（不套阶段名与波次序号）；仅 tournamentRef 指向现存系列赛的比赛有值（普通对局/孤儿引用缺席） |
| 阶段战绩重算（晋级积分榜） | resolveStageStandings | (paths: AppPaths, tournamentId: string, stageIndex: number) => StageStandings \| null | page14 用（只读、不落盘）。参赛名单：阶段 0 = `record.playerIds` 种子顺序；其后 = 该阶段 W1 节点的出场顺序（与 recomputeStageEntries 同口径），阶段未开打且非当前阶段 → 空行。逐波遍历该阶段 nodes（**跳过季军赛波次**：它不在晋级口径里）：胜者 +1 胜、负者 +1 负（异常数据里不在名单内的人不计），排序分 = 10×胜 − 负，降序、同分按种子顺序，名次依次编号；`state` 与 deriveState 同口径（单败一胜即 promoted / 一负即 eliminated，双败 2 胜 / 2 负）。**必须重算、不能读 record.entries**：阶段推进会把它换成下一阶段的 0-0/alive，回看已完成阶段会全员显示成 0-0 存活。返回 null = 系列赛不存在或阶段索引越界；bestOfText = formatStageBestOf(stage)（含双败波次覆盖的展示文本，page14 副标题直接用，缺省回退 `BO{bestOf}`） |

内部引擎：`doubleBucketSpecs`（双败波次战绩桶：W1 0-0 / W2 1-0+0-1 / W3 1-1）、`wonOpeningRound`（该选手本阶段 W1 是否取胜——决胜池 1-1 池里「胜者组掉落者」与「败者组上扬者」的判据）、`pairWithAvoidance`（greedy 桶内配对，avoidRematch 先过滤已交手、无法避开再放行）、`crossPair`（左右两侧交叉配对：左侧每人从右侧剩余池随机取对手；决胜波 1-1 池两类人互不相遇，avoidRematch 优先避开已交手）、`bracketPositions`（标准种子位序列，**仅 stageIndex=0 的首阶段使用**）、`generateDraftPairs`（生成配对草稿：单败 `bracket-seed` 从 stage 1 起按 `entries` 顺序两两相邻配对，**延续固定对阵树，不再每轮重新种子**；双败 W3 的 1-1 池走 `crossPair` 经典交叉配对）、`materializeWave`（建波：draft 或自动锁定）、`validatePairs`（每人恰好一次/同桶严格/跨桶显式允许/已交手提醒——`findPriorMeeting` 全赛程判定，本阶段与跨阶段均仅提醒）、`bracketOrderOfStage`（晋级选手在上一阶段的获胜节点位置 `(waveIndex, nodeIndex)`，单败即节点序、双败则胜者组出线在前）、`progressFromWave`（波完成后阶段/波次推进：promoted=半额→先调 `createThirdPlaceWave` 安排季军赛（仅 4 人阶段）再按 `bracketOrderOfStage` 的对阵树顺序换批进入下一阶段（而非全局种子序），否则双败建下一波；季军赛波次直接返回不推进）、`createThirdPlaceWave`（半决赛两名落败者建季军赛附加波次：赛制取 thirdPlaceBestOf、幂等、波次下标接本阶段主赛之后）、`recomputeStageEntries`（按现存节点重算阶段战绩，回退用；跳过季军赛）。

## 面板操作 (state-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取面板状态 | getPanelState | (paths: AppPaths, position: 'left' | 'right') => PanelState | 获取面板状态 |
| 保存面板状态 | savePanelState | (paths: AppPaths, position: 'left' | 'right', selectedSlots: unknown) => PanelState | 保存面板状态 |
| 更新单个格子 | savePanelSlotState | (paths: AppPaths, position: 'left' | 'right', slotIndex: number, slotData: unknown) => PanelState | 保存单个格子状态 |
| 清空面板 | clearPanelState | (paths: AppPaths, position: 'left' | 'right') => void | 清空面板状态 |

## 记分牌 (state-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取记分牌状态 | getScoreboardState | (paths: AppPaths) => ScoreboardState | 获取记分牌状态 |
| 保存记分牌状态 | saveScoreboardState | (paths: AppPaths, payload: unknown) => ScoreboardState | 保存记分牌状态；排名字段未携带时保留现值 |
| 归一化排位排名 | normalizeRankValue | (value: unknown) => string | 导出函数：只保留数字、截断到 RANK_TEXT_MAX_LENGTH 位（空字符串 = 未输入） |
| 更新赛制 | saveScoreboardBestOf | (paths: AppPaths, payload: unknown) => ScoreboardState | 更新赛制 |

## 精灵管理 (sprite-service.ts)

数据源 `resources/data/pets.json`（字段映射：精灵编号=handbook_no、精灵名称=name、精灵属性=elements、精灵形态=stage，4=首领）；本地图片按 `{pet_id}_{name}.png` 命名（sprites-img 立绘 / sprites-icon 头像）。

**进程级缓存**：`listSprites`/`spriteLookup` 结果按 AppPaths 实例缓存在 WeakMap，签名 = pets.json + sprites-img + sprites-icon 三者 mtimeMs；资源变化（如 sync:sprites 后）自动失效重建，无需重启；单次请求内 lookup 复用（如 savePanelState 6 槽只建一次）。

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取精灵列表 | listSprites | (paths: AppPaths) => SpriteRecord[] | 获取精灵列表（优先 pets.json 索引，否则扫描目录）；走 mtime 签名缓存 |
| 创建精灵查找表 | spriteLookup | (paths: AppPaths) => Map<string, SpriteRecord> | 创建精灵查找 Map（key: pet_id/filename/名称/别名）；与列表共用同一缓存条目 |
| 搜索精灵 | spriteMatchesKeyword | (sprite: SpriteRecord, keyword: string) => boolean | 检查精灵是否匹配关键词 |
| 快速填充阵容 | buildQuickFillPreview | (paths: AppPaths, text: string) => QuickFillPreview | 构建快速填充预览结果 |
| 数字前缀写法（匹配前置） | — | — | 快速填充 / 阵容导入共用：`3004 迪莫`（4 位 pet_id 精确命中，唯一主键）、`#011` / `011 鸭吉吉`（按图鉴编号筛候选集后用名字余部消歧）；余部无法消歧时退回常规名称匹配。用于解决「同名精灵填表精确指定」问题 |

## 图片管理 (image-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取赛事头像状态 | getAvatarState | (paths: AppPaths, side: 'left' | 'right', matchId: string | null) => AvatarState | 读取按赛事隔离的原始头像（不含档案兜底） |
| 上传头像 | saveAvatar | (paths: AppPaths, side: 'left' | 'right', buffer: Buffer, mimeType?: string) => AvatarState | 保存头像 |
| 删除头像 | deleteAvatar | (paths: AppPaths, side: 'left' | 'right') => AvatarState | 删除头像 |
| 读取头像 MIME 类型 | readAvatarMimeType | (paths: AppPaths, side: 'left' | 'right') => string | 读取头像 MIME 类型 |
| 保存选手录入头像 | saveProfilePlayerAvatar | (paths: AppPaths, playerId: string, buffer: Buffer) => Promise<void> | 魔数校验 + sharp 方形裁剪 PNG，存 cache/profiles/players/<id>.png |
| 保存战队录入 logo | saveProfileTeamLogo | (paths: AppPaths, teamId: string, buffer: Buffer) => Promise<void> | 魔数校验 + sharp cover 铺满裁剪 192×192 PNG，存 cache/profiles/teams/<id>.png |

## 头像统一解析 (avatar-resolver.ts)

所有展示页读取「某场比赛左右头像」都走这里，替代旧的 `getAvatarStates(paths, matchId)`。
优先级：**赛事覆盖（cache/avatars/{matchId}/**）> 档案头像（按 match.leftPlayer/rightPlayer 名字匹配信息录入）> 占位（exists:false）**；
这样「信息录入」改头像能反映到所有页面，同时保留「当前比赛」单独覆盖的能力。

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 创建头像解析器 | createAvatarResolver | (paths: AppPaths) => AvatarResolver | 一次请求内建一次档案索引，用 `forMatch(match)` 连续解析多场，避免逐场重复读 profiles.json |
| 解析单场头像 | resolveMatchAvatars | (paths: AppPaths, match: MatchRecord | null) => AvatarCollectionState | 单场一次性解析；`match` 为 null（未创建比赛）时全部回退占位 |

## 配置管理 (config-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 加载运行时配置 | loadRuntimeConfig | (paths: AppPaths) => RuntimeConfig | 加载运行时配置（runtime/config.json：port、machineCode） |
| 保存运行时配置 | saveRuntimeConfig | (paths: AppPaths, patch: Partial<RuntimeConfig>) => RuntimeConfig | 按传入字段合并保存（未传字段保持现值；machineCode 归一化为 1-2 位大写字母，空串 = 未设置） |
| 归一化本机标识 | normalizeMachineCode | (value: unknown) => string | 去空白 → 转大写 → 仅保留字母 → 截 2 位；不满足 1-2 位字母返回空串 |

## 直播推流 (stage-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取推流配置 | getStageState | (paths: AppPaths) => StageConfig | 获取 stage 配置 |
| 保存推流配置 | saveStageState | (paths: AppPaths, payload) => StageConfig | 保存 stage 配置；mirrorSides / page3RankVisible / page3TeamVisible / page3RedLightMode / page3RedLightInstant / page7SwitchSeconds 未携带时保留现值 |

> `page7SwitchSeconds`（战绩详情整屏切换间隔，秒）：默认 10、夹在 [2, 600]（下限要大于整屏过渡动画 700ms）；非法值回默认。展示页在启动时 GET /api/stage 拿它、并订阅 `stage:update` 实时改节奏，所以 socket-server 的 `ROLES_FOR_STAGE` 必须包含 `page7`。

| 信息录入 (profile-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取录入存储 | getProfileStore | (paths: AppPaths) => ProfileStoreState | 获取选手/战队录入（cache/profiles.json，附带头像/logo 存在性与 mtime） |
| 保存选手录入 | savePlayerProfile | (paths: AppPaths, payload: unknown) => ProfileStoreState | 新增/更新选手；未传 id 但同名视为更新（沿用旧 id 保住头像文件）；上限 200 人 |
| 批量导入选手 | importPlayerProfiles | (paths: AppPaths, payload: unknown) => { profiles: ProfileStoreState; review: PetSuggestionReview[] } | 批量导入选手（数组或 `{players:[...]}`）；仅识别 name/rank/declaration/pets（其余键忽略防注入），rank 仅纯数字、缺 name 跳过、同名沿用旧 id 更新；pets 字符串或数组（支持 `、/，,` 分隔），仅命中 pets.json 才录入，未命中不入库并在 review 中携带每条最多 5 个兜底候选（PetSuggestionReview: name/input/candidates）供前端人工确认；非数组抛错，返回 `{ profiles, review }` |
| 批量导入选手头像 | importPlayerAvatarFiles | (paths: AppPaths, files: Array<{ name: string; buffer: Buffer }>) => Promise<PlayerAvatarBatchReport> | 按文件基础名（去目录与扩展名）精确匹配已录入选手名字（同名取先录入者）；命中复用 saveProfilePlayerAvatar 管线压缩落盘，未命中/校验失败不落盘并在回执 unmatched/failed 中列出；返回 `{ profiles, matched, unmatched, failed }` |
| 匹配单个常用精灵 | matchSpriteToken | (input: string, sprites: SpriteRecord[], limit?: number) => { matched: string \| null; candidates: SpriteRecord[] } | 常用精灵命中判定：按名字/编号/别名精确匹配 pets.json，命中返回 displayName，未命中返回最多 limit（默认 5）个模糊候选；supply「信息录入」JSON 导入的兜底 |
| 删除选手录入 | deletePlayerProfile | (paths: AppPaths, playerId: string) => ProfileStoreState | 删除选手连同头像文件 |
| 保存战队录入 | saveTeamProfile | (paths: AppPaths, payload: unknown) => ProfileStoreState | 新增/更新战队；未传 id 但同名视为更新（沿用旧 id 保住 logo 文件）；上限 100 支 |
| 删除战队录入 | deleteTeamProfile | (paths: AppPaths, teamId: string) => ProfileStoreState | 删除战队连同 logo 文件 |
| 档案导入分类 | diffProfileRecords | (paths: AppPaths, incoming: ProfileImportInput) => ProfileImportDiff | 双机同步预览：先按 id（内容相同跳过、差异覆盖）再按名字 —— **同名不同 id 现在是「可勾选的更新」**（导入后保留本机 id 并登记 id 别名），不再直接跳过；受 200 人 / 100 队上限约束；每条附带字段级 diff（名字/常用精灵/宣言/排名 或 名字/队长/宣言） |
| 合并档案导入 | mergeProfileRecords | (paths: AppPaths, incoming: ProfileImportInput, acceptedIds?: { players?: Set<string>; teams?: Set<string> }) => MergeProfileRecordsReport | 按 id 覆盖 / **同名保留本机 id**（更新字段 + 写 `playerAliases`/`teamAliases`）/ 新增；acceptedIds 只合并勾选条目；报告带本次新增的 `aliases` 供导入摘要提示。**为什么要别名**：本机若已有同名但不同 id 的档案，系列赛编排里的 `playerIds` 是对方的 id，没有别名就只能显示一串 id（晋级图/波次卡片解析不出名字） |
| 别名解析 | resolveProfileAlias | (paths: AppPaths, id: string) => string | 外部档案 id → 本机档案 id（无别名时原样返回） |
| 合并导入档案 | mergeProfileRecords | (paths: AppPaths, incoming: ProfileImportInput, acceptedIds?) => MergeProfileRecordsReport | 双机同步落盘：按 diffProfileRecords 同规则合并；acceptedIds 传入时只合并其中条目（导入预览未勾选的条目不落盘） |

## 选手信息表格 (profile-xlsx-service.ts / shared/profile-sheet.ts)

列契约（工作表「选手信息」）由 `shared/profile-sheet.ts` 唯一定义：`名字 | 排位排名 | 宣言 | 擅长精灵1..6 | 头像`；「擅长精灵」拆成 6 个编号列（与系列赛阵容模板同构，才能各挂下拉），导入侧再合并回 `pets`（兼容单列「常用精灵」与改名前旧表头 `精灵1..6` 的写法）。

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 表格 → 选手条目（纯函数） | parseProfileSheetRows | (rows: ProfileSheetRow[]) => { players: ProfileSheetPlayer[]; headerRowNumber: number \| null; errors: string[]; warnings: string[] } | 在带真实行号的二维表上前 5 个非空行内定位表头（判据：既有「名字」列又有常用精灵列，避免把标题行「选手信息登记表」误当表头）；列别名支持中英文与全角；精灵支持 `擅长精灵1..6` 编号列（兼容改名前旧表头 `精灵1..6`）或单个「常用精灵」列；rank 纯小数取整数部分（防 `100.0→1000`）；空名行、重复名字、表内重复给出 warning |
| 导出预填（纯函数） | buildProfileSheetTextRows | (players: PlayerProfile[], sprites: SpriteRecord[]) => string[][] | 把 `player.pets`（`、` 分隔的 displayName）反查精灵回显为下拉同格式 `pet_id_名字（形态）`，拆进 擅长精灵1..6；查不到原样保留；头像列留空 |
| 精灵列区域（纯函数） | profileSpriteColumnRange | (lastRow: number) => string | 擅长精灵1..6 对应的 Excel 区域（`D2:I{lastRow}`），挂下拉校验用 |
| 解表 | extractProfileSheet | (buffer: Buffer) => Promise<ProfileXlsxTable> | exceljs 解 .xlsx → 带**真实行号**的二维表 + 按图片 `tl.nativeRow+1` 定位的浮动图片 + DISPIMG 检测。**不要复用 lineup-xlsx-service 的解表**（它丢空行、无行号，头像会错行）；按名优先取「选手信息」，回退第一个可见工作表 |
| 表格预览 | previewProfileXlsx | (paths: AppPaths, buffer: Buffer) => Promise<ProfileXlsxPreview> | 只读：返回映射好的选手行 + 头像有无 + warnings/errors（含超 MAX_PLAYERS 丢弃预估、孤儿头像行、DISPIMG 提示） |
| 表格导入 | importProfileXlsx | (paths: AppPaths, buffer: Buffer) => Promise<ProfileXlsxImportResult> | 先 importPlayerProfiles 写文字信息，**再从落盘结果重建 name→id**（同名取首个）按行存头像；单张头像失败只记入 failed 不 500；返回 `{ profiles, review, avatars, warnings }` |

## 双机数据同步 (sync-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 导出同步包 | exportSyncBundle | (paths: AppPaths, options: SyncExportOptions) => SyncBundle | 打包全部比赛（含空白/进行中）+ 系列赛编排全量（**含墓碑**，否则删除传播不出去）+ 可选档案与头像（base64，仅在包含档案时附带；缺失头像文件不产生键）；墓碑「连同对局删除」名单内的对局不进包；**剔除 localOnly 本机移除记录**（仅本机语义，绝不外传）；**可选 tournamentIds 范围导出（定向同步 P1-A）**：只含指定系列赛（含其墓碑=定向删除）+ 名下全部比赛 + 该届选手档案（战队档案全量附带），普通对局与他届不进包 |
| 导入预览 | previewSyncImport | (paths: AppPaths, raw: unknown, mode: SyncConflictMode) => SyncImportPreview | 校验 app/schema（不符抛中文错误）后组合比赛与档案 diff，统计头像 补缺/已有/无法对应；只读不写入（系列赛不进预览的勾选列表，导入时自动合并）。另产出 `tournamentGroups`（按 `match.tournamentRef.tournamentId` 把比赛归到各系列赛 + 「普通对局」组，带 name/playerCount/incoming/existsLocally/stageSummary/matchKeys；包内是墓碑时带 `tombstone: true`，UI 显示「已删除」且不可取消勾选）与 `hasTournaments`，供预览弹窗显示「这条系列赛包含哪些比赛」。**头像统计口径与落盘一致**：包内头像 key（档案 id）先按「id 别名 → 源 id → 同名」解析成本机档案，命中不了才算「无法对应」；本机已「本机移除」的系列赛在 tournamentGroups 里带 `localRemoved: true`（UI 显示「已在本机移除，保持隐藏」，不显示「本机已有 / 将新建」）。**「已删对局名单」拦截已计入预览**（与应用合并侧同口径：本机真墓碑 + 包内将被接受的真墓碑的 deletedMatches 名单并集）——命中比赛标 `action=skip` + `blocked=true`（UI 显示「已删名单拦截」），组带 `localTombstone: true`；否则这类比赛会永远显示「新增」却从不写入 |
| 应用导入 | applySyncImport | (paths: AppPaths, raw: unknown, options: SyncApplyOptions) => Promise<SyncImportResult> | 服务端重新分类（不信任客户端判定），按 acceptedKeys 取交集合并比赛与档案，系列赛编排自动合并（不参与勾选）后补跑写回（runTournamentWriteBack，幂等，波打齐自动推进），按 includeAvatars 写头像（复用 saveProfilePlayerAvatar / saveProfileTeamLogo，自带魔数校验；头像目标档案按「**id 别名 → 源 id → 同名**」解析后**一律用本机 id 落盘**）；返回 store（写回后最新、可能含新生成的下一波比赛）/profiles/avatarsWritten/tournaments/warnings。`options.skipTournaments`（云同步主控确认台用）= 不合并包内系列赛编排（编排结构由本机自己持有），只合并比赛并照跑写回；`options.excludeTournamentIds`（预览里被取消勾选的系列赛）= 该系列赛编排不合并且**其名下比赛一律不写入**（从 acceptedKeys 里剔除并统计 warning）；`options.overwriteAvatars`（导入预览勾选「覆盖已有头像」）= 用包内图片覆盖本机同档案已有头像，**默认 false 只补缺**（跨机一致性靠档案头像，覆盖是显式例外）。**墓碑行为**：合并顺序为 编排（墓碑不参与「取消勾选」）→ 按墓碑名单过滤比赛 → 解绑/清理不变量（引用墓碑的比赛一律解绑——旧包能把 tournamentRef 带回来；**新墓碑**且 deletedMatches 时按名单在本机静默移除对局，并记 warning「已按上游墓碑清理本机数据」） |
| 解析同步包（供云同步复用） | parseSyncBundle | (raw: unknown) => SyncBundlePayload | 校验 app/schema/结构并产出 {machine, exportedAt, matches, tournaments, profiles, avatars}，不合法抛中文错误（云同步服务与路由共用同一校验口径） |

## 云同步 (cloud-sync-service.ts)

云端是 Cloudflare Worker + KV 信箱，只有 4 类键：`room:{KEY}:downlink`（主控写/分控读）、`room:{KEY}:version`（小版本键，红点轮询用）、`room:{KEY}:uplink:{码}`（分控写/主控读）、`room:{KEY}:ack:{码}`（主控写/分控读）。**业务细节：没有任何定时器会自动合并数据**——分发、拉取、回传、确认全部由人点击触发；唯一的定时器是前端红点轮询（只读小键）。本机状态落 `cache/cloud-sync.json`，待合并包落 `cache/cloud-pending.json`。

鉴权两把钥匙都走请求头（URL 里不出现任何密钥）：`X-Sync-Key`（房间密钥，键空间隔离）+ `X-Sync-Token`（访问令牌 = Worker secret `SYNC_TOKEN`，真正的大门）。**Worker 侧未配置 SYNC_TOKEN 时所有 `/room` 请求返回 503（fail closed）**，因此本机 config 缺 `syncToken` 时任何数据操作都会被服务端直接拦下并给中文原因。

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 读云同步状态 | getCloudSyncStatus | (paths: AppPaths) => CloudSyncStatus | 组装界面所需的全部状态（config/configured/version/appliedVersion/pending/inbox/roster/assignment/excludedTournamentIds/ownedTournamentIds/lastContact/lastError），不产生云端请求 |
| 计算待回传集 | computePendingQueue | (paths: AppPaths) => CloudSyncPendingQueue | 现算「已完赛 + 有胜者 + 按指派归本机码 + 主控未 ack」的比赛；每次「同步最新」合并后重算，防主控回退后陈旧登记被复活；本机自建系列赛的赛果（未指派，scope 为空）天然不进本集 → 不上行 |
| 已确认比赛集合 | ackedMatchIdSet | (paths: AppPaths) => Set<string> | 主控回执里的 matchId 集合（分控端禁止撤回的判据） |
| 保存云同步设置 | saveCloudSyncConfig | (paths: AppPaths, input: CloudSyncConfigInput) => CloudSyncStatus | syncKey/role/workerUrl/machineLabel/pollEnabled/pollIntervalSeconds 落 config.json；peerCodes（主控端分控码列表）并入名册并剔除本机码 |
| 检测 Worker 在线 | testCloudConnection | (paths: AppPaths) => Promise<CloudSyncTestResult> | 打 `${workerUrl}/health`（不需要密钥、不碰 KV，避免为测通白扣读写额度）；超时/不可达返回 ok:false + 中文原因；**成功提示不含 Worker 地址**（后台界面可能出现在直播画面里，防域名暴露） |
| 主控「同步分发」 | pushCloudSync | (paths: AppPaths) => Promise<CloudSyncActionResult<CloudSyncPushResult> & { version }> | 组包（不带头像）+ `bundle.cloud = {roster, assignment}` → 写 downlink → 写 version（v = 本机记录版本 + 1）。校验：角色必须是 main、机器码必须已设置、名册里不能出现本机码 |
| 分控「同步最新」 | previewCloudPull | (paths: AppPaths) => Promise<CloudSyncPullResult> | 读 downlink → 配对校验（分发机码 == 本机码 → 400）→ 落盘 pending 文件 + 返回现有预览；同时把名册与指派规则并入本机状态（指派随分发下发） |
| 分控「确认合并」 | finalizeCloudPull | (paths: AppPaths, acceptedKeys: string[], mode?: SyncConflictMode) => Promise<CloudSyncActionResult<{applied, warnings}>> | 用落盘包走 applySyncImport（默认 newer），记 appliedVersion（「已同步」判据）后删除 pending 文件。**回退防复活**：本机把某场系列赛对局登记为 completed，而包内同一场仍是 pending（无胜者）且本机该节点已无 winnerId → 判定主控回退过这一波，先 `resetMatchRegistrations` 撤回本机登记再合并（并把它从 ackedMatchIds 移除，否则该场永远不会再进待回传集），附中文 warning。只对系列赛对局生效（普通对局的 pending 分发不是回退信号） |
| 分控「回传」 | uploadCloudSync | (paths: AppPaths) => Promise<CloudSyncUploadResult> | 现算**累计**未 ack 集（不是增量，否则两次回传之间未确认会覆盖丢失）→ 写 uplink:{本机码}，seq + 1；空集 400 |
| 分控「标记为已处理」 | skipCloudPull | (paths: AppPaths) => Promise<CloudSyncActionResult<{appliedVersion}>> | 预览里没有可写入条目时收尾状态：只把「拉取到的那一版」记进 appliedVersion，不写入任何数据（配合前端「知道了，标记为已处理」按钮） |
| 红点轮询 | pollCloudSync | (paths: AppPaths) => Promise<CloudSyncPollResult> | 只读小键：version（两端）、ack:{本机码}（分控端合并 ackedMatchIds，序号不小于已回传 seq 才认）、uplink:{各分控码}（主控端刷新收件箱，**带 ackedInboxSeq 水位：序号 ≤ 已确认水位的旧值一律忽略**，否则 KV 最终一致会让「刚确认完的数量」又冒出来）。**不读大包、不合并数据** |
| 主控「检查回传」 | checkCloudSync | (paths: AppPaths, code?: string \| null) => Promise<CloudSyncCheckResult> | 逐分控端读 uplink → 包装成 SyncBundle → previewSyncImport 复用现有 diff → 每条附 impact 写回影响（写哪个节点、是否推进）；不写入任何数据 |
| 主控确认 | confirmCloudSync | (paths: AppPaths, code: string, acceptedKeys: string[]) => Promise<CloudSyncConfirmResult> | 服务端重分类取交集 → 有可写入项时 applySyncImport（mode:'bundle' + `skipTournaments:true`，编排结构绝不用分控副本覆盖）→ 内部 runTournamentWriteBack 推进波次 → 写 ack:{code} → 从收件箱移除已确认条目。**被勾选项里的 `action='skip'`（本机与对方内容一致）也算确认**：这类不写数据、只回执 + 幂等补跑一次写回；否则对方会永远停在「等主控确认」（确认动作的本质是一次回执） |
| 主控驳回 | rejectCloudSync | (paths: AppPaths, code: string) => Promise<CloudSyncRejectResult> | 不写本地、不写回执；分控端保持「待回传」，修正后重新点「回传」 |
| 保存指派规则 | saveCloudAssignment | (paths: AppPaths, overrides: unknown) => CloudSyncStatus | 比赛 id -> 机器码（空串 = 主控端自己登记）；自动清理已不存在比赛的条目；随下次分发写入 downlink |
| 保存默认排除记忆 | saveCloudExcludedTournaments | (paths: AppPaths, ids: unknown) => CloudSyncStatus | B1「记住上次排除」：保存下次拉取预览默认排除的系列赛（空数组 = 清除记忆）；finalizeCloudPull「确认合并」时也会自动记入本次排除；去空白/去重；墓碑永不入列（删除指令不是可选项） |
| 改机器码守卫 | checkMachineCodeChange | (paths: AppPaths, nextCode: string) => MachineCodeGuardResult | 有内嵌旧码的 running 系列赛 → blocked（堵「改码丢所有权，自己锁死自己」）；仅有其它内嵌旧码系列赛 → requireConfirm；**不做自动迁移 id**（引用、头像目录名都会断） |
| 登记入口判定 | canRegisterMatch | (paths: AppPaths, matchId: string) => {allowed, reason} | 未启用云同步（没填 syncKey/机器码）→ 放行（保持单机行为）；**归属本机的比赛（tournamentRef 内嵌本机码，即本机自建系列赛的对局）一律放行**——自建系列赛不会出现在主控指派表里，按「未指派默认主控」判会让自建赛事登记被误拦，指派只约束「别人家的比赛」；主控端未指派/指派给本机可登记；分控端只有指派给本机的可登记 |
| 撤回判定 | checkSubUndoAllowed | (paths: AppPaths, matchId: string) => {allowed, reason} | 分控端对已 ack 的比赛禁止撤回（合并是整条替换、不触发 onMatchUndo，单方面撤回会让比赛回 pending 而节点胜者还在，状态分叉） |

> `machineCode` 一码三责（id 命名空间 / 编排所有权闸门 / 同步包来源标识）与两个坑（改码丢所有权、两机撞码）见 AGENTS.md「注意事项」与 docs/cloud-sync-plan.html ④。

## 战绩详情 (page7-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取战绩详情状态 | getPage7State | (paths: AppPaths) => Page7State | 获取 page7 标题/温馨提示/已选比赛列表 |
| 保存战绩详情配置 | savePage7State | (paths: AppPaths, payload: unknown) => Page7State | 保存 page7 配置（matchIds 任意状态现存比赛 / title / notice） |
| 清理选场悬空引用 | prunePage7State | (paths: AppPaths) => Page7State \| null | 移除已删比赛的引用（page7 不限状态）；有变化落盘并返回新状态，无变化返回 null；由 socket-server 的比赛广播出口 emitMatchesUpdate 调用 |

> **page7 选场上限 = 20 场**（`PAGE7_MAX_MATCHES = 20`，产品限制）：原来是 9（"整列表滚动"结构的容量），画面改成"一屏 4 行 + 整屏交叉淡入淡出"后放开到 200 兜底，2026-10 运营定为 20 场上限；`normalizeMatchIds` 超过 20 场静默截断（整届勾选大届会被截到前 20 场）。
>
> 同口径的 `prunePage6State`（page6-service.ts，额外要求「已结束」）/ `prunePage8State`（page8-service.ts，额外要求「待开始/进行中」）签名与行为一致；page6/page8 的收录状态白名单为 PAGE6_MATCH_STATUSES / PAGE8_MATCH_STATUSES（保存与清理共用，避免口径漂移）。**page6/page8 的 9 场上限是画面结构（3×3 卡片网格）决定的，不要跟着 page7 一起放开。**

## 团队积分榜 (page9-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取团队积分榜状态 | getPage9State | (paths: AppPaths) => Page9State | 获取 page9 标题与战队积分列表（cache/page9.json） |
| 保存团队积分榜配置 | savePage9State | (paths: AppPaths, payload: unknown) => Page9State | 保存 page9 配置；标题截断 40 字、战队最多 4 支、积分仅保留数字（0-999），排名与总积分不落盘由前端计算 |

## 晋级积分榜 (page14-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取晋级积分榜状态 | getPage14State | (paths: AppPaths) => Page14State | 读 cache/page14.json（系列赛 id / 可播阶段 / 当前阶段 / 页码 / 标题 / 副标题）；文件缺失或解析失败给默认值 |
| 保存晋级积分榜配置 | savePage14State | (paths: AppPaths, payload: unknown) => Page14State | 字段级合并后**按系列赛现状夹紧再落盘**：系列赛 id 只接受 T 前缀形态（其余归空）、阶段索引必须存在且已勾选（失效回退第一个已选阶段）、页码按 `standings.pageCount` 夹紧；标题 40 字 / 副标题 60 字 |
| 读取展示视图 | resolvePage14View | (paths: AppPaths) => { state: Page14State; standings: StageStandings \| null } | GET /api/page14 用（只读，不写盘）：已夹紧的 state + 当前阶段榜单（`resolveStageStandings`，系列赛缺失时 null）。POST 路由保存后再调它，把重算结果一并回给后台 |

## 选手介绍 (page11-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取选手介绍状态 | getPage11State | (paths: AppPaths) => Page11State | 获取 page11-13 左右两侧配置（cache/page11.json） |
| 保存选手介绍配置 | savePage11State | (paths: AppPaths, payload: unknown) => Page11State | 保存左右两侧 Page11SideConfig（source manual/match + 手动字段） |

## 下场对局 (nextgame-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取下场对局状态 | getNextGameState | (paths: AppPaths) => NextGameState | 获取配置（matchId/visible/duration/durationUnit/shownAt） |
| 获取完整载荷 | getNextGamePayload | (paths: AppPaths) => NextGamePayload | state + 当前所选比赛 + 双方头像（page3/后台/悬浮窗共用） |
| 保存配置 | saveNextGameState | (paths: AppPaths, payload: unknown) => NextGamePayload | 保存 matchId/duration/durationUnit |
| 显示下场对局 | showNextGame | (paths: AppPaths, payload: unknown) => NextGamePayload | 开启显示并记录 shownAt（按停留时长自动隐藏） |
| 隐藏下场对局 | hideNextGame | (paths: AppPaths) => NextGamePayload | 关闭显示 |

## 倒计时插件 (countdown-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取倒计时状态 | getCountdownState | (paths: AppPaths) => CountdownState | 获取配置与运行状态（cache/countdown.json） |
| 保存倒计时配置 | saveCountdownState | (paths: AppPaths, payload: unknown) => CountdownState | 保存 duration（分钟）/theme/visible |
| 显示/隐藏 | showCountdown / hideCountdown | (paths: AppPaths) => CountdownState | 切换 visible |
| 启动/暂停/重置 | startCountdown / pauseCountdown / resetCountdown | (paths: AppPaths) => CountdownState | start 写入 endAt（服务端时钟），pause/reset 回写 remainingSeconds 静止 |

## 数据统计 (stats-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取精灵排行 | getSpriteRanking | (paths: AppPaths, { player, tag, tournamentId }) => ... | 计算精灵使用率/上场率/胜率排行；系列赛按 tournamentRef.tournamentId 精确匹配（同名不合并）并回传 tournamentName 供页5标题展示 |

## 桌面悬浮窗 (float-window.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 注册悬浮窗 IPC | registerFloatWindow | (getPort: () => number) => void | 注册 float:toggle/close/menu/menu-close/shape |
| 创建/获取悬浮窗 | createFloatWindow | (getPort) => BrowserWindow | 透明置顶 587×56 阵容悬浮窗 |
| 切换悬浮窗显隐 | toggleFloatWindow | (getPort) => void | 显示并聚焦已有悬浮窗 |
| 打开更换精灵菜单 | openFloatMenuWindow | (payload, parentBoundsOverride?) => void | 在对应精灵上方打开 240×240 菜单窗口 |
| 关闭更换精灵菜单 | closeFloatMenuWindow | () => void | 关闭菜单窗口 |

## 服务器生命周期 (socket-server.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 启动 HTTP + Socket.IO 服务器 | createLocalServer | (paths: AppPaths, port, host?, authConfig?) => Promise<LocalServer> | 全部 REST 路由与 socket 推送的宿主；authConfig 缺省 = 关闭鉴权（桌面模式），传入 = 启用账号密码（Node/Docker 模式）。port 传 0 时返回的 LocalServer.port 仍是 0，真实端口要从 server.address() 取 |
| 关闭服务器 | LocalServer.close | () => Promise<void> | 清理三类定时器（胜负结算切页/nextgame/countdown）→ closeIdleConnections 断 keep-alive → io.close()。注意 io 以 http server 构造，io.close() 会连带关闭它，**不能再调 server.close()**（否则必抛 ERR_SERVER_NOT_RUNNING） |