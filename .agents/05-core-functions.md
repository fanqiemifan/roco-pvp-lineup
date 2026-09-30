# 核心函数索引

## 比赛管理 (match-service.ts)

持久化精灵主键字段 = `pet_id`（精灵 id）：快照槽位/阵容/撤销重做栈/删除历史均存 pet_id。不做旧数据兼容——pet_id 必须是精灵索引中存在的 id。

性能/存储机制（2026-09 优化）：
- **进程内内存态**：matches.json 按 AppPaths 实例做 WeakMap 缓存，读路径一次 stat 比对 mtime 即返回内存态；写路径直接更新缓存，不再写后重读。外部手改文件（mtime 变化）会自动重新载入。
- **原子写**：`persistStoreFile` 先写 `matches.json.tmp-<pid>-<n>` 再 rename，防止写一半崩溃截断文件。
- **版本号迁移**：落盘带 `__version: 1`；版本命中时跳过「全量序列化比对」，无版本旧文件首次读取时规范化回写一次。
- **撤销栈 7 天过期**：`MatchFlowSnapshot.savedAt` 入栈时间；读（缓存命中时节流 6 小时）、写、迁移三条路径都会 prune 超过 `FLOW_HISTORY_TTL_MS`（7 天）的 undo/redo 快照；旧数据无 savedAt 时迁移补当前时间，给予完整 7 天保留期。

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
| 规范化导入比赛 | normalizeImportedMatches | (paths: AppPaths, incoming: unknown[]) => NormalizedMatchImport | 双机同步导入：逐条过 normalizeMatchRecord（含 id 白名单，只接受 `YYYYMMDD_[机器码]NNN`，防止外部包把 id 拼进头像目录），返回可用记录与被拒明细 |
| 比赛导入分类 | diffMatchRecords | (paths: AppPaths, incoming: MatchRecord[], mode: SyncConflictMode) => MatchImportDecision[] | 只读：按 id 对比本机 store 逐条给出 add/update/skip 与原因（newer = 包内 updatedAt 较新才覆盖；bundle = 内容有差异即覆盖、相同跳过），并附带 conflict（两边都登记过且不一致）与字段级 diff |
| 比赛字段级差异 | buildMatchDiffFields | (local: MatchRecord, incoming: MatchRecord) => SyncImportDiffField[] | 只列出不同的字段（状态/比分/选手/赛制/标签 + 逐小局状态与双方阵容名称快照），最多 20 条；供导入预览弹窗做左右 diff 展示 |
| 合并导入比赛 | mergeMatchRecords | (paths: AppPaths, incoming: MatchRecord[], mode: SyncConflictMode) => MergeMatchRecordsReport | 双机同步落盘：不存在追加、已存在按冲突模式覆盖或跳过；复用 readStoreFile/writeStoreFile 缓存与原子写管线，不改 activeMatchId 与撤销栈 |
| 撤回本机登记（云同步专用） | resetMatchRegistrations | (paths: AppPaths, matchIds: string[]) => MatchStoreState | 把指定比赛退回「未登记」：只保留第 1 个待开始小局（含已录阵容），清掉其余小局与全部小局结果、比分、胜者、completedAt 与「弃权」标签；**保留 tournamentRef**（仍是系列赛对局），不走撤销栈。只给云同步回退防复活用（不在 applySyncImport 通用路径里） |
| 弃权判负 | forfeitMatch | (paths: AppPaths, matchId: string, loserSide: 'left' \| 'right') => MatchStoreState | 仅 pending 无结果比赛可用；补决胜小局（BO1=1:0、BO3=2:0，空阵容）+「弃权」标签，completed，入 undo 栈 |
| 批量复位未开始 | resetMatchesToPending | (paths: AppPaths, matchIds: string[]) => MatchStoreState | 系列赛回退专用：比赛直接置 pending（单空小局/0:0/无胜者），清 flowHistory；不进删除/撤销栈 |
| 解除系列赛关联 | detachMatchesFromTournament | (paths: AppPaths, tournamentId: string) => { store: MatchStoreState; matchIds: string[] } | 删除系列赛专用：剥离全部关联比赛的 tournamentRef（比赛保留为普通对局），不进删除/撤销栈；先解绑再删比赛可保证撤销栈快照无孤儿引用 |

