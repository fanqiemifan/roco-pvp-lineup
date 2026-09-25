# AI 编码使用指南

## 快速定位代码

1. **搜索文件** - 根据文件名直接搜索，如 `search "match-service.ts"`
2. **搜索函数** - 根据函数名搜索，如 `search "function createMatch"` 或 `search "export function"`
3. **搜索类型** - 根据类型名搜索，如 `search "interface MatchRecord"`
4. **搜索 API 路由** - 根据路径搜索，如 `search "/api/matches"`

## 常用操作

| 任务 | 搜索关键词 | 目标文件 |
|------|-----------|---------|
| 创建比赛 | createMatch | electron/services/match-service.ts |
| 更新面板 | savePanelState | electron/services/state-service.ts |
| 更新推流配置 | saveStageState | electron/services/stage-service.ts |
| 更新对局推送配置 | savePage7State | electron/services/page7-service.ts |
| 更新团队积分榜配置 | savePage9State | electron/services/page9-service.ts |
| 选手介绍配置 | savePage11State | electron/services/page11-service.ts |
| 下场对局显示/隐藏 | showNextGame / hideNextGame | electron/services/nextgame-service.ts |
| 倒计时插件操作 | saveCountdownState / startCountdown 等 | electron/services/countdown-service.ts |
| 胜者结算画面数据 | GET /api/page10（活跃比赛+头像） | electron/socket-server.ts |
| 选手/战队信息录入 | savePlayerProfile / saveTeamProfile | electron/services/profile-service.ts |
| 创建比赛复用录入信息 | reusePlayerProfile | src/admin-antd/App.tsx |
| page3 战队标识渲染 | renderTeams / buildTeamNameImage | src/scripts/page3-display.js |
| 精灵排行统计 | getSpriteRanking | electron/services/stats-service.ts |
| 搜索精灵 | listSprites | electron/services/sprite-service.ts |
| 上传头像 | saveAvatar | electron/services/image-service.ts |
| 发送 Socket 事件 | socket.emit | electron/socket-server.ts |
| 悬浮窗/菜单窗口 | openFloatMenuWindow / createFloatWindow | electron/float-window.ts |
| 数据统计聚合 | buildUsageStats | src/admin-antd/lib/stats.ts |
| 管理后台视图 | RosterPanelEditor / StatsView | src/admin-antd/views/ |
| 比赛历史录入阵容 | saveGameLineupForMatch | electron/services/match-service.ts |
| 启动测试用服务器 | createLocalServer | electron/socket-server.ts |
| 跑测试 | npm test（vitest run） | tests/ + vitest.config.ts |

## 类型引用

所有类型定义集中在 shared/types.ts，使用时直接引用。核心类型：
- PanelState - 面板状态
- ScoreboardState - 记分牌状态
- MatchRecord - 比赛记录
- SlotState - 格子状态
- SpriteRecord - 精灵记录
- StageConfig / StagePageKey / StageTransitionType - 直播推流配置
- PlayerProfile / TeamProfile / ProfileStoreState - 信息录入（选手/战队档案）
- Page7State - 对局推送页配置
- Page9State / Page9TeamEntry - 团队积分榜配置
- Page11State / Page11SideConfig - 选手介绍（page11-13）配置
- NextGameState / NextGamePayload - 下场对局配置与载荷
- CountdownState / CountdownPayload - 倒计时插件状态与载荷
- SpriteUsageRow / StatsMetricKey / StatsRangeKey（管理后台统计，src/admin-antd/lib/stats.ts）

## 文件索引

| 序号 | 文件 | 内容 |
|------|------|------|
| 01 | 01-project-overview.md | 项目架构概览、文件目录索引 |
| 02 | 02-module-dependencies.md | 模块依赖/导入映射 |
| 03 | 03-type-definitions.md | TypeScript 类型定义索引 |
| 04 | 04-api-endpoints.md | API 接口索引（含自然语言描述） |
| 05 | 05-core-functions.md | 核心函数索引（含自然语言描述、函数签名） |
| 06 | 06-socket-events.md | Socket 事件索引和数据流图 |
| 07 | 07-constants.md | 关键常量索引 |
| 08 | 08-resources-routes.md | 资源路径和页面路由索引 |
| 09 | 09-frontend-components.md | 前端组件结构 |
| 10 | 10-usage-guide.md | AI 编码使用指南 |