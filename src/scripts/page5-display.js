(function () {
    'use strict';

    const FALLBACK_IMG = '/assets/ui/back.png';
    const DEFAULT_TITLE = '精灵出场胜率';

    const titleEl = document.getElementById('page5Title');
    const leftRowsEl = document.getElementById('page5RowsLeft');
    const rightRowsEl = document.getElementById('page5RowsRight');

    let currentEventTitle = '';
    let currentTournamentId = '';
    let currentTournamentName = '';
    // 阶段过滤（stage.page5Stage）：'' = 全部阶段；matches:update 刷新时沿用当前口径
    let currentStageIndex = '';

    // 换系列赛立即清掉旧名字（新名字随排行榜响应带回），避免标题短暂显示上一场的名字
    function setTournamentId(tournamentId) {
        const next = String(tournamentId || '').trim();
        if (next === currentTournamentId) {
            return;
        }
        currentTournamentId = next;
        currentTournamentName = '';
        refreshTitle();
    }

    function setTournamentName(name) {
        currentTournamentName = String(name || '').trim();
    }

    // 标题 = 赛事标题 + 所选系列赛名 + 「精灵出场胜率」（无 · 符号）
    function composeTitle() {
        const part = [currentEventTitle, currentTournamentName].filter(Boolean).join('');
        return part ? `${part}精灵出场胜率` : DEFAULT_TITLE;
    }

    function applyTitle(eventTitle) {
        currentEventTitle = String(eventTitle || '').trim();
        titleEl.textContent = composeTitle();
    }

    function refreshTitle() {
        titleEl.textContent = composeTitle();
    }

    function normalizeDisplayName(value) {
        return String(value || '').trim().replace(/[-_－—]\d+$/, '');
    }

    function getSpriteName(row) {
        return normalizeDisplayName(row && (row.displayName || row.name) || '');
    }

    // 精灵立绘卡片组件（sprite-pet-card.js）128×128，纯文本名字（page3 用 canvas 名字图）
    function buildPetCard(row) {
        const spriteSrc = row && row.spritePath ? String(row.spritePath) : FALLBACK_IMG;
        return window.SpritePetCard.create({
            name: getSpriteName(row),
            nameMode: 'text',
            size: 128,
            sprite: row || null,
            images: [spriteSrc],
            fallbackSrc: FALLBACK_IMG,
            sourceKey: spriteSrc,
        });
    }

    // 胜率仅显示 2 位整数百分比，如 47%
    function formatWinRate(value) {
        if (typeof value !== 'number') {
            return '-';
        }
        return `${Math.round(value * 100)}%`;
    }

    function buildRow(row, index) {
        const el = document.createElement('div');
        el.className = 'page5-row';

        const rank = document.createElement('div');
        rank.className = 'page5-rank';
        rank.textContent = String(index + 1);

        const sprite = document.createElement('div');
        sprite.className = 'page5-sprite';
        sprite.appendChild(buildPetCard(row));

        const count = document.createElement('div');
        count.className = 'page5-data page5-data-count';
        count.textContent = String(row.picks || 0);

        const wins = document.createElement('div');
        wins.className = 'page5-data page5-data-wins';
        wins.textContent = formatWinRate(row.winRate);

        el.appendChild(rank);
        el.appendChild(sprite);
        el.appendChild(count);
        el.appendChild(wins);
        return el;
    }

    // 渲染签名：排行数据任一变化才重建行，避免 matches:update
    //（如历史录入待开始局阵容，不影响统计）引发无差异重渲染闪烁
    let renderSignature = null;

    function renderRanking(data) {
        const rows = data && Array.isArray(data.rows) ? data.rows : [];
        const signature = JSON.stringify(rows);
        if (renderSignature !== null && renderSignature === signature) {
            return;
        }
        renderSignature = signature;
        leftRowsEl.innerHTML = '';
        rightRowsEl.innerHTML = '';

        rows.slice(0, 5).forEach((row, index) => {
            leftRowsEl.appendChild(buildRow(row, index));
        });
        rows.slice(5, 10).forEach((row, index) => {
            rightRowsEl.appendChild(buildRow(row, index + 5));
        });
    }

    async function fetchRanking(tournamentId, stageIndex) {
        setTournamentId(tournamentId);
        currentStageIndex = stageIndex === undefined || stageIndex === null ? '' : String(stageIndex);
        const query = new URLSearchParams();
        if (tournamentId) {
            query.set('tournamentId', tournamentId);
        }
        if (stageIndex !== undefined && stageIndex !== null && String(stageIndex).trim() !== '') {
            query.set('stageIndex', String(stageIndex));
        }
        try {
            const response = await fetch(`/api/stats/ranking?${query.toString()}`, { credentials: 'same-origin' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            // 系列赛名由服务端解析：改名/删除后页面标题与榜单口径自动一致
            setTournamentName(data && data.tournamentName);
            refreshTitle();
            renderRanking(data);
        } catch (error) {
            console.error('排行加载失败:', error);
        }
    }

    async function loadInitial() {
        try {
            const [stage, scoreboard] = await Promise.all([
                fetch('/api/stage', { credentials: 'same-origin' }).then((r) => r.json()),
                fetch('/api/scoreboard', { credentials: 'same-origin' }).then((r) => r.json()),
            ]);
            await fetchRanking(stage && stage.page5TournamentId, stage && stage.page5Stage);
            applyTitle(scoreboard && scoreboard.page5Title);
        } catch (error) {
            console.error('page5 初始加载失败:', error);
        }
    }

    let refreshTimer = null;
    function scheduleRefresh() {
        if (refreshTimer) {
            window.clearTimeout(refreshTimer);
        }
        refreshTimer = window.setTimeout(() => {
            void fetchRanking(currentTournamentId, currentStageIndex);
        }, 250);
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            return;
        }
        const socket = io({ transports: ['websocket', 'polling'], query: { role: 'page5' } });

        socket.on('snapshot', (payload) => {
            const stage = payload && payload.stage ? payload.stage : null;
            const scoreboard = payload && payload.scoreboard ? payload.scoreboard : null;
            if (stage) {
                void fetchRanking(stage.page5TournamentId, stage.page5Stage);
            }
            if (scoreboard) {
                applyTitle(scoreboard.page5Title);
            } else {
                refreshTitle();
            }
        });

        socket.on('stage:update', (payload) => {
            const stage = payload && payload.stage ? payload.stage : null;
            if (stage) {
                refreshTitle();
                void fetchRanking(stage.page5TournamentId, stage.page5Stage);
            }
        });

        socket.on('scoreboard:update', (payload) => {
            const scoreboard = payload && payload.scoreboard ? payload.scoreboard : null;
            if (scoreboard) {
                applyTitle(scoreboard.page5Title);
            }
        });

        // matches:update 载荷为 { store }，比赛数据变化时用当前系列赛/阶段口径刷新排行
        socket.on('matches:update', () => {
            refreshTitle();
            scheduleRefresh();
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        void loadInitial();
        connectSocket();
    });
})();
