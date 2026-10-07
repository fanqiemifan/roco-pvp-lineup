(function () {
    'use strict';

    const FALLBACK_IMG = '/assets/ui/back.png';

    const leftRowsEl = document.getElementById('page15RowsLeft');
    const rightRowsEl = document.getElementById('page15RowsRight');

    let currentTournamentId = '';
    let currentStageIndex = '';
    // 排序字段与方向由后台「数据统计」视图下发（stage.page15SortBy / stage.page15SortOrder）：
    // picks = 使用次数 / games = 登场场次 / winRate = 胜率；desc 降序（默认）/ asc 升序
    let currentSortBy = 'picks';
    let currentSortOrder = 'desc';

    function normalizeDisplayName(value) {
        return String(value || '').trim().replace(/[-_－—]\d+$/, '');
    }

    function getSpriteName(row) {
        return normalizeDisplayName(row && (row.displayName || row.name) || '');
    }

    // 头像源：iconPath（sprites-icon 头像）优先，失败逐级回退立绘、占位图
    function buildAvatar(row) {
        const name = getSpriteName(row);
        const avatar = document.createElement('div');
        avatar.className = 'page15-avatar';

        const img = document.createElement('img');
        img.alt = name;
        avatar.appendChild(img);

        const sources = [];
        if (row && row.iconPath) {
            sources.push(String(row.iconPath));
        }
        if (row && row.spritePath) {
            sources.push(String(row.spritePath));
        }

        if (!sources.length) {
            img.src = FALLBACK_IMG;
            return avatar;
        }

        let currentIndex = 0;
        const assignNext = () => {
            img.src = sources[currentIndex];
        };
        img.onerror = () => {
            currentIndex += 1;
            if (currentIndex >= sources.length) {
                img.onerror = null;
                img.src = FALLBACK_IMG;
                return;
            }
            assignNext();
        };
        assignNext();

        return avatar;
    }

    // 胜率仅显示 2 位整数百分比，如 47%；无数据显示「-」
    function formatWinRate(value) {
        if (typeof value !== 'number') {
            return '-';
        }
        return `${Math.round(value * 100)}%`;
    }

    function buildRow(row, index) {
        const el = document.createElement('div');
        el.className = 'page15-row';

        const rank = document.createElement('div');
        rank.className = 'page15-rank';
        rank.textContent = String(index + 1);

        const name = document.createElement('div');
        name.className = 'page15-name';
        name.textContent = getSpriteName(row);

        const count = document.createElement('div');
        count.className = 'page15-data page15-data-count';
        count.textContent = String(row.picks || 0);

        const games = document.createElement('div');
        games.className = 'page15-data page15-data-games';
        games.textContent = String(row.games || 0);

        const winRate = document.createElement('div');
        winRate.className = 'page15-data page15-data-winrate';
        winRate.textContent = formatWinRate(row.winRate);

        el.appendChild(rank);
        el.appendChild(buildAvatar(row));
        el.appendChild(name);
        el.appendChild(count);
        el.appendChild(games);
        el.appendChild(winRate);
        return el;
    }

    function sortRows(rows) {
        // 主排序按后台所选字段与方向（desc 降序 / asc 升序），同值按使用次数（登场只次）降序；
        // 按胜率排序时未登场（winRate 为 null）的精灵无论方向都排最后
        return rows.slice().sort((a, b) => {
            const av = a[currentSortBy];
            const bv = b[currentSortBy];
            if (currentSortBy === 'winRate') {
                const aNoGame = typeof av !== 'number';
                const bNoGame = typeof bv !== 'number';
                if (aNoGame !== bNoGame) {
                    return aNoGame ? 1 : -1;
                }
            }
            const primary = currentSortOrder === 'asc'
                ? (Number(av) || 0) - (Number(bv) || 0)
                : (Number(bv) || 0) - (Number(av) || 0);
            return primary !== 0 ? primary : (b.picks || 0) - (a.picks || 0);
        });
    }

    // 渲染签名：排序字段或排行数据任一变化才重建行，避免无差异重渲染闪烁
    let renderSignature = null;

    function renderRanking(data) {
        const rows = data && Array.isArray(data.rows) ? data.rows : [];
        const signature = JSON.stringify([currentSortBy, currentSortOrder, rows]);
        if (renderSignature !== null && renderSignature === signature) {
            return;
        }
        renderSignature = signature;

        const sorted = sortRows(rows).slice(0, 20);
        leftRowsEl.innerHTML = '';
        rightRowsEl.innerHTML = '';
        sorted.slice(0, 10).forEach((row, index) => {
            leftRowsEl.appendChild(buildRow(row, index));
        });
        sorted.slice(10, 20).forEach((row, index) => {
            rightRowsEl.appendChild(buildRow(row, index + 10));
        });
    }

    function setSortBy(value) {
        currentSortBy = value === 'games' || value === 'winRate' ? value : 'picks';
    }

    function setSortOrder(value) {
        currentSortOrder = value === 'asc' ? 'asc' : 'desc';
    }

    async function fetchRanking(tournamentId, stageIndex) {
        currentTournamentId = String(tournamentId || '').trim();
        currentStageIndex = stageIndex === undefined || stageIndex === null ? '' : String(stageIndex);
        const query = new URLSearchParams();
        if (currentTournamentId) {
            query.set('tournamentId', currentTournamentId);
        }
        if (currentStageIndex !== '') {
            query.set('stageIndex', currentStageIndex);
        }
        // 拿全量排行后前端按所选字段排序取前 20（服务端按使用率截断会漏掉登场场次靠前的精灵）
        query.set('limit', '999');
        try {
            const response = await fetch(`/api/stats/ranking?${query.toString()}`, { credentials: 'same-origin' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            renderRanking(data);
        } catch (error) {
            console.error('数据统计加载失败:', error);
        }
    }

    async function loadInitial() {
        try {
            const stage = await fetch('/api/stage', { credentials: 'same-origin' }).then((r) => r.json());
            setSortBy(stage && stage.page15SortBy);
            setSortOrder(stage && stage.page15SortOrder);
            await fetchRanking(stage && stage.page15TournamentId, stage && stage.page15Stage);
        } catch (error) {
            console.error('page15 初始加载失败:', error);
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
        const socket = io({ transports: ['websocket', 'polling'], query: { role: 'page15' } });

        socket.on('snapshot', (payload) => {
            const stage = payload && payload.stage ? payload.stage : null;
            if (stage) {
                void fetchRanking(stage.page15TournamentId, stage.page15Stage);
            }
        });

        socket.on('stage:update', (payload) => {
            const stage = payload && payload.stage ? payload.stage : null;
            if (stage) {
                setSortBy(stage.page15SortBy);
                setSortOrder(stage.page15SortOrder);
                void fetchRanking(stage.page15TournamentId, stage.page15Stage);
            }
        });

        // matches:update 载荷为 { store }，比赛数据变化时按当前系列赛/阶段口径刷新排行
        socket.on('matches:update', () => {
            scheduleRefresh();
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        void loadInitial();
        connectSocket();
    });
})();
