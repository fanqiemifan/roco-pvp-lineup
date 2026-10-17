import React, { type Dispatch, type SetStateAction } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Input,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type {
  CloudSyncAckSource,
  CloudSyncKeyGuardResult,
  CloudSyncRole,
  CloudSyncRosterEntry,
  CloudSyncStatus,
  MatchRecord,
  SyncConflictMode,
  SyncImportAction,
  SyncImportItem,
  SyncImportItemKind,
  SyncImportPreview,
  SyncImportTournamentGroup,
  TournamentRecord,
} from '../../../shared/types';
import { formatDateTime } from '../lib/format';
import { formatStageRoundLabel } from '../lib/tournament';
import { EmptyState } from '../ui/EmptyState';
import { Hint } from '../ui/Hint';
import { MatchStatusTag } from '../ui/StatusTag';
import { MODAL_WIDTH } from '../ui/modal';
import { Surface } from '../ui/Surface';

const { Text } = Typography;

type SyncPreviewRow = SyncImportItem | (SyncImportTournamentGroup & { isGroup: true; rowKey: string });

/**
 * 数据同步视图（从 App.tsx 的 Dashboard 中拆出的第一个视图）。
 *
 * 这里是「展示层拆分」：状态与处理函数仍留在 Dashboard，通过 scope 传入。
 * 这样拆的好处是行为零改动、可逐步迁移；代价是 scope 字段偏多，下一步会把
 * 仅本视图使用的状态/处理函数搬进本文件，scope 会缩到十几个共享依赖。
 */
export interface SyncViewScope {
  applyCloudPreview: () => Promise<void>;
  applySyncPreview: () => Promise<void>;
  checkCloudInbox: (code?: string) => Promise<void>;
  clearRememberedExclusions: () => Promise<void>;
  closeCloudPreview: () => void;
  closeSyncPreview: () => void;
  cloudAckCode: string;
  cloudAckSource: CloudSyncAckSource | null;
  cloudAckSources: CloudSyncAckSource[];
  cloudAssignDraft: Record<string, string>;
  cloudAssignMatches: MatchRecord[];
  cloudAssignOpen: boolean;
  cloudAssignPeers: CloudSyncRosterEntry[];
  cloudAssignWaveGroups: { key: string; label: string; matchIds: string[]; }[];
  cloudBusy: "" | "push" | "pull" | "upload" | "check" | "apply" | "assignment" | "poll";
  cloudDistInfo: string;
  cloudInboxCount: number;
  cloudKeyDraft: string;
  cloudLabelDraft: string;
  cloudLiveBadge: string;
  cloudMachineText: (entry: { code: string; label: string; }) => string;
  cloudPeerDraft: string;
  cloudPreviewFlow: "pull" | "incoming" | null;
  cloudPullNothingToMerge: boolean;
  cloudRoleDraft: CloudSyncRole;
  cloudRoomGuard: { action: "save" | "test"; guard: CloudSyncKeyGuardResult; } | null;
  cloudSaving: boolean;
  cloudStatus: CloudSyncStatus | null;
  cloudSyncState: { tone: "idle"; label: string; hint: string; } | { tone: "main"; label: string; hint: string; } | { tone: "warn"; label: string; hint: string; } | { tone: "ok"; label: string; hint: string; };
  cloudTesting: boolean;
  cloudTimeline: { key: string; label: string; at: string; }[];
  cloudTodo: { count: number; label: string; hint: string; };
  cloudTokenDraft: string;
  cloudVersionText: string;
  cloudWorkerUrlDraft: string;
  exportSyncBundle: () => Promise<void>;
  handleSyncFile: (file: File) => void;
  loadSyncPreview: (file: File, mode: SyncConflictMode) => Promise<void>;
  machineCodeInput: string;
  machineCodeSaving: boolean;
  markCloudPullReviewed: () => Promise<void>;
  openCloudAssign: () => void;
  pollCloudStatus: (silent?: boolean) => Promise<void>;
  pullCloudBundle: () => Promise<void>;
  pushCloudBundle: () => Promise<void>;
  rejectCloudInbox: () => Promise<void>;
  resolveCloudRoomGuard: (cloudStateAction: "reset" | "keep") => void;
  resolveSyncConflicts: (accept: boolean) => void;
  saveCloudAssignDraft: () => Promise<void>;
  saveCloudSettings: (cloudStateAction?: "reset" | "keep") => Promise<void>;
  saveMachineCode: (confirmChange?: boolean) => Promise<void>;
  setCloudAssignDraft: Dispatch<SetStateAction<Record<string, string>>>;
  setCloudAssignOpen: Dispatch<SetStateAction<boolean>>;
  setCloudKeyDraft: Dispatch<SetStateAction<string>>;
  setCloudLabelDraft: Dispatch<SetStateAction<string>>;
  setCloudPeerDraft: Dispatch<SetStateAction<string>>;
  setCloudRoleDraft: Dispatch<SetStateAction<CloudSyncRole>>;
  setCloudRoomGuard: Dispatch<SetStateAction<{ action: "save" | "test"; guard: CloudSyncKeyGuardResult; } | null>>;
  setCloudTokenDraft: Dispatch<SetStateAction<string>>;
  setCloudWorkerUrlDraft: Dispatch<SetStateAction<string>>;
  setMachineCodeInput: Dispatch<SetStateAction<string>>;
  setSyncActiveKey: Dispatch<SetStateAction<string | null>>;
  setSyncCollapsedGroupKeys: Dispatch<SetStateAction<string[]>>;
  setSyncExportInclAvatars: Dispatch<SetStateAction<boolean>>;
  setSyncExportInclProfiles: Dispatch<SetStateAction<boolean>>;
  setSyncIncludeAvatars: Dispatch<SetStateAction<boolean>>;
  setSyncMode: Dispatch<SetStateAction<SyncConflictMode>>;
  setSyncOverwriteAvatars: Dispatch<SetStateAction<boolean>>;
  setSyncSelectedKeys: Dispatch<SetStateAction<string[]>>;
  switchCloudAckSource: (code: string) => Promise<void>;
  SYNC_ACTION_LABELS: Record<SyncImportAction, string>;
  SYNC_KIND_LABELS: Record<SyncImportItemKind, string>;
  syncActiveItem: SyncImportItem | null;
  syncActiveKey: string | null;
  syncCollapsedGroupKeys: string[];
  syncConflictCount: number;
  syncExcludedMatchKeys: Set<string>;
  syncExcludedTournamentIds: string[];
  syncExportInclAvatars: boolean;
  syncExportInclProfiles: boolean;
  syncExporting: boolean;
  syncFile: File | null;
  syncGroupOfMatchKey: Map<string, SyncImportTournamentGroup>;
  syncImporting: boolean;
  syncIncludeAvatars: boolean;
  syncMatchActionCounts: Record<SyncImportAction, number>;
  syncMatchRows: SyncImportItem[];
  syncMode: SyncConflictMode;
  syncOverwriteAvatars: boolean;
  syncPreview: SyncImportPreview | null;
  syncPreviewLoading: boolean;
  syncPreviewNotes: string[];
  syncPreviewRows: (SyncImportItem | (SyncImportTournamentGroup & { isGroup: true; rowKey: string; }))[];
  syncSelectedKeys: string[];
  testCloudWorker: (cloudStateAction?: "reset" | "keep") => Promise<void>;
  toggleSyncTournamentGroup: (group: SyncImportTournamentGroup) => void;
  tournamentNameMap: Map<string, string>;
  tournamentRecordMap: Map<string, TournamentRecord>;
  uploadCloudResults: () => Promise<void>;
}

