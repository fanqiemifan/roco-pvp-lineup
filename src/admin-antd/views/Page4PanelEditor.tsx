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
import { Page4SlotVisual } from '../components/Page4SlotVisual';
import { SpritePetCard } from '../components/SpritePetCard';
import { ATTRIBUTE_OPTIONS } from '../constants';
import { summarizePage4Slots } from '../lib/panel';
import { splitSpriteAttributes } from '../lib/sprite';
import type { NoticeState, Page4PanelEditorState, PanelSide, SpriteFilterState } from '../types';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

type Page4PanelEditorProps = {
  side: PanelSide;
  panel: Page4PanelEditorState;
  filter: SpriteFilterState;
  notice: NoticeState;
  searchValue: string;
  sprites: SpriteRecord[];
  spriteFormOptions: string[];
  onMutatePanel: (side: PanelSide, updater: (panel: Page4PanelEditorState) => Page4PanelEditorState) => void;
  onDismissNotice: () => void;
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

export function Page4PanelEditor({
  side,
  panel,
  filter,
  notice,
  searchValue,
  sprites,
  spriteFormOptions,
  onMutatePanel,
  onDismissNotice,
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
}: Page4PanelEditorProps) {
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
  const summary = summarizePage4Slots(panel.selected);

  return (
    <Card
      className="panel-editor-card"
      title={`${side === 'left' ? '左侧' : '右侧'} 仅显阵容`}
      extra={(
        <Space wrap>
          <Text type="secondary">已选 {summary.selectedCount} / 6</Text>
          <Text type="secondary">阵亡 {summary.deadCount}</Text>
          <Switch
            checked={panel.autoSaveEnabled}
            checkedChildren="自动保存"
            unCheckedChildren="手动保存"
            onChange={(checked) => onMutatePanel(side, (prev) => ({ ...prev, autoSaveEnabled: checked }))}
          />
          {panel.saving ? <Tag color="processing">保存中</Tag> : null}
        </Space>
      )}
    >
      <div className={`panel-editor-layout panel-editor-layout-${side}`}>
        <div className={`panel-slot-rail panel-slot-rail-${side}`}>
          <div className={`panel-slot-grid panel-slot-grid-${side}`}>
            {panel.selected.map((slot, index) => (
              <Button
                key={`${side}-page4-${index}`}
                type={index === panel.activeSlot ? 'primary' : 'default'}
                className={`slot-button slot-button-${side}`}
                onClick={() => onMutatePanel(side, (prev) => ({ ...prev, activeSlot: index }))}
              >
                <div className={`slot-button-inner slot-button-inner-${side}`}>
                  <Page4SlotVisual slot={slot} index={index} />
                </div>
              </Button>
            ))}
          </div>
        </div>

        <div className="panel-editor-main">
          <div className="panel-editor-tools">
            <Card size="small" className="subtle-card">
              <Space direction="vertical" size={12} className="control-stack">
                {notice ? (
                  <Alert
                    showIcon
                    closable
                    type={notice.tone}
                    message={notice.text}
                    onClose={onDismissNotice}
                  />
                ) : null}
                <div>
                  <Text strong>快速文本填充</Text>
                  <Paragraph type="secondary">一行一个精灵名，先生成仅显阵容本地草稿，再保存到展示页。</Paragraph>
                </div>
                <TextArea
                  rows={4}
                  value={panel.quickFillInput}
                  onChange={(event) => onMutatePanel(side, (prev) => ({ ...prev, quickFillInput: event.target.value }))}
                  placeholder={'普星达\n怕哭菇\n龙息帕尔'}
                />
                <Space wrap>
                  <Button onClick={() => onClearCurrentSlot(side)}>清空当前</Button>
                  <Button onClick={() => onClearPanel(side)}>清空全部</Button>
                  <Button onClick={() => onRunQuickFill(side)}>快速填充</Button>
                  <Button type="primary" onClick={() => onSavePanel(side)}>保存阵容</Button>
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
                      <div key={`${side}-page4-quick-${match.slot}`} className="quick-fill-group">
                        <Text>槽位 {match.slot + 1}</Text>
                        <div className="quick-fill-candidate-grid">
                          {match.candidates.map((candidate) => (
                            <Button
                              key={candidate.id}
                              size="small"
                              className="quick-fill-candidate-button"
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
                            key={`${side}-page4-attr-${option.code}`}
                            type={active ? 'primary' : 'default'}
                            className={`attribute-filter-chip${active ? ' is-active' : ''}`}
                            title={option.label}
                            aria-label={option.label}
                            onClick={() => onToggleAttributeFilter(side, option.label)}
                          >
                            <span className="attribute-filter-chip-inner">
                              <img src={option.iconPath} alt="" className="attribute-filter-icon" />
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
                        key={`${side}-page4-form-final`}
                        size="small"
                        type={filter.selectedFinalForm ? 'primary' : 'default'}
                        className="form-filter-chip"
                        onClick={() => onToggleFinalFormFilter(side)}
                      >
                        最终形态
                      </Button>
                      {spriteFormOptions.map((form) => (
                        <Button
                          key={`${side}-page4-form-${form}`}
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
                          key={`${side}-page4-${sprite.id}`}
                          className="sprite-card-button"
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
      </div>
    </Card>
  );
}
