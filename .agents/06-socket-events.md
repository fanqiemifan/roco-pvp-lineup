# Socket 事件索引

| 自然语言描述 | 事件名称 | 方向 | 说明 | 负载结构 |
|-------------|---------|------|------|---------|
| 完整状态快照 | snapshot | Server → Client | 完整状态快照 | { panels, scoreboard, avatars, store: MatchStoreState, stage, page6, page7, page8, page9, page11, nextgame, profiles, countdown, mvp }（注意比赛字段名是 `store` 不是 `matches`） |
| 面板更新通知 | panel:update | Server → Client | 面板更新 | { panel: PanelState } |
| 记分牌更新通知 | scoreboard:update | Server → Client | 记分牌更新 | { scoreboard: ScoreboardState } |
| 头像更新通知 | avatar:update | Server → Client | 头像更新 | { side, avatar, avatars } |
| 比赛记录更新通知 | matches:update | Server → Client | 比赛记录更新。注意：事件名叫 matches:update，但负载键是 `store` | { store: MatchStoreState } |
| 推流配置更新通知 | stage:update | Server → Client | stage 配置更新 | { stage: StageConfig } |
| 比赛结果页更新通知 | page6:update | Server → Client | page6 配置更新 | { state: Page6State } |
| 对局推送页更新通知 | page7:update | Server → Client | page7 配置更新 | { state: Page7State } |
| 比赛预告页更新通知 | page8:update | Server → Client | page8 配置更新 | { state: Page8State } |
| 团队积分榜页更新通知 | page9:update | Server → Client | page9 配置更新 | { state: Page9State } |
| 信息录入更新通知 | profiles:update | Server → Client | 选手/战队录入变更（增删改/头像 logo 上传后广播，page3 战队标识实时刷新） | { profiles: ProfileStoreState } |
| 选手介绍更新通知 | page11:update | Server → Client | 选手介绍（page11-13）配置更新 | { state: Page11State } |
| 下场对局更新通知 | nextgame:update | Server → Client | 下场对局状态/显示变更（保存/显示/隐藏/到期自动隐藏） | NextGamePayload（state + match + avatars） |
| 倒计时更新通知 | countdown:update | Server → Client | 倒计时状态变更（保存/show/hide/start/pause/reset/归零），负载带 serverNow 供校准 | CountdownPayload（state + serverNow） |
| MVP 结算更新通知 | mvp:update | Server → Client | MVP 结算（page4）精灵项/标签/MVP 标记变更（保存/显示时广播），推流页与后台草稿同步 | { state: MvpState } |

# 数据流图

## 配置变更流程

```
Admin UI (React)
    ↓ (HTTP POST)
socket-server.ts (API Route)
    ↓ (调用服务)
state-service.ts / image-service.ts
    ↓ (文件写入)
Runtime Cache (JSON/PNG)
    ↓ (Socket.emit)
Display Pages (overlay.js / lineup-display.js)
    ↓ (DOM 更新)
推流画面
```

## 比赛管理流程

```
Admin UI → 创建/更新比赛
    ↓
match-service.ts → 验证、计算、存储
    ↓
matches.json (运行时存储)
    ↓ (自动同步)
state-service.ts → 更新记分牌和面板
    ↓
Socket.emit → 推送更新到所有连接的展示页面
```

## 实时状态同步

```
后台操作（编辑阵容/血量）
    ↓
socket-server.ts POST /api/panels/:position
    ↓
state-service.ts savePanelState
    ↓
Runtime Cache (left.json / right.json)
    ↓
Socket.emit('panel:update')
    ↓
展示页面 overlay.js → renderPanel() → DOM 更新
```