## 系列赛管理 (tournament-service.ts)

编排层「搭在比赛系统之上」：赛程/战绩/晋级落 cache/tournaments.json；每场对决仍是普通 MatchRecord，经 createMatch 创建并打 tournamentRef。RNG = mulberry32（同 seed 可复现），波次 RNG 由 series seed 与 stage/wave 位置混合。系列赛归创建它的机器码所有：`mutateRecord`（全部变更入口）、`deleteTournament` 与写回钩子都有**编排机所有权闸门**，非编排机为只读副本（变更被拒「该系列赛由机器 X 编排」，登记赛果不写回，识别方式 = id 机器码 == 本机 machineCode）。

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取系列赛列表 | getTournamentStore | (paths: AppPaths) => TournamentRecord[] | 读 tournaments.json（逐条白名单规范化） |
| 创建系列赛 | createTournament | (paths: AppPaths, payload: unknown) => TournamentRecord | body: name/playerIds/stages?/seed?；校验人数 4/8/16/32、无重复、全部来自档案；stages 省略用 buildDefaultStages；**只剩 2 人的阶段（总决赛）必须为单败，否则抛「总决赛阶段必须为单败」**；id = `T{日期}_{机器码}{NN}`；返回 setup 草稿 |
| （重）抽签 | redrawTournament | (paths: AppPaths, tournamentId: string, payload?: unknown) => TournamentRecord | 仅 setup；重洗种子顺序、drawVersion+1；从字典序做位置洗牌，同 seed 永远同结果 |
| 首波对阵预览 | previewOpeningWave | (paths: AppPaths, tournamentId: string) => { pairs } | 只读：按当前 seed 调 generateDraftPairs 返回首波配对，不落盘不建场；仅 setup（否则抛错）。与开赛后实际 W1 节点逐场一致 |
| 开赛 | startTournament | (paths: AppPaths, tournamentId: string) => TournamentRecord | setup→running，materialize 阶段0 W1（自动锁定或 draft） |
| 确认推进 | advanceTournament | (paths: AppPaths, tournamentId: string) => TournamentRecord | 最后波 draft 且随机配对 → 重新随机并锁定建场；手动配对/非 draft 拒绝 |
| 暂存配对草稿 | savePairingDraft | (paths: AppPaths, tournamentId: string, waveGlobalIndex: unknown, payload: unknown) => TournamentRecord | 编辑中间态即存（白名单/范围校验，允许漏配重复），不建场 |
| 锁定配对 | lockPairings | (paths: AppPaths, tournamentId: string, waveGlobalIndex: unknown, payload: unknown) => TournamentRecord | 校验通过后批量 createMatch（draft→nodes），自动标签（赛事名/阶段名/W波次，跨桶加标签）；建场时从选手档案快照 leftRank/rightRank（与前端「快速创建比赛」同口径） |
| 导入外部对阵 | importPairings | (paths: AppPaths, tournamentId: string, waveGlobalIndex: unknown, payload: unknown) => PairingImportResult | text（每行 A vs B）/pairs 名字数组；匹配池仅本波选手，精确→子串模糊，未唯一匹配进 unmatched，回填草稿不锁定 |
| 回退上一波 | rollbackWave | (paths: AppPaths, tournamentId: string) => TournamentRecord | 最后波三情形：①整波刚打完（总决赛完赛）→ 波保留，比赛复位 pending、清节点胜者、撤销冠军、recompute 战绩；②波未打（pending/draft）→ 删未打比赛与波（可恢复）、重开前一波；③部分进行 → 拒绝并提示逐场撤销。跨阶段回落 currentStageIndex |
| 比赛完成钩子 | onMatchCompleted | (paths: AppPaths, matchId: string) => TournamentRecord \| null | 无 ref/未完成→null；系列赛已删除（孤儿引用）或本机只是只读副本（非编排机）→null 不报错；节点写胜者+更新战绩（幂等）；波齐→completed 并自动生成下一波/下一阶段或冠军 |
| 撤回小局钩子 | onMatchUndo | (paths: AppPaths, matchId: string) => TournamentRecord \| null | 清节点胜者并用 recomputeStageEntries 重算该阶段战绩（同阶段撤回与跨阶段回退口径一致）；该波已自动推进时，若后续波全是「自动锁定（pairingStatus=locked）且一场未打」则级联丢弃（软删其比赛、回退 currentStageIndex、删冠军结果），否则抛错提示走「回退上一波」；节点无胜者（撤回非决胜小局）→null 不广播；孤儿引用或只读副本同样 →null。调用方（undo 路由）须先跑本钩子再撤比赛 |
| 删除系列赛 | deleteTournament | (paths: AppPaths, tournamentId: string, options?: { deleteMatches?: boolean }) => DeleteTournamentResult | 不存在抛错；非编排机拒绝（「该系列赛由机器 X 编排」，解绑前先校验）；关联比赛一律先 detachMatchesFromTournament 解绑：默认仅删 tournaments.json 记录（比赛保留为普通对局）；deleteMatches=true 再走 deleteMatches 连对局删除（可撤回，恢复后无关联）；返回 matchIds/matchesDeleted |
| 合并导入系列赛 | mergeTournamentRecords | (paths: AppPaths, incoming: unknown[], mode: SyncConflictMode) => MergeTournamentRecordsReport | 双机同步自动合并（不参与勾选）：逐条 normalizeRecord 白名单校验（非法计数 rejected）；本机不存在→新增、内容相同→跳过（幂等）、有差异按「较新覆盖 / 以包为准」覆盖；只有编排机会修改系列赛，只读副本不会反向覆盖编排机 |
| 写回补跑 | runTournamentWriteBack | (paths: AppPaths) => TournamentWriteBackReport | 同步导入后对本机全部「已完成 + 带 tournamentRef」比赛逐场跑 onMatchCompleted（幂等）：最后一场补齐时自动推进（下一波/冠军），双机「各登记一半、汇合推进」的关键一步；只读副本自动跳过；advanced 按内容摘要（排除 updatedAt 空转）判断是否真正改动；失败与「赛果和已写回节点胜者不一致」（协作机撤回重登后回传）都记 warnings 不阻断导入，后者提示走「回退上一波」 |
| 阶段标注解析 | resolveTournamentLabels | (paths: AppPaths, matches: Array<Pick<MatchRecord, 'id' \| 'tournamentRef'>>) => Record<string, string> | page6/page8 卡片用（经 GET /api/page6、/api/page8 下发 tournamentLabels）：格式「阶段名·轮次」（`·` 两侧无空格）——单败阶段只给阶段名（如「总决赛」）；双败 W1=「首轮」、W2 按节点两位选手首轮胜负判池=「胜者组/败者组」、W3=「决胜轮」；跨桶等拿不到一致池归属退回阶段名；仅 tournamentRef 指向现存系列赛的比赛有值（普通对局/孤儿引用缺席） |

