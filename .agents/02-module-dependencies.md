# 模块依赖/导入映射

```
main.ts
├── socket-server.ts
│   ├── match-service.ts      → shared/types, shared/constants, path-service
│   ├── state-service.ts      → shared/types, shared/constants, path-service
│   ├── sprite-service.ts     → shared/types, shared/constants, path-service
│   ├── image-service.ts      → shared/types, path-service
│   ├── config-service.ts     → shared/constants, path-service
│   ├── stage-service.ts      → shared/types, shared/constants, path-service
│   ├── page6-service.ts      → shared/types, shared/match-schedule, match-service, image-service, path-service
│   ├── page7-service.ts      → shared/types, match-service, image-service, path-service
│   ├── page8-service.ts      → shared/types, shared/match-schedule, match-service, image-service, path-service
│   ├── page9-service.ts      → shared/types, image-service, path-service
│   ├── page14-service.ts     → shared/types, shared/constants, tournament-service（resolveStageStandings / getTournamentStore）, image-service, path-service
│   ├── page11-service.ts     → shared/types, image-service, path-service
│   ├── nextgame-service.ts   → shared/types, shared/constants, image-service, match-service, path-service
│   ├── countdown-service.ts  → shared/types, shared/constants, image-service, path-service
│   ├── sync-service.ts       → shared/types, shared/constants, config-service, match-service, profile-service, tournament-service, image-service, path-service
│   ├── profile-xlsx-service.ts → shared/types, shared/profile-sheet, profile-service, image-service, path-service（exceljs 解表 + 按锚点行落头像）
│   ├── cloud-sync-service.ts → shared/types, shared/constants, config-service, sync-service, match-service, tournament-service, path-service（跑 fetch 访问 Worker，无 Node 专用依赖）
│   ├── tournament-service.ts → shared/types, shared/constants, match-service, profile-service, config-service, image-service, path-service
│   └── stats-service.ts      → shared/types, path-service
├── float-window.ts           → preload.js（rocoFloat IPC 通道）
├── ipc/window-ipc.ts         → preload.js（rocoDesktop IPC 通道）
├── services/path-service.ts
└── services/config-service.ts

preload.ts
├── rocoDesktop（ipcRenderer.invoke → window-ipc.ts）
└── rocoFloat（ipcRenderer.send → float-window.ts：float:toggle/close/menu/menu-close/shape）

float-window.ts
├── preload.js
└── 依赖 main.ts 通过 registerFloatWindow() 注册 IPC 与端口

admin-antd/App.tsx
├── shared/events.ts
├── shared/types.ts
├── shared/constants.ts
├── shared/profile-sheet.ts（选手表格列契约 + 预填/解析纯函数，前端导出与后端导入共用）
├── admin-antd/constants.ts / types.ts
├── admin-antd/lib/*（request、sprite、match、panel、live、history、stats、format、preview）
├── admin-antd/views/*（RosterPanelEditor、HistoryLineupEntryModal、StatsView）
└── admin-antd/components/*（SpritePetCard、StageThumb）

login-antd/App.tsx
└── shared/types.ts

float.html（原生 JS）
└── /scripts/float.js → window.rocoFloat（preload）或 window.open 兜底

float-menu.html（原生 JS）
└── /scripts/float-menu.js → window.rocoFloat（preload）或 window.close 兜底
```
