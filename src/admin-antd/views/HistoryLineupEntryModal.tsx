import React, { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Empty, Input, Modal, Space, Tag, Tooltip, Typography } from 'antd';
import type { GameRecord, MatchRecord, MatchStoreState, QuickFillMatch, SlotState, SpriteRecord } from '../../../shared/types';
import { ATTRIBUTE_OPTIONS, EXCLUSIVE_FORM_FILTERS, FINAL_FORM_FILTER_LABEL } from '../constants';
import { requestQuickFillMatches, requestJson } from '../lib/request';
import { buildPanelRequest, createEmptySlot, draftSlotsToSelected } from '../lib/panel';
import { buildSpriteLookup, splitSpriteAttributes } from '../lib/sprite';
import type { PanelSide } from '../types';
import { SpritePetCard } from '../components/SpritePetCard';

const { Text } = Typography;

type SideBuffer = {
  selected: SlotState[];
  quickFillInput: string;
  quickFillMatches: QuickFillMatch[];
};

function createEmptySideBuffer(): SideBuffer {
  return {
    selected: Array.from({ length: 6 }, (_, index) => createEmptySlot(index)),
    quickFillInput: '',
    quickFillMatches: [],
  };
}

type HistoryLineupEntryModalProps = {
  open: boolean;
  match: MatchRecord | null;
  game: GameRecord | null;
  sprites: SpriteRecord[];
  onClose: () => void;
  /** 保存成功后把最新赛事 store 交回页面统一应用（服务端保证不改动面板/比分栏） */
  onSaved: (store: MatchStoreState) => void;
};

/**
 * 比赛历史「录入阵容」弹窗：为一场比赛的当前小局（待开始）提前录入双方阵容。
 * 只写赛事记录（/api/matches/:id/games/:n/lineup），不影响当前推流画面；
 * 左右快速填充、槽位点选与精灵筛选交互与赛事面板一致，缓冲区为弹窗本地状态。
 */