内部引擎：`doubleBucketSpecs`（双败波次战绩桶：W1 0-0 / W2 1-0+0-1 / W3 1-1）、`wonOpeningRound`（该选手本阶段 W1 是否取胜——决胜池 1-1 池里「胜者组掉落者」与「败者组上扬者」的判据）、`pairWithAvoidance`（greedy 桶内配对，avoidRematch 先过滤已交手、无法避开再放行）、`crossPair`（左右两侧交叉配对：左侧每人从右侧剩余池随机取对手；决胜波 1-1 池两类人互不相遇，avoidRematch 优先避开已交手）、`bracketPositions`（标准种子位序列，**仅 stageIndex=0 的首阶段使用**）、`generateDraftPairs`（生成配对草稿：单败 `bracket-seed` 从 stage 1 起按 `entries` 顺序两两相邻配对，**延续固定对阵树，不再每轮重新种子**；双败 W3 的 1-1 池走 `crossPair` 经典交叉配对）、`materializeWave`（建波：draft 或自动锁定）、`validatePairs`（每人恰好一次/同桶严格/跨桶显式允许/已交手提醒）、`bracketOrderOfStage`（晋级选手在上一阶段的获胜节点位置 `(waveIndex, nodeIndex)`，单败即节点序、双败则胜者组出线在前）、`progressFromWave`（波完成后阶段/波次推进：promoted=半额→按 `bracketOrderOfStage` 的对阵树顺序换批进入下一阶段（而非全局种子序），否则双败建下一波）、`recomputeStageEntries`（按现存节点重算阶段战绩，回退用）。

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

