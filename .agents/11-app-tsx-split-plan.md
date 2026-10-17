# App.tsx 拆解方案（后台视图拆分）

> 状态：方案评审版 · 2026-10-17
> 适用范围：`src/admin-antd/App.tsx` 与 12 个后台视图
> 关联：`AGENTS.md`（约束）、`.agents/09`（视图细节）、`npm run audit:ui`（设计契约体检）

## 0. 结论

**不要把「搬 JSX」当成拆解。** 数据同步视图已经试点过：单搬 JSX 会得到一个 99 个 props 的组件——耦合被显性化了，但没有真正降低维护成本。

正确顺序是：

1. **先把共享数据层抽出来**（socket 订阅、初始加载、跨视图 store）；
2. **再从低耦合视图开始逐个拆**，每个视图只保留自己的 UI 状态；
3. **最后 App.tsx 只剩壳**（Layout / 导航 / Provider / 路由），目标 **< 400 行**。

按下面的里程碑，单人约 **12–18 个工作日**，每个视图一个可独立回滚的 commit。

## 1. 基线（2026-10-17）

| 指标 | 数值 |
|---|---:|
| `App.tsx` 总行数 | 7,942 |
| `Dashboard()` 函数行数 | 7,520（414–7,934） |
| `useState` | 169 |
| `useEffect` / `useRef` / `useMemo` | 17 / 16 / 14 |
| 视图分支 | 12 |
| 已拆出的整视图 | 3（`StatsView`、`TournamentView`、`SyncView`） |
| `SyncView` 当前 scope | **99 个依赖**（52 个 useState 绑定） |

### 各视图耦合度（编译器实测）

用 TypeScript 编译器 API 统计每个 `view === 'x'` 分支里引用的 Dashboard 作用域符号数：

| 视图 | 分支行数 | 外部依赖 | 其中 useState 绑定 | 迁移难度 |
|---|---:|---:|---:|---|
| about | 80 | 4 | 0 | 低 |
| preview | 64 | 9 | 4 | 低 |
| tournament | 19 | 13 | 8 | 低（组件已独立，只需换 hooks） |
| roster | 85 | 14 | 5 | 低 |
| page11 | 146 | 15 | 9 | 低 |
| stage | 133 | 15 | 8 | 低 |
| stats | 31 | 20 | 16 | 中（组件已独立，依赖全在 props） |
| live | 93 | 20 | 8 | 中 |
| profiles | 202 | 23 | 10 | 中 |
| mvp | 168 | 23 | 3 | 中 |
| history | 342 | 54 | 34 | 高 |
| sync | 105 | 99 | 52 | 已拆，待收缩 |

> 统计口径：分支内引用的、声明在分支外的非 import 符号（含 setter），动态类名/局部变量/类型不计。脚本思路见 §8。

## 2. 根因

`Dashboard()` 同时扮演四个角色：

1. **数据层**：socket 订阅、初始加载、`applyServerState`；
2. **状态容器**：169 个 `useState`；
3. **业务编排**：比赛登记、系列赛推进、云同步、头像上传等 60+ 个处理函数；
4. **视图渲染**：12 个视图分支直接写在函数体里。

所以视图和状态的依赖是网状的，不是线性的：

- 云同步状态同时被「数据同步」视图和**导航角标 / 轮询副作用**使用；
- 比赛列表被「赛事面板 / 比赛管理 / 系列比赛 / 结算画面」共同使用；
- 阶段与记分牌被顶栏和多个视图使用。

## 3. 目标架构

```
src/admin-antd/
  App.tsx                     // 目标 < 400 行：Provider + Layout + 导航 + 视图路由
  data/
    admin-data.tsx            // AdminDataProvider：共享 store + socket 订阅 + 初始加载
    admin-actions.ts          // applyServerState / 请求封装 / 跨视图动作
    use-admin-data.ts         // useAdminData() / 细分 selector hooks
  views/
    RosterView.tsx            // 视图只保留 UI 状态（弹窗、草稿、筛选、tab）
    StageView.tsx
    HistoryView.tsx
    SyncView.tsx              // 现有文件，收缩 scope
    ...
  components/                 // 跨视图业务组件（已有）
  ui/                         // UI 原语（已有）
```

### 状态归属规则（拆每个视图时按此裁决）

