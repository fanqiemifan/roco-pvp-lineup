import { describe, expect, it } from 'vitest';

import {
  addMinutesToHHmm,
  computeScheduleTimes,
  formatScheduleLabel,
  normalizeHHmm,
} from '../../shared/match-schedule';

describe('normalizeHHmm', () => {
  it('接受合法时间并补齐两位小时', () => {
    expect(normalizeHHmm('19:00')).toBe('19:00');
    expect(normalizeHHmm('9:05')).toBe('09:05');
    expect(normalizeHHmm('00:59')).toBe('00:59');
    expect(normalizeHHmm('23:30')).toBe('23:30');
  });

  it('拒绝非法时间', () => {
    expect(normalizeHHmm('')).toBe('');
    expect(normalizeHHmm('24:00')).toBe('');
    expect(normalizeHHmm('19:60')).toBe('');
    expect(normalizeHHmm('abc')).toBe('');
    expect(normalizeHHmm(null)).toBe('');
    expect(normalizeHHmm(undefined)).toBe('');
    expect(normalizeHHmm('7点')).toBe('');
  });
});

describe('addMinutesToHHmm', () => {
  it('按分钟累加并跨小时进位', () => {
    expect(addMinutesToHHmm('19:00', 30)).toBe('19:30');
    expect(addMinutesToHHmm('19:00', 90)).toBe('20:30');
    expect(addMinutesToHHmm('19:45', 30)).toBe('20:15');
  });

  it('跨天按 24 小时回绕', () => {
    expect(addMinutesToHHmm('23:30', 60)).toBe('00:30');
  });
});

describe('computeScheduleTimes', () => {
  const items = [
    { id: 'm1', bestOf: 1 },
    { id: 'm2', bestOf: 3 },
    { id: 'm3', bestOf: 5 },
  ];

  it('按 BO 数 × 30 分钟累加（BO1=30、BO3=90、BO5=150）', () => {
    expect(computeScheduleTimes(items, '19:00', {})).toEqual({
      m1: '19:00',
      m2: '19:30',
      m3: '21:00',
    });
  });

  it('未配置开始时间且无手动覆盖时返回空映射', () => {
    expect(computeScheduleTimes(items, '', {})).toEqual({});
    expect(computeScheduleTimes(items, 'bad', {})).toEqual({});
  });

  it('未配置开始时间时手动覆盖仍独立生效，不影响其他场', () => {
    expect(computeScheduleTimes(items, '', { m2: '20:00' })).toEqual({ m2: '20:00' });
  });

  it('手动覆盖只替换该场，不影响后续自动累加链', () => {
    expect(computeScheduleTimes(items, '19:00', { m2: '20:00' })).toEqual({
      m1: '19:00',
      m2: '20:00',
      m3: '21:00',
    });
  });

  it('非法手动覆盖回退自动时间', () => {
    expect(computeScheduleTimes(items, '19:00', { m2: 'bad' })).toEqual({
      m1: '19:00',
      m2: '19:30',
      m3: '21:00',
    });
  });
});

describe('formatScheduleLabel', () => {
  it('有时间时拼接场序与时间', () => {
    expect(formatScheduleLabel(0, '19:00')).toBe('第一场 19:00');
    expect(formatScheduleLabel(1, '19:30')).toBe('第二场 19:30');
    expect(formatScheduleLabel(8, '21:00')).toBe('第九场 21:00');
  });

  it('无时间时只显示场序', () => {
    expect(formatScheduleLabel(0, '')).toBe('第一场');
    expect(formatScheduleLabel(2, undefined)).toBe('第三场');
  });
});