## 图片管理 (image-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取单个头像状态 | getAvatarState | (paths: AppPaths, side: 'left' | 'right') => AvatarState | 获取单个头像状态 |
| 获取双头像状态 | getAvatarStates | (paths: AppPaths) => AvatarCollectionState | 获取双头像状态 |
| 上传头像 | saveAvatar | (paths: AppPaths, side: 'left' | 'right', buffer: Buffer, mimeType?: string) => AvatarState | 保存头像 |
| 删除头像 | deleteAvatar | (paths: AppPaths, side: 'left' | 'right') => AvatarState | 删除头像 |
| 读取头像 MIME 类型 | readAvatarMimeType | (paths: AppPaths, side: 'left' | 'right') => string | 读取头像 MIME 类型 |
| 保存选手录入头像 | saveProfilePlayerAvatar | (paths: AppPaths, playerId: string, buffer: Buffer) => Promise<void> | 魔数校验 + sharp 方形裁剪 PNG，存 cache/profiles/players/<id>.png |
| 保存战队录入 logo | saveProfileTeamLogo | (paths: AppPaths, teamId: string, buffer: Buffer) => Promise<void> | 魔数校验 + sharp cover 铺满裁剪 192×192 PNG，存 cache/profiles/teams/<id>.png |

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
| 保存推流配置 | saveStageState | (paths: AppPaths, payload) => StageConfig | 保存 stage 配置；page3RankVisible / page3TeamVisible / page3RedLightMode / page3RedLightInstant 未携带时保留现值 |

## 信息录入 (profile-service.ts)

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
| 档案导入分类 | diffProfileRecords | (paths: AppPaths, incoming: ProfileImportInput) => ProfileImportDiff | 双机同步预览：先按 id（内容相同跳过、差异覆盖）再按名字（同名不同 id 跳过并在 reason 提示，不覆盖），受 200 人 / 100 队上限约束；每条附带字段级 diff（名字/常用精灵/宣言/排名 或 名字/队长/宣言） |
| 合并导入档案 | mergeProfileRecords | (paths: AppPaths, incoming: ProfileImportInput, acceptedIds?) => MergeProfileRecordsReport | 双机同步落盘：按 diffProfileRecords 同规则合并；acceptedIds 传入时只合并其中条目（导入预览未勾选的条目不落盘） |

## 双机数据同步 (sync-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 导出同步包 | exportSyncBundle | (paths: AppPaths, options: SyncExportOptions) => SyncBundle | 打包全部比赛（含空白/进行中）+ 系列赛编排全量 + 可选档案与头像（base64，仅在包含档案时附带；缺失头像文件不产生键） |
| 导入预览 | previewSyncImport | (paths: AppPaths, raw: unknown, mode: SyncConflictMode) => SyncImportPreview | 校验 app/schema（不符抛中文错误）后组合比赛与档案 diff，统计头像 补缺/已有/无法对应；只读不写入（系列赛不进预览，导入时自动合并） |
| 应用导入 | applySyncImport | (paths: AppPaths, raw: unknown, options: SyncApplyOptions) => Promise<SyncImportResult> | 服务端重新分类（不信任客户端判定），按 acceptedKeys 取交集合并比赛与档案，系列赛编排自动合并（不参与勾选）后补跑写回（runTournamentWriteBack，幂等，波打齐自动推进），按 includeAvatars 只补缺头像（复用 saveProfilePlayerAvatar / saveProfileTeamLogo，自带魔数校验；头像目标 id 支持「同名匹配」）；返回 store（写回后最新、可能含新生成的下一波比赛）/profiles/avatarsWritten/tournaments/warnings。`options.skipTournaments`（云同步主控确认台用）= 不合并包内系列赛编排（编排结构由本机自己持有），只合并比赛并照跑写回 |
| 解析同步包（供云同步复用） | parseSyncBundle | (raw: unknown) => SyncBundlePayload | 校验 app/schema/结构并产出 {machine, exportedAt, matches, tournaments, profiles, avatars}，不合法抛中文错误（云同步服务与路由共用同一校验口径） |

