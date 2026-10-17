/**
 * 管理后台「hooks 顺序」守卫（曾两次踩坑导致整页白屏）：
 * Dashboard 组件里任何 hook 都必须位于条件 return 之前，否则 loading 切换时 hook 数量变化
 * 会抛 Minified React error #310，后台整页空白。
 *
 * 项目没有 ESLint，这里用一份轻量文本扫描替代：定位组件函数体、找到 loading 早退分支的入口行，
 * 断言其后（同一组件函数体内）不再出现组件级 hook 调用。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_PATH = path.join(process.cwd(), 'src', 'admin-antd', 'App.tsx');
const HOOK_PATTERN = /(?<![\w.$])(use(?:State|Effect|Memo|Ref|Callback|DeferredValue|LayoutEffect|Reducer|Context|SyncExternalStore|Transition|Id|ImperativeHandle))\s*\(/;
/** loading 早退分支入口（Dashboard 加载态：`if (loading) {`） */
const EARLY_RETURN_PATTERN = /^if\s*\(\s*loading\s*\)\s*\{/;

interface ScanResult {
  /** loading 早退分支入口行号（1 基；-1 = 未找到） */
  earlyReturnLine: number;
  /** 位于其后的组件级 hook 调用（行号 + 代码） */
  hooksAfter: string[];
}

/**
 * 组件函数体只有一层：函数体里的语句缩进恒为 2 个空格（JSX 里的花括号/对象字面量不影响缩进判据，
 * 而按大括号深度计数会被 JSX 干扰）。hook 调用形如 `  const x = useMemo(` / `  useEffect(`。
 */
function isComponentLevelStatement(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  const indent = line.length - line.trimStart().length;
  return indent === 2;
}

function scanDashboardHooks(source: string): ScanResult {
  const lines = source.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.startsWith('function Dashboard('));
  if (startIndex === -1) {
    throw new Error('未找到 function Dashboard(');
  }

  let earlyReturnLine = -1;
  const hooksAfter: string[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (earlyReturnLine === -1 && EARLY_RETURN_PATTERN.test(trimmed)) {
      earlyReturnLine = index + 1;
      continue;
    }

    // loading 早退分支之后的组件级语句里再出现 hook → 违规
    if (earlyReturnLine !== -1 && isComponentLevelStatement(line) && HOOK_PATTERN.test(line)) {
      hooksAfter.push(`第 ${index + 1} 行：${trimmed.slice(0, 90)}`);
    }
  }

  return { earlyReturnLine, hooksAfter };
}

/** M2 起数据层 / 视图内部也有大段 hook：同样不允许顶层 return 之后再调 hook */
const CONTROL_FILES = [
  {
    file: path.join(process.cwd(), 'src', 'admin-antd', 'data', 'admin-data.tsx'),
    start: 'export function AdminDataProvider(',
  },
  {
    file: path.join(process.cwd(), 'src', 'admin-antd', 'views', 'SyncView.tsx'),
    start: 'export function SyncView(',
  },
  {
    file: path.join(process.cwd(), 'src', 'admin-antd', 'views', 'sync', 'use-sync-controller.ts'),
    start: 'export function useSyncController(',
  },
  {
    file: path.join(process.cwd(), 'src', 'admin-antd', 'views', 'PreviewView.tsx'),
    start: 'export function PreviewView(',
  },
];

function scanHooksAfterTopLevelReturn(source: string, startPrefix: string): { returnLine: number; hooksAfter: string[] } {
  const lines = source.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.startsWith(startPrefix));
  if (startIndex === -1) {
    return { returnLine: -1, hooksAfter: [] };
  }
  const returnIndex = lines.findIndex((line, index) => index > startIndex && line.startsWith('  return'));
  if (returnIndex === -1) {
    return { returnLine: -1, hooksAfter: [] };
  }
  const hooksAfter: string[] = [];
  for (let index = returnIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    // 只看组件/自定义 hook 的顶层语句（缩进 2）；嵌套函数与 JSX 内部缩进更深
    if (line.startsWith('  ') && !line.startsWith('    ') && HOOK_PATTERN.test(line)) {
      hooksAfter.push(`第 ${index + 1} 行：${line.trim().slice(0, 90)}`);
    }
  }
  return { returnLine: returnIndex + 1, hooksAfter };
}

describe('Dashboard hooks 顺序（React #310 白屏守卫）', () => {
  it('组件内所有 hook 都位于 if (loading) 早退分支之前', () => {
    const result = scanDashboardHooks(readFileSync(APP_PATH, 'utf-8'));

    expect(result.earlyReturnLine, '没有找到 `if (loading) {` 早退分支，扫描逻辑可能已失效').toBeGreaterThan(-1);
    expect(
      result.hooksAfter,
      `以下 hook 位于条件 return（第 ${result.earlyReturnLine} 行的 loading 分支）之后，loading 切换时会抛 React #310：\n${result.hooksAfter.join('\n')}`,
    ).toEqual([]);
  });

  it('扫描本身有效：把 hook 注入到 if (loading) 之后必须被抓出来', () => {
    const source = readFileSync(APP_PATH, 'utf-8');
    // 注意：文件是 CRLF，正则里不要用 `$` 锚定行尾（会被 \r 挡住），逐行重建最稳
    const lines = source.split(/\r?\n/);
    const target = lines.findIndex((line) => EARLY_RETURN_PATTERN.test(line.trim()));
    expect(target, '未找到 if (loading) 行').toBeGreaterThan(-1);

    const injected = [
      ...lines.slice(0, target + 1),
      '  useEffect(() => {}, []);',
      ...lines.slice(target + 1),
    ].join('\n');
    // 注入的 hook 必须被抓出来
    const scanned = scanDashboardHooks(injected);
    expect(scanned.earlyReturnLine).toBe(target + 1);
    expect(scanned.hooksAfter.join()).toContain('useEffect');
  });
});

describe('数据层 / 视图内部 hooks 顺序', () => {
  for (const { file, start } of CONTROL_FILES) {
    it(`${path.relative(process.cwd(), file)} 的 hook 不在顶层 return 之后`, () => {
      const result = scanHooksAfterTopLevelReturn(readFileSync(file, 'utf-8'), start);
      expect(result.returnLine, `没有找到 ${start} 的顶层 return，扫描逻辑可能已失效`).toBeGreaterThan(-1);
      expect(result.hooksAfter, `以下 hook 位于顶层 return 之后，会破坏 hooks 顺序：\n${result.hooksAfter.join('\n')}`).toEqual([]);
    });
  }

  it('扫描本身有效：顶层 return 后注入 hook 必须被抓出来', () => {
    const source = readFileSync(CONTROL_FILES[0].file, 'utf-8');
    const lines = source.split(/\r?\n/);
    const target = lines.findIndex((line) => line.startsWith('  return'));
    expect(target).toBeGreaterThan(-1);
    const injected = [
      ...lines.slice(0, target + 1),
      '  useEffect(() => {}, []);',
      ...lines.slice(target + 1),
    ].join('\n');
    const scanned = scanHooksAfterTopLevelReturn(injected, CONTROL_FILES[0].start);
    expect(scanned.hooksAfter.join()).toContain('useEffect');
  });
});
