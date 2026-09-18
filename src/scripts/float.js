(function () {
    'use strict';

    const MAX_SLOTS = 6;
    // 精灵头像目录（sprites-icon，与 sprites-img 立绘同命名：{pet_id}_{name}.png）
    const SPRITE_ICON_RESOURCE_BASE = '/resources/sprites-icon';
    const FALLBACK_IMG = '/assets/ui/back.png';

    // 阵容条原始尺寸与整体缩放：内容按 782×74 布局，缩放到 0.75 后为 587×56
    const LINEUP_W = 782;
    const LINEUP_H = 74;
    const ZOOM = 0.75;
    const STAGE_W = Math.round(LINEUP_W * ZOOM); // 587
    const STAGE_H = Math.round(LINEUP_H * ZOOM); // 56

    const state = {
        left: null,
        right: null,
        busy: false,
    };

    const stage = document.getElementById('floatStage');
    const lineupDiv = document.querySelector('.lineup-all-div');
    const closeBtn = document.getElementById('floatCloseBtn');
    const lineupSections = {
        left: document.querySelector('.lineup-left'),
        right: document.querySelector('.lineup-right'),
    };

    const unavailableIconPaths = new Set();

    function basename(value) {
        return String(value || '').split('/').filter(Boolean).pop() || '';
    }


    function getSpriteDisplayName(sprite) {
        if (!sprite || typeof sprite !== 'object') {
            return '';
        }
        // 优先使用原始名称（精灵名称），如 卡瓦重（草地附近的样子），而非去掉变体后缀的短名 displayName
        return String(sprite.name || sprite.displayName || basename(sprite.path) || '').trim();
    }

    function buildSpriteIconCandidates(sprite) {
        const iconUrl = String(sprite && sprite.iconUrl ? sprite.iconUrl : '').trim();
        return iconUrl ? [iconUrl] : [];
    }

    function applySpriteImage(imgEl, sprite) {
        const fallbackSrc = sprite && sprite.path ? String(sprite.path) : '';
        const spriteIconCandidates = buildSpriteIconCandidates(sprite).filter((path) => !unavailableIconPaths.has(path));
        const sourceQueue = [...spriteIconCandidates, ...(fallbackSrc ? [fallbackSrc] : [])];

        if (sourceQueue.length === 0) {
            imgEl.removeAttribute('src');
            delete imgEl.dataset.imageSignature;
            delete imgEl.dataset.currentSrc;
            imgEl.onerror = null;
            return;
        }

        const imageSignature = JSON.stringify(sourceQueue);
        if (imgEl.dataset.imageSignature === imageSignature && imgEl.getAttribute('src')) {
            return;
        }

        imgEl.dataset.imageSignature = imageSignature;
        let currentIndex = 0;

        const assignNext = () => {
            imgEl.dataset.currentSrc = sourceQueue[currentIndex];
            imgEl.src = sourceQueue[currentIndex];
        };

        imgEl.onerror = () => {
            const failedSrc = imgEl.dataset.currentSrc || '';
            if (failedSrc.startsWith(SPRITE_ICON_RESOURCE_BASE)) {
                unavailableIconPaths.add(failedSrc);
            }
            currentIndex += 1;
            if (currentIndex >= sourceQueue.length) {
                imgEl.onerror = null;
                imgEl.src = FALLBACK_IMG;
                return;
            }
            assignNext();
        };

        assignNext();
    }

    function buildSlotEl(side, index) {
        const el = document.createElement('div');
        el.className = 'petsdiv3 is-empty';
        el.dataset.side = side;
        el.dataset.slot = String(index);
        el.innerHTML = '<img alt="" />';
        el.addEventListener('click', () => {
            void toggleDead(side, index);
        });
        el.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            const rect = el.getBoundingClientRect();
            openSpriteMenu(side, index, { x: rect.left, y: rect.top, width: rect.width, height: rect.height });
        });
        return el;
    }

    let menuPopupWindow = null;

    function openSpriteMenu(side, slotIndex, rect) {
        if (window.rocoFloat && typeof window.rocoFloat.openMenu === 'function') {
            window.rocoFloat.openMenu({ side, slot: slotIndex, rect });
            return;
        }
        if (menuPopupWindow && !menuPopupWindow.closed) {
            menuPopupWindow.close();
        }
        const url = `/float-menu.html?side=${encodeURIComponent(side)}&slot=${encodeURIComponent(String(slotIndex))}`;
        const left = Math.max(0, Math.round(window.screenX + rect.x + rect.width / 2 - 120));
        const top = Math.max(0, Math.round(window.screenY + rect.y - 246));
        menuPopupWindow = window.open(url, '_blank', `width=240,height=240,popup=yes,left=${left},top=${top}`);
    }

    function renderSlot(slotEl, slotData) {
        const sprite = slotData && slotData.sprite ? slotData.sprite : null;
        const isDead = Boolean(sprite && Number(slotData.healthPercent) <= 0);

        slotEl.classList.toggle('is-active', Boolean(sprite));
        slotEl.classList.toggle('is-empty', !sprite);
        slotEl.classList.toggle('is-dead', isDead);

        const imgEl = slotEl.querySelector('img');
        if (sprite) {
            imgEl.alt = getSpriteDisplayName(sprite);
            applySpriteImage(imgEl, sprite);
            slotEl.title = `${getSpriteDisplayName(sprite)}（点击${isDead ? '复活' : '阵亡'} · 右键更换）`;
        } else {
            imgEl.removeAttribute('src');
            delete imgEl.dataset.imageSignature;
            delete imgEl.dataset.currentSrc;
            imgEl.onerror = null;
            imgEl.alt = '';
            slotEl.title = '右键添加精灵';
        }
    }

    function renderPanel(side) {
        const panel = state[side];
        const section = lineupSections[side];
        const selected = panel && Array.isArray(panel.selected) ? panel.selected : [];

        for (let index = 0; index < MAX_SLOTS; index += 1) {
            renderSlot(section.children[index], selected[index] || null);
        }
    }

    function applyPanels(panels) {
        if (!panels || !Array.isArray(panels)) {
            return;
        }
        panels.forEach((panel) => {
            if (panel && (panel.position === 'left' || panel.position === 'right')) {
                state[panel.position] = panel;
                renderPanel(panel.position);
            }
        });
    }

    async function requestJson(url, options) {
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
        }
        return response.json();
    }

    function buildSlotPayload(slotData, overrides) {
        return {
            slot: slotData ? slotData.slot : 0,
            sprite: overrides.sprite ?? (slotData && slotData.sprite ? slotData.sprite.id : null),
            opacityEnabled: Boolean(slotData && slotData.opacityEnabled),
            opacity: Number(slotData && slotData.opacity) || 1,
            saturation: Number(slotData && slotData.saturation) || 1,
            healthEnabled: typeof overrides.healthEnabled === 'boolean' ? overrides.healthEnabled : (slotData ? slotData.healthEnabled !== false : true),
            healthPercent: typeof overrides.healthPercent === 'number' ? overrides.healthPercent : (slotData ? Number(slotData.healthPercent) : 100),
            energyValue: typeof overrides.energyValue === 'number' ? overrides.energyValue : (slotData ? Number(slotData.energyValue) : 10),
        };
    }

    async function toggleDead(side, slotIndex) {
        if (state.busy) {
            return;
        }
        const panel = state[side];
        const slotData = panel && Array.isArray(panel.selected) ? panel.selected[slotIndex] : null;
        if (!slotData || !slotData.sprite) {
            return;
        }

        state.busy = true;
        const nextHealth = Number(slotData.healthPercent) > 0 ? 0 : 100;
        try {
            await requestJson(`/api/panels/${side}/slots/${slotIndex}`, {
                method: 'PATCH',
                body: JSON.stringify({ slot: buildSlotPayload(slotData, { healthPercent: nextHealth }) }),
            });
        } catch (error) {
            console.error('阵亡切换失败:', error);
        } finally {
            state.busy = false;
        }
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            return;
        }
        const socket = io({
            transports: ['websocket', 'polling'],
        });

        socket.on('snapshot', (payload) => {
            if (payload && Array.isArray(payload.panels)) {
                applyPanels(payload.panels);
            }
        });

        socket.on('panel:update', (payload) => {
            if (payload && payload.panel) {
                applyPanels([payload.panel]);
            }
        });
    }

    closeBtn.addEventListener('click', () => {
        if (window.rocoFloat && typeof window.rocoFloat.close === 'function') {
            window.rocoFloat.close();
            return;
        }
        window.close();
    });

    // 下场对局：点击中央圆形按钮打开比赛选择小窗
    let nextGameMenuWindow = null;
    const nextGameBtn = document.getElementById('floatNextGameBtn');
    if (nextGameBtn) {
        nextGameBtn.addEventListener('click', () => {
            if (nextGameMenuWindow && !nextGameMenuWindow.closed) {
                nextGameMenuWindow.focus();
                return;
            }
            const rect = nextGameBtn.getBoundingClientRect();
            const left = Math.max(0, Math.round(window.screenX + rect.left + rect.width / 2 - 150));
            const top = Math.max(0, Math.round(window.screenY + rect.top - 340));
            nextGameMenuWindow = window.open('/float-nextgame.html', '_blank', `width=300,height=320,popup=yes,left=${left},top=${top}`);
        });
    }

    function reportStageShape() {
        if (!window.rocoFloat || typeof window.rocoFloat.reportShape !== 'function') {
            return;
        }
        const rect = lineupDiv.getBoundingClientRect();
        window.rocoFloat.reportShape({
            x: Math.floor(rect.left),
            y: Math.floor(rect.top),
            width: STAGE_W,
            height: STAGE_H,
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        for (let index = 0; index < MAX_SLOTS; index += 1) {
            lineupSections.left.appendChild(buildSlotEl('left', index));
            lineupSections.right.appendChild(buildSlotEl('right', index));
        }
        lineupDiv.style.zoom = String(ZOOM);
        connectSocket();
        window.requestAnimationFrame(() => {
            reportStageShape();
            window.setTimeout(reportStageShape, 500);
        });
    });
})();
