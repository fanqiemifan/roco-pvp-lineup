import React, { useEffect, useMemo, useState } from 'react';
import {
  App,
  AutoComplete,
  Button,
  Card,
  Col,
  Input,
  Row,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';

import { MVP_MAX_ITEMS, MVP_TAG_MAX_LENGTH } from '../../../shared/constants';
import type { MvpSlotEntry, MvpState, MvpWinnerSnapshot, StageConfig } from '../../../shared/types';
import { useAdminData } from '../data/use-admin-data';
import { MVP_TAG_PRESETS, STAGE_OPTIONS } from '../constants';
import { getActiveMatch, getRecentWinnerLineup } from '../lib/match';
import { buildMvpProgressItems } from '../lib/mvp';
import { requestJson } from '../lib/request';
import { buildSpriteLookup } from '../lib/sprite';
import { EmptyState } from '../ui/EmptyState';
import { Hint } from '../ui/Hint';

const { Paragraph, Text } = Typography;

/** MVP 结算（推流页面4）空槽位：后台固定展示 MVP_MAX_ITEMS 行 */
function createEmptyMvpSlots(): MvpSlotEntry[] {
  return Array.from({ length: MVP_MAX_ITEMS }, () => ({ petId: '', tag: '', isMvp: false }));
}

/**
 * 结算画面（M5 从 App.tsx 拆出）：载入胜方、点选胜方阵容精灵、标签与 MVP 标记、显示/关闭。
 *
 * 精灵草稿是视图本地状态（服务端 mvp.slots 变化时按内容回填，一致则保持原引用）；
 * 服务端状态（mvp / 胜方快照 / stage / 当前对局）走 `useAdminData()`，
 * 保存仍用既有的 /api/mvp、/api/mvp/show、/api/mvp/hide，不重复实现。
 */
export function MvpView(): React.ReactElement {
  const { message } = App.useApp();
  const { mvp, mvpWinner, matchStore, sprites, stage, applyServerState } = useAdminData();
  const [mvpSaving, setMvpSaving] = useState(false);
  const [mvpSlotsDraft, setMvpSlotsDraft] = useState<MvpSlotEntry[]>(createEmptyMvpSlots);

  const activeMatch = getActiveMatch(matchStore);
  const spriteMap = useMemo(() => buildSpriteLookup(sprites), [sprites]);
  // 胜者阵容（口径同推流页面10）+ 标记完成度
  const mvpWinnerLineup = useMemo(() => getRecentWinnerLineup(activeMatch), [activeMatch]);
  // 结算画面只收最终形态精灵：可点选与「载入当前对局胜方」同一口径（非最终形态不进结算页）
  const mvpWinnerPetIds = mvpWinnerLineup.petIds.filter((petId) => spriteMap.get(petId)?.isFinalForm === true);
  const mvpAssignedCount = mvpSlotsDraft.filter((slot) => slot.petId).length;
  const mvpTagsComplete = mvpAssignedCount > 0 && mvpSlotsDraft.every((slot) => !slot.petId || slot.tag.trim().length > 0);
  // 显示 MVP 结算的门槛：只要标记了 MVP（标签可选，不要求填写完整）
  const mvpMarked = mvpSlotsDraft.some((slot) => slot.petId && slot.isMvp);
  const mvpVisible = stage?.page === 'page4';
  // 当前对局胜方与已载入快照不一致：推流画面不会自动更新，需重新「载入当前对局胜方」
  const mvpWinnerOutdated = Boolean(mvpWinnerLineup.side) && (
    mvp?.winner?.matchId !== activeMatch?.id || mvp?.winner?.playerName !== mvpWinnerLineup.playerName
  );
  // 操作引导条（载入胜方 → 选择精灵 → 标记 MVP → 显示结算）
  const mvpProgress = buildMvpProgressItems({
    hasWinner: Boolean(mvp?.winner),
    assignedCount: mvpAssignedCount,
    marked: mvpMarked,
    visible: mvpVisible,
  });

  // 服务端 mvp.slots 变化时回填草稿（内容一致时保持原引用，避免编辑中的标签被覆盖）
  useEffect(() => {
    setMvpSlotsDraft((prev) => {
      const serverSlots = mvp?.slots ?? [];
      const next = Array.from({ length: MVP_MAX_ITEMS }, (_, index) => {
        const slot = serverSlots[index];
        return { petId: slot?.petId ?? '', tag: slot?.tag ?? '', isMvp: slot?.isMvp === true };
      });
      const same = next.every((slot, index) => (
        slot.petId === prev[index]?.petId
        && slot.tag === prev[index]?.tag
        && slot.isMvp === prev[index]?.isMvp
      ));
      return same ? prev : next;
    });
  }, [mvp?.slots]);

  /** 已载入胜方的头像地址：按快照 matchId+side 解析（与推流页面4 同口径），未上传时回退默认占位图 */
  function getMvpWinnerAvatarSrc(): string {
    const side = mvpWinner?.side === 'right' ? 'right' : 'left';
    if (mvpWinner?.avatarExists && mvpWinner.avatarPath) {
      return `${mvpWinner.avatarPath}${mvpWinner.avatarMtime ? `?t=${Math.floor(mvpWinner.avatarMtime)}` : ''}`;
    }
    return side === 'right' ? '/assets/ui/right-avatar.png' : '/assets/ui/left-avatar.png';
  }

  /** 保存精灵项（顺序即页面从左到右，未赋值槽位由服务端忽略；winner 不传时保留已载入的胜方快照） */
  async function saveMvpSlots(slots: MvpSlotEntry[], winner?: MvpWinnerSnapshot | null) {
    setMvpSaving(true);
    try {
      const data = await requestJson<{ success: boolean; state: MvpState }>('/api/mvp', {
        method: 'POST',
        json: winner === undefined ? { slots } : { slots, winner },
      });
      applyServerState({ mvp: data.state });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setMvpSaving(false);
    }
  }

  /** 显示（记录当前推流画面后切到页面4） */
  async function showMvpSettlement() {
    setMvpSaving(true);
    try {
      const data = await requestJson<{ success: boolean; state: MvpState; stage: StageConfig }>('/api/mvp/show', {
        method: 'POST',
        json: {},
      });
      applyServerState({ mvp: data.state, stage: data.stage });
      message.success('推流画面已切换到：推流页面4（MVP 结算）');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setMvpSaving(false);
    }
  }

  /** 关闭（切回开启前所在推流画面） */
  async function hideMvpSettlement() {
    setMvpSaving(true);
    try {
      const data = await requestJson<{ success: boolean; state: MvpState; stage: StageConfig }>('/api/mvp/hide', {
        method: 'POST',
        json: {},
      });
      applyServerState({ mvp: data.state, stage: data.stage });
      const label = STAGE_OPTIONS.find((option) => option.value === data.stage.page)?.label ?? data.stage.page;
      message.success(`推流画面已切回：${label}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setMvpSaving(false);
    }
  }

  /** 草稿：本地即时回显后保存（标签手动输入在失焦/回车时保存） */
  function applyMvpDraft(next: MvpSlotEntry[], winner?: MvpWinnerSnapshot | null) {
    setMvpSlotsDraft(next);
    void saveMvpSlots(next, winner);
  }

  function updateMvpSlotDraft(index: number, patch: Partial<MvpSlotEntry>) {
    setMvpSlotsDraft((prev) => prev.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  }

  /** 点选胜者阵容精灵：已填入则移除，否则填入第一个空槽位 */
  function toggleMvpWinnerSprite(petId: string) {
    const existingIndex = mvpSlotsDraft.findIndex((slot) => slot.petId === petId);
    if (existingIndex >= 0) {
      applyMvpDraft(mvpSlotsDraft.map((slot, index) => (
        index === existingIndex ? { petId: '', tag: '', isMvp: false } : slot
      )));
      return;
    }
    const emptyIndex = mvpSlotsDraft.findIndex((slot) => !slot.petId);
    if (emptyIndex < 0) {
      message.warning(`最多只能标记 ${MVP_MAX_ITEMS} 个精灵`);
      return;
    }
    applyMvpDraft(mvpSlotsDraft.map((slot, index) => (index === emptyIndex ? { ...slot, petId } : slot)));
  }

  /** 载入当前对局胜方：把胜者名字与阵容快照（仅最终形态精灵）一并保存，之后切换对局不会自动更新 */
  function fillMvpWinnerLineup() {
    const { side, playerName } = mvpWinnerLineup;
    const matchId = activeMatch?.id ?? '';
    if (!side || !matchId) {
      message.warning('当前对局还没有已分胜负的小局');
      return;
    }
    const petIds = mvpWinnerPetIds.slice(0, MVP_MAX_ITEMS);
    if (!petIds.length) {
      // 没有可用的最终形态精灵时不覆盖已标记的精灵项，仅更新胜方名字
      message.warning('胜者阵容中没有可用的最终形态精灵，仅载入胜方选手名字');
      applyMvpDraft(mvpSlotsDraft, { matchId, side, playerName });
      return;
    }
    applyMvpDraft(petIds.map((petId) => {
      const existed = mvpSlotsDraft.find((slot) => slot.petId === petId);
      return { petId, tag: existed?.tag ?? '', isMvp: existed?.isMvp === true };
    }), { matchId, side, playerName });
  }

  /** MVP 标记：全页最多一个，标记新精灵时取消原标记 */
  function toggleMvpSlotMvp(index: number) {
    const target = mvpSlotsDraft[index];
    if (!target || !target.petId) {
      return;
    }
    applyMvpDraft(mvpSlotsDraft.map((slot, i) => ({ ...slot, isMvp: i === index ? !target.isMvp : false })));
  }

  function clearMvpSlot(index: number) {
    applyMvpDraft(mvpSlotsDraft.map((slot, i) => (
      i === index ? { petId: '', tag: '', isMvp: false } : slot
    )));
  }

  /** 标签手动输入失焦/回车：保存当前草稿（选择预设标签时即时保存） */
  function saveMvpTagDraft() {
    void saveMvpSlots(mvpSlotsDraft);
  }

  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Card
        className="stage-control-card"
        title="MVP 结算画面（推流页面4）"
        extra={(
          <Space wrap>
            <Button href="/roco-pvp-page4.html" target="_blank">打开结算画面</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={16} className="page-stack">
          {/* 操作引导条：与赛事面板「当前比赛」的状态条同款 */}
          <div className="current-match-statusbar">
            <Steps current={mvpProgress.current} items={mvpProgress.items} responsive />
          </div>
          <Row gutter={[16, 16]} className="stage-config-cards">
            <Col xs={24} xl={10}>
              <Card size="small" className="subtle-card" title="显示控制">
                <Space direction="vertical" size={12} className="control-stack">
                  <Space wrap>
                    <Button type="primary" loading={mvpSaving} disabled={!mvpMarked} onClick={() => void showMvpSettlement()}>
                      显示 MVP 结算
                    </Button>
                    <Button danger loading={mvpSaving} disabled={!mvpVisible} onClick={() => void hideMvpSettlement()}>
                      关闭
                    </Button>
                    {mvpVisible ? <Tag color="green">正在显示</Tag> : <Tag>未显示</Tag>}
                  </Space>
                  <Space size={8} wrap>
                    <Tag color={mvpAssignedCount ? 'gold' : 'default'}>
                      已标记精灵 {mvpAssignedCount}/{MVP_MAX_ITEMS}
                    </Tag>
                    {mvpTagsComplete ? <Tag color="green">标签已完整</Tag> : <Tag color="orange">标签未完整</Tag>}
                    {mvpMarked
                      ? <Tag color="red">已标记 MVP</Tag>
                      : <Tag>未标记 MVP</Tag>}
                  </Space>
                  {/* 已载入胜方：名字 + 头像（头像按快照 matchId+side 解析，未上传回退默认占位图） */}
                  <Space size={10} align="center" wrap>
                    <img
                      className="mvp-winner-avatar"
                      src={getMvpWinnerAvatarSrc()}
                      alt={mvp?.winner?.playerName || '胜方选手'}
                    />
                    <Space direction="vertical" size={0}>
                      <Text strong>{mvp?.winner?.playerName || '未载入胜方'}</Text>
                      <Hint>
                        {mvp?.winner
                          ? `已载入胜方 · ${mvp.winner.side === 'left' ? '左侧' : '右侧'} · ${mvp.winner.matchId}`
                          : '点「载入当前对局胜方」后在这里显示选手头像'}
                      </Hint>
                    </Space>
                  </Space>
                </Space>
              </Card>
            </Col>
            <Col xs={24} xl={14}>
              <Card
                size="small"
                className="subtle-card"
                title={mvpWinnerLineup.side
                  ? `当前对局胜者阵容（${mvpWinnerLineup.playerName || '胜者'} · 第 ${mvpWinnerLineup.gameNumber} 局）`
                  : '当前对局胜者阵容'}
                extra={(
                  <Button size="small" disabled={!mvpWinnerLineup.side || mvpSaving} onClick={fillMvpWinnerLineup}>
                    载入当前对局胜方
                  </Button>
                )}
              >
                {mvpWinnerPetIds.length ? (
                  <>
                    <div className="mvp-lineup-grid">
                      {mvpWinnerPetIds.map((petId) => {
                        const sprite = spriteMap.get(petId);
                        const active = mvpSlotsDraft.some((slot) => slot.petId === petId);
                        return (
                          <button
                            key={petId}
                            type="button"
                            className={`mvp-lineup-item${active ? ' is-active' : ''}`}
                            onClick={() => toggleMvpWinnerSprite(petId)}
                          >
                            <img src={sprite?.iconUrl || sprite?.path || '/assets/ui/back.png'} alt={sprite?.displayName || petId} />
                            <span>{sprite?.displayName || petId}</span>
                          </button>
                        );
                      })}
                    </div>
                    <Paragraph type="secondary" style={{ margin: '10px 0 0', fontSize: 12 }}>
                      点击精灵加入 / 再点移除（仅最终形态，最多 {MVP_MAX_ITEMS} 个），顺序即展示顺序。
                    </Paragraph>
                  </>
                ) : (
                  <EmptyState title="当前对局还没有已分胜负的小局（或胜者阵容中没有最终形态精灵）" />
                )}
                {mvpWinnerOutdated ? (
                  <Paragraph type="warning" style={{ margin: '10px 0 0', fontSize: 12 }}>
                    当前对局胜方与已载入的不一致，推流画面仍显示已载入的胜方；如需更新请点「载入当前对局胜方」。
                  </Paragraph>
                ) : null}
              </Card>
            </Col>
          </Row>
          <Card size="small" className="subtle-card" title="精灵项标签与 MVP 标记">
            <Space direction="vertical" size={10} className="page-stack" style={{ width: '100%' }}>
              {mvpSlotsDraft.map((slot, index) => {
                const sprite = slot.petId ? spriteMap.get(slot.petId) : null;
                return (
                  <Row key={index} gutter={[12, 8]} align="middle">
                    <Col flex="32px">
                      <Text strong>{index + 1}</Text>
                    </Col>
                    <Col flex="220px">
                      {sprite ? (
                        <Space size={8} align="center">
                          <img
                            className="mvp-slot-avatar"
                            src={sprite.iconUrl || sprite.path || '/assets/ui/back.png'}
                            alt={sprite.displayName}
                          />
                          <Text ellipsis style={{ maxWidth: 150 }}>{sprite.displayName}</Text>
                        </Space>
                      ) : (
                        <Text type="secondary">未选择精灵</Text>
                      )}
                    </Col>
                    <Col flex="280px">
                      <AutoComplete
                        value={slot.tag}
                        disabled={!slot.petId}
                        style={{ width: '100%' }}
                        options={MVP_TAG_PRESETS.map((tag) => ({ value: tag }))}
                        filterOption={(input, option) => String(option?.value ?? '').includes(input.trim())}
                        onChange={(value) => updateMvpSlotDraft(index, { tag: String(value ?? '').slice(0, MVP_TAG_MAX_LENGTH) })}
                      >
                        <Input
                          maxLength={MVP_TAG_MAX_LENGTH}
                          placeholder="标签，最多四个字（可留空）"
                          onBlur={saveMvpTagDraft}
                          onPressEnter={saveMvpTagDraft}
                        />
                      </AutoComplete>
                    </Col>
                    <Col flex="auto">
                      <Space wrap size={8}>
                        <Button
                          size="small"
                          type={slot.isMvp ? 'primary' : 'default'}
                          disabled={!slot.petId}
                          onClick={() => toggleMvpSlotMvp(index)}
                        >
                          {slot.isMvp ? 'MVP 已标记' : '标记 MVP'}
                        </Button>
                        <Button size="small" type="text" danger disabled={!slot.petId} onClick={() => clearMvpSlot(index)}>
                          清空
                        </Button>
                      </Space>
                    </Col>
                  </Row>
                );
              })}
            </Space>
          </Card>
        </Space>
      </Card>
    </Space>
  );
}
