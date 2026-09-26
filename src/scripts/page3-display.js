(function () {
    'use strict';

    const MAX_SLOTS = 6;
    const DEFAULT_BEST_OF = 7;
    const DEFAULT_AVATARS = {
        left: '/assets/ui/left-avatar.png',
        right: '/assets/ui/right-avatar.png'
    };
    // 红光特效：自动档任一侧阵亡精灵数达到阈值即显示；
    // 阵亡精灵中含下列可复活精灵（卡瓦重/卡卡虫/丢丢，任意形态）时阈值提升为 4
    const RED_LIGHT_IMAGE_URL = '/assets/Effect/red-light.jpg';
    const RED_LIGHT_SPECIAL_NAMES = new Set(['卡瓦重', '卡卡虫', '丢丢']);
    const RED_LIGHT_DEAD_THRESHOLD = 3;
    const RED_LIGHT_SPECIAL_DEAD_THRESHOLD = 4;

    const panelStates = {
        left: { signatures: new Array(MAX_SLOTS).fill(null) },
        right: { signatures: new Array(MAX_SLOTS).fill(null) }
    };
    const lastRenderedSlots = {
        left: new Array(MAX_SLOTS).fill(null),
        right: new Array(MAX_SLOTS).fill(null)
    };
    const exitLayer = document.getElementById('page3LineupExitLayer');
    const redLightLayer = document.getElementById('page3RedLight');

    let scoreboardSignature = null;
    let avatarSignature = null;
    let nextGameSignature = null;
    let matchPhaseSignature = null;
    let activeMatchIdSignature;
    let page3SpriteSource = 'sprite';
    let page3RankVisible = false;
    let page3TeamVisible = false;
    let page3RedLightMode = 'off';
    // 手动档是否已手动开启（显示至下一对局，切档可重新触发）
    let redLightManualActive = false;
    let redLightVisible = false;
    let scoreboardDataCache = null;
    let storeDataCache = null;
    let profilesDataCache = null;
    const panelDataCache = { left: null, right: null };
    const spriteNameImageCache = new Map();
    const teamNameImageCache = new Map();
    let lineupAnimationTimer = null;
    let lineupAnimationMode = null;

    const LINEUP_ANIMATION_MS = 760;

    // 排名数字距离图标左侧的 x 偏移（按显示位数，10000+ 视为 6 位）
    const RANK_TEXT_LEFT_BY_LENGTH = { 1: 22, 2: 16, 3: 12, 4: 7, 5: 3, 6: -2 };

    function clamp(value, min, max, fallback) {
        if (value === null || value === undefined || value === '') {
            return fallback;
        }
        const number = Number(value);
        if (Number.isNaN(number)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, number));
    }

    function normalizeBestOf(value) {
        const number = Number(value);
        return [1, 3, 5, 7].includes(number) ? number : DEFAULT_BEST_OF;
    }

    function normalizeDisplayName(value) {
        return String(value || '').trim().replace(/[-_－—]\d+$/, '');
    }

    function getSpriteDisplayName(sprite) {
        if (!sprite || typeof sprite !== 'object') {
            return '';
        }
        return normalizeDisplayName(
            sprite.displayName || sprite.name || sprite.filename || ''
        );
    }

    function getSlotSignature(slotData) {
        const sprite = slotData && slotData.sprite ? slotData.sprite : null;
        return JSON.stringify({
            id: sprite ? sprite.id || sprite.path || getSpriteDisplayName(sprite) : null,
            name: getSpriteDisplayName(sprite),
            path: sprite && sprite.path ? sprite.path : '',
            opacityEnabled: !!(slotData && slotData.opacityEnabled),
            effectiveOpacity: clamp(slotData && slotData.effectiveOpacity, 0, 1, 1),
            saturation: clamp(slotData && slotData.saturation, 0, 3, 1),
            healthEnabled: !!(slotData && slotData.healthEnabled),
            healthPercent: clamp(slotData && slotData.healthPercent, 0, 100, 100),
            energyValue: clamp(slotData && slotData.energyValue, 0, 10, 10)
        });
    }

    function getInitial(name, fallback) {
        const text = String(name || '').trim();
        if (!text) {
            return fallback;
        }
        return text[0].toUpperCase();
    }

    function getSpriteAttributeIcons(sprite) {
        const icons = [];

        if (sprite && sprite.attributeIcon1) {
            icons.push(sprite.attributeIcon1);
        }
        if (sprite && sprite.attributeIcon2) {
            icons.push(sprite.attributeIcon2);
        }

        return icons;
    }

    function getSpriteCardNameLeft(nameLength) {
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

    function buildSpriteNameImage(name, cardSize) {
        const fontSize = cardSize * 8 / 96;
        const lineHeight = cardSize * 14 / 96;
        const scale = 4;
        const cacheKey = `${name}|${cardSize}|${fontSize}`;
        const cached = spriteNameImageCache.get(cacheKey);
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
        spriteNameImageCache.set(cacheKey, result);
        return result;
    }

    function buildSlotCard(slotEl, sprite, spiritName, imageSrc) {
        const attributeIcons = getSpriteAttributeIcons(sprite);
        const attributeIcon1 = attributeIcons[0] || '';
        const attributeIcon2 = attributeIcons[1] || '';
        const cardSize = slotEl.clientWidth || 108;
        const nameImage = buildSpriteNameImage(spiritName, cardSize);
        const card = document.createElement('div');
        card.className = `sprite-pet-card${attributeIcon2 ? ' sprite-pet-card-has-attr2' : ''}`;
        card.style.setProperty('--pet-card-size', `${cardSize}px`);
        card.style.setProperty('--pet-name-left', String(getSpriteCardNameLeft(spiritName.length)));

        card.innerHTML = `
            <div class="sprite-pet-card-bg"></div>
            ${attributeIcon2 ? '<div class="sprite-pet-card-attr-circle"></div>' : ''}
            <img class="sprite-pet-card-sprite" alt="">
            ${attributeIcon1 ? '<img class="sprite-pet-card-attr sprite-pet-card-attr-1" alt="">' : ''}
            ${attributeIcon2 ? '<img class="sprite-pet-card-attr sprite-pet-card-attr-2" alt="">' : ''}
            <div class="sprite-pet-card-name-bg"></div>
            <img class="sprite-pet-card-name sprite-pet-card-name-image" alt="">
        `;

        const spriteImage = card.querySelector('.sprite-pet-card-sprite');
        spriteImage.src = imageSrc;
        spriteImage.alt = spiritName;

        if (attributeIcon1) {
            const attr1 = card.querySelector('.sprite-pet-card-attr-1');
            attr1.src = attributeIcon1;
        }

        if (attributeIcon2) {
            const attr2 = card.querySelector('.sprite-pet-card-attr-2');
            attr2.src = attributeIcon2;
        }

        const nameEl = card.querySelector('.sprite-pet-card-name');
        if (nameImage) {
            nameEl.src = nameImage.src;
            nameEl.width = nameImage.width;
            nameEl.height = nameImage.height;
            nameEl.alt = spiritName;
        }

        slotEl.innerHTML = '';
        slotEl.appendChild(card);
    }

    function renderEmptySlot(slotEl) {
        slotEl.className = 'page3-spirit-slot';
        slotEl.innerHTML = '';
        delete slotEl.dataset.spriteKey;
    }

    function renderSlot(slotEl, slotData, mtime) {
        const sprite = slotData && slotData.sprite ? slotData.sprite : null;
        if (!sprite || !sprite.path) {
            renderEmptySlot(slotEl);
            return;
        }

        const spiritName = getSpriteDisplayName(sprite);
        const healthPercent = clamp(slotData && slotData.healthPercent, 0, 100, 100);
        const healthEnabled = !!(slotData && slotData.healthEnabled);
        const isDone = healthEnabled && healthPercent <= 0;

        // 精灵身份签名（不含血量/阵亡）：精灵或立绘来源变化时才重建卡片并刷新图片，
        // 阵亡/复活只切换 className（CSS 负责 240ms 渐变），避免重建 <img> 导致渐变被打断
        const spriteKey = JSON.stringify({
            id: sprite.id || sprite.path || spiritName,
            name: spiritName,
            path: sprite.path || '',
            iconUrl: sprite.iconUrl || '',
            source: page3SpriteSource === 'thumbnail' ? 'thumbnail' : 'sprite',
        });

        slotEl.className = `page3-spirit-slot is-active${isDone ? ' is-done' : ''}`;
        if (lineupAnimationMode === 'enter') {
            slotEl.classList.add('is-lineup-entering');
        }

        // 精灵没变：保留卡片 DOM，只留 className 变化交由过渡完成
        if (slotEl.dataset.spriteKey === spriteKey) {
            return;
        }
        slotEl.dataset.spriteKey = spriteKey;

        const cacheBuster = mtime ? Math.floor(mtime) : Date.now();
        const imageCandidates = getSpriteImageCandidates(sprite)
            .map((src) => `${src}${src.includes('?') ? '&' : '?'}t=${cacheBuster}`);

        buildSlotCard(slotEl, sprite, spiritName, imageCandidates[0] || '');
        const spriteImage = slotEl.querySelector('.sprite-pet-card-sprite');
        if (page3SpriteSource === 'thumbnail' && slotEl.dataset.side === 'right') {
            spriteImage.classList.add('is-page3-icon-flipped');
        }
        let imageIndex = 0;
        spriteImage.onerror = () => {
            imageIndex += 1;
            if (imageIndex < imageCandidates.length) {
                spriteImage.src = imageCandidates[imageIndex];
            } else {
                spriteImage.onerror = null;
            }
        };
    }

    function renderPanel(position, panelData) {
        panelDataCache[position] = panelData || null;
        const selected = panelData && Array.isArray(panelData.selected) ? panelData.selected : [];
        const slotEls = document.querySelectorAll(`.page3-spirit-slot[data-side="${position}"]`);

        slotEls.forEach((slotEl, index) => {
            const slotData = selected[index] || null;
            const nextSignature = getSlotSignature(slotData);

            // 面板清空可能先于 matches:update 到达。先复制到独立退场层，
            // 原阵容可以立即按业务状态清空，动画不受影响。
            if (!slotData && slotEl.classList.contains('is-active') && lineupAnimationMode !== 'exit') {
                animateLineup('exit');
                panelStates[position].signatures[index] = nextSignature;
                return;
            }

            if (panelStates[position].signatures[index] === nextSignature) {
                return;
            }

            if (!slotData && lineupAnimationMode === 'exit') {
                renderEmptySlot(slotEl);
                panelStates[position].signatures[index] = nextSignature;
                return;
            }

            renderSlot(slotEl, slotData, panelData ? panelData.mtime : null);
            panelStates[position].signatures[index] = nextSignature;
            if (slotData && slotEl.classList.contains('is-active')) {
                lastRenderedSlots[position][index] = slotEl.cloneNode(true);
            } else if (!slotData) {
                lastRenderedSlots[position][index] = null;
            }
        });

        applyRedLightVisible();
    }

    function isSlotDead(slotData) {
        return Boolean(slotData && slotData.healthEnabled && Number(slotData.healthPercent) <= 0);
    }

    // 精灵基础名：displayName 为纯名称；兜底去掉 name 的形态后缀（如 卡瓦重（草地附近的样子））
    function getRedLightSpriteName(sprite) {
        if (!sprite) {
            return '';
        }
        const displayName = String(sprite.displayName || '').trim();
        if (displayName) {
            return displayName;
        }
        return String(sprite.name || '').replace(/[（(][^）)]*[）)]\s*$/, '').trim();
    }

    // 自动开启条件：任一选手一侧阵亡精灵数达到阈值；
    // 该侧阵亡精灵中含卡瓦重/卡卡虫/丢丢时阈值提升为 4
    function isRedLightAutoTriggered() {
        return ['left', 'right'].some(side => {
            const panel = panelDataCache[side];
            const selected = panel && Array.isArray(panel.selected) ? panel.selected : [];
            const deadSprites = selected
                .filter(slotData => isSlotDead(slotData) && slotData.sprite)
                .map(slotData => slotData.sprite);
            if (deadSprites.length < RED_LIGHT_DEAD_THRESHOLD) {
                return false;
            }
            const hasSpecial = deadSprites.some(sprite => RED_LIGHT_SPECIAL_NAMES.has(getRedLightSpriteName(sprite)));
            return deadSprites.length >= (hasSpecial ? RED_LIGHT_SPECIAL_DEAD_THRESHOLD : RED_LIGHT_DEAD_THRESHOLD);
        });
    }

    function computeRedLightVisible() {
        if (page3RedLightMode === 'auto') {
            return isRedLightAutoTriggered();
        }
        if (page3RedLightMode === 'manual') {
            return redLightManualActive;
        }
        return false;
    }

    function applyRedLightVisible() {
        const nextVisible = computeRedLightVisible();
        if (nextVisible === redLightVisible) {
            return;
        }
        redLightVisible = nextVisible;
        if (redLightLayer) {
            redLightLayer.classList.toggle('is-visible', nextVisible);
        }
    }

    function setPage3RedLightMode(mode) {
        const nextMode = mode === 'manual' || mode === 'auto' ? mode : 'off';
        if (nextMode === page3RedLightMode) {
            return;
        }
        // 手动档：切换到手动即视为一次手动开启，显示至下一对局（observeMatchPhase 观察对局边界后失效）
        redLightManualActive = nextMode === 'manual';
        page3RedLightMode = nextMode;
        applyRedLightVisible();
    }

    // 红光特效图运行时处理：黑底按亮度转 alpha（近似反预乘，叠加结果接近滤色），
    // 避免黑底遮挡透明叠层下的推流画面
    function prepareRedLightLayer() {
        const canvas = document.getElementById('page3RedLightCanvas');
        const image = new Image();
        image.onload = () => {
            const context = canvas ? canvas.getContext('2d') : null;
            if (!context) {
                return;
            }
            try {
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const pixels = imageData.data;
                for (let index = 0; index < pixels.length; index += 4) {
                    const maxChannel = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
                    if (maxChannel <= 12) {
                        pixels[index + 3] = 0;
                        continue;
                    }
                    pixels[index] = Math.round(pixels[index] * 255 / maxChannel);
                    pixels[index + 1] = Math.round(pixels[index + 1] * 255 / maxChannel);
                    pixels[index + 2] = Math.round(pixels[index + 2] * 255 / maxChannel);
                    pixels[index + 3] = maxChannel;
                }
                context.putImageData(imageData, 0, 0);
            } catch (error) {
                console.error('红光特效图片处理失败:', error);
            }
        };
        image.onerror = () => {
            console.error('红光特效图片加载失败:', RED_LIGHT_IMAGE_URL);
        };
        image.src = RED_LIGHT_IMAGE_URL;
    }


    function getSpriteImageCandidates(sprite) {
        const fallback = sprite && sprite.path ? String(sprite.path) : '';
        const iconUrl = sprite && sprite.iconUrl ? String(sprite.iconUrl).trim() : '';
        if (page3SpriteSource !== 'thumbnail' || !iconUrl) {
            return fallback ? [fallback] : [];
        }
        return [iconUrl, ...(fallback ? [fallback] : [])];
    }

    function getMatchPhase(payload) {
        const store = payload && payload.store;
        const matches = store && Array.isArray(store.matches) ? store.matches : [];
        const activeMatch = matches.find(match => match && match.id === store.activeMatchId);
        if (!activeMatch) {
            return 'none';
        }

        const currentGame = Array.isArray(activeMatch.games)
            ? activeMatch.games.find(game => game && game.status !== 'completed')
            : null;
        return currentGame && currentGame.status === 'in_progress' ? 'in_progress' : 'waiting';
    }

    function finishLineupAnimation() {
        if (lineupAnimationTimer) {
            window.clearTimeout(lineupAnimationTimer);
            lineupAnimationTimer = null;
        }
        lineupAnimationMode = null;
        if (exitLayer) {
            exitLayer.innerHTML = '';
        }
        spriteNameImageCache.clear();
        panelStates.left.signatures.fill(getSlotSignature(null));
        panelStates.right.signatures.fill(getSlotSignature(null));
    }

    function buildExitLayer() {
        if (!exitLayer) {
            return;
        }
        exitLayer.innerHTML = '';
        ['left', 'right'].forEach(side => {
            lastRenderedSlots[side].forEach((savedSlot, index) => {
                if (!savedSlot) {
                    return;
                }
                const clone = savedSlot.cloneNode(true);
                clone.dataset.side = side;
                clone.dataset.slot = String(index);
                clone.classList.remove('is-lineup-entering', 'is-lineup-exiting');
                clone.classList.add('page3-lineup-exit-slot');
                const sourceSlot = document.querySelector(`.page3-spirit-slot[data-side="${side}"][data-slot="${index}"]`);
                const left = sourceSlot ? sourceSlot.offsetLeft : 0;
                const top = sourceSlot ? sourceSlot.offsetTop : 0;
                const width = sourceSlot ? sourceSlot.offsetWidth : 108;
                const height = sourceSlot ? sourceSlot.offsetHeight : 108;
                clone.style.left = `${left}px`;
                clone.style.top = `${top}px`;
                clone.style.width = `${width}px`;
                clone.style.height = `${height}px`;
                exitLayer.appendChild(clone);
            });
        });
    }

    function animateLineup(mode) {
        if (lineupAnimationTimer) {
            window.clearTimeout(lineupAnimationTimer);
            lineupAnimationTimer = null;
        }
        lineupAnimationMode = mode;

        if (mode === 'exit') {
            buildExitLayer();
        } else if (exitLayer) {
            exitLayer.innerHTML = '';
        }

        const slots = document.querySelectorAll('.page3-spirit-slot');
        slots.forEach(slotEl => {
            const side = slotEl.dataset.side;
            const slot = Number(slotEl.dataset.slot || 0);
            const delayIndex = side === 'right' ? MAX_SLOTS - 1 - slot : slot;
            slotEl.style.setProperty('--page3-lineup-delay', `${delayIndex * 72}ms`);
            slotEl.classList.remove('is-lineup-entering', 'is-lineup-exiting');
            void slotEl.offsetWidth;
            if (mode === 'enter') {
                slotEl.classList.add('is-lineup-entering');
            }
        });

        if (mode === 'exit' && exitLayer) {
            const exitSlots = exitLayer.querySelectorAll('.page3-lineup-exit-slot');
            exitSlots.forEach(slotEl => {
                const side = slotEl.dataset.side;
                const slot = Number(slotEl.dataset.slot || 0);
                const delayIndex = side === 'right' ? MAX_SLOTS - 1 - slot : slot;
                slotEl.style.setProperty('--page3-lineup-delay', `${delayIndex * 72}ms`);
                void slotEl.offsetWidth;
                slotEl.classList.add('is-lineup-exiting');
            });
        }

        if (mode === 'exit') {
            lineupAnimationTimer = window.setTimeout(finishLineupAnimation, LINEUP_ANIMATION_MS + 6 * 72 + 40);
        } else {
            lineupAnimationTimer = window.setTimeout(() => {
                document.querySelectorAll('.page3-spirit-slot.is-lineup-entering').forEach(slotEl => {
                    slotEl.classList.remove('is-lineup-entering');
                });
                lineupAnimationMode = null;
                lineupAnimationTimer = null;
            }, LINEUP_ANIMATION_MS + 6 * 72 + 40);
        }
    }

    function getActiveMatchId(payload) {
        const store = payload && payload.store;
        return store && store.activeMatchId ? String(store.activeMatchId) : '';
    }

    function observeMatchPhase(payload) {
        const nextPhase = getMatchPhase(payload);
        const nextMatchId = getActiveMatchId(payload);
        // 进入下一对局（换比赛或新小局开始）时，手动档红光特效自动失效（需重新切档再次触发）
        const matchChanged = activeMatchIdSignature !== undefined && activeMatchIdSignature !== nextMatchId;
        const gameStarted = matchPhaseSignature !== null && matchPhaseSignature !== 'in_progress' && nextPhase === 'in_progress';
        activeMatchIdSignature = nextMatchId;
        if (matchChanged || gameStarted) {
            redLightManualActive = false;
            applyRedLightVisible();
        }

        if (matchPhaseSignature === null) {
            matchPhaseSignature = nextPhase;
            return;
        }
        if (matchPhaseSignature === nextPhase) {
            return;
        }

        const previousPhase = matchPhaseSignature;
        matchPhaseSignature = nextPhase;
        if (previousPhase === 'in_progress' && nextPhase !== 'in_progress') {
            animateLineup('exit');
        } else if (previousPhase !== 'in_progress' && nextPhase === 'in_progress') {
            // 开始本局时 matches:update 先于 panel:update 到达，等阵容 DOM 更新后再播放。
            window.setTimeout(() => animateLineup('enter'), 0);
        }
    }

    function scaleNameFont(value) {
        return Math.round(clamp(value, 12, 160, 64) * 0.5625);
    }

    function scaleScoreFont(value) {
        return Math.round(clamp(value, 12, 160, 64) * 0.75);
    }

    function formatRankText(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits) {
            return '';
        }
        return Number(digits) > 10000 ? '10000+' : digits;
    }

    function renderRank(side, value) {
        const rankEl = document.getElementById(side === 'left' ? 'page3LeftRank' : 'page3RightRank');
        if (!rankEl) {
            return;
        }
        const txtEl = rankEl.querySelector('.page3-rank-txt');
        const text = formatRankText(value);

        // 直播推流开关关闭时隐藏整个图标；开启但未输入排名时仅隐藏数字
        rankEl.hidden = !page3RankVisible;
        if (!txtEl) {
            return;
        }
        txtEl.hidden = !page3RankVisible || !text;
        if (!text) {
            return;
        }

        txtEl.textContent = text;
        txtEl.style.left = `${RANK_TEXT_LEFT_BY_LENGTH[Math.min(text.length, 6)]}px`;
    }

    // 战队名称渲染为 PNG（MiSans-Semibold 15px #585858），缓存避免重复绘制与字体兼容问题
    function buildTeamNameImage(name) {
        const text = String(name || '').trim();
        if (!text) {
            return null;
        }

        const cached = teamNameImageCache.get(text);
        if (cached) {
            return cached;
        }

        const fontSize = 15;
        const lineHeight = 18;
        const scale = 4;
        const measureCanvas = document.createElement('canvas');
        const measureContext = measureCanvas.getContext('2d');
        if (!measureContext) {
            return null;
        }
        measureContext.font = `600 ${fontSize}px "MiSans-Semibold", "Microsoft YaHei", sans-serif`;
        const textWidth = Math.ceil(measureContext.measureText(text).width) + 2;

        const canvas = document.createElement('canvas');
        canvas.width = textWidth * scale;
        canvas.height = Math.ceil(lineHeight * scale);
        const context = canvas.getContext('2d');
        if (!context) {
            return null;
        }
        context.scale(scale, scale);
        context.font = `600 ${fontSize}px "MiSans-Semibold", "Microsoft YaHei", sans-serif`;
        context.fillStyle = '#585858';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, textWidth / 2, lineHeight / 2);

        const result = {
            src: canvas.toDataURL('image/png'),
            width: textWidth,
            height: lineHeight,
        };
        teamNameImageCache.set(text, result);
        return result;
    }

    function renderTeamSide(side, teamName, teamLogo) {
        const teamEl = document.getElementById(side === 'left' ? 'page3LeftTeam' : 'page3RightTeam');
        if (!teamEl) {
            return;
        }

        const name = String(teamName || '').trim();
        // 开关关闭或当前对局未填写所属战队时不显示
        teamEl.hidden = !page3TeamVisible || !name;
        if (teamEl.hidden) {
            return;
        }

        const logoEl = document.getElementById(side === 'left' ? 'page3LeftTeamLogo' : 'page3RightTeamLogo');
        const nameEl = document.getElementById(side === 'left' ? 'page3LeftTeamName' : 'page3RightTeamName');

        // logo 优先取「信息录入」战队；未录入或未上传时仅显示名称色块
        if (logoEl) {
            if (teamLogo && teamLogo.logoExists) {
                const cacheBuster = teamLogo.logoMtime ? Math.floor(teamLogo.logoMtime) : Date.now();
                logoEl.src = `/runtime/profiles/teams/${encodeURIComponent(teamLogo.id)}.png?t=${cacheBuster}`;
                logoEl.classList.add('is-visible');
            } else {
                logoEl.classList.remove('is-visible');
                logoEl.removeAttribute('src');
            }
        }

        if (nameEl) {
            const nameImage = buildTeamNameImage(name);
            if (nameImage) {
                nameEl.src = nameImage.src;
                nameEl.width = nameImage.width;
                nameEl.height = nameImage.height;
                nameEl.alt = name;
            } else {
                nameEl.removeAttribute('src');
            }
        }
    }

    function renderTeams() {
        const store = storeDataCache || {};
        const matches = Array.isArray(store.matches) ? store.matches : [];
        const activeMatch = matches.find(match => match && match.id === store.activeMatchId) || null;
        const teams = profilesDataCache && Array.isArray(profilesDataCache.teams) ? profilesDataCache.teams : [];

        const teamBySide = {
            left: null,
            right: null
        };
        if (activeMatch) {
            const leftId = activeMatch.leftTeamId || '';
            const rightId = activeMatch.rightTeamId || '';
            if (leftId) {
                teamBySide.left = teams.find(team => team && team.id === leftId) || null;
            }
            if (rightId) {
                teamBySide.right = teams.find(team => team && team.id === rightId) || null;
            }
        }

        renderTeamSide('left', activeMatch ? activeMatch.leftTeamName : '', teamBySide.left);
        renderTeamSide('right', activeMatch ? activeMatch.rightTeamName : '', teamBySide.right);
    }

    function renderScoreboard(scoreboard) {
        const data = scoreboard || {};
        scoreboardDataCache = data;
        const nextSignature = JSON.stringify({
            leftName: data.leftName || '',
            leftScore: data.leftScore || '0',
            leftRank: data.leftRank || '',
            rightName: data.rightName || '',
            rightScore: data.rightScore || '0',
            rightRank: data.rightRank || '',
            bestOf: normalizeBestOf(data.bestOf),
            scoreboardEnabled: data.scoreboardEnabled !== false,
            nameFontSize: scaleNameFont(data.nameFontSize),
            scoreFontSize: scaleScoreFont(data.scoreFontSize),
            rankVisible: page3RankVisible
        });

        if (scoreboardSignature === nextSignature) {
            return;
        }

        scoreboardSignature = nextSignature;

        const scoreboardEl = document.getElementById('page3Scoreboard');
        scoreboardEl.classList.toggle('is-hidden', data.scoreboardEnabled === false);
        scoreboardEl.style.setProperty('--page3-name-size', `${clamp(scaleNameFont(data.nameFontSize), 24, 42, 36)}px`);
        scoreboardEl.style.setProperty('--page3-score-size', `${clamp(scaleScoreFont(data.scoreFontSize), 32, 60, 48)}px`);

        const leftName = data.leftName || '';
        const rightName = data.rightName || '';

        document.getElementById('page3LeftName').textContent = leftName;
        document.getElementById('page3RightName').textContent = rightName;
        document.getElementById('page3LeftScore').textContent = data.leftScore || '0';
        document.getElementById('page3RightScore').textContent = data.rightScore || '0';
        document.getElementById('page3BestOf').textContent = `BO${normalizeBestOf(data.bestOf)}`;
        document.getElementById('page3LeftAvatar').textContent = getInitial(leftName, 'L');
        document.getElementById('page3RightAvatar').textContent = getInitial(rightName, 'R');

        renderRank('left', data.leftRank);
        renderRank('right', data.rightRank);
    }

    function renderAvatar(side, avatarState) {
        const imageEl = document.getElementById(side === 'left' ? 'page3LeftAvatarImage' : 'page3RightAvatarImage');
        const textEl = document.getElementById(side === 'left' ? 'page3LeftAvatar' : 'page3RightAvatar');
        const avatar = avatarState || {};
        const defaultPath = DEFAULT_AVATARS[side];

        if (avatar.exists && avatar.path) {
            const cacheBuster = avatar.mtime ? Math.floor(avatar.mtime) : Date.now();
            imageEl.src = `${avatar.path}?t=${cacheBuster}`;
            imageEl.style.display = 'block';
            textEl.style.display = 'none';
            return;
        }

        imageEl.src = defaultPath;
        imageEl.style.display = 'block';
        textEl.style.display = 'none';
    }

    function renderAvatars(avatars) {
        const data = avatars || {};
        const nextSignature = JSON.stringify({
            leftPath: data.left && data.left.exists ? data.left.path : '',
            leftMtime: data.left && data.left.exists ? data.left.mtime : null,
            rightPath: data.right && data.right.exists ? data.right.path : '',
            rightMtime: data.right && data.right.exists ? data.right.mtime : null
        });

        if (avatarSignature === nextSignature) {
            return;
        }

        avatarSignature = nextSignature;
        renderAvatar('left', data.left);
        renderAvatar('right', data.right);
    }

    function applySnapshot(payload) {
        const panels = payload && Array.isArray(payload.panels) ? payload.panels : [];
        observeMatchPhase(payload);
        setPage3SpriteSource(payload && payload.stage ? payload.stage.page3SpriteSource : 'sprite');
        setPage3RankVisible(payload && payload.stage ? payload.stage.page3RankVisible === true : false);
        setPage3TeamVisible(payload && payload.stage ? payload.stage.page3TeamVisible === true : false);
        setPage3RedLightMode(payload && payload.stage ? payload.stage.page3RedLightMode : 'off');
        storeDataCache = payload ? payload.store || null : null;
        profilesDataCache = payload ? payload.profiles || null : null;
        renderTeams();
        renderScoreboard(payload ? payload.scoreboard : null);
        renderAvatars(payload ? payload.avatars : null);
        renderNextGame(payload ? payload.nextgame : null);
        renderPanel('left', panels.find(panel => panel && panel.position === 'left'));
        renderPanel('right', panels.find(panel => panel && panel.position === 'right'));
    }

    function setPage3SpriteSource(source) {
        const nextSource = source === 'thumbnail' ? 'thumbnail' : 'sprite';
        if (page3SpriteSource === nextSource) {
            return;
        }
        page3SpriteSource = nextSource;
        panelStates.left.signatures.fill(null);
        panelStates.right.signatures.fill(null);
        renderPanel('left', panelDataCache.left);
        renderPanel('right', panelDataCache.right);
    }

    function setPage3RankVisible(visible) {
        const next = visible === true;
        if (page3RankVisible === next) {
            return;
        }
        page3RankVisible = next;
        renderScoreboard(scoreboardDataCache);
    }

    function setPage3TeamVisible(visible) {
        const next = visible === true;
        if (page3TeamVisible === next) {
            return;
        }
        page3TeamVisible = next;
        renderTeams();
    }

    // 设置下场对局选手名字：超过 5 个字时开启横向滚动
    function setNextGameName(nameEl, text) {
        const inner = nameEl.querySelector('.page3-nextgame-name-inner');
        const nameText = String(text || '');

        if (inner) {
            inner.textContent = nameText;
        } else {
            nameEl.textContent = nameText;
        }

        nameEl.classList.toggle('is-scrolling', nameText.length > 5);

        if (!inner || !nameEl.classList.contains('is-scrolling')) {
            nameEl.style.removeProperty('--marquee-offset');
            return;
        }

        // The text remains centered at rest, so only half of its overflow is
        // needed to bring either edge into view.
        const overflow = inner.scrollWidth - nameEl.clientWidth;
        if (overflow > 0) {
            const offset = Math.ceil(overflow / 2);
            nameEl.style.setProperty('--marquee-offset', `-${offset}px`);
        } else {
            nameEl.style.removeProperty('--marquee-offset');
        }
    }

    function renderNextGame(payload) {
        const data = payload || {};
        const state = data.state || {};
        const match = data.match || null;
        const avatars = data.avatars || {};

        const nextSignature = JSON.stringify({
            visible: Boolean(state.visible),
            matchId: state.matchId || '',
            leftName: match ? match.leftPlayer || '' : '',
            rightName: match ? match.rightPlayer || '' : '',
            leftAvatar: avatars.left && avatars.left.exists ? (avatars.left.path || '') : '',
            leftMtime: avatars.left && avatars.left.exists ? avatars.left.mtime : null,
            rightAvatar: avatars.right && avatars.right.exists ? (avatars.right.path || '') : '',
            rightMtime: avatars.right && avatars.right.exists ? avatars.right.mtime : null,
        });

        if (nextGameSignature === nextSignature) {
            return;
        }
        nextGameSignature = nextSignature;

        const el = document.getElementById('page3NextGame');
        const isVisible = Boolean(state.visible) && Boolean(match);
        const wasVisible = !el.hidden;

        // 退场：先播放滑出动画，动画结束后再真正隐藏（超时兜底防止动画事件未触发时卡住）
        if (!isVisible && wasVisible) {
            el.hidden = false;
            el.classList.add('is-exiting');
            let exitFinished = false;
            let exitTimer = null;
            const finishExit = () => {
                if (exitFinished) {
                    return;
                }
                exitFinished = true;
                if (exitTimer) {
                    window.clearTimeout(exitTimer);
                    exitTimer = null;
                }
                el.classList.remove('is-exiting');
                el.hidden = true;
                el.removeEventListener('animationend', handleExit);
            };
            const handleExit = () => {
                finishExit();
            };
            el.addEventListener('animationend', handleExit);
            exitTimer = window.setTimeout(finishExit, 500);
            return;
        }

        if (!isVisible) {
            el.hidden = true;
            el.classList.remove('is-exiting');
            return;
        }

        // 进场：显示并触发从右到左滑入动画
        el.hidden = false;
        el.classList.remove('is-exiting');

        setNextGameName(document.getElementById('page3NextLeftName'), match.leftPlayer || '');
        setNextGameName(document.getElementById('page3NextRightName'), match.rightPlayer || '');

        const leftImg = document.getElementById('page3NextLeftAvatarImage');
        const rightImg = document.getElementById('page3NextRightAvatarImage');
        const leftAvatar = avatars.left || {};
        const rightAvatar = avatars.right || {};

        if (leftAvatar.exists && leftAvatar.path) {
            const cacheBuster = leftAvatar.mtime ? Math.floor(leftAvatar.mtime) : Date.now();
            leftImg.src = `${leftAvatar.path}?t=${cacheBuster}`;
        } else {
            leftImg.src = DEFAULT_AVATARS.left;
        }

        if (rightAvatar.exists && rightAvatar.path) {
            const cacheBuster = rightAvatar.mtime ? Math.floor(rightAvatar.mtime) : Date.now();
            rightImg.src = `${rightAvatar.path}?t=${cacheBuster}`;
        } else {
            rightImg.src = DEFAULT_AVATARS.right;
        }
    }

    async function loadInitialState() {
        const [imagesResponse, scoreboardResponse, avatarsResponse, nextgameResponse, matchesResponse, stageResponse, profilesResponse] = await Promise.all([
            fetch('api/panels'),
            fetch('api/scoreboard'),
            fetch('api/avatars'),
            fetch('api/nextgame'),
            fetch('api/matches'),
            fetch('api/stage'),
            fetch('api/profiles')
        ]);

        const [imagesData, scoreboardData, avatarsData, nextgameData, matchesData, stageData, profilesData] = await Promise.all([
            imagesResponse.json(),
            scoreboardResponse.json(),
            avatarsResponse.json(),
            nextgameResponse.json(),
            matchesResponse.json(),
            stageResponse.json(),
            profilesResponse.json()
        ]);

        applySnapshot({
            panels: imagesData.panels || [],
            scoreboard: scoreboardData,
            avatars: avatarsData,
            nextgame: nextgameData,
            store: matchesData,
            stage: stageData,
            profiles: profilesData
        });
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            console.error('Socket.IO 客户端未加载');
            return;
        }

        const socket = io({
            transports: ['websocket', 'polling']
        });

        socket.on('snapshot', payload => {
            applySnapshot(payload || {});
        });

        socket.on('panel:update', payload => {
            if (payload && payload.panel && payload.panel.position) {
                renderPanel(payload.panel.position, payload.panel);
            }
        });

        socket.on('scoreboard:update', payload => {
            renderScoreboard(payload ? payload.scoreboard : null);
        });

        socket.on('avatar:update', payload => {
            renderAvatars(payload ? payload.avatars : null);
        });

        socket.on('matches:update', payload => {
            observeMatchPhase({ store: payload ? payload.store : null });
            storeDataCache = payload ? payload.store || null : null;
            renderTeams();
        });

        socket.on('stage:update', payload => {
            const stage = payload && payload.stage ? payload.stage : payload;
            setPage3SpriteSource(stage && stage.page3SpriteSource);
            setPage3RankVisible(stage && stage.page3RankVisible === true);
            setPage3TeamVisible(stage && stage.page3TeamVisible === true);
            setPage3RedLightMode(stage && stage.page3RedLightMode);
        });

        socket.on('profiles:update', payload => {
            profilesDataCache = payload && payload.profiles ? payload.profiles : null;
            renderTeams();
        });

        socket.on('nextgame:update', payload => {
            renderNextGame(payload || null);
        });

        socket.on('connect_error', error => {
            console.error('Socket.IO 连接失败:', error);
        });
    }

    // 直播推流切换到页面3（iframe 重新加载）时播放一次阵容入场动画：
    // 载体 index.html 完成加载后派发 stage-enter 事件（scripts/stage-enter.js，
    // 该脚本保证每次切入只触发一次）。
    // - 切入时本局尚未开始：observeMatchPhase 首帧只记录不触发，这里补一次入场；
    // - 切入时数据尚未渲染完：animateLineup('enter') 先置 lineupAnimationMode，
    //   renderSlot 渲染槽位时自动带上 is-lineup-entering，动画不丢帧；
    // - 切入后开局：observeMatchPhase 会再触发一次入场，语义上属于新对局的业务动画。
    document.addEventListener('stage-enter', () => {
        animateLineup('enter');
    });

    document.addEventListener('DOMContentLoaded', async () => {
        prepareRedLightLayer();
        try {
            await loadInitialState();
            connectSocket();
        } catch (error) {
            console.error('初始化推流页面3失败:', error);
        }
    });
})();
