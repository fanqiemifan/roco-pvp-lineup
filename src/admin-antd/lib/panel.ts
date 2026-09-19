import type { MatchSlotSnapshot, Page4PanelState, Page4SlotState, PanelState, SlotState, SpriteRecord } from '../../../shared/types';
import type { Page4PanelEditorState, PanelEditorState, SpriteFilterState } from '../types';

export function createEmptySlot(index: number): SlotState {
  return {
    slot: index,
    sprite: null,
    opacityEnabled: false,
    opacity: 0.5,
    effectiveOpacity: 1,
    saturation: 1,
    healthEnabled: true,
    healthPercent: 100,
    energyValue: 10,
  };
}

export function createPanelEditorState(): PanelEditorState {
  return {
    selected: Array.from({ length: 6 }, (_, index) => createEmptySlot(index)),
    activeSlot: 0,
    quickFillInput: '',
    quickFillMatches: [],
    autoSaveEnabled: true,
    dirty: false,
    saving: false,
  };
}

export function createPage4EmptySlot(index: number): Page4SlotState {
  return {
    slot: index,
    sprite: null,
    isDead: false,
  };
}

export function createPage4PanelEditorState(): Page4PanelEditorState {
  return {
    selected: Array.from({ length: 6 }, (_, index) => createPage4EmptySlot(index)),
    activeSlot: 0,
    search: '',
    quickFillInput: '',
    quickFillMatches: [],
    autoSaveEnabled: true,
    dirty: false,
    saving: false,
  };
}

export function createSpriteFilterState(options?: { selectedFinalForm?: boolean }): SpriteFilterState {
  return {
    selectedAttributes: [],
    selectedForms: [],
    selectedFinalForm: options?.selectedFinalForm ?? false,
  };
}

export function createDefaultSpriteFilterState(): SpriteFilterState {
  return createSpriteFilterState({ selectedFinalForm: true });
}

export function cloneSlot(slot: Partial<SlotState> | null | undefined, index: number): SlotState {
  return {
    slot: index,
    sprite: slot?.sprite ?? null,
    opacityEnabled: Boolean(slot?.opacityEnabled),
    opacity: typeof slot?.opacity === 'number' ? slot.opacity : 0.5,
    effectiveOpacity: slot?.opacityEnabled ? (typeof slot.opacity === 'number' ? slot.opacity : 0.5) : 1,
    saturation: typeof slot?.saturation === 'number' ? slot.saturation : 1,
    healthEnabled: slot?.healthEnabled !== false,
    healthPercent: typeof slot?.healthPercent === 'number' ? slot.healthPercent : 100,
    energyValue: typeof slot?.energyValue === 'number' ? slot.energyValue : 10,
  };
}

export function cloneSelected(selected: SlotState[] | undefined): SlotState[] {
  const next = Array.from({ length: 6 }, (_, index) => {
    const source = selected?.[index];
    return cloneSlot(source, index);
  });
  return next;
}

export function clonePage4Slot(slot: Partial<Page4SlotState> | null | undefined, index: number): Page4SlotState {
  return {
    slot: index,
    sprite: slot?.sprite ?? null,
    isDead: Boolean(slot?.isDead),
  };
}

export function clonePage4Selected(selected: Page4SlotState[] | undefined): Page4SlotState[] {
  return Array.from({ length: 6 }, (_, index) => clonePage4Slot(selected?.[index], index));
}

export function panelStateToSelected(panel: PanelState | null | undefined): SlotState[] {
  return cloneSelected(panel?.selected);
}

/**
 * 赛事草稿快照（MatchSlotSnapshot，按 pet_id 存储）→ 编辑器槽位（需要完整精灵记录）。
 * 精灵库查不到的 id（已删除/改名）降级为空槽位，不报错。
 */
export function draftSlotsToSelected(
  slots: MatchSlotSnapshot[] | null | undefined,
  lookup: Map<string, SpriteRecord>,
): SlotState[] {
  return Array.from({ length: 6 }, (_, index) => {
    const snapshot = slots?.[index];
    const sprite = snapshot?.pet_id ? lookup.get(snapshot.pet_id) ?? null : null;
    if (!sprite) {
      return createEmptySlot(index);
    }
    return {
      slot: index,
      sprite,
      opacityEnabled: Boolean(snapshot?.opacityEnabled),
      opacity: typeof snapshot?.opacity === 'number' ? snapshot.opacity : 0.5,
      effectiveOpacity: snapshot?.opacityEnabled
        ? (typeof snapshot.opacity === 'number' ? snapshot.opacity : 0.5)
        : 1,
      saturation: typeof snapshot?.saturation === 'number' ? snapshot.saturation : 1,
      healthEnabled: snapshot?.healthEnabled !== false,
      healthPercent: typeof snapshot?.healthPercent === 'number' ? snapshot.healthPercent : 100,
      energyValue: typeof snapshot?.energyValue === 'number' ? snapshot.energyValue : 10,
    };
  });
}

export function page4PanelStateToSelected(panel: Page4PanelState | null | undefined): Page4SlotState[] {
  return clonePage4Selected(panel?.selected);
}

export function buildPanelRequest(selected: SlotState[]) {
  return selected.map((slot, index) => ({
    slot: index,
    sprite: slot.sprite?.id ?? null,
    opacityEnabled: slot.opacityEnabled,
    opacity: slot.opacity,
    saturation: slot.saturation,
    healthEnabled: slot.healthEnabled,
    healthPercent: slot.healthPercent,
    energyValue: slot.energyValue,
  }));
}

export function buildPage4Request(selected: Page4SlotState[]) {
  return selected.map((slot, index) => ({
    slot: index,
    sprite: slot.sprite?.id ?? null,
    isDead: slot.isDead,
  }));
}

export function summarizePage4Slots(selected: Page4SlotState[]) {
  const selectedCount = selected.filter((slot) => slot.sprite).length;
  const deadCount = selected.filter((slot) => slot.sprite && slot.isDead).length;
  return { selectedCount, deadCount };
}

export function summarizePanelSlots(selected: SlotState[]) {
  const selectedCount = selected.filter((slot) => slot.sprite).length;
  const aliveCount = selected.filter((slot) => slot.sprite && slot.healthPercent > 0).length;
  return { selectedCount, aliveCount };
}
