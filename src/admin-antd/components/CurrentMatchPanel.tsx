import React, { useEffect } from 'react';
import { Button, Col, Form, Image, Input, Row, Select, Space, Steps, Tooltip, Typography, Upload } from 'antd';
import type { AvatarCollectionState, MatchRecord } from '../../../shared/types';
import { buildProgressItems, getCurrentGame } from '../lib/match';
import type { MatchFormValues, PanelSide } from '../types';

const { Text } = Typography;

/** 登记闸门结果（云同步未指派 / 已确认禁撤回时给出中文原因） */
export interface MatchActionGate {
  allowed: boolean;
  reason: string;
}

export interface CurrentMatchPanelProps {
  /** 目标对局（不一定等于当前比赛：系列比赛的 Drawer 可以操作非当前比赛） */
  match: MatchRecord;
  /**
   * 头像集合（服务端按当前比赛解析）。为 null = 该场不是当前比赛，
   * 推流头像不适用 → 隐藏更换/删除入口，只显示占位图与说明。
   */
  avatars: AvatarCollectionState | null;
  /** 系列赛对局：选手名与赛制由编排 / 档案决定，置灰只读 */
  tournamentLocked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  registerGate: MatchActionGate;
  undoGate: MatchActionGate;
  avatarPreviewSrc: (side: PanelSide) => string;
  onUploadAvatar: (side: PanelSide, file: File) => void;
  onDeleteAvatar: (side: PanelSide) => void;
  onSaveMeta: (values: MatchFormValues) => void;
  onOpenTeamEdit: () => void;
  onAction: (action: 'start' | 'undo' | 'redo' | 'winner', extra?: Record<string, unknown>) => void;
  /** 阵容编辑器插槽（仅当该场是当前比赛时由调用方注入；赛事面板仍放在卡片外） */
  rosterEditor?: React.ReactNode;
  /** drawer = 系列比赛 Drawer 内的紧凑单列布局 */
  variant?: 'inline' | 'drawer';
}

/**
 * 「当前比赛」面板：赛事面板（内联）与系列比赛 Drawer（弹窗）共用。
 *
 * 以传入的 match 为准（不再读全局 activeMatch），表单实例也归组件自己所有——
 * 两处挂载时不会争用同一个 Form；动作只回传 action，调接口留在 App（云闸门 / 提示统一在那里）。
 */
