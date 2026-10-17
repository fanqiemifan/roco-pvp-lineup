import React, { startTransition, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { App } from 'antd';

import type { MatchStoreState, PanelState } from '../../../shared/types';
import type {
  LiveField,
  NoticeState,
  PanelEditorState,
  PanelSide,
} from '../types';
import {
  LIVE_WATCH_POLL_MS,
  clampNumber,
  createLiveWatchSnapshot,
  extractLiveConfigPanel,
  findConfigTargetIndex,
  formatWatchError,
  getLiveConfigFileName,
  readNumberField,
  readStoredLiveWatchPath,
  stringifyLiveConfig,
  writeStoredLiveWatchPath,
  type LiveWatchSnapshot,
} from '../lib/live';
import { buildPanelRequest, cloneSelected } from '../lib/panel';
import { requestJson } from '../lib/request';
import type { ApplyServerStatePayload } from './admin-data';

export interface LiveControl {
  /** 实时控制页顶部的操作提示（监听开启 / 导出 / 读写失败等） */
  liveNotice: NoticeState;
  liveFilePath: string | null;
  liveConfigEnabled: boolean;
  /** 监听状态快照（开始时间 / 最近同步 / 最近回写 / 错误），LiveWatchCard 只读展示 */
  liveWatch: LiveWatchSnapshot;
  /** 读取 / 切换监听文件过程中（按钮 loading） */
  liveWatchBusy: boolean;
  /** 上次成功监听的文件路径（localStorage 记忆，重启后仍能一键恢复） */
  liveRememberedPath: string;
  /** 轮询心跳（最近一次检查文件的时刻）：LiveWatchCard 每秒自读，用来展示「最近检查 x 秒前」 */
  liveHeartbeatRef: React.RefObject<number>;
  /** 桌面版才有本地文件读写能力：浏览器 / 无头模式下实时监听不可用（只能上传一次 JSON） */
  liveDesktopSupported: boolean;
  setLiveNotice: Dispatch<SetStateAction<NoticeState>>;
  handleExportLiveConfig: () => Promise<void>;
  handleLiveConfigWatchToggle: () => void;
  startLiveConfigWatch: () => Promise<void>;
  restoreLiveConfigWatch: () => Promise<void>;
  forgetLiveWatchPath: () => void;
  handleLiveConfigUpload: (file: File & { path?: string }) => Promise<boolean>;
  saveLiveField: (side: PanelSide, slotIndex: number, field: LiveField, value: number) => Promise<void>;
}

async function verifyFilePermission(fileHandle: {
  queryPermission?: (options?: unknown) => Promise<string>;
  requestPermission?: (options?: unknown) => Promise<string>;
}, mode: 'read' | 'readwrite' = 'read') {
  if (!fileHandle || typeof fileHandle.queryPermission !== 'function') {
    return true;
  }

  const options = { mode };
  if ((await fileHandle.queryPermission(options)) === 'granted') {
    return true;
  }
  if (typeof fileHandle.requestPermission !== 'function') {
    return false;
  }
  return (await fileHandle.requestPermission(options)) === 'granted';
}

function downloadLiveConfig(text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'roco-live-config.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * 实时控制（M5 从 App.tsx 下沉到常驻数据层）。
 *
 * 为什么必须挂在常驻的 AdminDataProvider 而不是 LiveView 里：
 * - 「监听是否开着」要能从任何视图一眼看到（导航项呼吸点），App 壳读 liveConfigEnabled / liveFilePath；
 * - 切走「实时控制」视图时监听轮询与回写定时器必须继续跑（否则外部计分工具的 JSON 不再被读取）；
 * - 轮询闭包只能读 ref（liveWatchRef / livePanelsRef），不能改成读 state —— 旧实现就是闭包读到
 *   开启监听之前的 false/null，界面显示「监听中」但文件从未被读取。
 */
export function useLiveControl({
  panels,
  setPanels,
  applyServerState,
  loadInitialData,
}: {
  panels: Record<PanelSide, PanelEditorState>;
  setPanels: Dispatch<SetStateAction<Record<PanelSide, PanelEditorState>>>;
  applyServerState: (payload: ApplyServerStatePayload) => void;
  loadInitialData: (showToast?: boolean) => Promise<void>;
}): LiveControl {
  const { message } = App.useApp();
  const [liveNotice, setLiveNotice] = useState<NoticeState>(null);
  const [liveFilePath, setLiveFilePath] = useState<string | null>(null);
  const [liveConfigEnabled, setLiveConfigEnabled] = useState(false);
  const [liveWatch, setLiveWatch] = useState<LiveWatchSnapshot>(createLiveWatchSnapshot);
  const [liveWatchBusy, setLiveWatchBusy] = useState(false);
  const [liveRememberedPath, setLiveRememberedPath] = useState<string>(() => readStoredLiveWatchPath());

  const liveApplyRef = useRef(false);
  const liveWriteRef = useRef(false);
  const liveSaveTimerRef = useRef<number | null>(null);
  const livePollTimerRef = useRef<number | null>(null);
  const liveWatchRef = useRef<{
    enabled: boolean;
    filePath: string | null;
    /** 已应用到面板的文件内容（相同则跳过，避免自己回写后又被当成外部改动） */
    lastContent: string;
    lastModified: number | null;
  }>({ enabled: false, filePath: null, lastContent: '', lastModified: null });
  const liveHeartbeatRef = useRef(0);
  /** 一次只允许一个轮询在跑（读取 + 应用期间不重入） */
  const livePollBusyRef = useRef(false);
  /** 最新面板状态：轮询 / 250ms 回写定时器都是异步回调，不能闭包读 panels（会写回旧值） */
  const livePanelsRef = useRef(panels);
  const liveDesktopSupported = Boolean(window.rocoDesktop?.readTextFile && window.rocoDesktop?.statFile);

  function clearLivePollTimer() {
    if (livePollTimerRef.current !== null) {
      window.clearInterval(livePollTimerRef.current);
      livePollTimerRef.current = null;
    }
  }

  function clearLiveSaveTimer() {
    if (liveSaveTimerRef.current !== null) {
      window.clearTimeout(liveSaveTimerRef.current);
      liveSaveTimerRef.current = null;
    }
  }

  function rememberLiveWatchPath(filePath: string) {
    setLiveRememberedPath(filePath);
    writeStoredLiveWatchPath(filePath);
  }

  function forgetLiveWatchPath() {
    setLiveRememberedPath('');
    writeStoredLiveWatchPath(null);
    setLiveNotice({ tone: 'info', text: '已清除上次监听记录' });
  }

  async function writeLiveConfigToPath(filePath: string, text: string, notice?: string) {
    const desktop = window.rocoDesktop;
    if (!desktop?.writeTextFile || !desktop?.statFile) {
      throw new Error('当前环境不支持写入监听文件');
    }

    liveWriteRef.current = true;
    try {
      await desktop.writeTextFile(filePath, text);
      const stat = await desktop.statFile(filePath);
      // 记住刚写进去的内容：否则下一秒轮询会把我们自己的回写当成外部改动再应用一遍
      const session = liveWatchRef.current;
      if (session.filePath === filePath) {
        session.lastContent = text;
        session.lastModified = stat.mtimeMs;
      }
      setLiveWatch((prev) => ({ ...prev, lastWriteAt: Date.now() }));
      if (notice) {
        setLiveNotice({ tone: 'success', text: notice });
      }
    } finally {
      liveWriteRef.current = false;
    }
  }

  async function saveLivePanelsSilently(nextPanels: Record<PanelSide, PanelEditorState>) {
    const [leftData, rightData] = await Promise.all([
      requestJson<{ success: boolean; panel?: PanelState; store?: MatchStoreState }>('/api/panels/left', {
        method: 'POST',
        json: { selected: buildPanelRequest(nextPanels.left.selected) },
      }),
      requestJson<{ success: boolean; panel?: PanelState; store?: MatchStoreState }>('/api/panels/right', {
        method: 'POST',
        json: { selected: buildPanelRequest(nextPanels.right.selected) },
      }),
    ]);

    applyServerState({
      panel: rightData.panel,
      panels: [leftData.panel, rightData.panel].filter(Boolean) as PanelState[],
      store: rightData.store ?? leftData.store,
    });
  }

  /**
   * 把监听 / 上传的 JSON 内容应用到面板。
   *
   * @param options.notify 是否在页面顶部弹提示：自动轮询默认静默（结果由 LiveWatchCard 的
   *   「最近同步」展示，每秒都在变的横幅纯属噪音），手动上传 / 首次开启由调用方提示。
   */
  async function applyLiveConfigText(text: string, source = '监听文件', options: { notify?: boolean } = {}) {
    const notify = options.notify !== false;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`${source} JSON 格式错误`);
    }

    liveApplyRef.current = true;
    try {
      // 以 ref 里的最新面板为基准：轮询回调闭包里的 panels 可能是几秒前的旧值
      const basePanels = livePanelsRef.current;
      let changedSlots = 0;
      const nextPanels: Record<PanelSide, PanelEditorState> = {
        left: { ...basePanels.left, selected: cloneSelected(basePanels.left.selected) },
        right: { ...basePanels.right, selected: cloneSelected(basePanels.right.selected) },
      };

      (['left', 'right'] as PanelSide[]).forEach((panel) => {
        const panelItems = extractLiveConfigPanel(payload, panel);
        if (!Array.isArray(panelItems)) {
          return;
        }

        const usedIndexes = new Set<number>();
        panelItems.slice(0, 6).forEach((rawItem, fallbackIndex) => {
          if (!rawItem || typeof rawItem !== 'object') {
            return;
          }

          const item = rawItem as Record<string, unknown>;
          const targetIndex = findConfigTargetIndex(panel, item, fallbackIndex, usedIndexes, nextPanels);
          if (targetIndex < 0 || targetIndex >= 6) {
            return;
          }
          usedIndexes.add(targetIndex);

          const slot = { ...nextPanels[panel].selected[targetIndex] };
          const hp = readNumberField(item, ['HP', 'hp', 'healthPercent', 'health'], 0, 100);
          const value = readNumberField(item, ['value', 'energyValue', 'energy'], 0, 10);
          let slotChanged = false;

          if (hp !== null && slot.healthPercent !== hp) {
            slot.healthPercent = hp;
            slotChanged = true;
          }
          if (value !== null && slot.energyValue !== value) {
            slot.energyValue = value;
            slotChanged = true;
          }
          if (slotChanged) {
            changedSlots += 1;
          }

          nextPanels[panel].selected[targetIndex] = slot;
        });
      });

      if (!changedSlots) {
        setLiveWatch((prev) => ({ ...prev, lastAppliedAt: Date.now(), lastAppliedCount: 0, error: null, errorAt: null }));
        if (notify) {
          setLiveNotice({ tone: 'info', text: `${source}无变化（面板数值已经是文件里的值）` });
        }
        return;
      }

      livePanelsRef.current = nextPanels;
      startTransition(() => {
        setPanels(nextPanels);
      });
      await saveLivePanelsSilently(nextPanels);
      setLiveWatch((prev) => ({
        ...prev,
        lastAppliedAt: Date.now(),
        lastAppliedCount: changedSlots,
        error: null,
        errorAt: null,
      }));
      if (notify) {
        setLiveNotice({ tone: 'success', text: `已根据${source}更新 ${changedSlots} 个槽位` });
      }
    } finally {
      liveApplyRef.current = false;
    }
  }

  /**
   * 轮询监听文件（每秒一次）。
   *
   * 只能读 liveWatchRef / livePanelsRef：本函数被 setInterval 捕获，闭包里任何 state
   * 都停在「开启监听之前」的那次渲染（曾导致轮询检查 !liveConfigEnabled 永远成立、直接早退）。
   */
  async function pollLiveConfigFile() {
    const desktop = window.rocoDesktop;
    const session = liveWatchRef.current;
    if (!session.enabled || !session.filePath || !desktop?.readTextFile || !desktop?.statFile) {
      return;
    }
    if (livePollBusyRef.current || liveWriteRef.current || liveApplyRef.current) {
      return;
    }

    const filePath = session.filePath;
    livePollBusyRef.current = true;
    try {
      const [text, stat] = await Promise.all([desktop.readTextFile(filePath), desktop.statFile(filePath)]);
      const current = liveWatchRef.current;
      if (!current.enabled || current.filePath !== filePath) {
        return;
      }
      liveHeartbeatRef.current = Date.now();
      if (text === current.lastContent || stat.mtimeMs === current.lastModified) {
        // 读到了但没有变化：顺手清掉上一次读取失败的错误（文件恢复可读）
        setLiveWatch((prev) => (prev.error ? { ...prev, error: null, errorAt: null } : prev));
        return;
      }
      await applyLiveConfigText(text, '监听文件', { notify: false });
      if (liveWatchRef.current === current) {
        current.lastContent = text;
        current.lastModified = stat.mtimeMs;
      }
    } catch (error) {
      liveHeartbeatRef.current = Date.now();
      const errorMessage = formatWatchError(error);
      setLiveWatch((prev) => {
        // 同一个错误（如文件被删）每秒都会抛一次：5 秒内只更新一次，避免整个后台每秒重渲染
        if (prev.error === errorMessage && prev.errorAt !== null && Date.now() - prev.errorAt < 5000) {
          return prev;
        }
        return { ...prev, error: errorMessage, errorAt: Date.now() };
      });
    } finally {
      livePollBusyRef.current = false;
    }
  }

  async function handleExportLiveConfig() {
    const text = stringifyLiveConfig(panels);

    try {
      if (typeof window.showSaveFilePicker === 'function') {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: 'roco-live-config.json',
          types: [{ description: 'JSON 文件', accept: { 'application/json': ['.json'] } }],
        });
        if (!(await verifyFilePermission(fileHandle, 'readwrite'))) {
          throw new Error('没有导出文件的写入权限');
        }
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
        setLiveNotice({ tone: 'success', text: '配置导出成功' });
        return;
      }

      if (window.rocoDesktop?.showSaveDialog && window.rocoDesktop?.writeTextFile) {
        const filePath = await window.rocoDesktop.showSaveDialog();
        if (!filePath) {
          setLiveNotice({ tone: 'info', text: '已取消配置导出' });
          return;
        }
        await window.rocoDesktop.writeTextFile(filePath, text);
        setLiveNotice({ tone: 'success', text: '配置导出成功' });
        return;
      }

      downloadLiveConfig(text);
      setLiveNotice({ tone: 'success', text: '配置已下载' });
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
        setLiveNotice({ tone: 'info', text: '已取消配置导出' });
        return;
      }
      setLiveNotice({ tone: 'error', text: error instanceof Error ? error.message : '配置导出失败' });
    }
  }

  async function startLiveConfigWatch() {
    if (!window.rocoDesktop?.showOpenDialog) {
      setLiveNotice({ tone: 'warning', text: '当前环境不支持持续监听：请在桌面版中选择监听文件' });
      return;
    }

    try {
      const filePath = await window.rocoDesktop.showOpenDialog();
      if (!filePath) {
        setLiveNotice({ tone: 'info', text: '已取消选择监听文件' });
        return;
      }
      await startLiveConfigWatchFromPath(filePath);
    } catch (error) {
      setLiveNotice({ tone: 'error', text: `实时监听开启失败：${formatWatchError(error)}` });
    }
  }

  /**
   * 开始（或切换）监听一个本地 JSON。
   *
   * - 读取失败 = 根本没法监听：抛错给调用方提示，并停掉旧监听。
   * - 首次解析 / 应用失败不算致命（外部计分工具可能正在写文件、读到半截 JSON）：保留监听、
   *   把错误挂到状态卡上，下一秒自动重试。
   */
  async function startLiveConfigWatchFromPath(filePath: string) {
    const desktop = window.rocoDesktop;
    if (!desktop?.readTextFile || !desktop?.statFile) {
      throw new Error('当前环境不支持实时监听');
    }

    setLiveWatchBusy(true);
    try {
      const [text, stat] = await Promise.all([desktop.readTextFile(filePath), desktop.statFile(filePath)]);

      clearLivePollTimer();
      liveWatchRef.current = { enabled: true, filePath, lastContent: '', lastModified: null };
      liveHeartbeatRef.current = 0;
      setLiveFilePath(filePath);
      setLiveConfigEnabled(true);
      setLiveWatch({ ...createLiveWatchSnapshot(), startedAt: Date.now() });
      rememberLiveWatchPath(filePath);

      let initialError = '';
      try {
        if (text.trim()) {
          await applyLiveConfigText(text, '监听文件', { notify: false });
          const session = liveWatchRef.current;
          if (session.filePath === filePath) {
            session.lastContent = text;
            session.lastModified = stat.mtimeMs;
          }
        } else {
          // 空文件：把当前面板写进去，外部工具才有初始结构可读
          await writeLiveConfigToPath(filePath, stringifyLiveConfig(livePanelsRef.current), `监听中：${getLiveConfigFileName(filePath)}`);
        }
      } catch (error) {
        initialError = formatWatchError(error);
        setLiveWatch((prev) => ({ ...prev, error: initialError, errorAt: Date.now() }));
        setLiveNotice({ tone: 'error', text: initialError });
      }

      livePollTimerRef.current = window.setInterval(() => {
        void pollLiveConfigFile();
      }, LIVE_WATCH_POLL_MS);
      // 立刻检查一次：让「最近检查」马上有心跳，不用等第一个整秒
      void pollLiveConfigFile();

      if (!initialError) {
        setLiveNotice({ tone: 'success', text: `实时监听已开启：${getLiveConfigFileName(filePath)}` });
      }
    } catch (error) {
      stopLiveConfigWatch(false);
      throw error;
    } finally {
      setLiveWatchBusy(false);
    }
  }

  async function restoreLiveConfigWatch() {
    if (!liveRememberedPath) {
      return;
    }
    try {
      await startLiveConfigWatchFromPath(liveRememberedPath);
    } catch (error) {
      setLiveNotice({
        tone: 'error',
        text: `无法恢复上次监听：${formatWatchError(error)}`,
      });
    }
  }

  async function handleLiveConfigUpload(file: File & { path?: string }) {
    try {
      // Electron 32+ 移除了 File.path：改由 preload 的 webUtils.getPathForFile 拿真实路径（拖拽 / 文件框都适用）
      const legacyPath = typeof file.path === 'string' ? file.path.trim() : '';
      const resolvedPath = legacyPath || window.rocoDesktop?.getPathForFile?.(file)?.trim() || '';

      if (resolvedPath) {
        await startLiveConfigWatchFromPath(resolvedPath);
        return false;
      }

      if (window.rocoDesktop?.showOpenDialog) {
        const filePath = await window.rocoDesktop.showOpenDialog();
        if (!filePath) {
          setLiveNotice({ tone: 'info', text: '已取消选择监听文件' });
          return false;
        }
        await startLiveConfigWatchFromPath(filePath);
        return false;
      }

      const text = await file.text();
      await applyLiveConfigText(text, '上传文件');
      setLiveNotice({ tone: 'warning', text: '当前环境仅应用了上传内容，无法持续监听该文件' });
      return false;
    } catch (error) {
      stopLiveConfigWatch(false);
      setLiveNotice({ tone: 'error', text: `实时监听开启失败：${formatWatchError(error)}` });
      return false;
    }
  }

  function stopLiveConfigWatch(shouldResetNotice = true) {
    clearLivePollTimer();
    clearLiveSaveTimer();
    liveApplyRef.current = false;
    liveWriteRef.current = false;
    livePollBusyRef.current = false;
    liveWatchRef.current = { enabled: false, filePath: null, lastContent: '', lastModified: null };
    liveHeartbeatRef.current = 0;
    setLiveConfigEnabled(false);
    setLiveFilePath(null);
    setLiveWatch(createLiveWatchSnapshot());
    if (shouldResetNotice) {
      setLiveNotice({ tone: 'info', text: '实时监听已关闭' });
    }
  }

  function scheduleLiveConfigWrite(reason = '已同步到监听文件') {
    const session = liveWatchRef.current;
    if (!session.enabled || !session.filePath || liveApplyRef.current || liveWriteRef.current) {
      return;
    }
    const filePath = session.filePath;
    clearLiveSaveTimer();
    liveSaveTimerRef.current = window.setTimeout(() => {
      liveSaveTimerRef.current = null;
      // 定时器是 250ms 后执行的：期间若正在应用外部文件的改动，这次回写让位，避免把文件内容改回去
      if (liveApplyRef.current) {
        return;
      }
      void writeLiveConfigToPath(filePath, stringifyLiveConfig(livePanelsRef.current), reason).catch((error) => {
        setLiveNotice({ tone: 'error', text: `监听文件写入失败：${formatWatchError(error)}` });
      });
    }, 250);
  }

  function handleLiveConfigWatchToggle() {
    if (liveConfigEnabled) {
      stopLiveConfigWatch(true);
      return;
    }
    void startLiveConfigWatch();
  }

  async function saveLiveField(side: PanelSide, slotIndex: number, field: LiveField, value: number) {
    const selected = cloneSelected(panels[side].selected);
    const target = { ...selected[slotIndex] };
    if (field === 'healthPercent') {
      target.healthPercent = clampNumber(Math.round(value), 0, 100);
    } else {
      target.energyValue = clampNumber(Math.round(value), 0, 10);
    }
    selected[slotIndex] = target;

    const nextPanels = {
      ...panels,
      [side]: {
        ...panels[side],
        selected,
      },
    };

    startTransition(() => {
      setPanels(nextPanels);
    });

    try {
      await requestJson<{ success: boolean; panel?: PanelState; store?: MatchStoreState }>(`/api/panels/${side}/slots/${slotIndex}`, {
        method: 'PATCH',
        json: {
          slot: buildPanelRequest(selected)[slotIndex],
        },
      });
      scheduleLiveConfigWrite();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      void loadInitialData();
    }
  }

  // 只在整个后台卸载时清定时器（视图切走不影响监听）
  useEffect(() => {
    return () => {
      clearLivePollTimer();
      clearLiveSaveTimer();
    };
  }, []);

  return {
    liveNotice,
    liveFilePath,
    liveConfigEnabled,
    liveWatch,
    liveWatchBusy,
    liveRememberedPath,
    liveHeartbeatRef,
    liveDesktopSupported,
    setLiveNotice,
    handleExportLiveConfig,
    handleLiveConfigWatchToggle,
    startLiveConfigWatch,
    restoreLiveConfigWatch,
    forgetLiveWatchPath,
    handleLiveConfigUpload,
    saveLiveField,
  };
}
