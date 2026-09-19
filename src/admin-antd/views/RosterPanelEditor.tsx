import React, { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Space,
  Tag,
  Typography,
} from 'antd';
import type { SpriteRecord } from '../../../shared/types';
import { SpritePetCard } from '../components/SpritePetCard';
import { AttributeFilterChips } from '../components/AttributeFilterChips';
import { FormFilterChips } from '../components/FormFilterChips';
import { splitSpriteAttributes } from '../lib/sprite';
import type { PanelEditorState, PanelSide, SpriteFilterState } from '../types';

const { TextArea } = Input;
const { Text } = Typography;

type RosterPanelEditorProps = {
  panels: Record<PanelSide, PanelEditorState>;
  filter: SpriteFilterState;
  locked: boolean;
  /** 双侧选手名（用于槽位栏标题展示） */
  players: { left?: string; right?: string };
  /** 搜索输入框的即时值 */
  searchValue: string;
  /** 搜索过滤用的防抖值（useDeferredValue） */
  deferredSearchValue: string;
  sprites: SpriteRecord[];
  spriteFormOptions: string[];
  onRosterSearchChange: (value: string) => void;
  onMutatePanel: (side: PanelSide, updater: (panel: PanelEditorState) => PanelEditorState) => void;
  onRunQuickFill: (side: PanelSide) => void;
  onClearPanel: (side: PanelSide) => void;
  onChooseQuickFillCandidate: (side: PanelSide, slotIndex: number, sprite: SpriteRecord) => void;
  onApplySprite: (side: PanelSide, sprite: SpriteRecord) => void;
  onToggleAttributeFilter: (attribute: string) => void;
  onToggleFinalFormFilter: () => void;
  onToggleFormFilter: (form: string) => void;
  onClearSpriteFilters: () => void;
};

/**
 * 赛事面板·合并阵容编辑器：布局与「录入阵容」弹窗一致——
 * 左右槽位栏 | 中部（左右双列快速填充 + 共享精灵筛选/搜索/选择） | 右侧槽位栏。
 * 点槽位或点精灵即自动保存（600ms 防抖），无手动保存按钮。
 */
