import type { ProfileStoreState, QuickFillMatch, SlotState } from '../../shared/types';

export type PanelSide = 'left' | 'right';
export type ViewKey = 'roster' | 'live' | 'history' | 'stats' | 'preview' | 'stage' | 'profiles' | 'page11' | 'about';

export type PreviewSlotKey = 'stage' | 'page1' | 'page2' | 'page3' | 'page5' | 'page6' | 'page7' | 'page8' | 'page9' | 'page10' | 'page11' | 'page12' | 'page13';

export type JsonInit = RequestInit & {
  json?: unknown;
};

export type MatchFormValues = {
  leftPlayer: string;
  rightPlayer: string;
  leftRank?: string;
  rightRank?: string;
  /** 左侧选手所属战队名称（可选，可从「信息录入」战队复用或手动输入） */
  leftTeam?: string;
  /** 右侧选手所属战队名称（可选，可从「信息录入」战队复用或手动输入） */
  rightTeam?: string;
  bestOf: number;
  tags?: string[];
};

/** 「信息录入」选手表单值（pets 为多选的常用精灵，保存时以「、」拼接为文本） */
export type PlayerProfileFormValues = {
  name: string;
  pets?: string[];
  declaration?: string;
  rank?: string;
};

/** 「信息录入」战队表单值 */
export type TeamProfileFormValues = {
  name: string;
  captain?: string;
  declaration?: string;
};

/** 批量上传选手头像的接口回执（按文件名匹配：matched 成功数 / unmatched 未命中名字 / failed 处理失败明细） */
export type PlayerAvatarBatchResponse = {
  success: boolean;
  profiles: ProfileStoreState;
  matched: number;
  unmatched: string[];
  failed: Array<{ name: string; reason: string }>;
};

export type CreateMatchValues = MatchFormValues;

export type PanelEditorState = {
  selected: SlotState[];
  activeSlot: number;
  quickFillInput: string;
  quickFillMatches: QuickFillMatch[];
  autoSaveEnabled: boolean;
  dirty: boolean;
  saving: boolean;
};

export type SpriteFilterState = {
  selectedAttributes: string[];
  selectedForms: string[];
  selectedFinalForm: boolean;
};

export type AttributeOption = {
  code: string;
  label: string;
  iconPath: string;
};

export type PreviewConfig = {
  title: string;
  fileName: string;
  path: string;
};

export type NoticeTone = 'success' | 'info' | 'warning' | 'error';

export type NoticeState = {
  tone: NoticeTone;
  text: string;
} | null;

export type LiveField = 'healthPercent' | 'energyValue';

export type LiveConfigPayload = {
  left: Array<{ name: string; HP: number; value: number }>;
  right: Array<{ name: string; HP: number; value: number }>;
};

declare global {
  interface Window {
    rocoDesktop?: {
      copyText?: (text: string) => Promise<void>;
      showOpenDialog?: () => Promise<string | null>;
      showSaveDialog?: () => Promise<string | null>;
      readTextFile?: (filePath: string) => Promise<string>;
      writeTextFile?: (filePath: string, text: string) => Promise<boolean>;
      statFile?: (filePath: string) => Promise<{ mtimeMs: number; size: number }>;
    };
    rocoFloat?: {
      toggle?: () => void;
      close?: () => void;
      reportShape?: (rect: { x: number; y: number; width: number; height: number }) => void;
      openMenu?: (payload: { side: string; slot: number; rect?: { x: number; y: number; width: number; height: number } }) => void;
      closeMenu?: () => void;
    };
    showOpenFilePicker?: (options?: unknown) => Promise<Array<{ getFile: () => Promise<File>; queryPermission?: (options?: unknown) => Promise<string>; requestPermission?: (options?: unknown) => Promise<string>; createWritable?: () => Promise<{ write: (text: string) => Promise<void>; close: () => Promise<void> }> }>>;
    showSaveFilePicker?: (options?: unknown) => Promise<{ getFile: () => Promise<File>; queryPermission?: (options?: unknown) => Promise<string>; requestPermission?: (options?: unknown) => Promise<string>; createWritable: () => Promise<{ write: (text: string) => Promise<void>; close: () => Promise<void> }> }>;
  }
}
