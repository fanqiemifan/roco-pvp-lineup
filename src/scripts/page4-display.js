(function () {
    'use strict';

    const MAX_SLOTS = 6;
    // 精灵头像目录（sprites-icon，与 sprites-img 立绘同命名：{pet_id}_{name}.png）
    const SPRITE_ICON_RESOURCE_BASE = '/resources/sprites-icon';
    const unavailableIconPaths = new Set();

    const panelStates = {
        left: { signatures: new Array(MAX_SLOTS).fill(null) },
        right: { signatures: new Array(MAX_SLOTS).fill(null) }
    };

    function basename(value) {
        return String(value || '').split('/').filter(Boolean).pop() || '';
    }


    function getSpriteDisplayName(sprite) {
        if (!sprite || typeof sprite !== 'object') {
            return '';
        }
        return String(sprite.cardName || sprite.displayName || sprite.chineseName || sprite.name || basename(sprite.path) || '').trim();
    }

    function buildSpriteIconCandidates(sprite) {
        const iconUrl = String(sprite && sprite.iconUrl ? sprite.iconUrl : '').trim();
        return iconUrl ? [iconUrl] : [];
    }

    function resolveSpriteImageSources(sprite) {
        const fallbackSrc = sprite && sprite.path ? String(sprite.path) : '';
        const spriteIconCandidates = buildSpriteIconCandidates(sprite).filter((path) => !unavailableIconPaths.has(path));

        return {
            fallbackSrc,
            spriteIconCandidates,
        };
    }

    function syncImageState(slotEl, imageSrc) {
        slotEl.classList.toggle('is-sprite-icon', String(imageSrc || '').startsWith(SPRITE_ICON_RESOURCE_BASE));
    }

    function applySpriteImage(imgEl, sprite) {
        if (!imgEl) {
            return;
        }

        const imageSources = resolveSpriteImageSources(sprite);
        const sourceQueue = [...imageSources.spriteIconCandidates, ...(imageSources.fallbackSrc ? [imageSources.fallbackSrc] : [])];

        if (sourceQueue.length === 0) {
            imgEl.removeAttribute('src');
            imgEl.onerror = null;
            return;
        }

        const imageSignature = JSON.stringify(sourceQueue);
        if (imgEl.dataset.imageSignature === imageSignature) {
            return;
        }

        imgEl.dataset.imageSignature = imageSignature;
        let currentIndex = 0;

        const assignNext = () => {
            const nextSrc = sourceQueue[currentIndex];
            imgEl.dataset.currentSrc = nextSrc;
            syncImageState(imgEl.closest('.petsdiv3') || imgEl.parentElement, nextSrc);
            imgEl.src = nextSrc;
        };

        imgEl.onerror = () => {
            const failedSrc = imgEl.dataset.currentSrc || '';
            if (failedSrc.startsWith(SPRITE_ICON_RESOURCE_BASE)) {
                unavailableIconPaths.add(failedSrc);
            }

            currentIndex += 1;
            if (currentIndex >= sourceQueue.length) {
                imgEl.onerror = null;
                return;
            }

            assignNext();
        };

        assignNext();
    }

    function renderEmptySlot(slotEl) {
        slotEl.className = 'petsdiv3 is-empty';
        slotEl.innerHTML = '';
        delete slotEl.dataset.spriteKey;
    }

    function renderSlot(slotEl, slotData) {
        const sprite = slotData && slotData.sprite ? slotData.sprite : null;
        if (!sprite) {
            renderEmptySlot(slotEl);
            return;
        }

        const isDead = Boolean(slotData && slotData.isDead);
        // 阵亡状态只切换 className（CSS 负责 240ms 渐变），不进图片签名，
        // 否则每次阵亡都会重建 <img> 导致立绘重新加载、渐变被打断。
        const signature = JSON.stringify({
            id: sprite.id || sprite.path || getSpriteDisplayName(sprite),
            name: getSpriteDisplayName(sprite),
            path: sprite.path || '',
            iconUrl: sprite.iconUrl || '',
        });

        slotEl.className = `petsdiv3 is-active${isDead ? ' is-dead' : ''}`;

        if (slotEl.dataset.spriteKey !== signature) {
            slotEl.dataset.spriteKey = signature;
            slotEl.innerHTML = '<img alt="">';
        }

        const imgEl = slotEl.querySelector('img');
        if (imgEl) {
            imgEl.alt = getSpriteDisplayName(sprite);
            applySpriteImage(imgEl, sprite);
        }
    }

    function renderPanel(position, panelData) {
        const selected = panelData && Array.isArray(panelData.selected) ? panelData.selected : [];
        const slotEls = document.querySelectorAll(`.petsdiv3[data-side="${position}"]`);

        slotEls.forEach((slotEl, index) => {
            const slotData = selected[index] || null;
            const nextSignature = JSON.stringify({
                spriteKey: slotData && slotData.sprite ? (slotData.sprite.id || slotData.sprite.path || getSpriteDisplayName(slotData.sprite)) : null,
                isDead: Boolean(slotData && slotData.isDead),
            });

            if (panelStates[position].signatures[index] === nextSignature) {
                return;
            }

            renderSlot(slotEl, slotData);
            panelStates[position].signatures[index] = nextSignature;
        });
    }

    function applySnapshot(payload) {
        const page4 = payload && payload.page4 ? payload.page4 : null;
        const panels = page4 && Array.isArray(page4.panels) ? page4.panels : [];
        renderPanel('left', panels.find((panel) => panel && panel.position === 'left'));
        renderPanel('right', panels.find((panel) => panel && panel.position === 'right'));
    }

    async function loadInitialState() {
        const response = await fetch('/api/page4');
        const data = await response.json();
        applySnapshot({ page4: data });
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            return;
        }

        const socket = io({
            transports: ['websocket', 'polling'],
        });

        socket.on('snapshot', (payload) => {
            applySnapshot(payload || {});
        });

        socket.on('page4:update', (payload) => {
            if (payload && payload.page4) {
                applySnapshot({ page4: payload.page4 });
            }
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            await loadInitialState();
            connectSocket();
        } catch (error) {
            console.error('page4 初始加载失败:', error);
        }
    });
})();
