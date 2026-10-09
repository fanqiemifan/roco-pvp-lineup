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

    // ================= 数据回放（后台「数据统计」推送 page15:replay）=================
    // 从空榜开始按场序逐场累加（口径与实时排行一致），播完自动恢复实时口径；
    // 回放期间忽略 snapshot / stage:update / matches:update 的实时刷新，避免中途被打断。
    const REPLAY_INTERVALS = { slow: 2400, normal: 1300, fast: 650 };
    const REPLAY_TOP_N = 20;
    let replayActive = false;
    let replayTimer = null;
    let replayState = null; // { sprites, steps, cursor, lastStageName, acc, rendered, interval, tournamentName }

    const replayBadge = document.getElementById('page15ReplayBadge');
    const replayBadgeText = document.getElementById('page15ReplayBadgeText');
    const replayBanner = document.getElementById('page15ReplayBanner');
    const replayBannerTitle = document.getElementById('page15ReplayBannerTitle');
    const replayBannerSub = document.getElementById('page15ReplayBannerSub');

    function buildReplayRow(row) {
        const el = document.createElement('div');
        el.className = 'page15-row';
        el.dataset.petId = row.key;

        const rank = document.createElement('div');
        rank.className = 'page15-rank';

        const name = document.createElement('div');
        name.className = 'page15-name';
        name.textContent = getSpriteName(row);

        const count = document.createElement('div');
        count.className = 'page15-data page15-data-count';

        const games = document.createElement('div');
        games.className = 'page15-data page15-data-games';

        const winRate = document.createElement('div');
        winRate.className = 'page15-data page15-data-winrate';

        el.appendChild(rank);
        el.appendChild(buildAvatar(row));
        el.appendChild(name);
        el.appendChild(count);
        el.appendChild(games);
        el.appendChild(winRate);
        return el;
    }

    function tweenReplayValue(cell, from, to, fmt) {
        if (from === to) {
            cell.textContent = fmt(to);
            return;
        }
        const start = performance.now();
        const duration = 480;
        const frame = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            cell.textContent = fmt(from + (to - from) * eased);
            if (t < 1) {
                window.requestAnimationFrame(frame);
            }
        };
        window.requestAnimationFrame(frame);
    }

    /** 数值差值角标：diffText 为空则只清旧角标（▲ 升绿 / ▼ 降红，约 4.5 秒淡出移除） */
    function showReplayDelta(cell, diffText, cls) {
        const host = cell.parentElement;
        const oldTag = host.querySelector('.page15-delta');
        if (oldTag) {
            oldTag.remove();
        }
        if (!diffText) {
            return;
        }
        const tag = document.createElement('span');
        tag.className = `page15-delta ${cls}`;
        tag.textContent = diffText;
        host.appendChild(tag);
        window.setTimeout(() => tag.classList.add('is-fading'), 3600);
        window.setTimeout(() => tag.remove(), 4600);
    }

    /** 对比上一次画面值，逐格滚动 + 角标 + 行闪光（回放只增不减，▲ 为主，防御性保留 ▼） */
    function updateReplayRow(el, row) {
        const prev = replayState.rendered.get(row.key) || { picks: 0, games: 0, wins: 0 };
        const prevRate = prev.games > 0 ? prev.wins / prev.games : null;
        const nextRate = row.games > 0 ? row.wins / row.games : null;
        let changed = false;

        const pickDiff = row.picks - prev.picks;
        if (pickDiff !== 0) {
            changed = true;
            tweenReplayValue(el.querySelector('.page15-data-count'), prev.picks, row.picks, (v) => String(Math.round(v)));
            showReplayDelta(el.querySelector('.page15-data-count'), `▲+${Math.abs(pickDiff)}`, 'is-up');
        }

        const gameDiff = row.games - prev.games;
        if (gameDiff !== 0) {
            changed = true;
            tweenReplayValue(el.querySelector('.page15-data-games'), prev.games, row.games, (v) => String(Math.round(v)));
            showReplayDelta(el.querySelector('.page15-data-games'), `▲+${Math.abs(gameDiff)}`, 'is-up');
        }

        if (prevRate !== nextRate && nextRate !== null) {
            changed = true;
            const from = prevRate ?? 0;
            const pp = Math.round((nextRate - from) * 1000) / 10;
            tweenReplayValue(el.querySelector('.page15-data-winrate'), from, nextRate, formatWinRate);
            showReplayDelta(
                el.querySelector('.page15-data-winrate'),
                `${pp >= 0 ? '▲+' : '▼'}${Math.abs(pp).toFixed(1)}%`,
                pp >= 0 ? 'is-up' : 'is-down',
            );
        }

        if (changed) {
            el.classList.remove('is-flash');
            void el.offsetWidth;
            el.classList.add('is-flash');
        }
    }

    /** keyed 增量渲染：复用已有行节点，FLIP 平移 + 数值动效（跨列移动含横向分量） */
    function renderReplay() {
        const state = replayState;
        const rows = [];
        for (const [key, entry] of state.acc) {
            const meta = state.sprites[key] || {};
            rows.push({
                key,
                name: meta.name || key,
                displayName: meta.displayName || '',
                iconPath: meta.iconPath || '',
                spritePath: meta.spritePath || '',
                picks: entry.picks,
                games: entry.games,
                wins: entry.wins,
                winRate: entry.games > 0 ? entry.wins / entry.games : null,
            });
        }
        // 回放固定口径：使用次数降序、同值按登场场次（展示「热门精灵逐步固化头部」的叙事）
        rows.sort((a, b) => (b.picks - a.picks) || (b.games - a.games));
        const top = rows.slice(0, REPLAY_TOP_N);

        const firstPos = new Map();
        const existing = new Map();
        document.querySelectorAll('.page15-rows .page15-row').forEach((el) => {
            const rect = el.getBoundingClientRect();
            firstPos.set(el.dataset.petId, { x: rect.left, y: rect.top });
            existing.set(el.dataset.petId, el);
        });

        top.forEach((row, index) => {
            let el = existing.get(row.key);
            const isNew = !el;
            if (el) {
                existing.delete(row.key);
            } else {
                el = buildReplayRow(row);
            }
            (index < 10 ? leftRowsEl : rightRowsEl).appendChild(el);
            el.querySelector('.page15-rank').textContent = String(index + 1);
            if (isNew) {
                el.querySelector('.page15-data-count').textContent = String(row.picks);
                el.querySelector('.page15-data-games').textContent = String(row.games);
                el.querySelector('.page15-data-winrate').textContent = formatWinRate(row.winRate);
                el.classList.add('is-entering');
                el.addEventListener('animationend', () => el.classList.remove('is-entering'), { once: true });
            } else {
                updateReplayRow(el, row);
            }
            state.rendered.set(row.key, { picks: row.picks, games: row.games, wins: row.wins });
        });
        existing.forEach((el) => el.remove());

        document.querySelectorAll('.page15-rows .page15-row').forEach((el) => {
            const first = firstPos.get(el.dataset.petId);
            if (!first) {
                return;
            }
            const rect = el.getBoundingClientRect();
            const dx = first.x - rect.left;
            const dy = first.y - rect.top;
            if (!dx && !dy) {
                return;
            }
            el.style.transition = 'none';
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
                el.style.transition = 'transform 520ms cubic-bezier(.22, .9, .26, 1)';
                el.style.transform = 'translate(0, 0)';
                el.addEventListener('transitionend', () => {
                    el.style.transition = '';
                    el.style.transform = '';
                }, { once: true });
            }));
        });
    }

    function showReplayBanner(step) {
        const state = replayState;
        replayBannerTitle.textContent = step.stageName;
        replayBannerSub.textContent = `第 ${state.cursor} / ${state.steps.length} 场`;
        replayBanner.hidden = false;
        replayBanner.classList.remove('is-showing');
        void replayBanner.offsetWidth;
        replayBanner.classList.add('is-showing');
        window.setTimeout(() => {
            replayBanner.hidden = true;
            replayBanner.classList.remove('is-showing');
        }, 1850);
    }

    function playNextReplayStep() {
        const state = replayState;
        if (!state) {
            return;
        }
        if (state.cursor >= state.steps.length) {
            finishReplay();
            return;
        }
        const step = state.steps[state.cursor];
        state.cursor += 1;

        if (step.stageName !== state.lastStageName) {
            state.lastStageName = step.stageName;
            showReplayBanner(step);
        }

        // 累加本场增量到回放累计值
        for (const delta of step.deltas) {
            const entry = state.acc.get(delta.key) || { picks: 0, games: 0, wins: 0 };
            entry.picks += delta.picks;
            entry.games += delta.games;
            entry.wins += delta.wins;
            state.acc.set(delta.key, entry);
        }
        renderReplay();
        replayBadgeText.textContent = `第 ${state.cursor}/${state.steps.length} 场 · ${step.stageName}`;

        if (state.cursor >= state.steps.length) {
            finishReplay();
        } else {
            replayTimer = window.setTimeout(playNextReplayStep, state.interval);
        }
    }

    /** 播完：角标提示后恢复实时口径（主动拉一次真实排行，renderSignature 已置空强制重绘） */
    function finishReplay() {
        const state = replayState;
        if (!state) {
            return;
        }
        replayBadgeText.textContent = `回放结束 · ${state.tournamentName}`;
        replayTimer = window.setTimeout(() => {
            replayActive = false;
            replayState = null;
            if (replayTimer) {
                window.clearTimeout(replayTimer);
                replayTimer = null;
            }
            replayBadge.hidden = true;
            renderSignature = null;
            void fetchRanking(currentTournamentId, currentStageIndex);
        }, state.interval);
    }

    function startReplay(payload) {
        const steps = payload && Array.isArray(payload.steps) ? payload.steps : [];
        if (!steps.length) {
            return;
        }
        // 打断进行中的回放，重新开始
        if (replayTimer) {
            window.clearTimeout(replayTimer);
            replayTimer = null;
        }
        replayBanner.hidden = true;
        replayBanner.classList.remove('is-showing');
        replayActive = true;
        replayState = {
            sprites: payload.sprites && typeof payload.sprites === 'object' ? payload.sprites : {},
            steps,
            cursor: 0,
            lastStageName: null,
            acc: new Map(),
            rendered: new Map(),
            interval: REPLAY_INTERVALS[payload.speed] ?? REPLAY_INTERVALS.normal,
            tournamentName: String(payload.tournamentName || ''),
        };
        leftRowsEl.innerHTML = '';
        rightRowsEl.innerHTML = '';
        renderSignature = null;
        replayBadge.hidden = false;
        replayBadgeText.textContent = `0/${steps.length} 场 · ${replayState.tournamentName}`;
        replayTimer = window.setTimeout(playNextReplayStep, 500);
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            return;
        }
        const socket = io({ transports: ['websocket', 'polling'], query: { role: 'page15' } });

        socket.on('snapshot', (payload) => {
            const stage = payload && payload.stage ? payload.stage : null;
            if (stage && !replayActive) {
                void fetchRanking(stage.page15TournamentId, stage.page15Stage);
            }
        });

        socket.on('stage:update', (payload) => {
            const stage = payload && payload.stage ? payload.stage : null;
            if (stage) {
                setSortBy(stage.page15SortBy);
                setSortOrder(stage.page15SortOrder);
                if (!replayActive) {
                    void fetchRanking(stage.page15TournamentId, stage.page15Stage);
                }
            }
        });

        // matches:update 载荷为 { store }，比赛数据变化时按当前系列赛/阶段口径刷新排行
        socket.on('matches:update', () => {
            if (!replayActive) {
                scheduleRefresh();
            }
        });

        // 数据回放：后台推送后进入回放模式，播完自动恢复实时口径
        socket.on('page15:replay', (payload) => {
            startReplay(payload);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        void loadInitial();
        connectSocket();
    });
})();