export function RosterPanelEditor({
  panels,
  filter,
  locked,
  players,
  searchValue,
  deferredSearchValue,
  sprites,
  spriteFormOptions,
  onRosterSearchChange,
  onMutatePanel,
  onRunQuickFill,
  onClearPanel,
  onChooseQuickFillCandidate,
  onApplySprite,
  onToggleAttributeFilter,
  onToggleFinalFormFilter,
  onToggleFormFilter,
  onClearSpriteFilters,
}: RosterPanelEditorProps) {
  // 当前编辑侧：点槽位栏切换，共享的精灵选择填入该侧的活动槽位
  const [editingSide, setEditingSide] = useState<PanelSide>('left');
  const editingPanel = panels[editingSide];
  const editingSlot = editingPanel.selected[editingPanel.activeSlot];
  const anySaving = panels.left.saving || panels.right.saving;

  const filteredSprites = sprites.filter((sprite) => {
    const keyword = deferredSearchValue.trim().toLowerCase();
    const values = [
      sprite.displayName,
      sprite.name,
      sprite.filename,
      ...(sprite.aliases ?? []),
    ];
    const matchesKeyword = !keyword || values.some((value) => String(value ?? '').toLowerCase().includes(keyword));
    const spriteAttributes = splitSpriteAttributes(sprite.attribute);
    const matchesAttributes = !filter.selectedAttributes.length
      || filter.selectedAttributes.every((attribute) => spriteAttributes.includes(attribute));
    const matchesForms = filter.selectedFinalForm
      ? sprite.isFinalForm
      : !filter.selectedForms.length || filter.selectedForms.includes(sprite.form);

    return matchesKeyword && matchesAttributes && matchesForms;
  });
  const hasFilter = filter.selectedAttributes.length > 0 || filter.selectedForms.length > 0 || filter.selectedFinalForm;

  function selectSlot(side: PanelSide, index: number) {
    setEditingSide(side);
    onMutatePanel(side, (prev) => ({ ...prev, activeSlot: index }));
  }

  function clearSlotAt(side: PanelSide, index: number) {
    onMutatePanel(side, (prev) => ({
      ...prev,
      selected: prev.selected.map((slot, i) => (i === index ? { ...slot, sprite: null } : slot)),
      dirty: true,
    }));
  }

  // 与「录入阵容」一致：填入后自动前进到同侧下一个空槽位，连续点选更顺手
  function handleSpritePick(sprite: SpriteRecord) {
    onApplySprite(editingSide, sprite);
    const current = panels[editingSide];
    const nextEmpty = current.selected.findIndex(
      (slot, index) => index > current.activeSlot && !slot.sprite,
    );
    if (nextEmpty !== -1) {
      onMutatePanel(editingSide, (prev) => ({ ...prev, activeSlot: nextEmpty }));
    }
  }

  function renderSideRail(side: PanelSide) {
    const panel = panels[side];
    const label = side === 'left' ? '左侧' : '右侧';
    const playerName = players[side]?.trim();
    return (
      <div className={`lineup-entry-rail lineup-entry-rail-${side}${editingSide === side ? ' is-active' : ''}`}>
        <div className="lineup-entry-rail-head">
          <span className="side">
            <span className="dot" />
            {label} · {playerName || label}
          </span>
          <span className="cnt">已选 {panel.selected.filter((slot) => slot.sprite).length}/6</span>
        </div>
        <div className="lineup-entry-slots">
          {panel.selected.map((slot, index) => {
            const active = editingSide === side && index === panel.activeSlot;
            return (
              <button
                key={`${side}-${index}`}
                type="button"
                disabled={locked}
                className={`lineup-entry-slot${slot.sprite ? ' filled' : ' empty'}${active ? ' active' : ''}`}
                onClick={() => selectSlot(side, index)}
              >
                {slot.sprite ? (
                  <SpritePetCard sprite={slot.sprite} size={88} />
                ) : (
                  <span className="slot-placeholder">
                    <span className="num">{index + 1}</span>
                    <span className="pick-hint">点击选中</span>
                  </span>
                )}
                {slot.sprite ? (
                  <span
                    role="button"
                    tabIndex={-1}
                    className="slot-clear"
                    title="清空该槽位"
                    onClick={(event) => {
                      event.stopPropagation();
                      clearSlotAt(side, index);
                    }}
                  >
                    ✕
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderQuickFillColumn(side: PanelSide) {
    const panel = panels[side];
    const label = side === 'left' ? '左侧' : '右侧';
    const multiCandidateMatches = panel.quickFillMatches.filter((match) => match.candidates.length > 1);
    return (
      <Card size="small" className="subtle-card lineup-entry-quickfill-side-card">
        <div className="lineup-entry-quickfill-side">
          <Text strong>{label}快速填充</Text>
          <TextArea
            rows={6}
            disabled={locked}
            value={panel.quickFillInput}
            placeholder={'一行一个精灵名，例如：\n暮星辰\n怖哭菇\n龙息帕尔'}
            onChange={(event) => onMutatePanel(side, (prev) => ({ ...prev, quickFillInput: event.target.value }))}
          />
          <Space wrap>
            <Button size="small" type="primary" disabled={locked} onClick={() => onRunQuickFill(side)}>
              快速填充
            </Button>
            <Button size="small" disabled={locked} onClick={() => onClearPanel(side)}>
              清空{label}
            </Button>
          </Space>
          {multiCandidateMatches.length ? (
            <div className="lineup-entry-candidates">
              {multiCandidateMatches.map((match) => (
                <div key={`${side}-quick-${match.slot}`} className="candidate-group">
                  <Text type="secondary">槽位 {match.slot + 1}</Text>
                  <div className="candidate-grid">
                    {match.candidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        className="candidate-button"
                        aria-label={`选择 ${candidate.displayName}`}
                        title={candidate.displayName}
                        disabled={locked}
                        onClick={() => onChooseQuickFillCandidate(side, match.slot, candidate)}
                      >
                        <SpritePetCard sprite={candidate} size={64} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card
      className="panel-editor-card"
      title="当前阵容"
      extra={(
        <Space wrap>
          <Text type="secondary">
            左 {panels.left.selected.filter((slot) => slot.sprite).length} / 6 · 右 {panels.right.selected.filter((slot) => slot.sprite).length} / 6
          </Text>
          {anySaving ? <Tag color="processing">保存中</Tag> : null}
          {locked ? <Tag color="warning">已锁定</Tag> : null}
        </Space>
      )}
    >
      {locked ? (
        <Alert
          showIcon
          type="warning"
          message="当前赛事已完成，阵容编辑已锁定"
          className="lineup-entry-alert"
        />
      ) : null}

      <div className="lineup-entry-body roster-lineup-body">
        {renderSideRail('left')}

        <div className="lineup-entry-center">
          <div className="lineup-entry-quickfill-grid">
            {renderQuickFillColumn('left')}
            {renderQuickFillColumn('right')}
          </div>

          <Card size="small" className="subtle-card lineup-entry-picker">
            <div className="picker-head">
              <Text strong>筛选精灵</Text>
              {hasFilter ? (
                <Button size="small" type="link" onClick={onClearSpriteFilters}>
                  清空筛选
                </Button>
              ) : null}
            </div>
            <Text type="secondary" className="filter-label">精灵属性（最多 2 个）</Text>
            <AttributeFilterChips
              selected={filter.selectedAttributes}
              onToggle={onToggleAttributeFilter}
            />
            <Text type="secondary" className="filter-label">精灵形态</Text>
            <FormFilterChips
              finalActive={filter.selectedFinalForm}
              onToggleFinal={onToggleFinalFormFilter}
              options={spriteFormOptions}
              selected={filter.selectedForms}
              onToggleForm={onToggleFormFilter}
            />
            <Input
              value={searchValue}
              placeholder="搜索精灵名称"
              allowClear
              onChange={(event) => onRosterSearchChange(event.target.value)}
            />
            <div className="sprite-picker-scroll lineup-entry-sprite-scroll">
              {filteredSprites.length ? (
                <div className="lineup-entry-sprite-grid">
                  {filteredSprites.map((sprite) => (
                    <button
                      key={sprite.id}
                      type="button"
                      className="lineup-entry-sprite-tile"
                      title={sprite.displayName}
                      disabled={locked}
                      onClick={() => handleSpritePick(sprite)}
                    >
                      <SpritePetCard sprite={sprite} size={92} />
                    </button>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配到精灵" />
              )}
            </div>
          </Card>

          <div className="roster-lineup-hint">
            当前选中：{editingSide === 'left' ? '左侧' : '右侧'}槽位 {editingPanel.activeSlot + 1}
            {editingSlot?.sprite ? `（${editingSlot.sprite.displayName}）` : ''} · 点击精灵填入，自动保存
          </div>
        </div>

        {renderSideRail('right')}
      </div>
    </Card>
  );
}