export function HistoryLineupEntryModal({
  open,
  match,
  game,
  sprites,
  onClose,
  onSaved,
}: HistoryLineupEntryModalProps) {
  const { message } = App.useApp();
  const [buffers, setBuffers] = useState<Record<PanelSide, SideBuffer>>({
    left: createEmptySideBuffer(),
    right: createEmptySideBuffer(),
  });
  const [activeSide, setActiveSide] = useState<PanelSide>('left');
  const [activeSlot, setActiveSlot] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedAttributes, setSelectedAttributes] = useState<string[]>([]);
  const [selectedForms, setSelectedForms] = useState<string[]>([]);
  const [selectedFinalForm, setSelectedFinalForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // 已回填过的草稿上下文键（matchId|gameNumber）：取消后重新打开同一局保留编辑中的缓冲区
  const initializedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !match || !game || !sprites.length) {
      return;
    }
    const key = `${match.id}|${game.gameNumber}`;
    if (initializedKeyRef.current === key) {
      return;
    }
    initializedKeyRef.current = key;
    const lookup = buildSpriteLookup(sprites);
    setBuffers({
      left: { ...createEmptySideBuffer(), selected: draftSlotsToSelected(game.leftSlots, lookup) },
      right: { ...createEmptySideBuffer(), selected: draftSlotsToSelected(game.rightSlots, lookup) },
    });
    setActiveSide('left');
    setActiveSlot(0);
    setSearch('');
    setSelectedAttributes([]);
    setSelectedForms([]);
    setSelectedFinalForm(false);
  }, [open, match, game, sprites]);

  const filteredSprites = sprites.filter((sprite) => {
    const keyword = search.trim().toLowerCase();
    const values = [
      sprite.displayName,
      sprite.name,
      sprite.chineseName,
      sprite.filename,
      ...(sprite.aliases ?? []),
    ];
    const matchesKeyword = !keyword || values.some((value) => String(value ?? '').toLowerCase().includes(keyword));
    const spriteAttributes = splitSpriteAttributes(sprite.attribute);
    const matchesAttributes = !selectedAttributes.length
      || selectedAttributes.every((attribute) => spriteAttributes.includes(attribute));
    const matchesForms = selectedFinalForm
      ? sprite.isFinalForm
      : !selectedForms.length || selectedForms.includes(sprite.form);

    return matchesKeyword && matchesAttributes && matchesForms;
  });
  const hasFilter = selectedAttributes.length > 0 || selectedForms.length > 0 || selectedFinalForm;

  function mutateSide(side: PanelSide, updater: (buffer: SideBuffer) => SideBuffer) {
    setBuffers((prev) => ({ ...prev, [side]: updater(prev[side]) }));
  }

  function fillSlot(side: PanelSide, slotIndex: number, sprite: SpriteRecord | null) {
    mutateSide(side, (buffer) => ({
      ...buffer,
      selected: buffer.selected.map((slot, index) => (
        index === slotIndex ? { ...slot, sprite } : slot
      )),
    }));
  }

  function handleSpritePick(sprite: SpriteRecord) {
    fillSlot(activeSide, activeSlot, sprite);
    // 填入后自动前进到同侧下一个空槽位，连续点选更顺手
    const nextEmpty = buffers[activeSide].selected.findIndex((slot, index) => index > activeSlot && !slot.sprite);
    if (nextEmpty !== -1) {
      setActiveSlot(nextEmpty);
    }
  }

  async function runQuickFill(side: PanelSide) {
    const text = buffers[side].quickFillInput.trim();
    if (!text) {
      message.warning(`先输入${side === 'left' ? '左侧' : '右侧'}要匹配的精灵名称`);
      return;
    }

    try {
      const matches = await requestQuickFillMatches(text);
      const nextSelected = Array.from({ length: 6 }, (_, index) => createEmptySlot(index));
      matches.forEach((match) => {
        if (match.slot >= 0 && match.slot < 6 && match.sprite) {
          nextSelected[match.slot] = { ...nextSelected[match.slot], sprite: match.sprite };
        }
      });
      mutateSide(side, (buffer) => ({ ...buffer, selected: nextSelected, quickFillMatches: matches }));
      message.success(`${side === 'left' ? '左侧' : '右侧'}快速填充已应用到本地草稿，确认后点「保存阵容」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSave() {
    if (!match || !game || saving) {
      return;
    }
    setSaving(true);
    try {
      let latestStore: MatchStoreState | null = null;
      for (const side of ['left', 'right'] as const) {
        const data = await requestJson<{ success: boolean; store?: MatchStoreState }>(
          `/api/matches/${encodeURIComponent(match.id)}/games/${game.gameNumber}/lineup`,
          {
            method: 'POST',
            json: { position: side, selected: buildPanelRequest(buffers[side].selected) },
          },
        );
        if (data.store) {
          latestStore = data.store;
        }
      }
      if (latestStore) {
        onSaved(latestStore);
      }
      message.success(`已录入第 ${game.gameNumber} 局阵容（仅写入赛事记录，不影响推流）`);
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const selectedCount = (side: PanelSide) => buffers[side].selected.filter((slot) => slot.sprite).length;
  const candidateGroups = (['left', 'right'] as const).flatMap((side) => (
    buffers[side].quickFillMatches
      .filter((match) => match.candidates.length > 1)
      .map((match) => ({ side, slot: match.slot, candidates: match.candidates }))
  ));

  const activeSprite = buffers[activeSide].selected[activeSlot]?.sprite ?? null;
  const footHint = activeSprite
    ? `当前选中：${activeSide === 'left' ? '左侧' : '右侧'}槽位 ${activeSlot + 1}（${activeSprite.displayName}）· 点击精灵可替换`
    : `当前选中：${activeSide === 'left' ? '左侧' : '右侧'}槽位 ${activeSlot + 1} · 点击精灵填入`;

  function clearBothSides() {
    mutateSide('left', (buffer) => ({ ...buffer, selected: Array.from({ length: 6 }, (_, index) => createEmptySlot(index)), quickFillMatches: [] }));
    mutateSide('right', (buffer) => ({ ...buffer, selected: Array.from({ length: 6 }, (_, index) => createEmptySlot(index)), quickFillMatches: [] }));
  }

  return (
    <Modal
      open={open}
      onCancel={saving ? undefined : onClose}
      width={1120}
      centered
      className="lineup-entry-modal"
      title={(
        <div className="lineup-entry-title">
          <span>录入阵容</span>
          <Tag color="gold">待开始</Tag>
          {match && game ? (
            <Text type="secondary" className="lineup-entry-subtitle">
              {match.id} · {match.leftPlayer || '左侧'} vs {match.rightPlayer || '右侧'} · BO{match.bestOf} · 第 {game.gameNumber} 局（当前小局）
            </Text>
          ) : null}
        </div>
      )}
      footer={(
        <div className="lineup-entry-footer">
          <Text type="secondary" className="lineup-entry-foot-hint">{footHint}</Text>
          <Space>
            <Button disabled={saving} onClick={clearBothSides}>清空双侧</Button>
            <Button disabled={saving} onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>保存阵容</Button>
          </Space>
        </div>
      )}
    >
      <Alert
        showIcon
        type="info"
        message="提前录入：该局尚未开始，阵容仅写入赛事记录，不影响当前推流画面；开打前可随时回来修改，开始对局时自动生效。"
        className="lineup-entry-alert"
      />

      <div className="lineup-entry-body">
        {(['left', 'right'] as const).map((side) => (
          <div key={side} className={`lineup-entry-rail lineup-entry-rail-${side}${activeSide === side ? ' is-active' : ''}`}>
            <div className="lineup-entry-rail-head">
              <span className="side">
                <span className="dot" />
                {side === 'left' ? '左侧' : '右侧'} · {match?.[side === 'left' ? 'leftPlayer' : 'rightPlayer'] || (side === 'left' ? '左侧' : '右侧')}
              </span>
              <span className="cnt">已选 {selectedCount(side)}/6</span>
            </div>
            <div className="lineup-entry-slots">
              {buffers[side].selected.map((slot, index) => {
                const active = activeSide === side && activeSlot === index;
                return (
                  <button
                    key={`${side}-${index}`}
                    type="button"
                    className={`lineup-entry-slot${slot.sprite ? ' filled' : ' empty'}${active ? ' active' : ''}`}
                    onClick={() => {
                      setActiveSide(side);
                      setActiveSlot(index);
                    }}
                  >
                    <span className="slot-idx">{index + 1}</span>
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
                          fillSlot(side, index, null);
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
        ))}

        <div className="lineup-entry-center">
          <Card size="small" className="subtle-card lineup-entry-quickfill">
            <div className="lineup-entry-quickfill-grid">
              {(['left', 'right'] as const).map((side) => (
                <div key={side} className="lineup-entry-quickfill-side">
                  <Text strong>{side === 'left' ? '左侧快速填充' : '右侧快速填充'}</Text>
                  <Input.TextArea
                    rows={2}
                    value={buffers[side].quickFillInput}
                    disabled={saving}
                    placeholder={'一行一个精灵名，例如：\n暮星辰\n怖哭菇\n龙息帕尔'}
                    onChange={(event) => mutateSide(side, (buffer) => ({ ...buffer, quickFillInput: event.target.value }))}
                  />
                  <Button
                    size="small"
                    disabled={saving}
                    onClick={() => void runQuickFill(side)}
                  >
                    快速填充到{side === 'left' ? '左侧' : '右侧'}
                  </Button>
                </div>
              ))}
            </div>
            {candidateGroups.length ? (
              <div className="lineup-entry-candidates">
                <Text strong>候选精灵选择</Text>
                {candidateGroups.map(({ side, slot, candidates }) => (
                  <div key={`${side}-${slot}`} className="candidate-group">
                    <Text type="secondary">{side === 'left' ? '左侧' : '右侧'}槽位 {slot + 1}</Text>
                    <div className="candidate-grid">
                      {candidates.map((candidate) => (
                        <Tooltip key={candidate.id} title={candidate.displayName}>
                          <button
                            type="button"
                            className="candidate-button"
                            aria-label={`选择 ${candidate.displayName}`}
                            onClick={() => fillSlot(side, slot, candidate)}
                          >
                            <SpritePetCard sprite={candidate} size={64} />
                          </button>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card size="small" className="subtle-card lineup-entry-picker">
            <div className="picker-head">
              <Text strong>筛选精灵</Text>
              {hasFilter ? (
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    setSelectedAttributes([]);
                    setSelectedForms([]);
                    setSelectedFinalForm(false);
                  }}
                >
                  清空筛选
                </Button>
              ) : null}
            </div>
            <Text type="secondary" className="filter-label">精灵属性（最多 2 个）</Text>
            <div className="attribute-filter-grid">
              {ATTRIBUTE_OPTIONS.map((option) => {
                const active = selectedAttributes.includes(option.label);
                return (
                  <Button
                    key={option.label}
                    type={active ? 'primary' : 'default'}
                    className="attribute-filter-chip"
                    title={option.label}
                    aria-label={option.label}
                    onClick={() => {
                      setSelectedAttributes((prev) => {
                        if (prev.includes(option.label)) {
                          return prev.filter((item) => item !== option.label);
                        }
                        if (prev.length >= 2) {
                          return prev;
                        }
                        return [...prev, option.label];
                      });
                    }}
                  >
                    <span className="attribute-filter-chip-inner">
                      <img src={option.iconPath} alt="" className="attribute-filter-icon" />
                    </span>
                  </Button>
                );
              })}
            </div>
            <Text type="secondary" className="filter-label">精灵形态</Text>
            <Space wrap size={[8, 8]} className="form-filter-row">
              <Button
                size="small"
                type={selectedFinalForm ? 'primary' : 'default'}
                onClick={() => {
                  setSelectedFinalForm((prev) => !prev);
                  setSelectedForms([]);
                }}
              >
                {FINAL_FORM_FILTER_LABEL}
              </Button>
              {EXCLUSIVE_FORM_FILTERS.map((form) => (
                <Button
                  key={form}
                  size="small"
                  type={selectedForms.includes(form) ? 'primary' : 'default'}
                  disabled={selectedFinalForm}
                  onClick={() => {
                    setSelectedForms((prev) => (
                      prev.includes(form) ? prev.filter((item) => item !== form) : [...prev, form]
                    ));
                  }}
                >
                  {form}
                </Button>
              ))}
            </Space>
            <Input
              value={search}
              placeholder="搜索精灵名称"
              allowClear
              onChange={(event) => setSearch(event.target.value)}
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
        </div>
      </div>
    </Modal>
  );
}
