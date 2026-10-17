import React, { useDeferredValue, useState } from 'react';
import { App } from 'antd';

import type { MatchRecord, SlotState, SpriteRecord } from '../../../shared/types';
import { EXCLUSIVE_FORM_FILTERS } from '../constants';
import { useAdminData } from '../data/use-admin-data';
import {
  cloneSelected,
  createDefaultSpriteFilterState,
  createEmptySlot,
  createSpriteFilterState,
} from '../lib/panel';
import { requestQuickFillMatches } from '../lib/request';
import type { PanelEditorState, PanelSide, SpriteFilterState } from '../types';
import { RosterPanelEditor } from './RosterPanelEditor';

/**
 * 阵容编辑器容器（M4 从 App.tsx 拆出）：赛事面板与系列比赛 Drawer 共用。
 * 这里只做编辑与本地草稿；600ms 自动保存留在常驻的 App（用数据层的 savePanel），
 * 这样异步快速填充在切走视图后仍会落盘（保持原生命周期）。
 */
export function RosterEditor({ match }: { match: MatchRecord | null }): React.ReactElement {
  const { message } = App.useApp();
  const {
    panels,
    setPanels,
    sprites,
  } = useAdminData();
  // 编辑器共享一份精灵筛选 + 搜索
  const [spriteFilter, setSpriteFilter] = useState<SpriteFilterState>(createDefaultSpriteFilterState);
  const [rosterSearch, setRosterSearch] = useState('');
  const deferredRosterSearch = useDeferredValue(rosterSearch);
  const spriteFormOptions = EXCLUSIVE_FORM_FILTERS.filter((form) => (
    sprites.some((sprite) => sprite.form.trim() === form)
  ));

  function mutatePanel(side: PanelSide, updater: (panel: PanelEditorState) => PanelEditorState) {
    setPanels((prev) => ({
      ...prev,
      [side]: updater(prev[side]),
    }));
  }

  async function runQuickFill(side: PanelSide) {
    const text = panels[side].quickFillInput.trim();
    if (!text) {
      message.warning('先输入要匹配的精灵名称');
      return;
    }

    try {
      const matches = await requestQuickFillMatches(text);

      const nextSelected = Array.from({ length: 6 }, (_, index) => createEmptySlot(index));
      matches.forEach((matchEntry) => {
        if (matchEntry.slot >= 0 && matchEntry.slot < 6 && matchEntry.sprite) {
          nextSelected[matchEntry.slot] = {
            ...nextSelected[matchEntry.slot],
            sprite: matchEntry.sprite,
          };
        }
      });

      mutatePanel(side, (panel) => ({
        ...panel,
        selected: nextSelected,
        quickFillMatches: matches,
        dirty: true,
      }));
      message.success(`${side === 'left' ? '左侧' : '右侧'}快速填充已应用到本地草稿`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function chooseQuickFillCandidate(side: PanelSide, slotIndex: number, sprite: SpriteRecord) {
    mutatePanel(side, (panel) => {
      const selected = cloneSelected(panel.selected);
      selected[slotIndex] = {
        ...selected[slotIndex],
        sprite,
      };
      return {
        ...panel,
        selected,
        dirty: true,
      };
    });
  }

  function updateSlot(side: PanelSide, updater: (slot: SlotState) => SlotState) {
    mutatePanel(side, (panel) => {
      const selected = cloneSelected(panel.selected);
      const current = selected[panel.activeSlot] ?? createEmptySlot(panel.activeSlot);
      selected[panel.activeSlot] = updater(current);
      return {
        ...panel,
        selected,
        dirty: true,
      };
    });
  }

  function clearPanel(side: PanelSide) {
    mutatePanel(side, (panel) => ({
      ...panel,
      selected: Array.from({ length: 6 }, (_, index) => createEmptySlot(index)),
      quickFillMatches: [],
      dirty: true,
    }));
  }

  function applySprite(side: PanelSide, sprite: SpriteRecord) {
    updateSlot(side, (slot) => ({
      ...slot,
      sprite,
    }));
  }

  function toggleAttributeFilter(attribute: string) {
    const current = spriteFilter.selectedAttributes;
    const isActive = current.includes(attribute);

    if (!isActive && current.length >= 2) {
      message.warning('精灵属性最多只能选择两个');
      return;
    }

    setSpriteFilter((filter) => ({
      ...filter,
      selectedAttributes: isActive
        ? filter.selectedAttributes.filter((item) => item !== attribute)
        : [...filter.selectedAttributes, attribute],
    }));
  }

  function toggleFormFilter(form: string) {
    setSpriteFilter((filter) => {
      if (filter.selectedFinalForm) {
        return filter;
      }

      return {
        ...filter,
        selectedForms: filter.selectedForms.includes(form)
          ? filter.selectedForms.filter((item) => item !== form)
          : [...filter.selectedForms, form],
      };
    });
  }

  function toggleFinalFormFilter() {
    setSpriteFilter((filter) => ({
      ...filter,
      selectedFinalForm: !filter.selectedFinalForm,
      selectedForms: filter.selectedFinalForm ? filter.selectedForms : [],
    }));
  }

  function clearSpriteFilters() {
    setSpriteFilter(createSpriteFilterState());
  }

  return (
    <RosterPanelEditor
      panels={panels}
      filter={spriteFilter}
      locked={match?.status === 'completed'}
      players={{ left: match?.leftPlayer, right: match?.rightPlayer }}
      searchValue={rosterSearch}
      deferredSearchValue={deferredRosterSearch}
      sprites={sprites}
      spriteFormOptions={spriteFormOptions}
      onRosterSearchChange={setRosterSearch}
      onMutatePanel={mutatePanel}
      onRunQuickFill={runQuickFill}
      onClearPanel={clearPanel}
      onChooseQuickFillCandidate={chooseQuickFillCandidate}
      onApplySprite={applySprite}
      onToggleAttributeFilter={toggleAttributeFilter}
      onToggleFinalFormFilter={toggleFinalFormFilter}
      onToggleFormFilter={toggleFormFilter}
      onClearSpriteFilters={clearSpriteFilters}
    />
  );
}
