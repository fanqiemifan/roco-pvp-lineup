export function basename(value: string | null | undefined): string {
  return String(value ?? '').split('/').filter(Boolean).pop() ?? '';
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function cleanSpriteName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\.(png|jpe?g|webp)$/i, '')
    .replace(/^NO\.\d+_/i, '')
    .replace(/[-_]\d+$/u, '');
}

export function cleanSpriteCardName(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/[-_－—]\d+$/u, '');
}

export function getSpriteCardNameLeft(nameLength: number): number {
  switch (nameLength) {
    case 2:
      return 44;
    case 3:
      return 40;
    case 4:
      return 37;
    case 5:
      return 34;
    default:
      return nameLength <= 2 ? 44 : 37;
  }
}
