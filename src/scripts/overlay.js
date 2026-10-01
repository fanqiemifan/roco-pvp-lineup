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

    // 阵容镜像反转（仅页面1-3 展示层左右互换，不改数据）：开启后视图侧渲染实际另一侧的数据
    let mirrorSides = false;
    // 实际侧面板缓存：镜像切换时按新映射重渲染（panelStates 仍按视图侧缓存签名）
    const latestPanels = { left: null, right: null };

    function mapSide(side) {
        if (!mirrorSides) {
            return side;
        }
        return side === 'left' ? 'right' : 'left';
    }

    function renderPanels() {
        renderPanel('left', latestPanels[mapSide('left')]);
        renderPanel('right', latestPanels[mapSide('right')]);
    }

    function setMirrorSides(value) {
        const next = value === true;
        if (next === mirrorSides) {
            return;
        }
        mirrorSides = next;
        // 左右映射变化：清空槽位签名，强制按新映射重渲染
        panelStates.left.signatures.fill(null);
        panelStates.right.signatures.fill(null);
        renderPanels();
    }

    function basename(value) {
        return String(value || '').split('/').filter(Boolean).pop() || '';
    }


    function getSpriteDisplayName(sprite) {
        if (!sprite || typeof sprite !== 'object') {
            return '';
        }
        return String(sprite.displayName || sprite.name || basename(sprite.path) || '').trim();
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

    function isSlotDead(slotData) {
        return Boolean(slotData && slotData.healthEnabled && Number(slotData.healthPercent) <= 0);
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

        const isDead = isSlotDead(slotData);
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
            const isDead = isSlotDead(slotData);
            const nextSignature = JSON.stringify({
                spriteKey: slotData && slotData.sprite ? (slotData.sprite.id || slotData.sprite.path || getSpriteDisplayName(slotData.sprite)) : null,
                isDead,
            });

            if (panelStates[position].signatures[index] === nextSignature) {
                return;
            }

            renderSlot(slotEl, slotData);
            panelStates[position].signatures[index] = nextSignature;
        });
    }

    function applySnapshot(payload) {
        const panels = payload && Array.isArray(payload.panels) ? payload.panels : [];
        latestPanels.left = panels.find((panel) => panel && panel.position === 'left') || null;
        latestPanels.right = panels.find((panel) => panel && panel.position === 'right') || null;
        renderPanels();
    }

    async function loadInitialState() {
        const [stageResponse, panelsResponse] = await Promise.all([
            fetch('/api/stage'),
            fetch('/api/panels')
        ]);
        const [stageData, panelsData] = await Promise.all([
            stageResponse.json(),
            panelsResponse.json()
        ]);
        setMirrorSides(stageData && stageData.mirrorSides === true);
        applySnapshot({ panels: panelsData.panels || [] });
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            return;
        }

        const socket = io({
            transports: ['websocket', 'polling'],
            query: { role: 'page1' },
        });

        socket.on('snapshot', (payload) => {
            applySnapshot(payload || {});
        });

        socket.on('panel:update', (payload) => {
            if (payload && payload.panel && payload.panel.position) {
                latestPanels[payload.panel.position] = payload.panel;
                renderPanel(mapSide(payload.panel.position), payload.panel);
            }
        });

        // 镜像反转实时切换（页面1 其余渲染不依赖 stage 配置，仅消费 mirrorSides）
        socket.on('stage:update', (payload) => {
            const stage = payload && payload.stage ? payload.stage : payload;
            setMirrorSides(stage && stage.mirrorSides === true);
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            await loadInitialState();
            connectSocket();
        } catch (error) {
            console.error('overlay 初始加载失败:', error);
        }
    });
})();
