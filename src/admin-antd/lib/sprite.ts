import type { SlotState, SpriteRecord } from '../../../shared/types';
import { ATTRIBUTE_ICON_BY_LABEL } from '../constants';
import { basename, cleanSpriteName } from './format';

export function buildSpriteLookup(records: SpriteRecord[]): Map<string, SpriteRecord> {
  const lookup = new Map<string, SpriteRecord>();

  records.forEach((sprite) => {
    const keys = new Set<string>([
      sprite.id,
      sprite.filename,
      sprite.displayName,
      sprite.name,
      basename(sprite.id),
      basename(sprite.filename),
      basename(sprite.path),
      ...(Array.isArray(sprite.aliases) ? sprite.aliases : []),
    ]);

    keys.forEach((key) => {
      if (typeof key === 'string' && key.trim()) {
        lookup.set(key.trim(), sprite);
      }
    });
  });

  return lookup;
}

export function splitSpriteAttributes(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(/[、/,，\s]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveSpriteAttributeIcons(sprite: SpriteRecord): string[] {
  const directIcons = [sprite.attributeIcon1, sprite.attributeIcon2].filter(Boolean);
  if (directIcons.length > 0) {
    return directIcons;
  }

  const directCodes = (sprite.attributeCodes ?? [])
    .map((code) => code.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((code) => `/resources/attribute/${code}.png`);

  if (directCodes.length > 0) {
    return directCodes;
  }

  return splitSpriteAttributes(sprite.attribute)
    .map((attribute) => ATTRIBUTE_ICON_BY_LABEL.get(attribute) ?? '')
    .filter(Boolean)
    .slice(0, 2);
}

export function resolveSpriteStatsName(sprite: SpriteRecord | null | undefined, fallback: string): string {
  return sprite?.name || sprite?.displayName || fallback;
}

export function getSlotName(slot: SlotState | null | undefined): string {
  const sprite = slot?.sprite;
  if (!sprite) {
    return '';
  }
  return cleanSpriteName(sprite.displayName || sprite.name || sprite.filename || sprite.id);
}
