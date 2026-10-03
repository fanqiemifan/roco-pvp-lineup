import React, { useMemo, useState } from 'react';
import { Button, Card, Space, Tag, Typography } from 'antd';
import type { MatchRecord, SpriteRecord, TournamentRecord } from '../../../shared/types';

import { TournamentLineupExportModal } from './TournamentLineupExportModal';
import { TournamentLineupImportModal } from './TournamentLineupImportModal';

const { Paragraph, Text } = Typography;

export interface MatchLineupEntryCardProps {
  /** 系列赛列表（导出 / 导入阵容模板要按系列赛定位对局） */
  tournaments: TournamentRecord[];
  /** 全部比赛（弹窗自己按系列赛过滤；已本机移除的系列赛已在调用侧过滤） */
  matches: MatchRecord[];
  sprites: SpriteRecord[];
}

/**
 * 「比赛管理」顶部的阵容录入入口卡（与四张推流功能卡同一排，第五张）。
 *
 * 为什么需要它：阵容录入的既有入口都藏在「系列赛详情工具栏」和「比赛管理表格的展开行」里，
 * 首次使用的人根本走不到。这里只做**入口**——弹的是既有弹窗、走既有接口，
 * 不新增任何接口、不改写入路径；单场「录入阵容」仍在表格展开行里（避免重复两套编辑入口）。
 *
 * 对局格式仍然是「一场两行」的 .xlsx 模板：比赛还没开始时先把双方 6 只精灵填好，
 * 导入只写比赛记录，不切当前比赛、不影响正在推流的画面。
 */
export function MatchLineupEntryCard({ tournaments, matches, sprites }: MatchLineupEntryCardProps): React.ReactElement {
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // 入口卡面向「最近还在编排的那一届」：服务端 store 是插入序（不一定按更新时间），
  // 这里显式按 updatedAt 取最新一条，避免目标系列赛跳来跳去。
  const target = useMemo(
    () => [...tournaments].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] ?? null,
    [tournaments],
  );

  return (
    <Card
      size="small"
      className="lineup-entry-card"
      title="阵容录入"
      extra={(
        <Space size={8}>
          <Button disabled={!target} onClick={() => setExportOpen(true)}>导出阵容模板</Button>
          <Button disabled={!target} onClick={() => setImportOpen(true)}>导入阵容</Button>
        </Space>
      )}
    >
      <Space direction="vertical" size={6} className="page-stack" style={{ width: '100%' }}>
        <Text type="secondary">
          比赛<Text strong>还没开始</Text>时，先把双方 6 只精灵填完：导出「一场两行」的 Excel 模板（精灵列带下拉，不用手打名字），
          线下填好再导入（也支持 CSV / 直接粘贴表格 / JSON）。
        </Text>
        <Space wrap size={6}>
          <Tag bordered={false}>只写比赛记录</Tag>
          <Tag bordered={false}>不影响正在推流的画面</Tag>
          <Tag bordered={false}>已开赛 / 已完赛的场次自动跳过</Tag>
        </Space>
        {target ? (
          <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
            当前目标系列赛：<Text strong>{target.name}</Text>
            {tournaments.length > 1 ? '（在「系列比赛」详情里可对指定一届导出 / 导入）' : ''}
          </Paragraph>
        ) : (
          <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
            还没有系列赛：先在「系列比赛」里创建一届，或直接在建场后到比赛管理表格的展开行里单场录入。
          </Paragraph>
        )}
      </Space>

      {/* 两个弹窗复用系列赛详情里的同一份实现（组件常驻挂载、只切换 open） */}
      {target ? (
        <>
          <TournamentLineupExportModal
            open={exportOpen}
            record={target}
            matches={matches}
            sprites={sprites}
            onClose={() => setExportOpen(false)}
          />
          <TournamentLineupImportModal
            open={importOpen}
            record={target}
            matches={matches}
            onClose={() => setImportOpen(false)}
          />
        </>
      ) : null}
    </Card>
  );
}

export default MatchLineupEntryCard;
