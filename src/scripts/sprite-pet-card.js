/**
 * sprite-pet-card 精灵立绘卡片组件 · 独立版（零依赖，浏览器直接引入）
 *
 * 立绘底图 + 双属性图标 + 底部名字条。page3（头像比分阵容，canvas 名字图）与
 * page5（出场/胜率排行，纯文本名字）共用，配套样式 styles/sprite-pet-card.css。
 *
 * 用法：
 *   <link rel="stylesheet" href="sprite-pet-card.css">
 *   <script src="sprite-pet-card.js"></script>
 *   const card = SpritePetCard.create({ name: '迪莫', nameMode: 'text', size: 128, ... });
 *   SpritePetCard.render(slotEl, { name, nameMode: 'canvas', sourceKey, images, sprite });
 *
 * 选项：
 *   name       精灵名（已由调用方规整为纯名；同时用作立绘 alt）
 *   nameMode   'canvas'（默认，名字用 canvas 画成 PNG，免字体环境差异）| 'text'（纯文本）
 *   size       卡片边长 px；缺省取 slotEl.clientWidth（create 固定 108 兜底）
 *   sprite     { attributeIcon1, attributeIcon2 } 属性图标地址（page3 传精灵索引记录、page5 传排行行）
 *   images     立绘候选队列（可带 cache-buster；只有第 1 个会进签名，其余仅作 onerror 降级）
 *   fallbackSrc 全部候选失败后的兜底图（page5 的 back.png）
 *   sourceKey  图片来源稳定标识（进签名；page3 = path+iconUrl+来源模式，page5 = spritePath）
 *
 * 行为约束：
 *   - 增量更新：sourceKey/名字/模式/尺寸/属性图标都没变时返回现有卡片（含 ?t= 的 images
 *     不进签名——page3 血量切换只允许切 class，重建卡片会打断 240ms 渐变）；
 *   - 名字图 canvas 不可用时自动降级为纯文本 span（无头环境 / 极旧内核不空名字）；
 *   - 属性图标加载失败自动移除该图标（取 page5 历史行为，page3 一并受益）；
 *   - 本组件只拥有 .sprite-pet-card 卡片节点本身；槽位外壳（page3-spirit-slot 等）
 *     与其上的状态类（is-active/is-done/is-lineup-entering）归各页面自管。
 */