1. **被 2 个及以上视图读取** → 进 `data/`；
2. **被 App 壳读取**（导航角标、顶栏按钮、page10 自动切回）→ 进 `data/`；
3. **只在一个视图内读写**（弹窗开关、草稿、筛选、当前 tab、预览槽位）→ 留在视图；
4. **可由现有数据推导**（各种 Map / count / 过滤结果）→ 不存 state，改 `useMemo` 或在消费点计算；
5. **跨视图的「一次性动作」**（登记胜负、撤回、推进系列赛）→ 放 `data/admin-actions.ts`，视图调用，不各自实现。

### 数据层形态（先做单 Context，暂不引入状态库）

```tsx
interface AdminData {
  matches: MatchStoreState;
  tournaments: TournamentState;
  profiles: ProfileStoreState;
  sprites: SpriteRecord[];
  stage: StageConfig | null;
  scoreboard: ScoreboardState | null;
  panels: [PanelState, PanelState];
  avatars: AvatarCollectionState;
  cloud: CloudSyncStatus | null;
  actions: {
    applyServerState(payload: unknown): void;
    refreshAll(): Promise<void>;
    registerWinner(matchId: string, side: 'left' | 'right'): Promise<void>;
    // ...
  };
}
```

**先保持「任意数据更新 → 全量重渲染」的现有行为**，不做过早优化；等视图拆完、有性能诉求再拆成多个 Context 或 `useSyncExternalStore` 选择器。**行为等价优先于性能。**

### 数据层要搬的东西（一次性，风险最高）

- `loadInitialData` 与首次加载；
- 所有 socket 订阅及其回调（`matches:update` / `tournament:update` / `stage:update` / `scoreboard:update` / `panel:update` / `avatar:update` / `cloud:*` / `live:*`）；
- `applyServerState` 与各 store 的 setter；
- 云同步轮询副作用（注意：它目前依赖 `cloudStatus.config`，角标也读 `cloudStatus`，**必须一起搬**）；
- page10 自动切回定时器（依赖 activeMatchId 与当前 stage）。

## 4. 里程碑与顺序

### M0 · 工具与基线（0.5 天）

- 固化视图耦合统计脚本（§8），每次拆分前后各跑一次；
- 固化截图脚本 `scripts/screenshot-views.mjs`（CDP 点击导航逐屏截图到 `.artifacts/views/`，gitignore）；
- 记录每个视图的 baseline 截图。

### M1 · 共享数据层（2–3 天）

- 新建 `data/admin-data.tsx` + `use-admin-data.ts`，把 §3 列的订阅/加载/动作搬进去；
- `App.tsx` 用 `<AdminDataProvider>` 包住 `Dashboard`；
- **此阶段不搬任何视图**，只让 `Dashboard` 从 context 读同一批值；
- 验收：`typecheck` + `test` + 12 屏截图与 baseline 无差异；socket 推送、开局、登记、撤回全部手工冒烟。

### M2 · 回炉 SyncView（1–2 天）

- 把 52 个 `sync*` / `cloud*Draft` 状态和对应处理函数搬进 `SyncView`；
- 共享依赖改为 `useAdminData()`（预计 scope ≤ 15：matches/tournaments/profiles/applyServerState/cloudStatus）；
- 验收：同步包导出/导入预览、云同步配置、回传确认、角标数字与轮询。

> 这一步是「数据层是否真的能解耦」的试金石。通过后再批量拆其他视图。

### M3 · 低耦合三连（1 天）

- `about`（4）→ `AboutView`；
- `preview`（9）→ `PreviewView`（预览槽位是纯 UI 状态）；
- `tournament`（13）→ `TournamentView` 改为直接 `useAdminData()`，删掉 13 个 props。

### M4 · 低耦合视图（2–3 天）

- `roster`（14）→ `RosterView`（赛事面板：比赛列表 + 当前比赛 + 阵容编辑）；
- `page11`（15）→ `Page11View`；
- `stage`（15）→ `StageView`（直播推流：页面卡片 + 过渡设置）。

### M5 · 中耦合视图（3–4 天）

- `stats`（20）→ `StatsView` 改 hooks，删 20 个 props；
- `live`（20）→ `LiveView`（实时控制：监听 + 面板滑块）；
- `profiles`（23）→ `ProfilesView`（信息录入：选手/战队表单、导入导出）；
- `mvp`（23）→ `MvpView`（结算画面：胜方载入 + 精灵标记）。

### M6 · 高耦合视图（2–3 天）