## 云同步 (cloud-sync-service.ts)

云端是 Cloudflare Worker + KV 信箱，只有 4 类键：`room:{KEY}:downlink`（主控写/分控读）、`room:{KEY}:version`（小版本键，红点轮询用）、`room:{KEY}:uplink:{码}`（分控写/主控读）、`room:{KEY}:ack:{码}`（主控写/分控读）。**业务细节：没有任何定时器会自动合并数据**——分发、拉取、回传、确认全部由人点击触发；唯一的定时器是前端红点轮询（只读小键）。本机状态落 `cache/cloud-sync.json`，待合并包落 `cache/cloud-pending.json`。

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 读云同步状态 | getCloudSyncStatus | (paths: AppPaths) => CloudSyncStatus | 组装界面所需的全部状态（config/configured/version/appliedVersion/pending/inbox/roster/assignment/ownedTournamentIds/lastContact/lastError），不产生云端请求 |
| 计算待回传集 | computePendingQueue | (paths: AppPaths) => CloudSyncPendingQueue | 现算「已完赛 + 有胜者 + 按指派归本机码 + 主控未 ack」的比赛；每次「同步最新」合并后重算，防主控回退后陈旧登记被复活 |
| 已确认比赛集合 | ackedMatchIdSet | (paths: AppPaths) => Set<string> | 主控回执里的 matchId 集合（分控端禁止撤回的判据） |
| 保存云同步设置 | saveCloudSyncConfig | (paths: AppPaths, input: CloudSyncConfigInput) => CloudSyncStatus | syncKey/role/workerUrl/machineLabel/pollEnabled/pollIntervalSeconds 落 config.json；peerCodes（主控端分控码列表）并入名册并剔除本机码 |
| 检测 Worker 在线 | testCloudConnection | (paths: AppPaths) => Promise<CloudSyncTestResult> | 打 `${workerUrl}/health`（不需要密钥、不碰 KV，避免为测通白扣读写额度）；超时/不可达返回 ok:false + 中文原因 |
| 主控「同步分发」 | pushCloudSync | (paths: AppPaths) => Promise<CloudSyncActionResult<CloudSyncPushResult> & { version }> | 组包（不带头像）+ `bundle.cloud = {roster, assignment}` → 写 downlink → 写 version（v = 本机记录版本 + 1）。校验：角色必须是 main、机器码必须已设置、名册里不能出现本机码 |
| 分控「同步最新」 | previewCloudPull | (paths: AppPaths) => Promise<CloudSyncPullResult> | 读 downlink → 配对校验（分发机码 == 本机码 → 400）→ 落盘 pending 文件 + 返回现有预览；同时把名册与指派规则并入本机状态（指派随分发下发） |
| 分控「确认合并」 | finalizeCloudPull | (paths: AppPaths, acceptedKeys: string[], mode?: SyncConflictMode) => Promise<CloudSyncActionResult<{applied, warnings}>> | 用落盘包走 applySyncImport（默认 newer），记 appliedVersion（「已同步」判据）后删除 pending 文件。**回退防复活**：本机把某场系列赛对局登记为 completed，而包内同一场仍是 pending（无胜者）且本机该节点已无 winnerId → 判定主控回退过这一波，先 `resetMatchRegistrations` 撤回本机登记再合并（并把它从 ackedMatchIds 移除，否则该场永远不会再进待回传集），附中文 warning。只对系列赛对局生效（普通对局的 pending 分发不是回退信号） |
| 分控「回传」 | uploadCloudSync | (paths: AppPaths) => Promise<CloudSyncUploadResult> | 现算**累计**未 ack 集（不是增量，否则两次回传之间未确认会覆盖丢失）→ 写 uplink:{本机码}，seq + 1；空集 400 |
| 红点轮询 | pollCloudSync | (paths: AppPaths) => Promise<CloudSyncPollResult> | 只读小键：version（两端）、ack:{本机码}（分控端合并 ackedMatchIds，序号不小于已回传 seq 才认）、uplink:{各分控码}（主控端刷新收件箱）。**不读大包、不合并数据** |
| 主控「检查回传」 | checkCloudSync | (paths: AppPaths, code?: string \| null) => Promise<CloudSyncCheckResult> | 逐分控端读 uplink → 包装成 SyncBundle → previewSyncImport 复用现有 diff → 每条附 impact 写回影响（写哪个节点、是否推进）；不写入任何数据 |
| 主控确认 | confirmCloudSync | (paths: AppPaths, code: string, acceptedKeys: string[]) => Promise<CloudSyncConfirmResult> | 服务端重分类取交集 → applySyncImport（mode:'bundle' + `skipTournaments:true`，编排结构绝不用分控副本覆盖）→ 内部 runTournamentWriteBack 推进波次 → 写 ack:{code} → 从收件箱移除已确认条目 |
| 主控驳回 | rejectCloudSync | (paths: AppPaths, code: string) => Promise<CloudSyncRejectResult> | 不写本地、不写回执；分控端保持「待回传」，修正后重新点「回传」 |
| 保存指派规则 | saveCloudAssignment | (paths: AppPaths, overrides: unknown) => CloudSyncStatus | 比赛 id -> 机器码（空串 = 主控端自己登记）；自动清理已不存在比赛的条目；随下次分发写入 downlink |
| 改机器码守卫 | checkMachineCodeChange | (paths: AppPaths, nextCode: string) => MachineCodeGuardResult | 有内嵌旧码的 running 系列赛 → blocked（堵「改码丢所有权，自己锁死自己」）；仅有其它内嵌旧码系列赛 → requireConfirm；**不做自动迁移 id**（引用、头像目录名都会断） |
| 登记入口判定 | canRegisterMatch | (paths: AppPaths, matchId: string) => {allowed, reason} | 未启用云同步（没填 syncKey/机器码）→ 放行（保持单机行为）；主控端未指派/指派给本机可登记；分控端只有指派给本机的可登记 |
| 撤回判定 | checkSubUndoAllowed | (paths: AppPaths, matchId: string) => {allowed, reason} | 分控端对已 ack 的比赛禁止撤回（合并是整条替换、不触发 onMatchUndo，单方面撤回会让比赛回 pending 而节点胜者还在，状态分叉） |

