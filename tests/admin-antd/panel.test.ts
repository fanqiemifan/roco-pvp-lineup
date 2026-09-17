import { describe, expect, it } from 'vitest';

import type { MatchSlotSnapshot, SpriteRecord } from '../../shared/types';
import { buildPanelRequest, createEmptySlot, draftSlotsToSelected } from '../../src/admin-antd/lib/panel';

function makeSprite(id: string): SpriteRecord {
  return {
    id,
    filename: `${id}.png`,
    displayName: `精灵${id}`,
    name: `精灵${id}（测试形态）`,
    path: `/sprites/${id}.png`,
    aliases: [id],
    number: null,
    attribute: '',
    attributeCodes: [],
    attributeIcon1: '',
    attributeIcon2: '',
    iconUrl: '',
    form: '',
    petForm: '',
    isFinalForm: true,
  };
}

function makeSnapshot(index: number, petId: string | null): MatchSlotSnapshot {
  return {
    slot: index,
    pet_id: petId,
    name: '',
    form: '',
    opacityEnabled: false,
    opacity: 0.5,
    saturation: 1,
    healthEnabled: true,
    healthPercent: 100,
    energyValue: 10,
  };
}

describe('createEmptySlot', () => {
  it('默认值：无精灵、半透明关闭、血量全满、能量 10', () => {
    const slot = createEmptySlot(3);
    expect(slot).toMatchObject({
      slot: 3,
      sprite: null,
      opacityEnabled: false,
      opacity: 0.5,
      effectiveOpacity: 1,
      saturation: 1,
      healthEnabled: true,
      healthPercent: 100,
      energyValue: 10,
    });
  });
});

describe('buildPanelRequest', () => {
  it('按槽位序号映射，精灵只保留 id，空槽位为 null', () => {
    const selected = Array.from({ length: 6 }, (_, index) => createEmptySlot(index));
    selected[1] = { ...selected[1], sprite: makeSprite('pet-9'), opacityEnabled: true, opacity: 0.3 };

    const request = buildPanelRequest(selected);

    expect(request).toHaveLength(6);
    expect(request[0].sprite).toBeNull();
    expect(request[1]).toMatchObject({
      slot: 1,
      sprite: 'pet-9',
      opacityEnabled: true,
      opacity: 0.3,
      saturation: 1,
      healthEnabled: true,
      healthPercent: 100,
      energyValue: 10,
    });
  });
});

describe('draftSlotsToSelected', () => {
  it('查得到 pet_id → 回填完整精灵记录，透传透明度/血量等字段', () => {
    const snapshot = makeSnapshot(0, 'pet-9');
    snapshot.opacityEnabled = true;
    snapshot.opacity = 0.4;

    const selected = draftSlotsToSelected([snapshot], new Map([['pet-9', makeSprite('pet-9')]]));

    expect(selected).toHaveLength(6);
    expect(selected[0].sprite?.id).toBe('pet-9');
    expect(selected[0].opacityEnabled).toBe(true);
    expect(selected[0].effectiveOpacity).toBe(0.4);
    expect(selected[1].sprite).toBeNull();
  });

  it('透明度开关关闭时 effectiveOpacity 归 1', () => {
    const selected = draftSlotsToSelected(
      [makeSnapshot(0, 'pet-9')],
      new Map([['pet-9', makeSprite('pet-9')]]),
    );
    expect(selected[0].effectiveOpacity).toBe(1);
  });

  it('查不到的 pet_id（已删除/改名）降级为空槽位，不报错', () => {
    const selected = draftSlotsToSelected(
      [makeSnapshot(0, 'pet-gone')],
      new Map([['pet-9', makeSprite('pet-9')]]),
    );
    expect(selected[0].sprite).toBeNull();
  });

  it('null/undefined 快照整体降级为 6 个空槽位', () => {
    for (const slots of [null, undefined] as const) {
      const selected = draftSlotsToSelected(slots, new Map());
      expect(selected).toHaveLength(6);
      expect(selected.every((slot) => slot.sprite === null)).toBe(true);
    }
  });
});
