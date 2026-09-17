import React from 'react';
import type { SpriteRecord } from '../../../shared/types';
import { cleanSpriteCardName, getSpriteCardNameLeft } from '../lib/format';
import { resolveSpriteAttributeIcons } from '../lib/sprite';

export type SpritePetCardProps = {
  sprite: SpriteRecord;
  size?: number | string;
  className?: string;
};

export function SpritePetCard({ sprite, size = 96, className }: SpritePetCardProps) {
  const shortName = cleanSpriteCardName(sprite.displayName || sprite.name);
  const attributeIcons = resolveSpriteAttributeIcons(sprite);
  const attributeIcon1 = attributeIcons[0] ?? '';
  const attributeIcon2 = attributeIcons[1] ?? '';
  const cardSize = typeof size === 'number' ? `${size}px` : size;
  const style = {
    '--pet-card-size': cardSize,
    '--pet-name-left': String(getSpriteCardNameLeft(shortName.length)),
  } as React.CSSProperties;

  return (
    <div
      className={`sprite-pet-card${attributeIcon2 ? ' sprite-pet-card-has-attr2' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <div className="sprite-pet-card-bg" />
      {attributeIcon2 ? <div className="sprite-pet-card-attr-circle" /> : null}
      <img className="sprite-pet-card-sprite" src={sprite.path} alt={sprite.displayName} />
      {attributeIcon1 ? (
        <img className="sprite-pet-card-attr sprite-pet-card-attr-1" src={attributeIcon1} alt="" />
      ) : null}
      {attributeIcon2 ? (
        <img className="sprite-pet-card-attr sprite-pet-card-attr-2" src={attributeIcon2} alt="" />
      ) : null}
      <div className="sprite-pet-card-name-bg" />
      <span className="sprite-pet-card-name">{shortName}</span>
    </div>
  );
}