> `machineCode` 一码三责（id 命名空间 / 编排所有权闸门 / 同步包来源标识）与两个坑（改码丢所有权、两机撞码）见 AGENTS.md「注意事项」与 docs/cloud-sync-plan.html ④。

## 对局推送 (page7-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取对局推送状态 | getPage7State | (paths: AppPaths) => Page7State | 获取 page7 标题/温馨提示/已选比赛列表 |
| 保存对局推送配置 | savePage7State | (paths: AppPaths, payload: unknown) => Page7State | 保存 page7 配置（matchIds 任意状态现存比赛 / title / notice） |
| 清理选场悬空引用 | prunePage7State | (paths: AppPaths) => Page7State \| null | 移除已删比赛的引用（page7 不限状态）；有变化落盘并返回新状态，无变化返回 null；由 socket-server 的比赛广播出口 emitMatchesUpdate 调用 |

> 同口径的 `prunePage6State`（page6-service.ts，额外要求「已结束」）/ `prunePage8State`（page8-service.ts，额外要求「待开始/进行中」）签名与行为一致；page6/page8 的收录状态白名单为 PAGE6_MATCH_STATUSES / PAGE8_MATCH_STATUSES（保存与清理共用，避免口径漂移）。

## 团队积分榜 (page9-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取团队积分榜状态 | getPage9State | (paths: AppPaths) => Page9State | 获取 page9 标题与战队积分列表（cache/page9.json） |
| 保存团队积分榜配置 | savePage9State | (paths: AppPaths, payload: unknown) => Page9State | 保存 page9 配置；标题截断 40 字、战队最多 4 支、积分仅保留数字（0-999），排名与总积分不落盘由前端计算 |

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
| 获取精灵排行 | getSpriteRanking | (paths: AppPaths, params) => ... | 计算精灵使用率/上场率/胜率排行 |

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