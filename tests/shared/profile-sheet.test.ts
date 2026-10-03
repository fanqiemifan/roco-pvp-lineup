import { describe, expect, it } from 'vitest';

import {
  PROFILE_HEADER,
  buildProfileSheetTextRows,
  parseProfileSheetRows,
  profileSpriteColumnRange,
  splitProfilePetTokens,
  type ProfileSheetRow,
} from '../../shared/profile-sheet';
import type { PlayerProfile, SpriteRecord } from '../../shared/types';

/* ---------- 夹具 ---------- */

function row(rowNumber: number, cells: string[]): ProfileSheetRow {
  return { rowNumber, cells };
}

function makePlayer(patch: Partial<PlayerProfile>): PlayerProfile {
  return {
    id: 'p1',
    name: '小明',
    pets: '',
    declaration: '',
    rank: '',
    avatarExists: false,
    avatarMtime: null,
    ...patch,
  };
}

function makeSprite(id: string, name: string, patch: Partial<SpriteRecord> = {}): SpriteRecord {
  return {
    id,
    filename: `${id}_${name}.png`,
    displayName: name,
    name,
    path: `/img/${id}_${name}.png`,
    aliases: [],
    number: null,
    attribute: '',
    attributeCodes: [],
    attributeIcon1: '',
    attributeIcon2: '',
    iconUrl: '',
    form: '',
    petForm: '',
    isFinalForm: false,
    ...patch,
  };
}

/* ---------- 表头与列映射 ---------- */

describe('parseProfileSheetRows（表头定位与列映射）', () => {
  it('编号列 精灵1..6 合并为 pets；排名仅保留数字', () => {
    const result = parseProfileSheetRows([
      row(1, [...PROFILE_HEADER.slice(0, 9), '头像']),
      row(2, ['小明', '100.0', '冲', '3005_水灵', '', '3287_岚鸟', '', '', '', '']),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.headerRowNumber).toBe(1);
    expect(result.players).toHaveLength(1);
    expect(result.players[0]).toMatchObject({
      rowNumber: 2,
      name: '小明',
      rank: '100',
      declaration: '冲',
      pets: '3005_水灵、3287_岚鸟',
    });
  });

  it('支持中文列别名与单个「常用精灵」兜底列（格内多值拆分）', () => {
    const result = parseProfileSheetRows([
      row(1, ['选手', '排名', '宣言', '常用精灵']),
      row(2, ['小红', '88', '赢', '水蓝蓝、火神']),
    ]);
    expect(result.players).toHaveLength(1);
    expect(result.players[0]).toMatchObject({ name: '小红', rank: '88', pets: '水蓝蓝、火神' });
  });

  it('表头不在首行（前面有标题行）也能定位', () => {
    const result = parseProfileSheetRows([
      row(1, ['选手信息登记表']),
      row(2, PROFILE_HEADER),
      row(3, ['小刚', '', '', '火神', '', '', '', '', '', '']),
    ]);
    expect(result.headerRowNumber).toBe(2);
    expect(result.players[0]).toMatchObject({ rowNumber: 3, name: '小刚', pets: '火神' });
  });

  it('缺名字列 → 报错；空名字行与重复名字 → warning', () => {
    expect(parseProfileSheetRows([row(1, ['精灵1', '精灵2']), row(2, ['水灵', '火神'])]).errors.length).toBeGreaterThan(0);

    const duplicated = parseProfileSheetRows([
      row(1, PROFILE_HEADER),
      row(2, ['小明', '', '', '水灵', '', '', '', '', '', '']),
      row(3, ['', '', '', '火神', '', '', '', '', '', '']),
      row(4, ['小明', '', '', '火神', '', '', '', '', '', '']),
    ]);
    expect(duplicated.players).toHaveLength(2);
    expect(duplicated.warnings.some((warning) => warning.includes('缺少名字'))).toBe(true);
    expect(duplicated.warnings.some((warning) => warning.includes('重复'))).toBe(true);
  });
});

describe('splitProfilePetTokens', () => {
  it('拆分顿号/逗号/空白；`数字_名字` 保持完整', () => {
    expect(splitProfilePetTokens('3005_水灵、3287 岚鸟, 火神')).toEqual(['3005_水灵', '3287 岚鸟', '火神']);
  });
});

/* ---------- 导出预填 ---------- */

describe('buildProfileSheetTextRows（导出预填）', () => {
  const sprites = [
    makeSprite('3005', '水灵', { displayName: '水灵', number: 5, isFinalForm: true }),
    makeSprite('3287', '岚鸟（秋天的样子）', { displayName: '岚鸟', number: 287, isFinalForm: true }),
  ];

  it('displayName → `pet_id_名字` 拆进 6 列；查不到的原样保留；头像列留空', () => {
    const rows = buildProfileSheetTextRows(
      [makePlayer({ name: '小明', rank: '100', declaration: '冲', pets: '水灵、岚鸟、未知精灵' })],
      sprites,
    );
    expect(rows[0]).toEqual(['小明', '100', '冲', '3005_水灵', '3287_岚鸟（秋天的样子）', '未知精灵', '', '', '', '']);
    expect(rows[0]).toHaveLength(PROFILE_HEADER.length);
  });
});

describe('profileSpriteColumnRange', () => {
  it('精灵1..6 对应 D..I 列', () => {
    expect(profileSpriteColumnRange(3)).toBe('D2:I3');
  });
});
