import React from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import type { SpriteRecord } from '../../../shared/types';
import { SpritePetCard } from '../components/SpritePetCard';
import { ATTRIBUTE_OPTIONS, FINAL_FORM_FILTER_LABEL } from '../constants';
import { splitSpriteAttributes } from '../lib/sprite';
import { summarizePanelSlots } from '../lib/panel';
import type { PanelEditorState, PanelSide, SpriteFilterState } from '../types';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

type RosterPanelEditorProps = {
  side: PanelSide;
  panel: PanelEditorState;
  filter: SpriteFilterState;
  locked: boolean;
  searchValue: string;
  sprites: SpriteRecord[];
  spriteFormOptions: string[];
  onMutatePanel: (side: PanelSide, updater: (panel: PanelEditorState) => PanelEditorState) => void;
  onSavePanel: (side: PanelSide, silent?: boolean) => void;
  onRunQuickFill: (side: PanelSide) => void;
  onClearCurrentSlot: (side: PanelSide) => void;
  onClearPanel: (side: PanelSide) => void;
  onChooseQuickFillCandidate: (side: PanelSide, slotIndex: number, sprite: SpriteRecord) => void;
  onApplySprite: (side: PanelSide, sprite: SpriteRecord) => void;
  onClearSpriteFilters: (side: PanelSide) => void;
  onToggleAttributeFilter: (side: PanelSide, attribute: string) => void;
  onToggleFinalFormFilter: (side: PanelSide) => void;
  onToggleFormFilter: (side: PanelSide, form: string) => void;
};