(function (global) {
    'use strict';

    // 名字图缓存：key = name|cardSize|fontSize（finishLineupAnimation 等时机可整体清空）
    const nameImageCache = new Map();

    function getNameLeftByLength(nameLength) {
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

    /**
     * 名字画成 PNG（4x 超采样再由 CSS 缩回，避免小字号发虚）。
     * canvas 不可用（getContext 缺失）返回 null，由调用方降级为纯文本。
     */
    function buildNameImage(name, cardSize) {
        const fontSize = cardSize * 8 / 96;
        const lineHeight = cardSize * 14 / 96;
        const scale = 4;
        const cacheKey = `${name}|${cardSize}|${fontSize}`;
        const cached = nameImageCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const measureCanvas = document.createElement('canvas');
        const measureContext = measureCanvas.getContext('2d');
        if (!measureContext) {
            return null;
        }
        measureContext.font = `900 ${fontSize}px "MiSans-Heavy", "MiSans-Medium", "Microsoft YaHei", sans-serif`;
        const textWidth = Math.ceil(measureContext.measureText(name).width) + 2;
        const canvas = document.createElement('canvas');
        canvas.width = textWidth * scale;
        canvas.height = Math.ceil(lineHeight * scale);
        const context = canvas.getContext('2d');
        if (!context) {
            return null;
        }
        context.scale(scale, scale);
        context.font = `900 ${fontSize}px "MiSans-Heavy", "MiSans-Medium", "Microsoft YaHei", sans-serif`;
        context.fillStyle = '#fff';
        context.textBaseline = 'middle';
        context.fillText(name, 1, lineHeight / 2);

        const result = {
            src: canvas.toDataURL('image/png'),
            width: textWidth,
            height: lineHeight,
        };
        nameImageCache.set(cacheKey, result);
        return result;
    }

    function getAttributeIcons(sprite) {
        const attr1 = sprite && sprite.attributeIcon1 ? String(sprite.attributeIcon1) : '';
        const attr2 = sprite && sprite.attributeIcon2 ? String(sprite.attributeIcon2) : '';
        return [attr1, attr2];
    }

    /** 槽位里现有的卡片节点（直接子级中 class 含 sprite-pet-card 者） */
    function findCardEl(slotEl) {
        const children = slotEl.children || [];
        for (let index = 0; index < children.length; index += 1) {
            if (children[index].classList && children[index].classList.contains('sprite-pet-card')) {
                return children[index];
            }
        }
        return null;
    }

    /** 立绘：候选队列依次降级，末尾追加可选兜底图 */
    function attachSpriteSources(imgEl, images, fallbackSrc, alt) {
        const queue = fallbackSrc ? images.concat([String(fallbackSrc)]) : images.slice();
        imgEl.alt = alt;
        if (queue.length === 0) {
            imgEl.removeAttribute('src');
            return;
        }
        let index = 0;
        imgEl.onerror = () => {
            index += 1;
            if (index >= queue.length) {
                imgEl.onerror = null;
                return;
            }
            imgEl.src = queue[index];
        };
        imgEl.src = queue[0];
    }

    /** 属性图标：加载失败自动移除（不残留破图） */
    function appendAttributeIcon(cardEl, className, src) {
        const imgEl = document.createElement('img');
        imgEl.className = className;
        imgEl.alt = '';
        imgEl.onerror = () => {
            imgEl.onerror = null;
            imgEl.remove();
        };
        imgEl.src = src;
        cardEl.appendChild(imgEl);
    }

    function appendName(cardEl, name, nameMode, cardSize) {
        const nameImage = nameMode === 'canvas' ? buildNameImage(name, cardSize) : null;
        if (nameImage) {
            const imgEl = document.createElement('img');
            imgEl.className = 'sprite-pet-card-name sprite-pet-card-name-image';
            imgEl.src = nameImage.src;
            imgEl.width = nameImage.width;
            imgEl.height = nameImage.height;
            imgEl.alt = name;
            cardEl.appendChild(imgEl);
            return;
        }
        // canvas 不可用或显式 text 模式：纯文本名字（CSS 同一条 .sprite-pet-card-name 规则）
        const nameEl = document.createElement('span');
        nameEl.className = 'sprite-pet-card-name';
        nameEl.textContent = name;
        cardEl.appendChild(nameEl);
    }

    function buildCard(options) {
        const attr1 = options.attributeIcon1;
        const attr2 = options.attributeIcon2;
        const cardEl = document.createElement('div');
        cardEl.className = `sprite-pet-card${attr2 ? ' sprite-pet-card-has-attr2' : ''}`;
        cardEl.style.setProperty('--pet-card-size', `${options.size}px`);
        cardEl.style.setProperty('--pet-name-left', String(getNameLeftByLength(options.name.length)));

        const bgEl = document.createElement('div');
        bgEl.className = 'sprite-pet-card-bg';
        cardEl.appendChild(bgEl);

        if (attr2) {
            const circleEl = document.createElement('div');
            circleEl.className = 'sprite-pet-card-attr-circle';
            cardEl.appendChild(circleEl);
        }

        const spriteImg = document.createElement('img');
        spriteImg.className = 'sprite-pet-card-sprite';
        attachSpriteSources(spriteImg, options.images, options.fallbackSrc, options.name);
        cardEl.appendChild(spriteImg);

        if (attr1) {
            appendAttributeIcon(cardEl, 'sprite-pet-card-attr sprite-pet-card-attr-1', attr1);
        }
        if (attr2) {
            appendAttributeIcon(cardEl, 'sprite-pet-card-attr sprite-pet-card-attr-2', attr2);
        }

        const nameBgEl = document.createElement('div');
        nameBgEl.className = 'sprite-pet-card-name-bg';
        cardEl.appendChild(nameBgEl);

        appendName(cardEl, options.name, options.nameMode, options.size);
        return cardEl;
    }

    function resolveOptions(slotEl, options) {
        const opts = options || {};
        const name = String(opts.name || '').trim();
        const nameMode = opts.nameMode === 'text' ? 'text' : 'canvas';
        const size = opts.size ? Number(opts.size) : (slotEl.clientWidth || 108);
        const attributeIcons = getAttributeIcons(opts.sprite);
        return {
            name: name,
            nameMode: nameMode,
            size: size,
            attributeIcon1: attributeIcons[0],
            attributeIcon2: attributeIcons[1],
            images: (opts.images || []).map(String).filter(Boolean),
            fallbackSrc: opts.fallbackSrc ? String(opts.fallbackSrc) : '',
            sourceKey: opts.sourceKey !== undefined && opts.sourceKey !== null ? String(opts.sourceKey) : '',
        };
    }

    /**
     * 把槽位渲染成精灵立绘卡片（增量：签名不变返回现有卡片，签名变化才重建）。
     * 返回卡片元素（新建或现有）；name 与 images 全空时清空槽位并返回 null。
     */
    function render(slotEl, options) {
        const opts = resolveOptions(slotEl, options);
        if (!opts.name && opts.images.length === 0 && !opts.fallbackSrc) {
            const staleCard = findCardEl(slotEl);
            if (staleCard) {
                staleCard.remove();
            }
            delete slotEl.dataset.spritePetCardKey;
            return null;
        }

        // 签名只含稳定身份；images（可能带 ?t=）与血量等瞬态不进签名
        const cardKey = JSON.stringify({
            sourceKey: opts.sourceKey,
            name: opts.name,
            nameMode: opts.nameMode,
            size: opts.size,
            attr1: opts.attributeIcon1,
            attr2: opts.attributeIcon2,
        });

        const existingCard = findCardEl(slotEl);
        if (existingCard && slotEl.dataset.spritePetCardKey === cardKey) {
            return existingCard;
        }

        if (existingCard) {
            existingCard.remove();
        }
        slotEl.dataset.spritePetCardKey = cardKey;
        const cardEl = buildCard(opts);
        slotEl.appendChild(cardEl);
        return cardEl;
    }

    /** 新建一张独立卡片元素（无槽位包裹，page5 排行行直接挂载用） */
    function create(options) {
        return buildCard(resolveOptions(document.createElement('div'), options));
    }

    /** 清空名字图缓存（换字体/索引刷新等时机调用，画布会按需重建） */
    function clearNameImageCache() {
        nameImageCache.clear();
    }

    global.SpritePetCard = {
        render: render,
        create: create,
        clearNameImageCache: clearNameImageCache,
    };
})(typeof window !== 'undefined' ? window : this);
