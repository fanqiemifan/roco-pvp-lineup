(function () {
    'use strict';

    const MAX_SLOTS = 6;

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

    function isSlotDead(slotData) {
        return Boolean(slotData && slotData.healthEnabled && Number(slotData.healthPercent) <= 0);
    }

    function renderSlot(slotEl, slotData) {
        // 精灵头像卡组件：头像优先、失败回退立绘；身份不变时只切状态 class（增量更新）
        window.Petsicon.render(slotEl, {
            pet: slotData && slotData.sprite ? slotData.sprite : null,
            dead: isSlotDead(slotData),
        });
    }

    function renderPanel(position, panelData) {
        const selected = panelData && Array.isArray(panelData.selected) ? panelData.selected : [];
        const slotEls = document.querySelectorAll(`.petsicon[data-side="${position}"]`);

        slotEls.forEach((slotEl, index) => {
            const slotData = selected[index] || null;
            const isDead = isSlotDead(slotData);
            const nextSignature = JSON.stringify({
                spriteKey: slotData && slotData.sprite ? (slotData.sprite.id || slotData.sprite.path || slotData.sprite.displayName || slotData.sprite.name || '') : null,
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