export function RosterPanelEditor({
  side,
  panel,
  filter,
  locked,
  searchValue,
  sprites,
  spriteFormOptions,
  onMutatePanel,
  onSavePanel,
  onRunQuickFill,
  onClearCurrentSlot,
  onClearPanel,
  onChooseQuickFillCandidate,
  onApplySprite,
  onClearSpriteFilters,
  onToggleAttributeFilter,
  onToggleFinalFormFilter,
  onToggleFormFilter,
}: RosterPanelEditorProps) {
  const panelLocked = locked;
  const filteredSprites = sprites.filter((sprite) => {
    const keyword = searchValue.trim().toLowerCase();
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

  return (
    <Card
      className="panel-editor-card"
      title={`${side === 'left' ? '左侧' : '右侧'}当前阵容`}
      extra={(
        <Space wrap>
          <Text type="secondary">已选 {summarizePanelSlots(panel.selected).selectedCount} / 6</Text>
          <Switch
            checked={panel.autoSaveEnabled}
            checkedChildren="自动保存"
            unCheckedChildren="手动保存"
            disabled={panelLocked}
            onChange={(checked) => onMutatePanel(side, (prev) => ({ ...prev, autoSaveEnabled: checked }))}
          />
          {panel.saving ? <Tag color="processing">保存中</Tag> : null}
          {panelLocked ? <Tag color="warning">已锁定</Tag> : null}
        </Space>
      )}
    >
      <div className={`panel-editor-layout panel-editor-layout-${side}`}>
        <div className={`panel-slot-rail panel-slot-rail-${side}`}>
          <div className={`panel-slot-grid panel-slot-grid-${side}`}>
            {panel.selected.map((slot, index) => (
              <Button
                key={`${side}-${index}`}
                type={index === panel.activeSlot ? 'primary' : 'default'}
                className={`slot-button slot-button-${side}`}
                disabled={panelLocked}
                onClick={() => onMutatePanel(side, (prev) => ({ ...prev, activeSlot: index }))}
              >
                <div className={`slot-button-inner slot-button-inner-${side}`}>
                  {slot.sprite?.path ? (
                    <SpritePetCard sprite={slot.sprite} size={96} />
                  ) : (
                    <div className="slot-placeholder">{index + 1}</div>
                  )}
                </div>
              </Button>
            ))}
          </div>
        </div>

        <div className="panel-editor-main">
          <div className="panel-editor-tools">
            <Card size="small" className="subtle-card">
              <Space direction="vertical" size={12} className="control-stack">
                {panelLocked ? (
                  <Alert
                    showIcon
                    type="warning"
                    message="当前赛事已完成，阵容编辑已锁定"
                  />
                ) : null}
                <div>
                  <Text strong>快速文本填充</Text>
                  <Paragraph type="secondary">一行一个精灵名，先生成本地草稿，再保存到阵容。</Paragraph>
                </div>
                <TextArea
                  disabled={panelLocked}
                  rows={4}
                  value={panel.quickFillInput}
                  onChange={(event) => onMutatePanel(side, (prev) => ({ ...prev, quickFillInput: event.target.value }))}
                  placeholder={'暮星辰\n怖哭菇\n龙息帕尔'}
                />
                <Space wrap>
                  <Button disabled={panelLocked} onClick={() => onRunQuickFill(side)}>快速填充</Button>
                  <Button disabled={panelLocked} type="primary" onClick={() => onSavePanel(side)}>保存到{side === 'left' ? '左侧' : '右侧'}</Button>
                  <Button disabled={panelLocked} onClick={() => onClearCurrentSlot(side)}>选中清除</Button>
                  <Button disabled={panelLocked} onClick={() => onClearPanel(side)}>清除全部</Button>
                </Space>
              </Space>
            </Card>

            {panel.quickFillMatches.some((match) => match.candidates.length > 1) ? (
              <Card size="small" className="subtle-card">
                <Space direction="vertical" size={12} className="control-stack">
                  <Text strong>候选精灵选择</Text>
                  {panel.quickFillMatches
                    .filter((match) => match.candidates.length > 1)
                    .map((match) => (
                      <div key={`${side}-quick-${match.slot}`} className="quick-fill-group">
                        <Text>槽位 {match.slot + 1}</Text>
                        <div className="quick-fill-candidate-grid">
                          {match.candidates.map((candidate) => (
                            <Button
                              key={candidate.id}
                              size="small"
                              className="quick-fill-candidate-button"
                              disabled={panelLocked}
                              title={candidate.displayName}
                              aria-label={`选择 ${candidate.displayName}`}
                              onClick={() => onChooseQuickFillCandidate(side, match.slot, candidate)}
                            >
                              <SpritePetCard sprite={candidate} size={64} className="quick-fill-candidate-card" />
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                </Space>
              </Card>
            ) : null}
          </div>

          <Card size="small" className="subtle-card sprite-picker-card">
            <div className="sprite-picker-shell">
              <div className="sprite-filter-panel">
                <div className="sprite-filter-header">
                  <Text strong>筛选精灵</Text>
                  {hasFilter ? (
                    <Button size="small" type="link" onClick={() => onClearSpriteFilters(side)}>
                      清空筛选
                    </Button>
                  ) : null}
                </div>
                <div className="sprite-filter-group">
                  <Text type="secondary" className="sprite-filter-label">精灵属性（最多 2 个）</Text>
                  <div className="attribute-filter-grid">
                    {ATTRIBUTE_OPTIONS.map((option) => {
                      const active = filter.selectedAttributes.includes(option.label);
                      return (
                        <Button
                          key={`${side}-attr-${option.code}`}
                          type={active ? 'primary' : 'default'}
                          className={`attribute-filter-chip${active ? ' is-active' : ''}`}
                          title={option.label}
                          aria-label={option.label}
                          onClick={() => onToggleAttributeFilter(side, option.label)}
                        >
                          <span className="attribute-filter-chip-inner">
                            <img
                              src={option.iconPath}
                              alt=""
                              className="attribute-filter-icon"
                            />
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div className="sprite-filter-group">
                  <Text type="secondary" className="sprite-filter-label">精灵形态</Text>
                  <Space wrap size={[8, 8]}>
                    <Button
                      key={`${side}-form-${FINAL_FORM_FILTER_LABEL}`}
                      size="small"
                      type={filter.selectedFinalForm ? 'primary' : 'default'}
                      className="form-filter-chip"
                      onClick={() => onToggleFinalFormFilter(side)}
                    >
                      {FINAL_FORM_FILTER_LABEL}
                    </Button>
                    {spriteFormOptions.map((form) => (
                      <Button
                        key={`${side}-form-${form}`}
                        size="small"
                        type={filter.selectedForms.includes(form) ? 'primary' : 'default'}
                        className="form-filter-chip"
                        disabled={filter.selectedFinalForm}
                        onClick={() => onToggleFormFilter(side, form)}
                      >
                        {form}
                      </Button>
                    ))}
                  </Space>
                </div>
              </div>
              <Input
                value={panel.search}
                onChange={(event) => onMutatePanel(side, (prev) => ({ ...prev, search: event.target.value }))}
                placeholder={`搜索${side === 'left' ? '左侧' : '右侧'}精灵名称`}
              />
              <div className="sprite-picker-scroll">
                {filteredSprites.length ? (
                  <div className="sprite-picker-grid">
                    {filteredSprites.map((sprite) => (
                      <Button
                        key={`${side}-${sprite.id}`}
                        className="sprite-card-button"
                        disabled={panelLocked}
                        onClick={() => onApplySprite(side, sprite)}
                      >
                        <div className="sprite-card-inner">
                          <SpritePetCard sprite={sprite} size="var(--sprite-picker-card-size)" />
                        </div>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配到精灵" />
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Card>
  );
}
