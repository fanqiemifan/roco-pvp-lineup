import { describe, expect, it } from 'vitest';

import type {
  SyncImportItem,
  SyncImportPreview,
  SyncImportTournamentGroup,
} from '../../shared/types';
import {
  buildSyncAvailableKeys,
  buildSyncExcludedMatchKeys,
  buildSyncGroupOfMatchKey,
  buildSyncPreviewRows,
  cloudMachineText,
  compareSyncItems,
  countActions,
  defaultSyncActiveKey,
  defaultSyncSelection,
} from '../../src/admin-antd/views/sync/sync-helpers';

function item(key: string, action: SyncImportItem['action'], conflict = false, kind: SyncImportItem['kind'] = 'match'): SyncImportItem {
  return {
    key,
    kind,
    id: key.split(':')[1] ?? key,
    label: key,
    action,
    reason: '',
    localUpdatedAt: null,
    incomingUpdatedAt: null,
    conflict,
    diff: [],
  };
}

function group(key: string, id: string, matchKeys: string[], extra: Partial<SyncImportTournamentGroup> = {}): SyncImportTournamentGroup {
  return {
    key,
    id,
    name: id || '普通对局',
    incoming: Boolean(id),
    existsLocally: false,
    playerCount: null,
    stageSummary: '',
    matchKeys,
    selectableCount: matchKeys.length,
    ...extra,
  };
}

function preview(overrides: Partial<SyncImportPreview> = {}): SyncImportPreview {
  return {
    meta: { app: 'roco', schema: 1, machine: 'B', exportedAt: '2026-10-17T00:00:00.000Z' },
    sameMachine: false,
    mode: 'newer',
    matchItems: [],
    playerItems: [],
    teamItems: [],
    summary: {
      match: { add: 0, update: 0, skip: 0 },
      player: { add: 0, update: 0, skip: 0 },
      team: { add: 0, update: 0, skip: 0 },
    },
    avatars: {
      players: { fill: 0, existing: 0, unmatched: 0 },
      teams: { fill: 0, existing: 0, unmatched: 0 },
    },
    ...overrides,
  };
}

describe('sync-view 纯逻辑', () => {
  it('countActions 只按条目动作计数', () => {
    expect(countActions([
      item('match:a', 'add'),
      item('match:b', 'update'),
      item('match:c', 'update'),
      item('match:d', 'skip'),
    ])).toEqual({ add: 1, update: 2, skip: 1 });
  });

  it('compareSyncItems：更新 → 新增 → 跳过，同档冲突优先', () => {
    const items = [
      item('match:skip', 'skip'),
      item('match:add', 'add'),
      item('match:update-normal', 'update'),
      item('match:update-conflict', 'update', true),
    ];
    expect(items.sort(compareSyncItems).map((entry) => entry.key)).toEqual([
      'match:update-conflict',
      'match:update-normal',
      'match:add',
      'match:skip',
    ]);
  });

  it('defaultSyncSelection：跳过所有 action=skip 的条目（含档案项）', () => {
    const p = preview({
      matchItems: [item('match:a', 'add'), item('match:b', 'skip'), item('match:c', 'update')],
      playerItems: [item('player:p1', 'add', false, 'player'), item('player:p2', 'skip', false, 'player')],
      teamItems: [item('team:t1', 'update', false, 'team')],
    });
    expect(defaultSyncSelection(p)).toEqual(['match:a', 'match:c', 'player:p1', 'team:t1']);
  });

  it('defaultSyncActiveKey：优先第一处冲突，否则取排序后的第一条', () => {
    const withConflict = preview({
      matchItems: [item('match:a', 'add'), item('match:b', 'skip', true), item('match:c', 'update')],
    });
    expect(defaultSyncActiveKey(withConflict)).toBe('match:b');

    const withoutConflict = preview({
      matchItems: [item('match:a', 'skip'), item('match:b', 'add'), item('match:c', 'update')],
    });
    expect(defaultSyncActiveKey(withoutConflict)).toBe('match:c');

    expect(defaultSyncActiveKey(preview({
      matchItems: [],
      playerItems: [item('player:p1', 'add', false, 'player')],
    }))).toBe('player:p1');
  });

  it('buildSyncGroupOfMatchKey / buildSyncExcludedMatchKeys / buildSyncAvailableKeys', () => {
    const groups = [
      group('tournament:T1', 'T1', ['match:a', 'match:b']),
      group('plain', '', ['match:c']),
    ];
    const groupMap = buildSyncGroupOfMatchKey(groups);
    expect(groupMap.get('match:a')?.id).toBe('T1');
    expect(groupMap.get('match:c')?.id).toBe('');

    const excluded = buildSyncExcludedMatchKeys(groups, ['T1']);
    expect([...excluded]).toEqual(['match:a', 'match:b']);

    const p = preview({
      matchItems: [
        item('match:a', 'update'),
        item('match:b', 'skip'),
        item('match:c', 'add'),
        item('match:d', 'add'), // 未被任何分组收录，也应可勾选
      ],
      playerItems: [item('player:p1', 'add', false, 'player')],
    });
    expect([...buildSyncAvailableKeys(p, excluded)].sort()).toEqual([
      'match:c',
      'match:d',
      'player:p1',
    ]);
  });

  it('buildSyncPreviewRows：分组标题 + 组内排序 + 折叠 + 未分组兜底', () => {
    const groups = [
      group('tournament:T-skip', 'T-skip', ['match:skip']),
      group('tournament:T-work', 'T-work', ['match:add', 'match:update', 'match:conflict']),
      group('plain', '', ['match:plain']),
    ];
    const p = preview({
      matchItems: [
        item('match:skip', 'skip'),
        item('match:add', 'add'),
        item('match:update', 'update'),
        item('match:conflict', 'update', true),
        item('match:plain', 'add'),
        item('match:orphan', 'add'),
      ],
      tournamentGroups: groups,
    });

    const rows = buildSyncPreviewRows(p, []);
    expect(rows.map((row) => ('isGroup' in row ? `group:${row.id}` : row.key))).toEqual([
      'group:T-work',
      'match:conflict',
      'match:update',
      'match:add',
      'group:',
      'match:plain',
      'group:T-skip',
      'match:skip',
      'match:orphan',
    ]);

    // 折叠后只保留组标题行
    const collapsed = buildSyncPreviewRows(p, ['tournament:T-work']);
    expect(collapsed.map((row) => ('isGroup' in row ? `group:${row.id}` : row.key))).toEqual([
      'group:T-work',
      'group:',
      'match:plain',
      'group:T-skip',
      'match:skip',
      'match:orphan',
    ]);
  });

  it('cloudMachineText：有备注名显示「备注（码）」，否则「码 号机」', () => {
    expect(cloudMachineText({ code: 'B', label: '主播机' })).toBe('主播机（B）');
    expect(cloudMachineText({ code: 'B', label: '' })).toBe('B 号机');
  });
});
