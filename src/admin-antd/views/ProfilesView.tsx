import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Dropdown,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
  Upload,
} from 'antd';

import type { PlayerProfile, ProfileStoreState, SpriteRecord, TeamProfile } from '../../../shared/types';
import { useAdminData } from '../data/use-admin-data';
import { renderProfileTemplateXlsx } from '../lib/profile-template-xlsx';
import { requestJson, uploadSingleFile } from '../lib/request';
import type {
  PlayerAvatarBatchResponse,
  PlayerProfileFormValues,
  ProfileXlsxImportResponse,
  ProfileXlsxPreviewResponse,
  TeamProfileFormValues,
} from '../types';
import { Hint } from '../ui/Hint';
import { MODAL_WIDTH } from '../ui/modal';

const { Paragraph, Text } = Typography;
const { TextArea } = Input;

/**
 * 信息录入（M5 从 App.tsx 拆出）：选手 / 战队档案、头像、批量头像、.xlsx / JSON 导入导出。
 *
 * 全部弹窗、表单草稿、勾选与导入预览都是本视图本地状态（离开视图会重置）；
 * 档案服务端状态由 `useAdminData()` 的 profiles / setProfiles 提供，接口调用保持原样。
 */
export function ProfilesView(): React.ReactElement {
  const { message, modal } = App.useApp();
  const { profiles, sprites, setProfiles } = useAdminData();
  // 信息录入卡片内切换视图（选手 / 战队）
  const [profileTab, setProfileTab] = useState<'players' | 'teams'>('players');
  const [playerEditorOpen, setPlayerEditorOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<PlayerProfile | null>(null);
  const [playerAvatarFile, setPlayerAvatarFile] = useState<File | null>(null);
  const [playerAvatarUrl, setPlayerAvatarUrl] = useState<string | null>(null);
  const [playerSaving, setPlayerSaving] = useState(false);
  const [teamEditorOpen, setTeamEditorOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamProfile | null>(null);
  const [teamLogoFile, setTeamLogoFile] = useState<File | null>(null);
  const [teamLogoUrl, setTeamLogoUrl] = useState<string | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);
  // 多选删除：记录选手/战队勾选的 id（跨 tab 独立）
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // 选手批量导入（JSON / Excel）：预览确认弹窗与解析结果
  const [playerImportOpen, setPlayerImportOpen] = useState(false);
  const [playerImportPreview, setPlayerImportPreview] = useState<Array<{ name: string; rank: string; declaration: string; pets: string; hasAvatar?: boolean }>>([]);
  const [playerImporting, setPlayerImporting] = useState(false);
  const [playerExporting, setPlayerExporting] = useState(false);
  // 导入来源：json（前端解析）| xlsx（服务端解表，确认时二次上传原文件）。xlsx 的 File 仅在预览期间持有，用完即清。
  const [playerImportSource, setPlayerImportSource] = useState<'json' | 'xlsx'>('json');
  const [playerImportXlsxFile, setPlayerImportXlsxFile] = useState<File | null>(null);
  const [playerImportWarnings, setPlayerImportWarnings] = useState<string[]>([]);
  // 常用精灵未命中 pets.json 的兜底人工确认：review 列表 + 每条选中的候选
  const [playerImportReview, setPlayerImportReview] = useState<Array<{ name: string; input: string; candidates: Array<{ name: string; number: number | null }> }>>([]);
  const [playerImportReviewOpen, setPlayerImportReviewOpen] = useState(false);
  const [petReviewSelection, setPetReviewSelection] = useState<Record<number, string>>({});
  // 选手头像批量上传：先按文件名本地匹配出「原头像 vs 新头像」对比预览弹窗，确认后才覆盖上传
  const [avatarBatchUploading, setAvatarBatchUploading] = useState(false);
  const [avatarBatchConfirmOpen, setAvatarBatchConfirmOpen] = useState(false);
  const [avatarBatchPreview, setAvatarBatchPreview] = useState<Array<{ file: File; url: string; player: PlayerProfile }>>([]);
  const [avatarBatchSkipped, setAvatarBatchSkipped] = useState<string[]>([]);
  // 上传后后端回执中未命中/失败明细的结果提醒弹窗
  const [avatarBatchResult, setAvatarBatchResult] = useState<{ matched: number; unmatched: string[]; failed: Array<{ name: string; reason: string }> } | null>(null);
  const [avatarBatchResultOpen, setAvatarBatchResultOpen] = useState(false);
  const avatarBatchInputRef = useRef<HTMLInputElement | null>(null);
  // 选手常用精灵网格：当前表单选中集 + 顶栏搜索词
  const [petEditorKeyword, setPetEditorKeyword] = useState('');
  const [playerProfileForm] = Form.useForm<PlayerProfileFormValues>();
  const [teamProfileForm] = Form.useForm<TeamProfileFormValues>();
  const playerPetEditorValue = (Form.useWatch('pets', playerProfileForm) ?? []) as string[];
  const playerPetEditorSelected = new Set(playerPetEditorValue);
  // 选手常用精灵「两列精灵网格」：按 displayName 去重（同一精灵多形态只显示一项）、用于名字+头像点选
  const playerPetGridItems = useMemo(() => {
    const seen = new Set<string>();
    const items: SpriteRecord[] = [];
    for (const sprite of sprites) {
      const displayName = sprite.displayName.trim();
      if (!displayName || seen.has(displayName)) continue;
      seen.add(displayName);
      items.push(sprite);
    }
    return items;
  }, [sprites]);

  function clearProfileEditorImages() {
    if (playerAvatarUrl) URL.revokeObjectURL(playerAvatarUrl);
    if (teamLogoUrl) URL.revokeObjectURL(teamLogoUrl);
    setPlayerAvatarFile(null);
    setPlayerAvatarUrl(null);
    setTeamLogoFile(null);
    setTeamLogoUrl(null);
  }

  function openPlayerEditor(player: PlayerProfile | null) {
    setEditingPlayer(player);
    playerProfileForm.resetFields();
    setPetEditorKeyword('');
    playerProfileForm.setFieldsValue({
      name: player?.name ?? '',
      // 存储为「、」分隔文本，编辑时拆回多选数组
      pets: (player?.pets ?? '').split(/[/、,，\s]+/).map((item) => item.trim()).filter(Boolean),
      declaration: player?.declaration ?? '',
      rank: player?.rank ?? '',
    });
    clearProfileEditorImages();
    setPlayerEditorOpen(true);
  }

  function openTeamEditor(team: TeamProfile | null) {
    setEditingTeam(team);
    teamProfileForm.resetFields();
    teamProfileForm.setFieldsValue({
      name: team?.name ?? '',
      captain: team?.captain ?? '',
      declaration: team?.declaration ?? '',
    });
    clearProfileEditorImages();
    setTeamEditorOpen(true);
  }

  function togglePetInEditor(name: string) {
    const next = playerPetEditorValue.includes(name)
      ? playerPetEditorValue.filter((value) => value !== name)
      : playerPetEditorValue.length >= 6
        ? playerPetEditorValue
        : [...playerPetEditorValue, name];
    playerProfileForm.setFieldValue('pets', next);
  }

  function pickPlayerAvatar(file: File) {
    if (playerAvatarUrl) URL.revokeObjectURL(playerAvatarUrl);
    setPlayerAvatarFile(file);
    setPlayerAvatarUrl(URL.createObjectURL(file));
  }

  function pickTeamLogo(file: File) {
    if (teamLogoUrl) URL.revokeObjectURL(teamLogoUrl);
    setTeamLogoFile(file);
    setTeamLogoUrl(URL.createObjectURL(file));
  }

  async function savePlayerProfile(values: PlayerProfileFormValues) {
    setPlayerSaving(true);
    try {
      const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>('/api/profiles/players', {
        method: 'POST',
        json: {
          id: editingPlayer?.id,
          name: values.name,
          pets: Array.isArray(values.pets) ? values.pets.filter(Boolean).join('、') : (values.pets ?? ''),
          declaration: values.declaration ?? '',
          rank: values.rank ?? '',
        },
      });
      // 保存成功后再上传头像（新增时由后端按名字生成/复用记录）
      const saved = data.profiles.players.find((item) => item.name === values.name.trim());
      if (playerAvatarFile && saved) {
        await uploadSingleFile(`/api/upload/player-avatar/${encodeURIComponent(saved.id)}`, playerAvatarFile);
      }
      const latest = await requestJson<ProfileStoreState>('/api/profiles');
      setProfiles(latest);
      setPlayerEditorOpen(false);
      clearProfileEditorImages();
      message.success(editingPlayer ? '选手信息已更新' : '选手信息已录入');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPlayerSaving(false);
    }
  }

  async function removePlayerProfile(player: PlayerProfile) {
    try {
      const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>(`/api/profiles/players/${encodeURIComponent(player.id)}`, {
        method: 'DELETE',
      });
      setProfiles(data.profiles);
      message.success(`已删除选手「${player.name}」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /** 下载选手导入示例 JSON（英文字段名，中文说明见界面提示） */
  function downloadPlayerImportTemplate() {
    const sample = [
      { name: '选手A', rank: '100', declaration: '目标冠军！', pets: '迪莫、火神' },
      { name: '选手B', rank: '88', declaration: '为胜利而战', pets: '水蓝蓝' },
      { name: '选手C', rank: '', declaration: '宣言（可选）', pets: '' },
    ];
    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '选手导入示例.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  /** 清空选手导入的临时状态（xlsx 原文件用完即弃，避免大文件常驻内存） */
  function resetPlayerImportState() {
    setPlayerImportPreview([]);
    setPlayerImportWarnings([]);
    setPlayerImportXlsxFile(null);
    setPlayerImportSource('json');
  }

  /** 选手信息 .xlsx：交服务端解表（带行号 + 头像有无 + 提示），返回后打开确认弹窗 */
  async function handlePlayerImportXlsx(file: File) {
    try {
      const data = await uploadSingleFile<ProfileXlsxPreviewResponse>('/api/profiles/players/import/parse-xlsx', file);
      if (data.errors && data.errors.length > 0) {
        message.error(data.errors.join('；'));
        return;
      }
      if (!data.players || data.players.length === 0) {
        message.error('表格里没有可导入的选手（需要表头 + 至少一行填写「名字」）。');
        return;
      }
      setPlayerImportSource('xlsx');
      setPlayerImportXlsxFile(file);
      setPlayerImportWarnings(data.warnings ?? []);
      setPlayerImportPreview(
        data.players.map((player) => ({
          name: player.name,
          rank: player.rank,
          declaration: player.declaration,
          pets: player.pets,
          hasAvatar: player.hasAvatar,
        })),
      );
      setPlayerImportOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 解析选手导入文件：`.xlsx` 交服务端解表（可携带浮动头像）；否则按 JSON 白名单读取
   * 英文字段 名字 name / 排位排名 rank / 宣言 declaration / 常用精灵 pets，其余字段一律丢弃（防注入）。
   * 解析通过后打开确认弹窗。
   */
  function handlePlayerImportFile(file: File) {
    if (/\.xlsx$/i.test(file.name)) {
      void handlePlayerImportXlsx(file);
      return false;
    }
    void file
      .text()
      .then((text) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          message.error('JSON 解析失败，请检查文件是否为合法 JSON。');
          return;
        }
        if (!Array.isArray(parsed)) {
          message.error('导入文件必须是 JSON 数组，例如：[ { "name": "选手A", "rank": "100" } ]。');
          return;
        }
        const cleaned: Array<{ name: string; rank: string; declaration: string; pets: string }> = [];
        for (const item of parsed) {
          if (!item || typeof item !== 'object') continue;
          const raw = item as Record<string, unknown>;
          const name = String(raw.name ?? '').trim().slice(0, 32);
          if (!name) continue;
          cleaned.push({
            name,
            rank: String(raw.rank ?? '').replace(/\D/g, '').slice(0, 10),
            declaration: String(raw.declaration ?? '').trim().slice(0, 120),
            pets: String(raw.pets ?? '').trim().slice(0, 300),
          });
        }
        if (cleaned.length === 0) {
          message.error('文件中没有可导入的有效选手记录（每条至少需要英文字段「name」）。');
          return;
        }
        setPlayerImportSource('json');
        setPlayerImportXlsxFile(null);
        setPlayerImportWarnings([]);
        setPlayerImportPreview(cleaned);
        setPlayerImportOpen(true);
      })
      .catch(() => {
        message.error('读取文件失败，请重试。');
      });
    return false;
  }

  /** 确认批量导入选手：JSON 走原接口；xlsx 二次上传原文件（解表 + 导入 + 落头像由服务端一次完成） */
  async function confirmPlayerImport() {
    setPlayerImporting(true);
    try {
      if (playerImportSource === 'xlsx') {
        if (!playerImportXlsxFile) {
          message.error('表格文件已失效，请重新选择后再导入。');
          return;
        }
        const importedCount = playerImportPreview.length;
        const data = await uploadSingleFile<ProfileXlsxImportResponse>('/api/profiles/players/import-xlsx', playerImportXlsxFile);
        setProfiles(data.profiles);
        setPlayerImportOpen(false);
        resetPlayerImportState();
        const avatarText = data.avatars.matched > 0 ? `，头像 ${data.avatars.matched} 张` : '';
        if (data.avatars.unmatched.length > 0 || data.avatars.failed.length > 0) {
          setAvatarBatchResult({ matched: data.avatars.matched, unmatched: data.avatars.unmatched, failed: data.avatars.failed });
          setAvatarBatchResultOpen(true);
        }
        if (data.review && data.review.length > 0) {
          setPlayerImportReview(data.review);
          setPetReviewSelection({});
          setPlayerImportReviewOpen(true);
          message.warning(`已导入 ${importedCount} 名选手${avatarText}，但 ${data.review.length} 个常用精灵未命中，请人工确认。`);
        } else {
          message.success(`已导入 ${importedCount} 名选手${avatarText}（同名记录已更新）`);
        }
        return;
      }

      const data = await requestJson<{
        success: boolean;
        profiles: ProfileStoreState;
        review: Array<{ name: string; input: string; candidates: Array<{ name: string; number: number | null }> }>;
      }>('/api/profiles/players/import', {
        method: 'POST',
        json: playerImportPreview,
      });
      setProfiles(data.profiles);
      const matchedCount = playerImportPreview.length;
      setPlayerImportPreview([]);
      setPlayerImportOpen(false);
      if (data.review && data.review.length > 0) {
        setPlayerImportReview(data.review);
        setPetReviewSelection({});
        setPlayerImportReviewOpen(true);
        message.warning(`已导入 ${matchedCount} 名选手，但 ${data.review.length} 个常用精灵未在 pets.json 中找到，请人工确认。`);
      } else {
        message.success(`已导入 ${matchedCount} 名选手（同名记录已更新排名与宣言）`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPlayerImporting(false);
    }
  }

  /** 把生成的 xlsx 字节下载为文件（选手导出 / 模板共用） */
  function downloadXlsxBytes(bytes: Uint8Array<ArrayBuffer>, filename: string): void {
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  /** 导出当前选手为带头像的 Excel 表格（列与导入模板一致；常用精灵带下拉，可用 WPS 编辑后直接导回） */
  async function exportPlayersXlsx() {
    if (!profiles) {
      message.error('选手档案尚未加载，请稍后重试。');
      return;
    }
    if (sprites.length === 0) {
      message.warning('精灵索引尚未加载，导出的表格将没有常用精灵下拉，请稍后重试');
    }
    setPlayerExporting(true);
    try {
      const data = await renderProfileTemplateXlsx({ players: profiles.players, sprites });
      const stamp = new Date();
      const pad = (value: number): string => String(value).padStart(2, '0');
      downloadXlsxBytes(data, `选手信息_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}.xlsx`);
      message.success(
        profiles.players.length > 0
          ? `已导出 ${profiles.players.length} 名选手（含头像与常用精灵下拉）`
          : '已导出空白模板（表头 + 填写说明）',
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setPlayerExporting(false);
    }
  }

  /** 下载 Excel 导入模板（空白：表头 + 精灵下拉 + 填写说明；导入时按同口径解析） */
  async function downloadPlayerImportXlsxTemplate() {
    if (sprites.length === 0) {
      message.warning('精灵索引尚未加载，模板将没有常用精灵下拉，请稍后重试');
    }
    setPlayerExporting(true);
    try {
      const data = await renderProfileTemplateXlsx({ players: [], sprites });
      downloadXlsxBytes(data, '选手导入模板.xlsx');
      message.success('已下载 Excel 模板（表头 + 常用精灵下拉 + 填写说明）');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '下载模板失败');
    } finally {
      setPlayerExporting(false);
    }
  }

  /** 释放批量头像预览中创建的本地对象 URL 并清空预览状态 */
  function clearAvatarBatchPreview() {
    for (const item of avatarBatchPreview) {
      URL.revokeObjectURL(item.url);
    }
    setAvatarBatchPreview([]);
    setAvatarBatchSkipped([]);
  }

  /**
   * 选择批量头像文件后先做本地匹配预览：按文件名（去扩展名）精确匹配已录入选手，
   * 弹出「原头像 vs 新头像」左右对比弹窗，确认后才提交覆盖；未匹配到的文件列出提醒且不上传。
   */
  function handleAvatarBatchFiles(files: File[]) {
    if (files.length === 0) return;
    if (!profiles) {
      message.error('选手档案尚未加载，请稍后重试。');
      return;
    }
    // 换一批文件前先释放上一批预览的对象 URL
    clearAvatarBatchPreview();
    const nameToPlayer = new Map<string, PlayerProfile>();
    for (const player of profiles.players) {
      if (!nameToPlayer.has(player.name)) {
        nameToPlayer.set(player.name, player);
      }
    }
    const preview: Array<{ file: File; url: string; player: PlayerProfile }> = [];
    const skipped: string[] = [];
    for (const file of files) {
      const matchName = file.name.replace(/\.[^.]+$/, '').trim();
      const player = matchName ? nameToPlayer.get(matchName) : undefined;
      if (player) {
        preview.push({ file, url: URL.createObjectURL(file), player });
      } else {
        skipped.push(matchName || file.name);
      }
    }
    setAvatarBatchPreview(preview);
    setAvatarBatchSkipped(skipped);
    if (preview.length === 0) {
      message.error(`所选图片均未匹配到已录入选手（${skipped.length} 个文件已忽略），请检查文件名是否与选手名字一致。`);
      return;
    }
    setAvatarBatchConfirmOpen(true);
  }

  /**
   * 确认覆盖：只提交预览中匹配到的图片（文件名列表随表单 names 字段以 JSON 显式传递，
   * 规避 multer 将 multipart 文件名按 latin1 解码导致的中文乱码），后端二次按名字匹配
   * 并走与单个头像上传相同的魔数校验 + sharp 压缩管线落盘。
   */
  async function confirmPlayerAvatarBatch() {
    if (avatarBatchPreview.length === 0) return;
    setAvatarBatchUploading(true);
    try {
      const formData = new FormData();
      for (const item of avatarBatchPreview) {
        formData.append('files', item.file);
      }
      formData.append('names', JSON.stringify(avatarBatchPreview.map((item) => item.file.name)));
      const data = await requestJson<PlayerAvatarBatchResponse>('/api/upload/player-avatars/batch', {
        method: 'POST',
        body: formData,
      });
      setProfiles(data.profiles);
      clearAvatarBatchPreview();
      setAvatarBatchConfirmOpen(false);
      if (data.unmatched.length > 0 || data.failed.length > 0) {
        setAvatarBatchResult({ matched: data.matched, unmatched: data.unmatched, failed: data.failed });
        setAvatarBatchResultOpen(true);
      } else {
        message.success(`已为 ${data.matched} 位选手更新头像`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAvatarBatchUploading(false);
    }
  }

  /** 兜底确认：把选中的候选精灵写入对应选手的常用精灵 */
  async function applyPetReviewChoices() {
    try {
      const chosen = Object.entries(petReviewSelection).filter(([, value]) => Boolean(value));
      if (chosen.length === 0) {
        setPlayerImportReviewOpen(false);
        setPlayerImportReview([]);
        message.success('未选择任何候选，未做改动。');
        return;
      }
      let latest = profiles;
      for (const [indexKey, choice] of chosen) {
        const index = Number(indexKey);
        const reviewItem = playerImportReview[index];
        const player = latest?.players.find((item) => item.name === reviewItem?.name);
        if (!player) continue;
        const existing = (player.pets ?? '')
          .split(/[/、,，\s]+/)
          .map((token) => token.trim())
          .filter(Boolean);
        const pets = [...existing.filter((token) => token !== choice), choice].join('、');
        const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>('/api/profiles/players', {
          method: 'POST',
          json: { id: player.id, name: player.name, declaration: player.declaration, rank: player.rank, pets },
        });
        latest = data.profiles;
      }
      setProfiles(latest);
      setPlayerImportReviewOpen(false);
      setPlayerImportReview([]);
      setPetReviewSelection({});
      message.success(`已为 ${chosen.length} 个常用精灵补录对应选手。`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveTeamProfile(values: TeamProfileFormValues) {
    setTeamSaving(true);
    try {
      const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>('/api/profiles/teams', {
        method: 'POST',
        json: {
          id: editingTeam?.id,
          name: values.name,
          captain: values.captain ?? '',
          declaration: values.declaration ?? '',
        },
      });
      const saved = data.profiles.teams.find((item) => item.name === values.name.trim());
      if (teamLogoFile && saved) {
        await uploadSingleFile(`/api/upload/team-logo/${encodeURIComponent(saved.id)}`, teamLogoFile);
      }
      const latest = await requestJson<ProfileStoreState>('/api/profiles');
      setProfiles(latest);
      setTeamEditorOpen(false);
      clearProfileEditorImages();
      message.success(editingTeam ? '战队信息已更新' : '战队信息已录入');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTeamSaving(false);
    }
  }

  async function removeTeamProfile(team: TeamProfile) {
    try {
      const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>(`/api/profiles/teams/${encodeURIComponent(team.id)}`, {
        method: 'DELETE',
      });
      setProfiles(data.profiles);
      message.success(`已删除战队「${team.name}」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /** 批量删除选手/战队：逐条走单删接口，勾选后弹出确认（含将要删除的名称清单） */
  function bulkDeleteProfiles(kind: 'players' | 'teams', ids: string[]) {
    if (!ids.length) {
      return;
    }
    const isPlayers = kind === 'players';
    const label = isPlayers ? '选手' : '战队';
    const items = (isPlayers ? profiles?.players : profiles?.teams) ?? [];
    const names = items.filter((item) => ids.includes(item.id)).map((item) => item.name);
    modal.confirm({
      title: `确认删除所选 ${ids.length} 个${label}？`,
      content: `将删除：${names.join('、')}（同时移除其头像/logo 文件）。该操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setBulkDeleting(true);
        try {
          let latest = profiles;
          for (const id of ids) {
            const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>(
              `/api/profiles/${kind}/${encodeURIComponent(id)}`,
              { method: 'DELETE' },
            );
            latest = data.profiles;
          }
          if (latest) {
            setProfiles(latest);
          }
          if (isPlayers) {
            setSelectedPlayerIds([]);
          } else {
            setSelectedTeamIds([]);
          }
          message.success(`已删除 ${ids.length} 个${label}`);
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error));
        } finally {
          setBulkDeleting(false);
        }
      },
    });
  }

  return (
    <>
      <Card
        title="选手与战队"
        extra={
          <Space size={12}>
            <Segmented
              value={profileTab}
              options={[
                { value: 'players', label: '选手信息' },
                { value: 'teams', label: '战队信息' },
              ]}
              onChange={(value) => {
                setProfileTab(value as 'players' | 'teams');
                setSelectedPlayerIds([]);
                setSelectedTeamIds([]);
              }}
            />
            {profileTab === 'players' ? (
              <>
                <Dropdown
                  menu={{
                    items: [
                      { key: 'json', label: '下载 JSON 示例' },
                      { key: 'xlsx', label: '下载 Excel 模板' },
                    ],
                    onClick: ({ key }) => {
                      if (key === 'json') {
                        downloadPlayerImportTemplate();
                      } else {
                        void downloadPlayerImportXlsxTemplate();
                      }
                    },
                  }}
                >
                  <Button loading={playerExporting}>下载示例</Button>
                </Dropdown>
                <Tooltip title="导出当前选手为 Excel（含头像、常用精灵带下拉），可用 WPS 编辑后再导入；无选手时导出空白模板">
                  <Button loading={playerExporting} onClick={() => void exportPlayersXlsx()}>导出信息</Button>
                </Tooltip>
                <Tooltip title="支持 .xlsx（可携带嵌入的浮动头像）与 .json（仅文字字段）">
                  <Upload
                    accept=".json,.xlsx,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    showUploadList={false}
                    beforeUpload={(file) => handlePlayerImportFile(file as File)}
                  >
                    <Button>导入信息</Button>
                  </Upload>
                </Tooltip>
                <Tooltip title="一次多选图片，先按文件名（去掉扩展名）匹配选手并预览原/新头像对比，确认后才覆盖保存；未命中的不上传">
                  <Button loading={avatarBatchUploading} onClick={() => avatarBatchInputRef.current?.click()}>批量头像</Button>
                </Tooltip>
                <Button
                  danger
                  disabled={!selectedPlayerIds.length}
                  loading={bulkDeleting}
                  onClick={() => bulkDeleteProfiles('players', selectedPlayerIds)}
                >
                  删除所选（{selectedPlayerIds.length}）
                </Button>
                <Button type="primary" onClick={() => openPlayerEditor(null)}>新增选手</Button>
              </>
            ) : (
              <>
                <Button
                  danger
                  disabled={!selectedTeamIds.length}
                  loading={bulkDeleting}
                  onClick={() => bulkDeleteProfiles('teams', selectedTeamIds)}
                >
                  删除所选（{selectedTeamIds.length}）
                </Button>
                <Button type="primary" onClick={() => openTeamEditor(null)}>新增战队</Button>
              </>
            )}
          </Space>
        }
      >
        {profileTab === 'players' ? (
          <>
            <input
              ref={avatarBatchInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (files.length > 0) handleAvatarBatchFiles(files);
              }}
            />
            <Table
              size="small"
              rowKey="id"
              dataSource={profiles?.players ?? []}
              pagination={false}
              rowSelection={{
                selectedRowKeys: selectedPlayerIds,
                onChange: (keys) => setSelectedPlayerIds(keys as string[]),
                getCheckboxProps: () => ({ disabled: bulkDeleting }),
              }}
              locale={{ emptyText: '暂无选手录入，点击「新增选手」录入头像、名字、常用精灵、宣言与排名。' }}
              columns={[
                {
                  title: '头像',
                  key: 'avatar',
                  width: 72,
                  render: (_: unknown, record: PlayerProfile) => (
                    <div className="player-avatar-circular">
                      {record.avatarExists ? (
                        <Image
                          preview={false}
                          src={`/runtime/profiles/players/${encodeURIComponent(record.id)}.png?t=${record.avatarMtime ?? 0}`}
                          alt={record.name}
                        />
                      ) : (
                        <Image preview={false} src="/assets/ui/left-avatar.png" alt="默认头像" />
                      )}
                    </div>
                  ),
                },
                { title: '名字', dataIndex: 'name', key: 'name', render: (value: string) => <Text strong>{value}</Text> },
                { title: '排名', dataIndex: 'rank', key: 'rank', width: 80, render: (value: string) => value || '-' },
                { title: '常用精灵', dataIndex: 'pets', key: 'pets', ellipsis: true, render: (value: string) => value || '-' },
                { title: '宣言', dataIndex: 'declaration', key: 'declaration', ellipsis: true, render: (value: string) => value || '-' },
                {
                  title: '操作',
                  key: 'actions',
                  width: 130,
                  render: (_: unknown, record: PlayerProfile) => (
                    <Space size={4}>
                      <Button size="small" onClick={() => openPlayerEditor(record)}>编辑</Button>
                      <Popconfirm title={`确认删除选手「${record.name}」？`} onConfirm={() => void removePlayerProfile(record)}>
                        <Button size="small" danger>删除</Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
            <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              创建赛事时输入选手名字会自动联想已录入选手，选中后自动复用其头像与排名。
              「批量头像」支持一次多选图片，按文件名（去掉扩展名）匹配选手名字，先弹出原/新头像对比预览，确认后才覆盖保存；未命中的会提醒且不上传。
            </Paragraph>
          </>
        ) : (
          <>
            <Table
              size="small"
              rowKey="id"
              dataSource={profiles?.teams ?? []}
              pagination={false}
              rowSelection={{
                selectedRowKeys: selectedTeamIds,
                onChange: (keys) => setSelectedTeamIds(keys as string[]),
                getCheckboxProps: () => ({ disabled: bulkDeleting }),
              }}
              locale={{ emptyText: '暂无战队录入，点击「新增战队」录入战队名称、队长、logo 与宣言。' }}
              columns={[
                {
                  title: 'Logo',
                  key: 'logo',
                  width: 72,
                  render: (_: unknown, record: TeamProfile) => (
                    <div className="player-avatar-circular">
                      {record.logoExists ? (
                        <Image
                          preview={false}
                          src={`/runtime/profiles/teams/${encodeURIComponent(record.id)}.png?t=${record.logoMtime ?? 0}`}
                          alt={record.name}
                        />
                      ) : (
                        <Image preview={false} src="/assets/ui/left-avatar.png" alt="默认logo" />
                      )}
                    </div>
                  ),
                },
                { title: '战队名称', dataIndex: 'name', key: 'name', render: (value: string) => <Text strong>{value}</Text> },
                { title: '队长', dataIndex: 'captain', key: 'captain', width: 120, render: (value: string) => value || '-' },
                { title: '宣言', dataIndex: 'declaration', key: 'declaration', ellipsis: true, render: (value: string) => value || '-' },
                {
                  title: '操作',
                  key: 'actions',
                  width: 130,
                  render: (_: unknown, record: TeamProfile) => (
                    <Space size={4}>
                      <Button size="small" onClick={() => openTeamEditor(record)}>编辑</Button>
                      <Popconfirm title={`确认删除战队「${record.name}」？`} onConfirm={() => void removeTeamProfile(record)}>
                        <Button size="small" danger>删除</Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
            <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              创建赛事时可在「所属战队」中选择已录入战队复用；推流页面3 开启战队显示后会展示战队 logo 与名称。
            </Paragraph>
          </>
        )}
      </Card>

      <Modal
        title={editingPlayer ? `编辑选手：${editingPlayer.name}` : '新增选手'}
        open={playerEditorOpen}
        onCancel={() => {
          setPlayerEditorOpen(false);
          clearProfileEditorImages();
        }}
        onOk={() => playerProfileForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={playerSaving}
      >
        <Form
          form={playerProfileForm}
          layout="vertical"
          onFinish={(values) => void savePlayerProfile(values)}
        >
          <Form.Item label="选手头像（可选）">
            <div className="create-avatar-row">
              <div className="player-avatar-circular">
                {playerAvatarUrl ? (
                  <img src={playerAvatarUrl} alt="选手头像预览" />
                ) : editingPlayer?.avatarExists ? (
                  <Image
                    preview={false}
                    src={`/runtime/profiles/players/${encodeURIComponent(editingPlayer.id)}.png?t=${editingPlayer.avatarMtime ?? 0}`}
                    alt="当前头像"
                  />
                ) : (
                  <Image preview={false} src="/assets/ui/left-avatar.png" alt="默认头像" />
                )}
              </div>
              <Upload
                showUploadList={false}
                beforeUpload={(file) => {
                  pickPlayerAvatar(file as File);
                  return false;
                }}
              >
                <Button>选择头像</Button>
              </Upload>
            </div>
          </Form.Item>
          <Form.Item label="名字" name="name" rules={[{ required: true, message: '请输入选手名字' }]}>
            <Input maxLength={32} placeholder="例如：选手A（同名保存会更新已有录入）" />
          </Form.Item>
          <Form.Item label="排名（可选）" name="rank" getValueFromEvent={(event: React.ChangeEvent<HTMLInputElement>) => event.target.value.replace(/\D/g, '')}>
            <Input maxLength={10} inputMode="numeric" placeholder="仅数字，例如：123" />
          </Form.Item>
          <Form.Item label={`常用精灵（点击选择，最多 6 个，可选可不选）当前已选 ${playerPetEditorValue.length}/6`} name="pets">
            <Input
              allowClear
              prefix={<span className="roco-muted">搜索</span>}
              placeholder="输入精灵名字快速过滤"
              value={petEditorKeyword}
              onChange={(event) => setPetEditorKeyword(event.target.value)}
              style={{ marginBottom: 8 }}
            />
            <div
              style={{
                border: '1px solid #d9d9d9',
                borderRadius: 6,
                padding: 6,
                maxHeight: 320,
                overflowY: 'auto',
                background: '#fff',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {playerPetGridItems
                  .filter((sprite) => {
                    const keyword = petEditorKeyword.trim().toLowerCase();
                    return !keyword || sprite.displayName.toLowerCase().includes(keyword);
                  })
                  .map((sprite) => {
                    const name = sprite.displayName.trim();
                    const selected = playerPetEditorSelected.has(name);
                    return (
                      <div
                        key={`${name}-${sprite.id}`}
                        role="checkbox"
                        aria-checked={selected}
                        onClick={() => togglePetInEditor(name)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '5px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: selected ? '#e6f4ff' : 'transparent',
                          border: selected ? '1px solid #91caff' : '1px solid transparent',
                          userSelect: 'none',
                        }}
                      >
                        <span
                          style={{
                            width: 40,
                            height: 40,
                            flexShrink: 0,
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 6,
                            background: 'rgba(0,0,0,0.03)',
                          }}
                        >
                          <img
                            src={sprite.iconUrl || sprite.path}
                            alt={name}
                            style={{ width: 36, height: 36, objectFit: 'contain' }}
                            loading="lazy"
                          />
                        </span>
                        <Text style={{ fontSize: 13, lineHeight: 1.2 }} ellipsis={{ tooltip: name }}>
                          {name}
                        </Text>
                        {selected ? <span style={{ marginLeft: 'auto', color: 'var(--roco-brand-text)', fontSize: 14 }}>✓</span> : null}
                      </div>
                    );
                  })}
                {playerPetGridItems.filter((sprite) => {
                  const keyword = petEditorKeyword.trim().toLowerCase();
                  return !keyword || sprite.displayName.toLowerCase().includes(keyword);
                }).length === 0 ? (
                  <Text type="secondary" style={{ padding: '10px 12px' }}>无匹配精灵</Text>
                ) : null}
              </div>
            </div>
          </Form.Item>
          <Form.Item label="宣言（可选）" name="declaration">
            <TextArea rows={2} maxLength={120} placeholder="例如：目标冠军！" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={playerImportSource === 'xlsx' ? '导入选手（Excel）' : '导入选手（JSON）'}
        open={playerImportOpen}
        onCancel={() => {
          setPlayerImportOpen(false);
          resetPlayerImportState();
        }}
        onOk={() => void confirmPlayerImport()}
        okText="确认导入"
        cancelText="取消"
        confirmLoading={playerImporting}
        width={MODAL_WIDTH.md}
      >
        {playerImportSource === 'xlsx' ? (
          <>
            <Paragraph>
              将导入 <Text strong>{playerImportPreview.length}</Text> 名选手。列口径：名字 / 排位排名 / 宣言 / 擅长精灵1..擅长精灵6；嵌入到「头像」列的浮动图片会一并导入。
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>
              同名选手将更新其排名、宣言与常用精灵，并保留原头像。常用精灵仅在 pets.json 精确命中时录入，未命中的会在导入后提示并给出候选。
            </Paragraph>
          </>
        ) : (
          <>
            <Paragraph>
              将导入 <Text strong>{playerImportPreview.length}</Text> 条选手记录。仅识别以下英文字段，其余字段一律忽略（防止恶意字段注入）：
            </Paragraph>
            <Space size={16} wrap style={{ marginBottom: 12 }}>
              <span><Text code>name</Text> <Text type="secondary">选手名字（必填）</Text></span>
              <span><Text code>rank</Text> <Text type="secondary">排位排名（仅数字）</Text></span>
              <span><Text code>declaration</Text> <Text type="secondary">宣言</Text></span>
              <span><Text code>pets</Text> <Text type="secondary">常用精灵（需在 pets.json 中命中）</Text></span>
            </Space>
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>
              同名选手将更新其排名、宣言与常用精灵，并保留原头像。常用精灵仅在 pets.json 精确命中时录入，未命中的会在导入后提示并给出候选。
            </Paragraph>
          </>
        )}
        {playerImportWarnings.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`导入提示（${playerImportWarnings.length}）`}
            description={(
              <div>
                {playerImportWarnings.map((warning, index) => (
                  <div key={index}>· {warning}</div>
                ))}
              </div>
            )}
          />
        ) : null}
        <Table
          size="small"
          rowKey={(_record, index) => `${index}`}
          dataSource={playerImportPreview}
          pagination={false}
          scroll={{ y: 220 }}
          locale={{ emptyText: '无可导入记录' }}
          columns={[
            { title: '名字', dataIndex: 'name', key: 'name', render: (value: string) => <Text strong>{value}</Text> },
            { title: '排位排名', dataIndex: 'rank', key: 'rank', width: 90, render: (value: string) => value || '-' },
            { title: '常用精灵', dataIndex: 'pets', key: 'pets', ellipsis: true, render: (value: string) => value || '-' },
            { title: '宣言', dataIndex: 'declaration', key: 'declaration', ellipsis: true, render: (value: string) => value || '-' },
            ...(playerImportSource === 'xlsx'
              ? [{ title: '头像', dataIndex: 'hasAvatar', key: 'hasAvatar', width: 64, render: (value: boolean) => (value ? '有' : '无') }]
              : []),
          ]}
        />
      </Modal>

      <Modal
        title="常用精灵需要人工确认"
        open={playerImportReviewOpen}
        onOk={() => void applyPetReviewChoices()}
        okText="确认（写入选中的精灵）"
        cancelText="忽略全部"
        onCancel={() => {
          setPlayerImportReviewOpen(false);
          setPlayerImportReview([]);
          setPetReviewSelection({});
        }}
        width={MODAL_WIDTH.sm}
      >
        <Paragraph>
          有 <Text strong>{playerImportReview.length}</Text> 个常用精灵未在 pets.json 中命中，选手的其它信息已正常导入。请在下方选择正确的精灵以录入（每条最多 5 个候选），或忽略。
        </Paragraph>
        {playerImportReview.map((item, index) => (
          <div key={`${item.name}-${index}`} style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4 }}>
              <Text strong>{item.name}</Text>
              <Text type="secondary">：「{item.input}」未匹配到</Text>
            </div>
            <Select
              allowClear
              showSearch
              style={{ width: '100%' }}
              placeholder={item.candidates.length > 0 ? '选择候选精灵（可留空忽略）' : '无匹配候选，已跳过'}
              value={petReviewSelection[index]}
              disabled={item.candidates.length === 0}
              filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())}
              onChange={(value) => setPetReviewSelection((prev) => ({ ...prev, [index]: String(value ?? '') }))}
              options={item.candidates.map((candidate) => ({
                value: candidate.name,
                label: `${candidate.name}${candidate.number != null ? `（编号 ${candidate.number}）` : ''}`,
              }))}
            />
          </div>
        ))}
      </Modal>

      <Modal
        title="批量头像预览"
        open={avatarBatchConfirmOpen}
        onCancel={() => {
          setAvatarBatchConfirmOpen(false);
          clearAvatarBatchPreview();
        }}
        onOk={() => void confirmPlayerAvatarBatch()}
        okText={`确认覆盖（${avatarBatchPreview.length} 张）`}
        cancelText="取消"
        confirmLoading={avatarBatchUploading}
        width={MODAL_WIDTH.md}
      >
        <Paragraph>
          已按文件名匹配 <Text strong>{avatarBatchPreview.length}</Text> 位选手，确认后覆盖原头像（统一压缩为 480×480 PNG）；未匹配的文件不会上传。
        </Paragraph>
        {avatarBatchSkipped.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${avatarBatchSkipped.length} 个文件未匹配到已录入选手，将不上传：${avatarBatchSkipped.join('、')}`}
          />
        ) : null}
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {avatarBatchPreview.map((item, index) => (
            <div
              key={`${item.player.id}-${index}`}
              style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}
            >
              <div style={{ textAlign: 'center' }}>
                <Image
                  preview={false}
                  width={56}
                  height={56}
                  style={{ borderRadius: 8, objectFit: 'cover' }}
                  src={item.player.avatarExists
                    ? `/runtime/profiles/players/${encodeURIComponent(item.player.id)}.png?t=${item.player.avatarMtime ?? 0}`
                    : '/assets/ui/left-avatar.png'}
                />
                <div>
                  <Hint>
                    {item.player.avatarExists ? '原头像' : '原头像（未设置）'}
                  </Hint>
                </div>
              </div>
              <Text type="secondary">→</Text>
              <div style={{ textAlign: 'center' }}>
                <Image preview={false} width={56} height={56} style={{ borderRadius: 8, objectFit: 'cover' }} src={item.url} />
                <div><Hint>新头像</Hint></div>
              </div>
              <Text strong style={{ marginLeft: 'auto', marginRight: 8 }}>{item.player.name}</Text>
            </div>
          ))}
        </div>
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          同一选手匹配到多张图片时以后上传的为准；确认后按文件名覆盖对应选手档案。
        </Paragraph>
      </Modal>

      <Modal
        title="批量头像上传结果"
        open={avatarBatchResultOpen}
        onCancel={() => setAvatarBatchResultOpen(false)}
        footer={null}
        width={MODAL_WIDTH.sm}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {(avatarBatchResult?.matched ?? 0) > 0 ? (
            <Alert type="success" showIcon message={`已为 ${avatarBatchResult?.matched} 位选手更新头像（统一压缩为 480×480 PNG）`} />
          ) : null}
          {(avatarBatchResult?.unmatched.length ?? 0) > 0 ? (
            <Alert
              type="warning"
              showIcon
              message={`${avatarBatchResult?.unmatched.length} 张图片未匹配到已录入选手名字，已跳过`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {avatarBatchResult?.unmatched.map((name, index) => (
                    <li key={`${name}-${index}`}>{name}</li>
                  ))}
                </ul>
              }
            />
          ) : null}
          {(avatarBatchResult?.failed.length ?? 0) > 0 ? (
            <Alert
              type="error"
              showIcon
              message={`${avatarBatchResult?.failed.length} 张图片处理失败`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {avatarBatchResult?.failed.map((item, index) => (
                    <li key={`${item.name}-${index}`}>{item.name}：{item.reason}</li>
                  ))}
                </ul>
              }
            />
          ) : null}
          <Text type="secondary">提示：图片文件名（去掉扩展名）需与已录入选手名字一致，例如「小明.png」匹配选手「小明」。</Text>
        </Space>
      </Modal>

      <Modal
        title={editingTeam ? `编辑战队：${editingTeam.name}` : '新增战队'}
        open={teamEditorOpen}
        onCancel={() => {
          setTeamEditorOpen(false);
          clearProfileEditorImages();
        }}
        onOk={() => teamProfileForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={teamSaving}
      >
        <Form
          form={teamProfileForm}
          layout="vertical"
          onFinish={(values) => void saveTeamProfile(values)}
        >
          <Form.Item label="战队 Logo / 头像（可选）">
            <div className="create-avatar-row">
              <div className="player-avatar-circular">
                {teamLogoUrl ? (
                  <img src={teamLogoUrl} alt="战队logo预览" />
                ) : editingTeam?.logoExists ? (
                  <Image
                    preview={false}
                    src={`/runtime/profiles/teams/${encodeURIComponent(editingTeam.id)}.png?t=${editingTeam.logoMtime ?? 0}`}
                    alt="当前logo"
                  />
                ) : (
                  <Image preview={false} src="/assets/ui/left-avatar.png" alt="默认logo" />
                )}
              </div>
              <Upload
                showUploadList={false}
                beforeUpload={(file) => {
                  pickTeamLogo(file as File);
                  return false;
                }}
              >
                <Button>选择图片</Button>
              </Upload>
            </div>
          </Form.Item>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Form.Item label="战队名称" name="name" rules={[{ required: true, message: '请输入战队名称' }]}>
                <Input maxLength={40} placeholder="例如：星辰战队（同名保存会更新已有录入）" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="队长名称（可选）" name="captain">
                <Input maxLength={32} placeholder="例如：选手A" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="宣言（可选）" name="declaration">
            <TextArea rows={2} maxLength={120} placeholder="例如：为荣耀而战！" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