export function CurrentMatchPanel({
  match,
  avatars,
  tournamentLocked,
  canUndo,
  canRedo,
  registerGate,
  undoGate,
  avatarPreviewSrc,
  onUploadAvatar,
  onDeleteAvatar,
  onSaveMeta,
  onOpenTeamEdit,
  onAction,
  rosterEditor,
  variant = 'inline',
}: CurrentMatchPanelProps): React.ReactElement {
  const [matchForm] = Form.useForm<MatchFormValues>();
  const currentGame = getCurrentGame(match);
  const progress = buildProgressItems(match);

  // 换一场就重填表单（原来在 Dashboard 里按 activeMatch 做，现在跟着本组件自己的目标走）
  useEffect(() => {
    matchForm.setFieldsValue({
      leftPlayer: match.leftPlayer,
      rightPlayer: match.rightPlayer,
      leftRank: match.leftRank,
      rightRank: match.rightRank,
      bestOf: match.bestOf,
    });
  }, [match.id, match.leftPlayer, match.rightPlayer, match.leftRank, match.rightRank, match.bestOf, matchForm]);

  const canStart = Boolean(
    match.status !== 'completed'
    && currentGame
    && currentGame.status === 'pending'
    && currentGame.leftLineup.length > 0
    && currentGame.rightLineup.length > 0,
  );
  const canRegister = Boolean(match.status !== 'completed' && currentGame?.status === 'in_progress');
  // 头像不可用时（非当前比赛）也给一句解释，避免以为「这场比赛没上传头像」
  const avatarTooltip = '头像按当前比赛存储：把这场设为当前比赛后才能更换';

  function renderPlayerBlock(side: PanelSide) {
    const avatar = avatars?.[side] ?? null;
    const name = side === 'left' ? match.leftPlayer : match.rightPlayer;
    const avatarNode = (
      <div className="player-avatar-wrap">
        <Upload
          showUploadList={false}
          disabled={!avatar}
          beforeUpload={(file) => {
            onUploadAvatar(side, file as File);
            return false;
          }}
        >
          <div className="player-avatar-circular current-match-player-avatar">
            <Image preview={false} src={avatarPreviewSrc(side)} alt={`${side === 'left' ? '左' : '右'}侧选手头像`} />
            {avatar ? <span className="player-avatar-hint">更换</span> : null}
          </div>
        </Upload>
        {avatar?.exists ? (
          <Button
            className="player-avatar-delete"
            size="small"
            danger
            onClick={(event) => {
              event.stopPropagation();
              onDeleteAvatar(side);
            }}
          >
            删除
          </Button>
        ) : null}
      </div>
    );
    return (
      <div className={`current-match-player current-match-player-${side}`}>
        {avatar ? avatarNode : <Tooltip title={avatarTooltip}>{avatarNode}</Tooltip>}
        <Text strong className={`current-match-player-name current-match-player-name-${side}`}>
          {name || '未设置'}
        </Text>
      </div>
    );
  }

  return (
    <Space
      direction="vertical"
      size={18}
      className={`page-stack current-match-panel${variant === 'drawer' ? ' current-match-panel-drawer' : ''}`}
    >
      <div className="current-match-overview">
        {renderPlayerBlock('left')}
        <div className="current-match-score-block">
          <Text type="secondary" className="current-match-score-label">当前比分</Text>
          <div
            className="current-match-score-card"
            aria-label={`当前比分 ${match.leftScore} 比 ${match.rightScore}`}
          >
            <div className="current-match-scoreline">
              <span className="current-match-score-value">{match.leftScore}</span>
              <span className="current-match-score-separator">:</span>
              <span className="current-match-score-value">{match.rightScore}</span>
            </div>
          </div>
          <Text type="secondary" className="current-match-meta">
            BO{match.bestOf} · {currentGame ? `第 ${currentGame.gameNumber} 局` : '暂无对局'}
          </Text>
        </div>
        {renderPlayerBlock('right')}
      </div>

      <div className="current-match-statusbar">
        <Steps current={progress.current} items={progress.items} responsive />
      </div>

      <Form
        form={matchForm}
        layout="vertical"
        className="current-match-form"
        onFinish={(values) => onSaveMeta(values)}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} md={10}>
            <Row gutter={8} wrap={false} className="current-match-player-inputs">
              <Col flex="auto" style={{ minWidth: 0 }}>
                <Form.Item label="左侧选手" name="leftPlayer">
                  <Input maxLength={32} placeholder="输入左侧选手名字" disabled={tournamentLocked} />
                </Form.Item>
              </Col>
              <Col flex="112px">
                <Form.Item
                  label="排位排名"
                  name="leftRank"
                  getValueFromEvent={(event: React.ChangeEvent<HTMLInputElement>) => event.target.value.replace(/\D/g, '')}
                >
                  <Input maxLength={10} inputMode="numeric" placeholder="仅数字" />
                </Form.Item>
              </Col>
            </Row>
          </Col>
          <Col xs={24} md={10}>
            <Row gutter={8} wrap={false} className="current-match-player-inputs">
              <Col flex="auto" style={{ minWidth: 0 }}>
                <Form.Item label="右侧选手" name="rightPlayer">
                  <Input maxLength={32} placeholder="输入右侧选手名字" disabled={tournamentLocked} />
                </Form.Item>
              </Col>
              <Col flex="112px">
                <Form.Item
                  label="排位排名"
                  name="rightRank"
                  getValueFromEvent={(event: React.ChangeEvent<HTMLInputElement>) => event.target.value.replace(/\D/g, '')}
                >
                  <Input maxLength={10} inputMode="numeric" placeholder="仅数字" />
                </Form.Item>
              </Col>
            </Row>
          </Col>
          <Col xs={24} md={4}>
            <Form.Item label="比赛赛制" name="bestOf">
              <Select
                style={{ width: '100%' }}
                disabled={tournamentLocked}
                options={[
                  { value: 1, label: 'BO1' },
                  { value: 3, label: 'BO3' },
                  { value: 5, label: 'BO5' },
                  { value: 7, label: 'BO7' },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>
        {tournamentLocked ? (
          <Text type="secondary" className="current-match-meta">
            这是系列赛对局：选手名与赛制由编排决定（登记胜负时按选手名写回对阵图），此处不可修改。
            需要改选手名请到「信息录入」，改赛制请在系列赛的阶段规则里调整；战队与排位排名仍可保存。
          </Text>
        ) : null}
        <div className="current-match-action-row">
          <Space wrap size={12} className="current-match-action-group">
            <Button type="primary" onClick={() => onAction('start')} disabled={!canStart}>
              开始本次对局
            </Button>
            <Button type="dashed" onClick={onOpenTeamEdit}>战队修改</Button>
            <Button htmlType="submit">保存比赛信息</Button>
          </Space>
          <Space wrap size={12} className="current-match-action-group current-match-action-group-right">
            <Tooltip title={registerGate.reason}>
              <span>
                <Button
                  type="dashed"
                  onClick={() => onAction('winner', { winner: 'left' })}
                  disabled={!canRegister || !registerGate.allowed}
                >
                  左侧赢了
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={registerGate.reason}>
              <span>
                <Button
                  type="dashed"
                  onClick={() => onAction('winner', { winner: 'right' })}
                  disabled={!canRegister || !registerGate.allowed}
                >
                  右侧赢了
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={undoGate.reason}>
              <span>
                <Button onClick={() => onAction('undo')} disabled={!canUndo || !undoGate.allowed}>
                  撤回上一步
                </Button>
              </span>
            </Tooltip>
            <Button onClick={() => onAction('redo')} disabled={!canRedo}>取消撤回</Button>
          </Space>
        </div>
      </Form>

      {rosterEditor}
    </Space>
  );
}

export default CurrentMatchPanel;
