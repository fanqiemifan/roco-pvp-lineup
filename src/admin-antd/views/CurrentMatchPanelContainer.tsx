import React, { useMemo, useState } from 'react';
import {
  App,
  AutoComplete,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Typography,
} from 'antd';

import type {
  AvatarCollectionState,
  MatchRecord,
  MatchStoreState,
  ScoreboardState,
} from '../../../shared/types';
import { useAdminData } from '../data/use-admin-data';
import { getActiveMatch, summarizeSeriesForBestOf } from '../lib/match';
import { deriveMatchActionAvailability } from '../lib/match-actions';
import { requestJson, uploadSingleFile } from '../lib/request';
import type { MatchFormValues, PanelSide } from '../types';
import { CurrentMatchPanel } from '../components/CurrentMatchPanel';

const { Paragraph } = Typography;

/**
 * 「当前比赛」面板容器（M4 从 App.tsx 拆出）：赛事面板（inline）与系列比赛 Drawer（drawer）共用。
 * 动作与云闸门按**目标比赛**绑定（headless 登记）；头像只对当前比赛可用；
 * 战队修改弹窗随容器挂载（任意时刻只会有一个容器在可见视图里）。
 */
export function CurrentMatchPanelContainer({
  match,
  variant,
  rosterEditor,
}: {
  match: MatchRecord;
  variant: 'inline' | 'drawer';
  rosterEditor?: React.ReactNode;
}): React.ReactElement {
  const { message, modal } = App.useApp();
  const {
    avatars,
    setAvatars,
    profiles,
    tournaments,
    matchStore,
    applyServerState,
    setRosterNotice,
    runMatchAction,
    cloudRegisterGate,
    cloudUndoGate,
  } = useAdminData();
  const tournamentRecordMap = useMemo(
    () => new Map(tournaments.map((tournament) => [tournament.id, tournament])),
    [tournaments],
  );
  const activeMatch = getActiveMatch(matchStore);
  const availability = deriveMatchActionAvailability(match, matchStore.activeMatchId, matchStore.undo);
  const isCurrent = availability.isCurrent;

  // 战队修改：打开弹窗并回填目标比赛左右战队名称（系列比赛 Drawer 也能改非当前比赛）
  const [teamEditOpen, setTeamEditOpen] = useState(false);
  const [teamEditSaving, setTeamEditSaving] = useState(false);
  const [teamEditTargetId, setTeamEditTargetId] = useState<string | null>(null);
  const [teamEditForm] = Form.useForm<{ leftTeam?: string; rightTeam?: string }>();

  function getAvatarPreviewSrc(side: PanelSide): string {
    const avatar = avatars[side];
    return avatar.exists
      ? `${avatar.path}?t=${avatar.mtime ?? 0}`
      : placeholderAvatarSrc(side);
  }

  /** 头像占位图：非当前比赛时用它（推流头像按当前比赛存储，不能借用别场的头像） */
  function placeholderAvatarSrc(side: PanelSide): string {
    return side === 'left' ? '/assets/ui/left-avatar.png' : '/assets/ui/right-avatar.png';
  }

  async function uploadAvatarFile(side: PanelSide, file: File) {
    try {
      await uploadSingleFile(`/api/upload/avatar/${side}`, file);
      const nextAvatars = await requestJson<AvatarCollectionState>('/api/avatars');
      setAvatars(nextAvatars);
      message.success(`${side === 'left' ? '左侧' : '右侧'}头像已更新`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteAvatarFile(side: PanelSide) {
    try {
      await requestJson(`/api/delete/avatar/${side}`, {
        method: 'DELETE',
      });
      const nextAvatars = await requestJson<AvatarCollectionState>('/api/avatars');
      setAvatars(nextAvatars);
      message.success(`${side === 'left' ? '左侧' : '右侧'}头像已删除`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveMatchMeta(matchId: string, values: MatchFormValues) {
    const target = matchStore.matches.find((item) => item.id === matchId);
    if (!target) {
      return;
    }

    const nextBestOf = Number(values.bestOf) || target.bestOf;
    const bestOfChanged = nextBestOf !== target.bestOf;
    const projection = bestOfChanged ? summarizeSeriesForBestOf(target, nextBestOf) : null;
    const endsMatchAfterBestOfChange = Boolean(projection?.winner && target.status !== 'completed');

    const save = async () => {
      try {
        const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState }>(`/api/matches/${encodeURIComponent(matchId)}`, {
          method: 'PATCH',
          json: values,
        });
        applyServerState({
          store: data.store,
          scoreboard: data.scoreboard,
        });

        if (endsMatchAfterBestOfChange && projection?.winner) {
          const winnerText = projection.winner === 'left'
            ? (values.leftPlayer || '左侧')
            : (values.rightPlayer || '右侧');
          const nextText = `BO 已改为 BO${nextBestOf}，本场比赛按已录入结果直接结束，${winnerText} 以 ${projection.leftScore}:${projection.rightScore} 获胜`;
          setRosterNotice({ tone: 'warning', text: nextText });
          message.success(nextText);
          return;
        }

        if (bestOfChanged) {
          const nextText = `比赛信息已保存，BO 已更新为 BO${nextBestOf}`;
          setRosterNotice({ tone: 'success', text: nextText });
          message.success(nextText);
          return;
        }

        setRosterNotice({ tone: 'success', text: '比赛信息已保存' });
        message.success('比赛信息已保存');
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    };

    if (endsMatchAfterBestOfChange && projection?.winner) {
      const winnerText = projection.winner === 'left'
        ? (values.leftPlayer || '左侧')
        : (values.rightPlayer || '右侧');
      modal.confirm({
        title: '修改 BO 会直接结束本场比赛',
        content: `当前已录入的战绩在 BO${nextBestOf} 下已经足以分出胜负。继续后会立即结束本场比赛，并按前 ${projection.completedGameCount} 局结算为 ${winnerText} ${projection.leftScore}:${projection.rightScore} 获胜。`,
        okText: '确认并结束比赛',
        cancelText: '取消',
        onOk: save,
      });
      return;
    }

    await save();
  }

  function openTeamEdit(matchId: string) {
    const target = matchStore.matches.find((item) => item.id === matchId);
    if (!target) {
      return;
    }
    setTeamEditTargetId(matchId);
    teamEditForm.setFieldsValue({
      leftTeam: target.leftTeamName || undefined,
      rightTeam: target.rightTeamName || undefined,
    });
    setTeamEditOpen(true);
  }

  async function saveTeamEdit(values: { leftTeam?: string; rightTeam?: string }) {
    const matchId = teamEditTargetId;
    if (!matchId) {
      return;
    }
    const teamList = profiles?.teams ?? [];
    const leftTeamName = (values.leftTeam ?? '').trim();
    const rightTeamName = (values.rightTeam ?? '').trim();
    const leftTeam = leftTeamName ? teamList.find((team) => team.name === leftTeamName) : undefined;
    const rightTeam = rightTeamName ? teamList.find((team) => team.name === rightTeamName) : undefined;
    setTeamEditSaving(true);
    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState }>(`/api/matches/${encodeURIComponent(matchId)}`, {
        method: 'PATCH',
        json: {
          leftTeamName,
          leftTeamId: leftTeam?.id ?? '',
          rightTeamName,
          rightTeamId: rightTeam?.id ?? '',
        },
      });
      applyServerState({
        store: data.store,
        scoreboard: data.scoreboard,
      });
      setTeamEditOpen(false);
      message.success('战队已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTeamEditSaving(false);
    }
  }

  return (
    <>
      <CurrentMatchPanel
        match={match}
        variant={variant}
        avatars={isCurrent ? avatars : null}
        tournamentLocked={Boolean(match.tournamentRef && tournamentRecordMap.has(match.tournamentRef.tournamentId))}
        canUndo={availability.canUndo}
        canRedo={availability.canRedo}
        registerGate={cloudRegisterGate(match.id)}
        undoGate={cloudUndoGate(match.id)}
        avatarPreviewSrc={isCurrent ? getAvatarPreviewSrc : placeholderAvatarSrc}
        onUploadAvatar={(side, file) => void uploadAvatarFile(side, file)}
        onDeleteAvatar={(side) => void deleteAvatarFile(side)}
        onSaveMeta={(values) => void saveMatchMeta(match.id, values)}
        onOpenTeamEdit={() => openTeamEdit(match.id)}
        onAction={(action, extra) => void runMatchAction(match.id, action, extra)}
        rosterEditor={isCurrent && variant === 'drawer' ? rosterEditor : undefined}
      />
      <Modal
        title={activeMatch ? `战队修改：${activeMatch.leftPlayer || '左侧'} vs ${activeMatch.rightPlayer || '右侧'}` : '战队修改'}
        open={teamEditOpen}
        onCancel={() => setTeamEditOpen(false)}
        onOk={() => teamEditForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={teamEditSaving}
      >
        <Form
          form={teamEditForm}
          layout="vertical"
          onFinish={(values) => void saveTeamEdit(values)}
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Form.Item label="左侧所属战队（可选）" name="leftTeam">
                <AutoComplete
                  maxLength={40}
                  style={{ width: '100%' }}
                  placeholder="选择已录入战队复用，或手动输入"
                  options={(profiles?.teams ?? []).map((team) => ({ value: team.name, label: team.name }))}
                  filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="右侧所属战队（可选）" name="rightTeam">
                <AutoComplete
                  maxLength={40}
                  style={{ width: '100%' }}
                  placeholder="选择已录入战队复用，或手动输入"
                  options={(profiles?.teams ?? []).map((team) => ({ value: team.name, label: team.name }))}
                  filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                  allowClear
                />
              </Form.Item>
            </Col>
          </Row>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            选择「信息录入」中的战队会自动复用其 id（推流页 3 可展示战队 logo）；手动输入则仅记录战队名称。
          </Paragraph>
        </Form>
      </Modal>
    </>
  );
}
