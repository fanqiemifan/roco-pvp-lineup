/**
 * 「上次操作的系列赛」本地记忆（浏览器 localStorage，跨会话保留）。
 *
 * 为什么需要：系列比赛视图切走再切回时组件会卸载重建，详情区原来固定回退到列表第一条，
 * 正在编排的系列赛（比如已打到第三波的那个）每次都要重新找一遍。这里把用户打开的系列赛 id
 * 记在本地，视图重新挂载时优先恢复它。
 *
 * 记录失效（系列赛被删除 / 同步后本机没有该 id）时读取返回原样、由调用方回退到列表第一条，
 * 不做校验——列表是判断 id 是否存在的唯一真源。
 *
 * localStorage 不可用（隐私模式、配额异常等）时全部静默降级为「没有记忆」，
 * 与「固定打开第一条」的旧行为等价，不影响页面其它功能。
 */

/** 记忆键名：与其它本地偏好（如切换比赛确认弹窗的「不再提示」）保持同一命名空间 */
const LAST_TOURNAMENT_ID_KEY = 'roco-pvp-lineup:lastTournamentId';

/**
 * 本地存储的最小结构。故意不用 DOM 的 `Storage` 类型：
 * lib 会被 tests/admin-antd 的 node 环境测试导入，而测试工程的 tsconfig 不带 DOM lib。
 */
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 取本地存储；不可用返回 null（读取访问本身也可能抛，一并吞掉） */
function getStorage(): KeyValueStorage | null {
  try {
    return (globalThis as { localStorage?: KeyValueStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** 读取上次打开的系列赛 id；无记录或存储不可用 → null */
export function readLastTournamentId(): string | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(LAST_TOURNAMENT_ID_KEY);
  } catch {
    return null;
  }
}

/** 记录上次打开的系列赛 id；传 null 清除记录 */
export function writeLastTournamentId(tournamentId: string | null): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    if (tournamentId) {
      storage.setItem(LAST_TOURNAMENT_ID_KEY, tournamentId);
    } else {
      storage.removeItem(LAST_TOURNAMENT_ID_KEY);
    }
  } catch {
    // 写入失败（配额/隐私模式）静默降级：下次仍回退列表第一条
  }
}
