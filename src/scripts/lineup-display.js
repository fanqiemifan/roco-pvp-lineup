(function () {
    'use strict';

    const MAX_SLOTS = 6;
    const SPIRIT_INDEX_URL = '/api/sprites';
    const DEFAULT_EVENT_TITLE = '';
    const DEFAULT_BEST_OF = 7;
    const ROUND_BOX_WIDTH = 32;
    const ROUND_BOX_GAP = 4;
    const DEFAULT_LINEUP_DISPLAY_MODE = 'avatar-only';
    const PESTDIV2_SLOT_SIZES = {
        default: 78,
        'avatar-only': 98
    };
    // 精灵头像目录（sprites-icon，与 sprites-img 立绘同命名：{pet_id}_{name}.png）
    const SPRITE_ICON_RESOURCE_BASE = '/resources/sprites-icon';
    const PANEL_SLOT_POSITIONS = {
        left: ['0', '1', '2', '3', '4', '5'],
        right: ['0', '1', '2', '3', '4', '5']
    };

    const panelStates = {
        left: { signature: new Array(MAX_SLOTS).fill(null), selected: new Array(MAX_SLOTS).fill(null) },
        right: { signature: new Array(MAX_SLOTS).fill(null), selected: new Array(MAX_SLOTS).fill(null) }
    };

    let lookup = null;
    let scoreboardSignature = null;
    let currentLineupDisplayMode = DEFAULT_LINEUP_DISPLAY_MODE;
    const unavailableIconPaths = new Set();

    function normalizeText(value) {
        return String(value ?? '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[·・.。_\-－—]/g, '');
    }

    function normalizeNumber(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }
        const number = Number(value);
        if (Number.isNaN(number)) {
            return String(value).trim();
        }
        return String(number);
    }

    function stripVariantName(value) {
        return String(value ?? '').trim().replace(/[-_－—]\d+$/, '');
    }

    function displaySpiritName(value) {
        return stripVariantName(value);
    }

    function toRootPath(value) {
        const text = String(value ?? '').trim();
        if (!text) {
            return '';
        }

        return text.startsWith('/') ? text : `/${text.replace(/^\/+/, '')}`;
    }


    function clamp(value, min, max, fallback) {
        const number = Number(value);
        if (Number.isNaN(number)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, Math.round(number)));
    }

    function normalizeBestOf(value) {
        const number = Number(value);
        return [1, 3, 5, 7].includes(number) ? number : DEFAULT_BEST_OF;
    }

    function normalizeLineupDisplayMode(value) {
        return value === 'avatar-only' ? 'avatar-only' : DEFAULT_LINEUP_DISPLAY_MODE;
    }

    function getRoundBoxCount(bestOf) {
        return Math.ceil(normalizeBestOf(bestOf) / 2);
    }

    function getScoreRoundCount(scoreValue, boxCount) {
        const score = String(scoreValue ?? '0').trim();
        return clamp(score === '' ? 0 : score, 0, boxCount, 0);
    }

    function toSpiritRecord(record) {
        if (!record || typeof record !== 'object') {
            return null;
        }

        // /api/sprites 记录已含 id / filename / displayName / number / path / iconUrl
        return {
            ...record,
            number: normalizeNumber(record.number),
        };
    }

    function buildLookup(records) {
        const byNumberAndName = new Map();
        const byNumberAndBaseName = new Map();
        const byName = new Map();
        const byBaseName = new Map();
        const byNumber = new Map();

        records.forEach(record => {
            const number = normalizeNumber(record.number);
            const name = normalizeText(record.displayName);
            const baseName = normalizeText(stripVariantName(record.displayName));
            const filename = normalizeText(record.filename.replace(/\.[^.]+$/, ''));

            if (number && name) {
                byNumberAndName.set(`${number}|${name}`, record);
            }
            if (number && baseName && !byNumberAndBaseName.has(`${number}|${baseName}`)) {
                byNumberAndBaseName.set(`${number}|${baseName}`, record);
            }
            if (name && !byName.has(name)) {
                byName.set(name, record);
            }
            if (baseName && !byBaseName.has(baseName)) {
                byBaseName.set(baseName, record);
            }
            if (filename && !byName.has(filename)) {
                byName.set(filename, record);
            }
            if (number && !byNumber.has(number)) {
                byNumber.set(number, record);
            }
        });

        return { byNumberAndName, byNumberAndBaseName, byName, byBaseName, byNumber };
    }

    function getSpriteNumber(sprite) {
        if (!sprite || typeof sprite !== 'object') {
            return '';
        }
        return normalizeNumber(sprite.number);
    }

    function getSpriteDisplayName(sprite) {
        if (!sprite || typeof sprite !== 'object') {
            return '';
        }
        return sprite.displayName || sprite.name || sprite.filename || '';
    }


    function getPestdiv2Size() {
        return PESTDIV2_SLOT_SIZES[currentLineupDisplayMode] || PESTDIV2_SLOT_SIZES.default;
    }

    function buildSpriteIconCandidates(displaySpirit, sourceSprite, spiritName) {
        const iconUrl = String(
            (displaySpirit && displaySpirit.iconUrl)
            || sourceSprite?.iconUrl
            || ''
        ).trim();

        return iconUrl ? [iconUrl] : [];
    }

    function resolveSpriteImageSources(displaySpirit, sourceSprite, spiritName) {
        const fallbackSrc = toRootPath(
            (displaySpirit && displaySpirit.path)
            || sourceSprite?.path
            || ''
        );
        const spriteIconCandidates = buildSpriteIconCandidates(displaySpirit, sourceSprite, spiritName)
            .filter(path => !unavailableIconPaths.has(path));

        return {
            fallbackSrc,
            spriteIconCandidates
        };
    }

    function buildSpiritVisualMeta(slotData) {
        const sourceSprite = slotData && slotData.sprite ? slotData.sprite : null;
        const displaySpirit = resolveDisplaySpirit(sourceSprite);
        const spiritName = displaySpiritName(
            (displaySpirit && displaySpirit.displayName) || getSpriteDisplayName(sourceSprite)
        );

        return {
            sourceSprite,
            displaySpirit,
            spiritName,
            size: getPestdiv2Size(),
            imageSources: resolveSpriteImageSources(displaySpirit, sourceSprite, spiritName)
        };
    }

    function syncPestdiv2IconState(container, imageSrc) {
        if (!container) {
            return;
        }

        container.classList.toggle('pestdiv2-has-icon', String(imageSrc || '').startsWith(SPRITE_ICON_RESOURCE_BASE));
    }

    function applySpiritImage(thumbEl, spiritName, imageSources) {
        if (!thumbEl) {
            return;
        }

        const fallbackSrc = imageSources?.fallbackSrc || '';
        const candidateList = Array.isArray(imageSources?.spriteIconCandidates)
            ? imageSources.spriteIconCandidates.slice()
            : [];
        const sourceQueue = [...candidateList, ...(fallbackSrc ? [fallbackSrc] : [])];

        thumbEl.alt = spiritName || '';

        if (sourceQueue.length === 0) {
            thumbEl.removeAttribute('src');
            delete thumbEl.dataset.currentSrc;
            thumbEl.onerror = null;
            syncPestdiv2IconState(thumbEl.closest('.pestdiv2'), '');
            return;
        }

        const imageSignature = JSON.stringify(sourceQueue);
        if (thumbEl.dataset.imageSignature === imageSignature) {
            return;
        }

        thumbEl.dataset.imageSignature = imageSignature;
        let currentIndex = 0;

        const assignNext = () => {
            const nextSrc = sourceQueue[currentIndex];
            thumbEl.dataset.currentSrc = nextSrc;
            syncPestdiv2IconState(thumbEl.closest('.pestdiv2'), nextSrc);
            thumbEl.src = nextSrc;
        };

        thumbEl.onerror = () => {
            const failedSrc = thumbEl.dataset.currentSrc || '';
            if (failedSrc.startsWith(SPRITE_ICON_RESOURCE_BASE)) {
                unavailableIconPaths.add(failedSrc);
            }

            currentIndex += 1;
            if (currentIndex >= sourceQueue.length) {
                thumbEl.onerror = null;
                return;
            }

            assignNext();
        };

        assignNext();
    }

    function createPestdiv2(spiritVisual) {
        const container = document.createElement('div');
        container.className = 'pestdiv2';
        container.style.setProperty('--pestdiv2-size', `${spiritVisual.size}px`);

        const circle = document.createElement('div');
        circle.className = 'pestdiv2-circle';
        container.append(circle);

        const thumb = document.createElement('img');
        thumb.className = 'pestdiv2-thumb';
        container.append(thumb);
        applySpiritImage(thumb, spiritVisual.spiritName, spiritVisual.imageSources);

        return container;
    }

    function updatePestdiv2(container, spiritVisual) {
        if (!container) {
            return;
        }

        container.className = 'pestdiv2';
        container.style.setProperty('--pestdiv2-size', `${spiritVisual.size}px`);

        let circle = container.querySelector('.pestdiv2-circle');
        if (!circle) {
            circle = document.createElement('div');
            circle.className = 'pestdiv2-circle';
            container.prepend(circle);
        }

        let thumb = container.querySelector('.pestdiv2-thumb');
        if (!thumb) {
            thumb = document.createElement('img');
            thumb.className = 'pestdiv2-thumb';
            container.append(thumb);
        }

        applySpiritImage(thumb, spiritVisual.spiritName, spiritVisual.imageSources);
    }

    function resolveDisplaySpirit(sprite) {
        if (!sprite || !lookup) {
            return null;
        }

        const number = getSpriteNumber(sprite);
        const name = normalizeText(getSpriteDisplayName(sprite));
        const baseName = normalizeText(stripVariantName(getSpriteDisplayName(sprite)));
        const filename = normalizeText(String(sprite.filename || sprite.id || '').replace(/\.[^.]+$/, ''));

        return (
            (number && name && lookup.byNumberAndName.get(`${number}|${name}`)) ||
            (number && baseName && lookup.byNumberAndBaseName.get(`${number}|${baseName}`)) ||
            (name && lookup.byName.get(name)) ||
            (baseName && lookup.byBaseName.get(baseName)) ||
            (filename && lookup.byName.get(filename)) ||
            (number && lookup.byNumber.get(number)) ||
            null
        );
    }

    function getSlotSignature(slotData) {
        const spiritVisual = buildSpiritVisualMeta(slotData);
        const healthMeta = getHealthMeta(slotData);

        return JSON.stringify({
            mode: currentLineupDisplayMode,
            spritePath: spiritVisual.imageSources.fallbackSrc,
            spriteIconCandidates: spiritVisual.imageSources.spriteIconCandidates,
            name: spiritVisual.spiritName,
            sourceName: getSpriteDisplayName(spiritVisual.sourceSprite),
            number: getSpriteNumber(spiritVisual.sourceSprite),
            spriteSize: spiritVisual.size,
            hp: healthMeta.label,
            hpPercent: healthMeta.percent,
            energy: slotData ? clamp(slotData.energyValue, 0, 10, 10) : 10
        });
    }

    function firstFiniteNumber(...values) {
        for (const value of values) {
            const number = Number(value);
            if (Number.isFinite(number)) {
                return number;
            }
        }
        return null;
    }

    function getHealthMeta(slotData) {
        if (!slotData || typeof slotData !== 'object') {
            return { percent: 100, label: '100%' };
        }

        if (slotData.hpLabel || slotData.healthLabel) {
            return {
                percent: clamp(slotData.healthPercent, 0, 100, 100),
                label: String(slotData.hpLabel || slotData.healthLabel)
            };
        }

        const currentHp = firstFiniteNumber(
            slotData.currentHp,
            slotData.currentHP,
            slotData.hp,
            slotData.health,
            slotData.hpValue
        );
        const maxHp = firstFiniteNumber(
            slotData.maxHp,
            slotData.maxHP,
            slotData.maxHealth,
            slotData.totalHp,
            slotData.totalHP
        );

        if (currentHp !== null && maxHp !== null && maxHp > 0) {
            return {
                percent: clamp((currentHp / maxHp) * 100, 0, 100, 100),
                label: `${Math.round(currentHp)}/${Math.round(maxHp)}`
            };
        }

        const healthPercent = clamp(slotData.healthPercent, 0, 100, 100);
        return {
            percent: healthPercent,
            label: `${healthPercent}%`
        };
    }

    function createStatRow(type, fillPercent, label, emptyBar) {
        const row = document.createElement('div');
        row.className = `stat-row stat-row-${type}${emptyBar ? ' is-empty-bar' : ''}`;

        const fill = document.createElement('div');
        fill.className = 'stat-fill';

        const text = document.createElement('div');
        text.className = 'stat-label';

        row.append(fill, text);
        updateStatRow(row, type, fillPercent, label, emptyBar);
        return row;
    }

    function updateStatRow(row, type, fillPercent, label, emptyBar) {
        if (!row) return;

        row.className = `stat-row stat-row-${type}${emptyBar ? ' is-empty-bar' : ''}`;

        const fill = row.querySelector('.stat-fill');
        if (fill) {
            fill.style.width = `${fillPercent}%`;
        }

        const text = row.querySelector('.stat-label');
        if (text) {
            text.textContent = label;
        }
    }

    function renderEmptySlot(slotEl) {
        slotEl.className = 'spirit-slot is-empty';
        slotEl.innerHTML = '';
        delete slotEl.dataset.spriteKey;
        slotEl.dataset.renderMode = currentLineupDisplayMode;
    }

    function renderSlot(slotEl, slotData) {
        const spiritVisual = buildSpiritVisualMeta(slotData);
        const sourceSprite = spiritVisual.sourceSprite;

        if (!sourceSprite) {
            renderEmptySlot(slotEl);
            return;
        }

        const healthMeta = getHealthMeta(slotData);
        const healthPercent = healthMeta.percent;
        const energyValue = clamp(slotData.energyValue, 0, 10, 10);
        const isDone = healthPercent <= 0;
        const spiritName = spiritVisual.spiritName;
        const spriteKey = JSON.stringify({
            fallbackSrc: spiritVisual.imageSources.fallbackSrc,
            spriteIconCandidates: spiritVisual.imageSources.spriteIconCandidates,
            spiritName,
            size: spiritVisual.size
        });
        const isAvatarOnlyMode = currentLineupDisplayMode === 'avatar-only';
        const shouldRebuild = slotEl.dataset.spriteKey !== spriteKey
            || slotEl.dataset.renderMode !== currentLineupDisplayMode
            || (isAvatarOnlyMode
                ? !slotEl.querySelector('.pestdiv2')
                : !slotEl.querySelector('.pestdiv2')
                    || !slotEl.querySelector('.spirit-name')
                    || !slotEl.querySelector('.stat-row-hp')
                    || !slotEl.querySelector('.stat-row-energy'));

        slotEl.className = `spirit-slot${isDone ? ' is-done' : ''}`;
        slotEl.dataset.renderMode = currentLineupDisplayMode;

        if (isAvatarOnlyMode) {
            if (shouldRebuild) {
                slotEl.innerHTML = '';
                slotEl.dataset.spriteKey = spriteKey;
                slotEl.append(createPestdiv2(spiritVisual));
                return;
            }

            updatePestdiv2(slotEl.querySelector('.pestdiv2'), spiritVisual);
            return;
        }

        const hpLabel = isDone ? '/' : healthMeta.label;
        const energyFill = isDone ? 100 : Math.round((energyValue / 10) * 100);
        const energyLabel = isDone ? '/' : String(energyValue);

        if (shouldRebuild) {
            slotEl.innerHTML = '';
            slotEl.dataset.spriteKey = spriteKey;
            slotEl.append(createPestdiv2(spiritVisual));

            const hpRow = createStatRow('hp', isDone ? 100 : healthPercent, hpLabel, isDone);
            const energyRow = createStatRow('energy', energyFill, energyLabel, isDone);

            const name = document.createElement('div');
            name.className = 'spirit-name';
            name.textContent = spiritName;

            slotEl.append(hpRow, energyRow, name);
            return;
        }

        updatePestdiv2(slotEl.querySelector('.pestdiv2'), spiritVisual);

        const name = slotEl.querySelector('.spirit-name');
        if (name) {
            name.textContent = spiritName;
        }

        updateStatRow(slotEl.querySelector('.stat-row-hp'), 'hp', isDone ? 100 : healthPercent, hpLabel, isDone);
        updateStatRow(slotEl.querySelector('.stat-row-energy'), 'energy', energyFill, energyLabel, isDone);
    }

    function renderPanel(position, panelData) {
        const state = panelStates[position];
        const selected = panelData && Array.isArray(panelData.selected) ? panelData.selected : [];
        const slots = PANEL_SLOT_POSITIONS[position].map(slotId =>
            document.querySelector(`.lineup-panel-${position} .spirit-slot[data-slot="${slotId}"]`)
        );

        slots.forEach((slotEl, index) => {
            if (!slotEl) {
                return;
            }

            const slotData = selected[index] || null;
            state.selected[index] = slotData;
            const nextSignature = getSlotSignature(slotData);
            if (state.signature[index] === nextSignature) {
                return;
            }

            renderSlot(slotEl, slotData);
            state.signature[index] = nextSignature;
        });
    }

    function buildScoreValue(scoreboard) {
        const leftScore = String(scoreboard.leftScore ?? '0').trim() || '0';
        const rightScore = String(scoreboard.rightScore ?? '0').trim() || '0';
        return `${leftScore}:${rightScore}`;
    }

    function updateRoundBoxes(container, scoreValue, bestOf) {
        if (!container) {
            return;
        }

        const boxCount = getRoundBoxCount(bestOf);
        const activeCount = getScoreRoundCount(scoreValue, boxCount);
        const currentBoxes = Array.from(container.querySelectorAll('.round-box'));

        if (currentBoxes.length !== boxCount) {
            container.innerHTML = '';
            for (let index = 0; index < boxCount; index += 1) {
                const box = document.createElement('span');
                box.className = 'round-box';
                container.append(box);
            }
        }

        const boxes = Array.from(container.querySelectorAll('.round-box'));
        boxes.forEach((box, index) => {
            box.classList.toggle('round-box-active', index < activeCount);
        });

        const line = container.closest('.player-summary')?.querySelector('.player-summary-line');
        if (line) {
            line.style.width = `${boxCount * ROUND_BOX_WIDTH + (boxCount - 1) * ROUND_BOX_GAP}px`;
        }
    }

    function renderScoreboard(scoreboard) {
        const data = scoreboard || {};
        const nextLineupDisplayMode = normalizeLineupDisplayMode(data.page2LineupDisplayMode);
        const nextSignature = JSON.stringify({
            leftName: data.leftName || '',
            leftScore: data.leftScore || '0',
            rightName: data.rightName || '',
            rightScore: data.rightScore || '0',
            bestOf: normalizeBestOf(data.bestOf),
            scoreboardEnabled: data.scoreboardEnabled !== false,
            eventTitle: data.eventTitle || DEFAULT_EVENT_TITLE,
            eventTitleEnabled: data.eventTitleEnabled !== false,
            page2LineupDisplayMode: nextLineupDisplayMode
        });

        if (scoreboardSignature === nextSignature) {
            return;
        }

        const lineupDisplayModeChanged = currentLineupDisplayMode !== nextLineupDisplayMode;
        currentLineupDisplayMode = nextLineupDisplayMode;
        scoreboardSignature = nextSignature;
        document.body.dataset.page2LineupDisplayMode = currentLineupDisplayMode;

        document.getElementById('leftPlayerName').textContent = data.leftName || '';
        document.getElementById('rightPlayerName').textContent = data.rightName || '';
        document.getElementById('matchScore').textContent = buildScoreValue(data);
        const eventTitleEl = document.getElementById('eventTitle');
        const eventTitleEnabled = data.eventTitleEnabled !== false;
        const eventTitleText = data.eventTitle || DEFAULT_EVENT_TITLE;
        eventTitleEl.textContent = eventTitleText;
        eventTitleEl.style.display = eventTitleEnabled && eventTitleText ? '' : 'none';

        updateRoundBoxes(
            document.querySelector('.player-summary-left .player-rounds'),
            Number(data.leftScore),
            data.bestOf
        );
        updateRoundBoxes(
            document.querySelector('.player-summary-right .player-rounds'),
            Number(data.rightScore),
            data.bestOf
        );

        document.body.classList.toggle('scoreboard-disabled', data.scoreboardEnabled === false);

        if (lineupDisplayModeChanged) {
            renderPanel('left', { selected: panelStates.left.selected });
            renderPanel('right', { selected: panelStates.right.selected });
        }
    }

    function applySnapshot(payload) {
        const panels = payload && Array.isArray(payload.panels) ? payload.panels : [];
        renderScoreboard(payload ? payload.scoreboard : null);
        renderPanel('left', panels.find(panel => panel && panel.position === 'left'));
        renderPanel('right', panels.find(panel => panel && panel.position === 'right'));
    }

    async function loadSpiritIndex() {
        const response = await fetch(SPIRIT_INDEX_URL);
        if (!response.ok) {
            throw new Error(`精灵索引加载失败: ${response.status}`);
        }

        const payload = await response.json();
        // /api/sprites 返回 { sprites, count }
        const records = Array.isArray(payload) ? payload : (payload.sprites || []);
        lookup = buildLookup(records.map(toSpiritRecord).filter(Boolean));
    }

    async function loadInitialState() {
        const [imagesResponse, scoreboardResponse] = await Promise.all([
            fetch('api/panels'),
            fetch('api/scoreboard')
        ]);

        const [imagesData, scoreboardData] = await Promise.all([
            imagesResponse.json(),
            scoreboardResponse.json()
        ]);

        applySnapshot({
            panels: imagesData.panels || [],
            scoreboard: scoreboardData
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

        socket.on('connect_error', error => {
            console.error('Socket.IO 连接失败:', error);
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            await loadSpiritIndex();
            await loadInitialState();
            connectSocket();
        } catch (error) {
            console.error('初始化 PVP 展示页失败:', error);
        }
    });
})();