export function SyncView({ scope }: { scope: SyncViewScope }) {
  const {
    applyCloudPreview,
    applySyncPreview,
    checkCloudInbox,
    clearRememberedExclusions,
    closeCloudPreview,
    closeSyncPreview,
    cloudAckCode,
    cloudAckSource,
    cloudAckSources,
    cloudAssignDraft,
    cloudAssignMatches,
    cloudAssignOpen,
    cloudAssignPeers,
    cloudAssignWaveGroups,
    cloudBusy,
    cloudDistInfo,
    cloudInboxCount,
    cloudKeyDraft,
    cloudLabelDraft,
    cloudLiveBadge,
    cloudMachineText,
    cloudPeerDraft,
    cloudPreviewFlow,
    cloudPullNothingToMerge,
    cloudRoleDraft,
    cloudRoomGuard,
    cloudSaving,
    cloudStatus,
    cloudSyncState,
    cloudTesting,
    cloudTimeline,
    cloudTodo,
    cloudTokenDraft,
    cloudVersionText,
    cloudWorkerUrlDraft,
    exportSyncBundle,
    handleSyncFile,
    loadSyncPreview,
    machineCodeInput,
    machineCodeSaving,
    markCloudPullReviewed,
    openCloudAssign,
    pollCloudStatus,
    pullCloudBundle,
    pushCloudBundle,
    rejectCloudInbox,
    resolveCloudRoomGuard,
    resolveSyncConflicts,
    saveCloudAssignDraft,
    saveCloudSettings,
    saveMachineCode,
    setCloudAssignDraft,
    setCloudAssignOpen,
    setCloudKeyDraft,
    setCloudLabelDraft,
    setCloudPeerDraft,
    setCloudRoleDraft,
    setCloudRoomGuard,
    setCloudTokenDraft,
    setCloudWorkerUrlDraft,
    setMachineCodeInput,
    setSyncActiveKey,
    setSyncCollapsedGroupKeys,
    setSyncExportInclAvatars,
    setSyncExportInclProfiles,
    setSyncIncludeAvatars,
    setSyncMode,
    setSyncOverwriteAvatars,
    setSyncSelectedKeys,
    switchCloudAckSource,
    SYNC_ACTION_LABELS,
    SYNC_KIND_LABELS,
    syncActiveItem,
    syncActiveKey,
    syncCollapsedGroupKeys,
    syncConflictCount,
    syncExcludedMatchKeys,
    syncExcludedTournamentIds,
    syncExportInclAvatars,
    syncExportInclProfiles,
    syncExporting,
    syncFile,
    syncGroupOfMatchKey,
    syncImporting,
    syncIncludeAvatars,
    syncMatchActionCounts,
    syncMatchRows,
    syncMode,
    syncOverwriteAvatars,
    syncPreview,
    syncPreviewLoading,
    syncPreviewNotes,
    syncPreviewRows,
    syncSelectedKeys,
    testCloudWorker,
    toggleSyncTournamentGroup,
    tournamentNameMap,
    tournamentRecordMap,
    uploadCloudResults,
  } = scope;
  return (
            <Space direction="vertical" size={18} className="page-stack">
              <Card
                size="small"
                className="sync-card"
                title={(
                  <Space size={8} align="center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#c7632f" aria-hidden="true">
                      <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
                    </svg>
                    <span>数据同步</span>
                  </Space>
                )}
              >
                <div className="sync-card-row">
                  <div className="sync-card-label">本机标识</div>
                  <div className="sync-card-content">
                    <Space size={10} align="center">
                      <Input
                        value={machineCodeInput}
                        onChange={(event) => setMachineCodeInput(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))}
                        placeholder="A"
                        maxLength={2}
                        style={{ width: 96 }}
                      />
                      <Button onClick={() => void saveMachineCode()} loading={machineCodeSaving}>保存标识</Button>
                    </Space>
                    <div className="sync-card-hint">
                      新比赛编号形如 <Text code>20260928_A001</Text>；两台请分别设为 <Text strong>A / B</Text>，未设置则沿用旧编号
                    </div>
                  </div>
                </div>

                <Divider className="sync-card-divider" />

                <div className="sync-card-row">
                  <div className="sync-card-label">导出同步包</div>
                  <div className="sync-card-content">
                    <div className="sync-export-bar">
                      <Space size={12} align="center">
                        <Checkbox
                          className="sync-check-card"
                          checked={syncExportInclProfiles}
                          onChange={(event) => setSyncExportInclProfiles(event.target.checked)}
                        >
                          包含选手 / 战队档案
                        </Checkbox>
                        <Checkbox
                          className="sync-check-card"
                          checked={syncExportInclAvatars}
                          disabled={!syncExportInclProfiles}
                          onChange={(event) => setSyncExportInclAvatars(event.target.checked)}
                        >
                          包含头像与 logo
                        </Checkbox>
                      </Space>
                      <Button type="primary" onClick={() => void exportSyncBundle()} loading={syncExporting}>导出同步包</Button>
                    </div>
                    <div className="sync-card-hint">赛前可把包发给另一台机器导入，做「基线分发」；同一场比赛不要在两台机器分别创建</div>
                  </div>
                </div>

                <Divider className="sync-card-divider" />

                <div className="sync-card-row">
                  <div className="sync-card-label">导入同步包</div>
                  <div className="sync-card-content">
                    <Upload
                      accept=".json,application/json"
                      showUploadList={false}
                      beforeUpload={(file) => {
                        handleSyncFile(file as File);
                        return false;
                      }}
                    >
                      <Button loading={syncPreviewLoading}>选择同步包并预览</Button>
                    </Upload>
                    <div className="sync-card-hint">
                      先预览
                      <Tag color="success" bordered={false}>新增</Tag>
                      <Tag color="warning" bordered={false}>更新</Tag>
                      <Tag bordered={false}>跳过</Tag>
                      ，确认后才写入；重复导入同一包不会有副作用
                    </div>
                  </div>
                </div>

                <Divider className="sync-card-divider" />

                {/* === 云同步（点击式）：主控「同步分发 / 检查回传 / 确认台」+ 分控「同步最新 / 回传」 === */}
                <div className="sync-card-row sync-card-row-cloud">
                  <div className="sync-card-label">
                    云同步
                    {cloudLiveBadge ? <span className="cloud-sync-badge">{cloudLiveBadge}</span> : null}
                  </div>
                  <div className="sync-card-content">
                    <div className="sync-card-hint" style={{ marginTop: 0, marginBottom: 10 }}>
                      <b>这是做什么的：</b>多台电脑各管一段赛程时用的。一台电脑（主控）负责抽签、编排、确认赛果；
                      其他电脑（分控）负责现场登记比分。登记完点一下就能互相传过去，不用再导文件、发群聊。
                    </div>
                    <Space size={12} wrap align="center">
                      <span className="cloud-sync-role-tag">
                        {cloudRoleDraft === 'main'
                          ? '当前身份：主控电脑（编排 + 确认赛果）'
                          : '当前身份：分控电脑（现场登记赛果）'}
                      </span>
                      <Radio.Group
                        value={cloudRoleDraft}
                        optionType="button"
                        buttonStyle="solid"
                        options={[
                          { label: '主控电脑', value: 'main' },
                          { label: '分控电脑', value: 'sub' },
                        ]}
                        onChange={(event) => setCloudRoleDraft(event.target.value as CloudSyncRole)}
                      />
                      <Button onClick={() => void testCloudWorker()} loading={cloudTesting}>测试能否连上云端</Button>
                      <Button onClick={() => void saveCloudSettings()} loading={cloudSaving}>保存设置</Button>
                      <Button onClick={() => void pollCloudStatus(false)} loading={cloudBusy === 'poll'}>刷新同步状态</Button>
                    </Space>

                    <Row gutter={[12, 8]} className="cloud-sync-fields">
                      <Col xs={24} md={12} xl={6}>
                        <Input.Password
                          value={cloudWorkerUrlDraft}
                          onChange={(event) => setCloudWorkerUrlDraft(event.target.value)}
                          placeholder="https://roco-sync.xxx.workers.dev"
                          addonBefore="服务地址"
                        />
                      </Col>
                      <Col xs={24} md={12} xl={6}>
                        <Input
                          value={cloudKeyDraft}
                          onChange={(event) => setCloudKeyDraft(event.target.value)}
                          placeholder="一组人填一样的，比如 luoke-8yue"
                          addonBefore="房间号"
                        />
                      </Col>
                      <Col xs={24} md={12} xl={6}>
                        <Input.Password
                          value={cloudTokenDraft}
                          onChange={(event) => setCloudTokenDraft(event.target.value)}
                          placeholder="主办方发给你的，两端一致"
                          addonBefore="通行证"
                        />
                      </Col>
                      <Col xs={12} md={6} xl={3}>
                        <Input
                          value={cloudLabelDraft}
                          onChange={(event) => setCloudLabelDraft(event.target.value)}
                          placeholder="如 主播机"
                          maxLength={16}
                          addonBefore="备注名"
                        />
                      </Col>
                      <Col xs={12} md={6} xl={3}>
                        {cloudRoleDraft === 'main' ? (
                          <Input
                            value={cloudPeerDraft}
                            onChange={(event) => setCloudPeerDraft(event.target.value)}
                            placeholder="如 B、C"
                            addonBefore="对方机器码"
                          />
                        ) : null}
                      </Col>
                    </Row>

                    <div className="sync-card-hint">
                      <b>怎么填：</b>主办方（主控电脑）把「服务地址 / 房间号 / 通行证」发给其他电脑，三样照抄，
                      再把角色选成<b>分控电脑</b>、本机标识（卡片最上面那个字母）改成<b>和别人不重复</b>的即可。
                      「服务地址 / 通行证 / 备注名」填一次就存下来了，换比赛不用再填；只有「房间号」和角色是每场赛事确认一下
                      （换房间号时会问一次：本机旧房间的同步记录要不要重置）。
                    </div>
                    <div className="sync-card-hint">
                      <b>为什么要互不相同：</b>同一组人里两台电脑的「本机标识」必须不一样（比如 A / B），
                      否则两边会互相覆盖数据、比赛编号也会撞车。
                      <span className="cloud-sync-tech">（技术名：服务地址 = workerUrl，房间号 = syncKey，通行证 = SYNC_TOKEN）</span>
                    </div>

                    {/* 同步状态卡：一眼看清「云端是哪一版 / 本机是不是最新 / 有没有待办 / 本机都做过什么」 */}
                    {cloudStatus?.configured ? (
                      <div className="cloud-sync-status">
                        <div className="cloud-sync-status-head">
                          <Space size={8} align="center">
                            <span className={`cloud-sync-dot cloud-sync-dot-${cloudSyncState.tone}`} />
                            <Text strong>{cloudSyncState.label}</Text>
                            {cloudSyncState.hint ? (
                              <Text type="secondary" className="cloud-sync-status-note">{cloudSyncState.hint}</Text>
                            ) : null}
                          </Space>
                          {cloudTodo.count > 0 ? <Tag color="orange">{cloudTodo.label}</Tag> : <Tag>{cloudTodo.label}</Tag>}
                        </div>

                        <div className="cloud-sync-status-grid">
                          <div className="cloud-sync-tile">
                            <div className="cloud-sync-tile-label">云端最新</div>
                            {cloudStatus.version ? (
                              <>
                                <div className="cloud-sync-tile-value">
                                  第 {cloudStatus.version.v} 版
                                  <span className="cloud-sync-tile-sub">{formatDateTime(cloudStatus.version.at)}</span>
                                </div>
                                <div className="cloud-sync-tile-hint">
                                  {cloudStatus.version.from
                                    ? `由 ${cloudMachineText(
                                      cloudStatus.roster.find((entry) => entry.code === cloudStatus.version!.from)
                                      ?? { code: cloudStatus.version.from, label: '' },
                                    )} 上传`
                                    : ''}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="cloud-sync-tile-value">暂无内容</div>
                                <div className="cloud-sync-tile-hint">等主控电脑点「上传给其他电脑」</div>
                              </>
                            )}
                          </div>

                          <div className="cloud-sync-tile">
                            <div className="cloud-sync-tile-label">本机进度</div>
                            <div className="cloud-sync-tile-value">
                              {cloudStatus.appliedVersion ? `已处理第 ${cloudStatus.appliedVersion} 版` : '尚未获取'}
                            </div>
                            <div className="cloud-sync-tile-hint">
                              {cloudStatus.config.role === 'main'
                                ? '主控电脑不需要拉取'
                                : cloudSyncState.tone === 'ok' ? '已是最新' : '有新内容时点「从云端获取最新」'}
                            </div>
                          </div>

                          <div className="cloud-sync-tile">
                            <div className="cloud-sync-tile-label">本机待办</div>
                            <div className="cloud-sync-tile-value">{cloudTodo.label}</div>
                            <div className="cloud-sync-tile-hint">{cloudTodo.hint}</div>
                          </div>
                        </div>

                        <div className="cloud-sync-status-foot">
                          {cloudTimeline.length ? (
                            <>
                              <Text type="secondary" className="cloud-sync-foot-title">本机记录</Text>
                              <Space size={14} wrap>
                                {cloudTimeline.map((item) => (
                                  <span key={item.key} className="cloud-sync-foot-item">
                                    <span className="cloud-sync-foot-label">{item.label}</span>
                                    <span className="cloud-sync-foot-time">{formatDateTime(item.at)}</span>
                                  </span>
                                ))}
                              </Space>
                            </>
                          ) : (
                            <Text type="secondary">还没有同步记录：主控点「上传给其他电脑」、分控点「从云端获取最新」都会记在这里</Text>
                          )}
                          {cloudStatus.config.pollEnabled === false ? (
                            <Text type="secondary">· 已关闭自动检查新内容（手动点「刷新同步状态」不受影响）</Text>
                          ) : null}
                        </div>
                        <div className="cloud-sync-status-tip">
                          云端有半分钟左右的延迟是正常的：刚上传完，另一台电脑可能要等 30 秒才能拉到新内容，等一会儿再点，别连续点。
                        </div>
                      </div>
                    ) : null}

                    {cloudStatus?.lastError ? (
                      <Alert
                        type="warning"
                        showIcon
                        className="cloud-sync-alert"
                        message={cloudStatus.lastError}
                      />
                    ) : null}

                    {cloudStatus?.configured ? (
                      cloudRoleDraft === 'main' ? (
                        <Space size={10} wrap align="center" className="cloud-sync-actions">
                          <Button type="primary" onClick={() => void pushCloudBundle()} loading={cloudBusy === 'push'}>
                            上传给其他电脑
                          </Button>
                          <Button
                            onClick={() => void checkCloudInbox()}
                            loading={cloudBusy === 'check'}
                          >
                            🔔 查看其他电脑交回的赛果{cloudInboxCount > 0 ? `（${cloudInboxCount}）` : ''}
                          </Button>
                          <Button onClick={openCloudAssign}>安排由哪台电脑登记…</Button>
                          <Text type="secondary" className="cloud-sync-status-text">
                            {cloudDistInfo || '还没有上传过'}
                            {cloudAckSources.length
                              ? ` · 还有 ${cloudAckSources.length} 台电脑的赛果等着确认`
                              : ''}
                          </Text>
                        </Space>
                      ) : (
                        <Space size={10} wrap align="center" className="cloud-sync-actions">
                          <Button type="primary" onClick={() => void pullCloudBundle()} loading={cloudBusy === 'pull'}>
                            从云端获取最新
                          </Button>
                          <Button
                            onClick={() => void uploadCloudResults()}
                            loading={cloudBusy === 'upload'}
                            disabled={!cloudStatus.pending.count}
                          >
                            交回赛果{cloudStatus.pending.count ? `（${cloudStatus.pending.count} 场）` : ''}
                          </Button>
                          <Text type="secondary" className="cloud-sync-status-text">
                            {cloudVersionText}
                          </Text>
                        </Space>
                      )
                    ) : (
                      <Text type="secondary">
                        把上面的「服务地址 / 房间号 / 通行证」填好、本机标识设好，就能用了。先点「测试能否连上云端」确认网络通不通。
                      </Text>
                    )}

                    {cloudStatus?.configured ? (
                      <div className="sync-card-hint">
                        {cloudRoleDraft === 'main'
                          ? '点「上传给其他电脑」把赛事资料发到云端；对方在别处登记完赛果后点「交回赛果」，你点「查看其他电脑交回的赛果」逐场确认，确认后自动写进系列赛并推进下一轮。'
                          : `本机可选登记并交回的赛果：${cloudStatus?.pending.count ?? 0} 场${cloudStatus?.pending.ackedAt ? `（上次被确认 ${formatDateTime(cloudStatus.pending.ackedAt)}）` : ''}；只有主控电脑安排给本机的比赛才能登记，其余比赛登记按钮是灰的。`}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>

              {/* 换房间守卫：房间号变了且本机还留着旧房间的同步状态时必须显式选一项，别默默带过去 */}
              <Modal
                title="房间号变了：本机旧房间的同步状态怎么处理？"
                open={Boolean(cloudRoomGuard)}
                onCancel={() => setCloudRoomGuard(null)}
                footer={(
                  <Space>
                    <Button onClick={() => setCloudRoomGuard(null)}>先不改了</Button>
                    <Button onClick={() => resolveCloudRoomGuard('keep')} loading={cloudSaving || cloudTesting}>
                      保留旧状态，继续
                    </Button>
                    <Button
                      type="primary"
                      onClick={() => resolveCloudRoomGuard('reset')}
                      loading={cloudSaving || cloudTesting}
                    >
                      重置旧状态，继续
                    </Button>
                  </Space>
                )}
              >
                {cloudRoomGuard ? (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Alert type="warning" showIcon message={cloudRoomGuard.guard.message} />
                    <div className="sync-card-hint">
                      <b>重置</b>＝ 清掉上面这些旧房间记录（换赛事、换一组人时选它）；
                      <b>保留</b>＝ 只是改正房间号里的错字、数据其实还在同一个房间时选它。
                    </div>
                  </Space>
                ) : null}
              </Modal>

              <Modal
                title={cloudPreviewFlow === 'pull'
                  ? '从云端获取 · 请确认要写入本机的内容'
                  : cloudPreviewFlow === 'incoming'
                    ? `${cloudAckCode} 号机交回的赛果 · 请确认`
                    : '导入同步包预览'}
                open={Boolean(syncPreview)}
                width="min(1440px, 94vw)"
                style={{ top: 24 }}
                className="sync-preview-modal"
                onCancel={() => {
                  if (cloudPreviewFlow) {
                    closeCloudPreview();
                    return;
                  }
                  closeSyncPreview();
                }}
                footer={cloudPreviewFlow === 'incoming' ? (
                  <Space>
                    <Button onClick={() => closeCloudPreview()}>稍后再看</Button>
                    <Button danger onClick={() => void rejectCloudInbox()} loading={cloudBusy === 'apply'}>
                      退回，让对方重填
                    </Button>
                    <Button
                      type="primary"
                      onClick={() => void applyCloudPreview()}
                      loading={cloudBusy === 'apply'}
                      disabled={!syncPreview || syncSelectedKeys.length === 0}
                    >
                      确认这 {syncSelectedKeys.length} 场
                    </Button>
                  </Space>
                ) : cloudPullNothingToMerge ? (
                  <Button
                    type="primary"
                    onClick={() => void markCloudPullReviewed()}
                    loading={cloudBusy === 'apply'}
                  >
                    知道了，标记为已处理
                  </Button>
                ) : undefined}
                okText={cloudPreviewFlow === 'pull'
                  ? `确认写入本机（${syncSelectedKeys.length} 项）`
                  : `确认导入（${syncSelectedKeys.length} 项）`}
                okButtonProps={{
                  disabled: !syncPreview || syncSelectedKeys.length === 0,
                  style: cloudPreviewFlow === 'incoming' || cloudPullNothingToMerge ? { display: 'none' } : undefined,
                }}
                cancelButtonProps={{ style: cloudPreviewFlow === 'incoming' ? { display: 'none' } : undefined }}
                confirmLoading={cloudPreviewFlow ? cloudBusy === 'apply' : syncImporting}
                onOk={() => {
                  if (cloudPreviewFlow) {
                    void applyCloudPreview();
                    return;
                  }
                  void applySyncPreview();
                }}
              >
                {syncPreview ? (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {cloudPreviewFlow === 'incoming' ? (
                      <Space wrap align="center" size={10}>
                        <Text strong>哪台电脑交回的</Text>
                        <Select
                          value={cloudAckCode}
                          style={{ minWidth: 200 }}
                          options={cloudAckSources.map((source) => ({
                            value: source.code,
                            label: `${source.label ? `${source.label} · ` : ''}${source.code} 号机（${source.items.length} 场）`,
                          }))}
                          onChange={(value) => void switchCloudAckSource(value)}
                        />
                        {cloudAckSource ? (
                          <Text type="secondary">
                            交回时间 {formatDateTime(cloudAckSource.submittedAt)}；确认后写入本机、自动安排下一轮，并通知对方已收到
                          </Text>
                        ) : null}
                      </Space>
                    ) : null}

                    {cloudPullNothingToMerge ? (
                      <Alert
                        type="success"
                        showIcon
                        message="云端这一版的内容本机已经是最新的，没有需要写入的东西"
                        description="点下面的「知道了，标记为已处理」清掉红点即可；如果确实期待有新内容，等半分钟后再点一次「从云端获取最新」。"
                      />
                    ) : null}

                    {syncPreview.sameMachine ? (
                      <Alert
                        type="warning"
                        showIcon
                        message={syncPreview.meta.machine
                          ? `这份数据来自与本机相同标识（${syncPreview.meta.machine}）的电脑，可能互相覆盖，请核对后再导入`
                          : '这份数据没有机器标识，比赛编号可能和本机撞车，建议每台电脑都设一个不同的本机标识（如 A / B）'}
                      />
                    ) : null}

                    {syncConflictCount > 0 ? (
                      <Alert
                        type="warning"
                        showIcon
                        message={`检测到 ${syncConflictCount} 场比赛两台机器都登记过（内容不同），请逐条确认保留哪一边`}
                        action={(
                          <Space>
                            <Button size="small" onClick={() => resolveSyncConflicts(false)}>冲突全部保留本机</Button>
                            <Button size="small" type="primary" onClick={() => resolveSyncConflicts(true)}>冲突全部用包内覆盖</Button>
                          </Space>
                        )}
                      />
                    ) : null}

                    {/* 第一行：选项（冲突处理模式 + 带不带头像）并成一行，不再各占一行 */}
                    {cloudPreviewFlow === 'incoming' ? null : (
                      <Space wrap align="center" size={14} className="sync-preview-options">
                        <Space size={8} align="center">
                          <Text type="secondary">同一场都有内容时</Text>
                          <Radio.Group
                            value={syncMode}
                            optionType="button"
                            buttonStyle="solid"
                            size="small"
                            options={[
                              { label: '保留更新的', value: 'newer' },
                              { label: '以这份为准', value: 'bundle' },
                            ]}
                            onChange={(event) => {
                              const nextMode = event.target.value as SyncConflictMode;
                              setSyncMode(nextMode);
                              if (syncFile) {
                                void loadSyncPreview(syncFile, nextMode);
                              }
                            }}
                          />
                        </Space>
                        <Checkbox checked={syncIncludeAvatars} onChange={(event) => setSyncIncludeAvatars(event.target.checked)}>
                          缺失头像 / logo 一并补缺（{syncPreview.avatars.players.fill + syncPreview.avatars.teams.fill} 张）
                        </Checkbox>
                        <Checkbox
                          checked={syncOverwriteAvatars}
                          disabled={!syncIncludeAvatars}
                          onChange={(event) => setSyncOverwriteAvatars(event.target.checked)}
                        >
                          覆盖已有头像 / logo（{syncPreview.avatars.players.existing + syncPreview.avatars.teams.existing} 张，仅同档案）
                        </Checkbox>
                        <Hint>
                          已有 {syncPreview.avatars.players.existing + syncPreview.avatars.teams.existing} 张{syncOverwriteAvatars ? '将被覆盖' : '保持不动'} · 无法对应档案 {syncPreview.avatars.players.unmatched + syncPreview.avatars.teams.unmatched} 张
                        </Hint>
                      </Space>
                    )}

                    {/* 第二行：计数速览 + 说明小字（原来七八条 Alert 全部并进这一行） */}
                    <Surface tone="inset" className="sync-preview-summary">
                      <Space wrap size={6} align="center">
                        <Text type="secondary">比赛 {syncMatchRows.length} 场</Text>
                        <Tag color="gold">更新 {syncMatchActionCounts.update}</Tag>
                        <Tag color="green">新增 {syncMatchActionCounts.add}</Tag>
                        {syncMatchActionCounts.skip ? (
                          <Tag>{cloudPreviewFlow === 'incoming' ? '内容一致' : '跳过'} {syncMatchActionCounts.skip}</Tag>
                        ) : null}
                        {syncConflictCount ? <Tag color="red">冲突 {syncConflictCount}</Tag> : null}
                        {cloudPreviewFlow === 'pull' && syncExcludedTournamentIds.length > 0 ? (
                          <Button size="small" type="link" onClick={() => void clearRememberedExclusions()}>
                            恢复导入已排除的 {syncExcludedTournamentIds.length} 届
                          </Button>
                        ) : null}
                      </Space>
                      <Text type="secondary" className="sync-preview-notes">{syncPreviewNotes.join(' · ')}</Text>
                    </Surface>

                    <div className="sync-preview-layout">
                      <div className="sync-preview-list">
                        <Table<SyncPreviewRow>
                          rowKey={(record) => ('isGroup' in record ? record.rowKey : record.key)}
                          size="small"
                          dataSource={syncPreviewRows}
                          columns={[
                            {
                              title: '类型',
                              width: 76,
                              render: (_value, record) => ('isGroup' in record
                                ? (record.tombstone ? '🧹 已删除' : record.id ? '🏆 系列赛' : '普通对局')
                                : SYNC_KIND_LABELS[record.kind]),
                            },
                            {
                              title: '对象',
                              render: (_value, record) => ('isGroup' in record ? (
                                <Space size={6} wrap>
                                  <Text strong>{record.id ? (record.name || record.id) : '不属于任何系列赛的比赛'}</Text>
                                  {record.id ? <Hint>{record.id}</Hint> : null}
                                  {record.playerCount ? <Tag>{record.playerCount} 人</Tag> : null}
                                  {record.tombstone ? (
                                    <Tag color="red">上游已删除，随同步清理本机副本</Tag>
                                  ) : (
                                    <>
                                      <Tag color={record.incoming ? 'purple' : 'default'}>
                                        {record.incoming ? '包含系列赛编排' : '仅比赛，无编排'}
                                      </Tag>
                                      {record.localRemoved ? (
                                        <Tag color="orange">已在本机移除，保持隐藏</Tag>
                                      ) : record.localTombstone ? (
                                        <Tag color="orange">本机已删除（墓碑），名单内对局将被拦截</Tag>
                                      ) : (
                                        <Tag color={record.existsLocally ? 'blue' : 'green'}>
                                          {record.existsLocally ? '本机已有' : '本机没有，将新建'}
                                        </Tag>
                                      )}
                                    </>
                                  )}
                                  {record.stageSummary ? <Tag>{record.stageSummary}</Tag> : null}
                                  <Hint>
                                    共 {record.matchKeys.length} 场（{record.selectableCount} 场待写入）
                                  </Hint>
                                </Space>
                              ) : (
                                // 名字与 id 同行（原来上下两行会把每行撑高一倍）
                                <Space size={6} align="baseline">
                                  <Text>{record.label}</Text>
                                  <Hint>{record.id}</Hint>
                                </Space>
                              )),
                            },
                            {
                              title: '处理',
                              width: 150,
                              render: (_value, record) => ('isGroup' in record ? (
                                record.id ? (
                                  record.tombstone ? (
                                    <Tag color="red">随同步清理（不可取消）</Tag>
                                  ) : record.localTombstone ? (
                                    <Tag color="orange">名单内对局将被拦截</Tag>
                                  ) : (
                                    <Checkbox
                                      checked={!syncExcludedTournamentIds.includes(record.id)}
                                      onChange={() => toggleSyncTournamentGroup(record)}
                                    >
                                      一起导入
                                    </Checkbox>
                                  )
                                ) : null
                              ) : (() => {
                                const group = syncGroupOfMatchKey.get(record.key);
                                const excluded = Boolean(group?.id && syncExcludedTournamentIds.includes(group.id));
                                // 确认台里的「跳过」含义是「本机已有一模一样的赛果」→ 说清楚确认它只是回执
                                const label = record.blocked
                                  ? '已删名单拦截'
                                  : excluded
                                    ? '随系列赛跳过'
                                    : record.action === 'skip' && cloudPreviewFlow === 'incoming'
                                      ? '内容一致'
                                      : SYNC_ACTION_LABELS[record.action];
                                return (
                                  <Space size={4}>
                                    <Tag color={record.blocked ? 'orange' : record.action === 'add' ? 'green' : record.action === 'update' ? 'gold' : 'default'}>
                                      {label}
                                    </Tag>
                                    {record.conflict ? <Tag color="red">冲突</Tag> : null}
                                  </Space>
                                );
                              })()),
                            },
                            {
                              title: '说明',
                              width: 170,
                              ellipsis: true,
                              render: (_value, record) => ('isGroup' in record
                                ? (record.id && syncCollapsedGroupKeys.includes(record.key) ? '已折叠' : '')
                                : <Text type="secondary">{record.reason || '—'}</Text>),
                            },
                          ]}
                          pagination={false}
                          scroll={{ y: 520 }}
                          onRow={(record) => ({
                            onClick: () => {
                              if ('isGroup' in record) {
                                if (record.matchKeys.length) {
                                  setSyncCollapsedGroupKeys((prev) => (
                                    prev.includes(record.key)
                                      ? prev.filter((key) => key !== record.key)
                                      : [...prev, record.key]
                                  ));
                                }
                                return;
                              }
                              setSyncActiveKey(record.key);
                            },
                            style: { cursor: 'pointer' },
                          })}
                          rowClassName={(record) => {
                            if ('isGroup' in record) {
                              return 'sync-preview-group-row';
                            }
                            if (syncExcludedMatchKeys.has(record.key)) {
                              return 'sync-preview-row-excluded';
                            }
                            return record.key === syncActiveKey ? 'sync-preview-row-active' : '';
                          }}
                          rowSelection={{
                            selectedRowKeys: syncSelectedKeys,
                            onChange: (keys) => setSyncSelectedKeys(keys.map(String)),
                            getCheckboxProps: (record) => {
                              if ('isGroup' in record) {
                                return { disabled: true, style: { display: 'none' } };
                              }
                              const group = syncGroupOfMatchKey.get(record.key);
                              const excluded = Boolean(group?.id && syncExcludedTournamentIds.includes(group.id));
                              // 确认台里连「内容一致（跳过）」的条目也要能勾：确认它只等于给对方回执，
                              // 否则主控会卡在「没有需要更新的内容」，而对方永远显示「等主控确认」
                              const selectable = cloudPreviewFlow === 'incoming' || record.action !== 'skip';
                              return { disabled: !selectable || excluded };
                            },
                          }}
                        />
                      </div>
                      <div className="sync-preview-detail">
                        {syncActiveItem ? (
                          <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            <Space wrap size={8} align="center">
                              <Tag>{SYNC_KIND_LABELS[syncActiveItem.kind]}</Tag>
                              <Text strong>{syncActiveItem.label}</Text>
                              <Hint>{syncActiveItem.id}</Hint>
                            </Space>

                            {syncActiveItem.conflict ? (
                              <Alert
                                type="error"
                                showIcon
                                message="冲突：两台机器都登记过这场比赛"
                                description="下方为「本机版本 vs 包内版本」的差异，请确认保留哪一边。"
                              />
                            ) : null}

                            <Space wrap size={12}>
                              <Text type="secondary">处理结果：{SYNC_ACTION_LABELS[syncActiveItem.action]}</Text>
                              <Text type="secondary">
                                本机 {formatDateTime(syncActiveItem.localUpdatedAt)} → 包内 {formatDateTime(syncActiveItem.incomingUpdatedAt)}
                              </Text>
                            </Space>

                            {syncActiveItem.reason ? <Text type="secondary">原因：{syncActiveItem.reason}</Text> : null}

                            {cloudPreviewFlow === 'incoming' && cloudAckSource
                              ? (() => {
                                const ackItem = cloudAckSource.items.find((entry) => entry.item.key === syncActiveItem.key);
                                return ackItem?.impact ? (
                                  <Alert type="info" showIcon message="写回影响" description={ackItem.impact} />
                                ) : null;
                              })()
                              : null}

                            {syncActiveItem.diff.length ? (
                              <table className="sync-diff-table">
                                <thead>
                                  <tr>
                                    <th>字段</th>
                                    <th>本机版本</th>
                                    <th>包内版本</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {syncActiveItem.diff.map((field) => (
                                    <tr key={field.label}>
                                      <td className="sync-diff-label">{field.label}</td>
                                      <td className="sync-diff-local">{field.local}</td>
                                      <td className="sync-diff-incoming">{field.incoming}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <Text type="secondary">
                                {syncActiveItem.action === 'add' ? '本机没有这条记录，导入后新增。' : '本机与包内没有字段差异。'}
                              </Text>
                            )}

                            {syncActiveItem.avatarCompare ? (
                              <Space align="start" size={14} wrap>
                                <div className="sync-avatar-compare">
                                  <Hint>本机</Hint>
                                  {syncActiveItem.avatarCompare.localUrl ? (
                                    <img src={syncActiveItem.avatarCompare.localUrl} alt="本机头像" />
                                  ) : (
                                    <div className="sync-avatar-empty">无</div>
                                  )}
                                </div>
                                <div className="sync-avatar-compare">
                                  <Hint>包内</Hint>
                                  {syncActiveItem.avatarCompare.incomingDataUrl ? (
                                    <img src={syncActiveItem.avatarCompare.incomingDataUrl} alt="包内头像" />
                                  ) : (
                                    <div className="sync-avatar-empty">无</div>
                                  )}
                                </div>
                                <Text type="secondary" style={{ alignSelf: 'center' }}>{syncActiveItem.avatarCompare.note}</Text>
                              </Space>
                            ) : null}

                            {syncActiveItem.action === 'skip' ? null : (
                              <Radio.Group
                                value={syncSelectedKeys.includes(syncActiveItem.key) ? 'bundle' : 'local'}
                                optionType="button"
                                buttonStyle="solid"
                                options={syncActiveItem.action === 'add'
                                  ? [{ label: '不导入此条', value: 'local' }, { label: '新增此条', value: 'bundle' }]
                                  : [{ label: '保留本机', value: 'local' }, { label: '用包内覆盖', value: 'bundle' }]}
                                onChange={(event) => {
                                  const accept = event.target.value === 'bundle';
                                  const activeKey = syncActiveItem.key;
                                  setSyncSelectedKeys((prev) => (accept
                                    ? Array.from(new Set([...prev, activeKey]))
                                    : prev.filter((key) => key !== activeKey)));
                                }}
                              />
                            )}
                          </Space>
                        ) : (
                          <EmptyState title="点击左侧条目查看左右差异" />
                        )}
                      </div>
                    </div>
                  </Space>
                ) : null}
              </Modal>

              {/* 安排登记：主控决定哪几场交给哪台电脑登记（没安排的默认自己在主控电脑登记） */}
              <Modal
                title="安排由哪台电脑登记"
                open={cloudAssignOpen}
                width={MODAL_WIDTH.lg}
                style={{ top: 24 }}
                onCancel={() => setCloudAssignOpen(false)}
                okText="保存安排"
                confirmLoading={cloudBusy === 'assignment'}
                onOk={() => void saveCloudAssignDraft()}
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Alert
                    type="info"
                    showIcon
                    message="没有安排的比赛，默认由主控电脑自己登记；其他电脑上这些比赛的登记按钮会是灰的"
                    description="保存后要点一次「上传给其他电脑」，对方才会收到最新的安排；随时可以改。"
                  />
                  <Space wrap size={8}>
                    <Text type="secondary">整轮一起安排：</Text>
                    {cloudAssignWaveGroups.map((group) => (
                      <Space key={group.key} size={4}>
                        <Text>{group.label}（{group.matchIds.length} 场）</Text>
                        {cloudAssignPeers.length ? cloudAssignPeers.map((peer) => (
                          <Button
                            key={`${group.key}-${peer.code}`}
                            size="small"
                            onClick={() => setCloudAssignDraft((prev) => {
                              const next = { ...prev };
                              group.matchIds.forEach((matchId) => {
                                next[matchId] = peer.code;
                              });
                              return next;
                            })}
                          >
                            → 交给 {peer.code} 号机
                          </Button>
                        )) : <Text type="secondary">请先在上面「对方机器码」里填上其他电脑的标识</Text>}
                        <Button
                          size="small"
                          onClick={() => setCloudAssignDraft((prev) => {
                            const next = { ...prev };
                            group.matchIds.forEach((matchId) => {
                              next[matchId] = '';
                            });
                            return next;
                          })}
                        >
                          → 主控电脑自己登记
                        </Button>
                      </Space>
                    ))}
                    {cloudAssignWaveGroups.length ? null : <Text type="secondary">暂时没有需要安排的比赛</Text>}
                  </Space>
                  <Table<MatchRecord>
                    rowKey="id"
                    size="small"
                    dataSource={cloudAssignMatches}
                    pagination={false}
                    scroll={{ y: 360 }}
                    columns={[
                      { title: '比赛', dataIndex: 'id', width: 170 },
                      {
                        title: '对阵',
                        key: 'players',
                        render: (_value, record) => `${record.leftPlayer || '左侧'} vs ${record.rightPlayer || '右侧'}`,
                      },
                      {
                        title: '系列赛',
                        key: 'tournament',
                        width: 240,
                        render: (_value, record) => {
                          const ref = record.tournamentRef;
                          if (!ref) {
                            return '普通对局';
                          }
                          const name = tournamentNameMap.get(ref.tournamentId) ?? ref.tournamentId;
                          const tournament = tournamentRecordMap.get(ref.tournamentId);
                          const stageRound = tournament ? formatStageRoundLabel(tournament, ref) : null;
                          return stageRound ? `${name} · ${stageRound}` : name;
                        },
                      },
                      {
                        title: '比分 / 状态',
                        key: 'status',
                        width: 140,
                        render: (_value, record) => (
                          <Space size={6}>
                            <Tag>{`${record.leftScore} : ${record.rightScore}`}</Tag>
                            <MatchStatusTag status={record.status} />
                          </Space>
                        ),
                      },
                      {
                        title: '由哪台电脑登记',
                        key: 'scope',
                        width: 220,
                        render: (_value, record) => (
                          <Select
                            style={{ width: '100%' }}
                            value={cloudAssignDraft[record.id] ?? ''}
                            options={[
                              { value: '', label: `主控电脑自己（${cloudStatus?.config.machineCode || '未设置'}）` },
                              ...cloudAssignPeers.map((peer) => ({
                                value: peer.code,
                                label: `${peer.label ? `${peer.label} · ` : ''}${peer.code} 号机`,
                              })),
                            ]}
                            onChange={(value) => setCloudAssignDraft((prev) => ({ ...prev, [record.id]: value }))}
                          />
                        ),
                      },
                    ]}
                    locale={{ emptyText: '暂无比赛' }}
                  />
                </Space>
              </Modal>
            </Space>
  );
}
