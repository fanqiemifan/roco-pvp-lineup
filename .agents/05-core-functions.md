# 核心函数索引

## 比赛管理 (match-service.ts)

持久化精灵主键字段 = `pet_id`（精灵 id）：快照槽位/阵容/撤销重做栈/删除历史均存 pet_id。不做旧数据兼容——pet_id 必须是精灵索引中存在的 id。

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取比赛列表 | getMatchStore | (paths: AppPaths) => MatchStoreState | 获取比赛存储状态 |
| 创建比赛 | createMatch | (paths: AppPaths, payload: unknown) => MatchStoreState | 创建新比赛，payload 包含 leftPlayer, rightPlayer, leftRank, rightRank, leftTeamId/leftTeamName/rightTeamId/rightTeamName（所属战队，选填）, bestOf, tags |
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

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 加载精灵索引 | loadSpriteIndex | (paths: AppPaths) => SpriteRecord[] | 从 pets.json 加载精灵索引 |
| 获取精灵列表 | listSprites | (paths: AppPaths) => SpriteRecord[] | 获取精灵列表（优先索引，否则扫描目录） |
| 创建精灵查找表 | spriteLookup | (paths: AppPaths) => Map<string, SpriteRecord> | 创建精灵查找 Map（key: pet_id/filename/名称/别名） |
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
| 加载运行时配置 | loadRuntimeConfig | (paths: AppPaths) => RuntimeConfig | 加载运行时配置（port） |
| 保存运行时配置 | saveRuntimeConfig | (paths: AppPaths, config: RuntimeConfig) => RuntimeConfig | 保存运行时配置 |

## 仅显阵容 (page4-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取 page4 状态 | getPage4State | (paths: AppPaths) => Page4State | 获取 page4 双面板状态 |
| 保存 page4 面板 | savePage4State | (paths: AppPaths, position, selectedSlots) => Page4PanelState | 保存 page4 面板 |
| 更新 page4 格子 | savePage4SlotState | (paths: AppPaths, position, slotIndex, slotData) => Page4PanelState | 保存 page4 单个格子 |
| 清空 page4 面板 | clearPage4State | (paths: AppPaths, position) => Page4PanelState | 清空 page4 面板 |

## 直播推流 (stage-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取推流配置 | getStageState | (paths: AppPaths) => StageConfig | 获取 stage 配置 |
| 保存推流配置 | saveStageState | (paths: AppPaths, payload) => StageConfig | 保存 stage 配置；page3RankVisible / page3TeamVisible 未携带时保留现值 |

## 信息录入 (profile-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取录入存储 | getProfileStore | (paths: AppPaths) => ProfileStoreState | 获取选手/战队录入（cache/profiles.json，附带头像/logo 存在性与 mtime） |
| 保存选手录入 | savePlayerProfile | (paths: AppPaths, payload: unknown) => ProfileStoreState | 新增/更新选手；未传 id 但同名视为更新（沿用旧 id 保住头像文件）；上限 200 人 |
| 批量导入选手 | importPlayerProfiles | (paths: AppPaths, payload: unknown) => ProfileStoreState | 批量导入选手（数组或 `{players:[...]}`）；仅识别 name/rank/declaration（其余键忽略防注入），rank 仅纯数字、缺 name 跳过、同名沿用旧 id 更新；非数组抛错 |
| 删除选手录入 | deletePlayerProfile | (paths: AppPaths, playerId: string) => ProfileStoreState | 删除选手连同头像文件 |
| 保存战队录入 | saveTeamProfile | (paths: AppPaths, payload: unknown) => ProfileStoreState | 新增/更新战队；未传 id 但同名视为更新（沿用旧 id 保住 logo 文件）；上限 100 支 |
| 删除战队录入 | deleteTeamProfile | (paths: AppPaths, teamId: string) => ProfileStoreState | 删除战队连同 logo 文件 |

## 对局推送 (page7-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取对局推送状态 | getPage7State | (paths: AppPaths) => Page7State | 获取 page7 标题/温馨提示/已选比赛列表 |
| 保存对局推送配置 | savePage7State | (paths: AppPaths, payload: unknown) => Page7State | 保存 page7 配置（matchIds 已结束比赛 / title / notice） |

## 团队积分榜 (page9-service.ts)

| 自然语言描述 | 函数名 | 签名 | 说明 |
|-------------|-------|------|------|
| 获取团队积分榜状态 | getPage9State | (paths: AppPaths) => Page9State | 获取 page9 标题与战队积分列表（cache/page9.json） |
| 保存团队积分榜配置 | savePage9State | (paths: AppPaths, payload: unknown) => Page9State | 保存 page9 配置；标题截断 40 字、战队最多 4 支、积分仅保留数字（0-999），排名与总积分不落盘由前端计算 |

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