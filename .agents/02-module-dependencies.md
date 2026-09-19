# 模块依赖/导入映射

```
main.ts
├── socket-server.ts
│   ├── match-service.ts      → shared/types, shared/constants, path-service
│   ├── state-service.ts      → shared/types, shared/constants, path-service
│   ├── sprite-service.ts     → shared/types, shared/constants, path-service
│   ├── image-service.ts      → shared/types, path-service
│   ├── config-service.ts     → shared/constants, path-service
│   ├── page4-service.ts      → shared/types, path-service
│   ├── stage-service.ts      → shared/types, shared/constants, path-service
│   ├── page6-service.ts      → shared/types, match-service, path-service
│   ├── page7-service.ts      → shared/types, match-service, image-service, path-service
│   ├── page8-service.ts      → shared/types, match-service, image-service, path-service
│   ├── page9-service.ts      → shared/types, image-service, path-service
│   ├── page11-service.ts     → shared/types, image-service, path-service
│   ├── nextgame-service.ts   → shared/types, shared/constants, image-service, match-service, path-service
│   ├── countdown-service.ts  → shared/types, shared/constants, image-service, path-service
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
├── admin-antd/constants.ts / types.ts
├── admin-antd/lib/*（request、sprite、match、panel、live、history、stats、format、preview）
├── admin-antd/views/*（RosterPanelEditor、Page4PanelEditor、Page4DeathPanel、StatsView）
└── admin-antd/components/*（Page4SlotVisual、SpritePetCard、StageThumb）

login-antd/App.tsx
└── shared/types.ts

float.html（原生 JS）
└── /scripts/float.js → window.rocoFloat（preload）或 window.open 兜底

float-menu.html（原生 JS）
└── /scripts/float-menu.js → window.rocoFloat（preload）或 window.close 兜底
```
