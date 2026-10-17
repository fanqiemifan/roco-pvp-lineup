import React from 'react';
import { Card, Col, Row, Space, Typography } from 'antd';

const { Text, Title, Paragraph, Link } = Typography;

/**
 * 关于项目（M3 从 App.tsx 拆出）：纯静态说明，无状态、无数据依赖。
 */
export function AboutView(): React.ReactElement {
  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Card title="项目链接">
        <Space wrap size={12}>
          <Link href="/login.html" target="_blank">登录页入口</Link>
          <Link href="/admin.html" target="_blank">当前后台入口</Link>
          <Link href="/roco-pvp-page3.html" target="_blank">推流页面 3</Link>
          <Link href="rocom.shallow.ink" target="_blank">精灵图素材来源</Link>
          <Link href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans" target="_blank">CC BY-NC-SA 4.0</Link>
        </Space>
      </Card>
      <Card>
        <Space direction="vertical" size={16} className="page-stack">
          <div>
            <Text className="eyebrow">About This Site</Text>
            <Title level={3}>关于这应用的说明</Title>
          </div>
          <Paragraph>
            这个应用面向洛克王国 PVP 直播场景，把赛事录入、阵容同步、比分控制、素材管理和推流页面预览统一收口到同一套 Ant Design 工作台里。
          </Paragraph>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card size="small" className="subtle-card">
                <Title level={5}>赛事与比分统一管理</Title>
                <Paragraph type="secondary">创建赛事、维护 BO 赛制、记录每小局胜负，并把当前状态同步到推流页面。</Paragraph>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" className="subtle-card">
                <Title level={5}>左右阵容独立编辑</Title>
                <Paragraph type="secondary">两边阵容可分别配置，并独立调节血量、能力值、透明度和饱和度。</Paragraph>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" className="subtle-card">
                <Title level={5}>素材与预览联动</Title>
                <Paragraph type="secondary">头像、推流页面 1/2/3 和等待页都能在后台里一起管理。</Paragraph>
              </Card>
            </Col>
          </Row>
          <Card size="small" className="subtle-card" title="作者与许可">
            <Space direction="vertical" size={8} className="page-stack">
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                作者邮箱：<Link href="mailto:463218006@qq.com">463218006@qq.com</Link>
              </Paragraph>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                本软件<Text strong>免费开源使用</Text>，基于 MIT License 发布，可自由使用、复制、修改与分发（分发时需保留版权声明与许可声明）。
              </Paragraph>
            </Space>
          </Card>
          <Card size="small" className="subtle-card" title="字体说明">
            <Space direction="vertical" size={8} className="page-stack">
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                本项目内置了 <Text strong>MiSans</Text> 系列字体（精灵名字使用 MiSans-Medium、推流页面3 选手名字使用 MiSans-Regular 等）。
              </Paragraph>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                以下推流页面使用了 <Text strong>YouSheBiaoTiHei</Text>（优设标题黑）字体，该字体<Text strong>未随软件打包</Text>，需要您在电脑上自行安装后才能正常显示，未安装时页面会自动回退到 MiSans：
              </Paragraph>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                · 推流页面2（比分栏等标题）· 推流页面5（登场/胜率排行）· 推流页面6（比赛结果）· 等待页
              </Paragraph>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                下载 YouSheBiaoTiHei：
                <Link href="https://www.fonts.net.cn/font-38213257557.html" target="_blank">免登录下载</Link>
                &nbsp;·&nbsp;
                <Link href="https://www.uisdc.com/uisdc-first-free-font" target="_blank">官网下载（需登录）</Link>
              </Paragraph>
            </Space>
          </Card>
          <Card size="small" className="subtle-card" title="数据来源">
            <Space direction="vertical" size={8} className="page-stack">
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                本应用相关数据由洛克魔法书（rocom.shallow.ink）提供，仅供娱乐参考。数据源于民间整理、用户授权接口返回或算法推断，非《洛克王国》官方数据，与官方无任何关联。游戏素材及版权归属于《洛克王国》项目组，准确信息请以官方游戏内为准。因使用数据产生的任何后果与争议，由使用者自行承担，本应用及洛克魔法书团队不承担任何责任。
              </Paragraph>
            </Space>
          </Card>
        </Space>
      </Card>
    </Space>
  );
}