- `history`（54 / 34 个 state）→ `HistoryView`（比赛管理：列表、筛选、回收站、批量删除、撤销）；
- 这一块建议先补 `@testing-library/react` + jsdom（约 0.5–1 天）再动手，覆盖筛选与删除路径。

### M7 · 收尾（1 天）

- App.tsx 只剩 Layout / 导航 / Provider / 路由；
- 删除 Dashboard 中已无引用的 state、handler、常量；
- `npm run audit:ui` 记录指标；
- 更新 `.agents/09` 的目录结构与视图说明。

## 5. 每个视图的标准作业（SOP）

1. 跑耦合统计，列出该视图的外部符号；
2. 按 §3 规则把符号分成「进 data 层 / 留视图 / 可推导」三类；
3. 先搬**只属于该视图**的状态与处理函数（保持 JSX 不动），typecheck；
4. 再搬 JSX 到 `views/XView.tsx`，共享依赖改为 hooks；
5. `npm run typecheck:frontend` + `npm test`；
6. 截图对比 baseline（§6），并过一遍该视图的冒烟清单；
7. 一个视图一个 commit，提交信息写清「搬了哪些状态、依赖从 N 降到 M」。

**红线**：

- 不在视图拆分 commit 里顺手改样式/文案（视觉差异会掩盖回归）；
- 不在同一 commit 里拆两个视图；
- 不把 socket 订阅搬进视图；
- 不在条件分支里新增 hook（React #310 踩过）。

## 6. 验证手段

- **静态**：`npm run typecheck:frontend`、`npm run typecheck:tests`、`npm run build:renderer`；
- **测试**：`npm test`（622 个纯函数/服务用例，组件层目前为 0）；
- **截图**：`scripts/screenshot-views.mjs`（CDP 驱动 Chrome，逐个点击导航截图）；拆分前存 baseline，拆分后逐屏对比；
- **冒烟清单**（每视图 5–10 条），示例：
  - 赛事面板：开一局 / 选场 / 左赢右赢 / 撤回 / 阵容快速填充；
  - 数据同步：导出包 / 导入预览 / 云同步保存 / 回传确认 / 导航角标；
  - 系列比赛：创建 / 开赛 / 晋级图 / 回退上一波 / 删除回收站；
  - 比赛管理：筛选 / 批量删除 / 回收站恢复 / 撤销。

> 没有组件测试是这套拆解的最大风险；history 与 sync 两个高风险视图建议补组件测试（jsdom + Testing Library）后再动。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| socket/轮询搬错导致数据不更新 | M1 一次性搬完，先不改视图；冒烟覆盖每个广播 |
| 跨视图状态被误搬（如 cloudStatus 角标） | 用耦合统计列出「分支外引用」，被壳引用的强制进 data 层 |
| React Hooks 顺序（#310） | 视图组件内 hook 一律在条件 return 之前；不加 lint 就靠 review |
| 大 diff 难以 review | 一视图一 commit；先搬状态、再搬 JSX 可分成两个 commit |
| 无组件测试 | 截图 baseline + 冒烟清单；高风险视图补测试 |
| Context 全量重渲染 | 先接受（与现状等价），拆完再按域拆 Context |

## 8. 附：耦合统计脚本思路

用 `typescript` 编译器 API 解析 `App.tsx`：

1. 找到所有 `view === '<literal>'` 的 `ConditionalExpression`；
2. 取 `whenTrue` 子树，遍历 `Identifier`；
3. 用 `checker.getSymbolAtLocation` 解析声明：跳过 import、类型、默认库、子树内声明；
4. 剩余符号即「Dashboard 作用域依赖」；对 `const [x, setX] = useState()` 的绑定单独计数。

脚本可临时放 `scripts/`（不入库），或后续做成 `npm run audit:views`。

## 9. 交接

- 分支：`feat/admin-ds-lite`
- 已有提交：`579e68c`（主题底座）→ `7636355`（蓝红/Hint/StatusTag）→ `01315af`（收尾）→ `35b73d1`（弹窗宽度）→ `29e4861`（死类名）→ `28fa565`（Surface/EmptyState）→ `df52d18`（SyncView 拆分）
- 当前状态：`df52d18` 因网络 SSL 失败**尚未推送**（本地 ahead 1），恢复后先 `git push`
- 下一步：M1 共享数据层（或先把 SyncView scope 从 99 收缩，作为 M2 前置验证）
- 新会话启动时先读：本文件 + `AGENTS.md` + `.agents/09`，再跑 `npm run audit:ui` 与 `npm test` 确认基线
