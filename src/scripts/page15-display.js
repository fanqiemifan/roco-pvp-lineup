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
    // 默认不播放：推送后直接把所有场次增量一次累加并静态渲染最终数据，停留片刻恢复实时口径；
    // 显示设置开启「逐场播放」后才按场序逐场累加播演化动画（口径与实时排行一致）。
    // 回放期间忽略 snapshot / stage:update / matches:update 的实时刷新，避免中途被打断。
    const REPLAY_INTERVALS = { slow: 2400, normal: 1300, fast: 650 };
    const REPLAY_TOP_N = 20;
    // 不播放模式：最终数据停留时长（毫秒），随后恢复实时口径
    const REPLAY_DIRECT_HOLD = 2000;
    let replayActive = false;
    let replayTimer = null;
    let replayState = null; // { sprites, steps, cursor, acc, rendered, interval, tournamentName }

    const replayBadge = document.getElementById('page15ReplayBadge');
    const replayBadgeText = document.getElementById('page15ReplayBadgeText');

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

    // 数值滚轮（odometer）：每一位数字是一条竖向滚带，滚带按「10 + 位置值」铺设、glyph 取 index mod 10，
    // 位置值连续变化时 glyph 组合始终正确（跨 10 归位在两条等宽滚带的镜像段完成，无肉眼跳变）
    const ROLL_DIGIT_HEIGHT = 90; // 与行高一致：滚带每一位占一格

    /** 造一位滚轮：滚带覆盖 [lo, hi] 的位置区间，返回 { digit, strip, lo } 供逐帧定位 */
    function buildRollWheel(fromPos, toPos) {
        const lo = Math.floor(Math.min(fromPos, toPos));
        const hi = Math.ceil(Math.max(fromPos, toPos)) + 1;
        const digit = document.createElement('span');
        digit.className = 'page15-roll-digit';
        const strip = document.createElement('span');
        strip.className = 'page15-roll-strip';
        for (let i = lo; i <= hi; i += 1) {
            const glyph = document.createElement('span');
            glyph.textContent = String(((i % 10) + 10) % 10);
            strip.appendChild(glyph);
        }
        digit.appendChild(strip);
        return { digit, strip, lo };
    }

    function setWheelPosition(wheel, pos) {
        wheel.strip.style.transform = `translateY(${-(pos - wheel.lo) * ROLL_DIGIT_HEIGHT}px)`;
    }

    /**
     * 数值滚动（odometer 形式）：个位连续滚（过轮带小数偏移），高位随进位步进；
     * from/to 必须是展示空间的整数（winrate 由调用方先 ×100 取整），滚完回落纯文本。
     * 位数取两端较大值——跨位滚动时中途出现前导 0 属 odometer 正常形态。
     */
    function tweenReplayValue(cell, from, to, fmt, suffix = '') {
        if (from === to) {
            cell.textContent = fmt(to) + suffix;
            return;
        }
        // 生成代号：被新一次滚动接替时旧 rAF 循环自灭，防止快速连播时两个循环打架
        const gen = (cell._page15RollGen = (cell._page15RollGen || 0) + 1);
        const digitCount = Math.max(fmt(from).length, fmt(to).length);
        const roller = document.createElement('span');
        roller.className = 'page15-roll';
        const wheels = [];
        for (let place = digitCount - 1; place >= 0; place -= 1) {
            const startPos = place === 0 ? 10 + from : 10 + Math.floor(from / 10 ** place);
            const endPos = place === 0 ? 10 + to : 10 + Math.floor(to / 10 ** place);
            const wheel = buildRollWheel(startPos, endPos);
            roller.appendChild(wheel.digit);
            wheels.push(wheel);
            setWheelPosition(wheel, startPos);
        }
        if (suffix) {
            const suf = document.createElement('span');
            suf.className = 'page15-roll-suffix';
            suf.textContent = suffix;
            roller.appendChild(suf);
        }
        cell.textContent = '';
        cell.appendChild(roller);

        const start = performance.now();
        const duration = 480;
        const frame = (now) => {
            if (cell._page15RollGen !== gen) {
                return;
            }
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            const v = from + (to - from) * eased;
            for (let i = 0; i < wheels.length; i += 1) {
                const place = digitCount - 1 - i;
                const pos = place === 0 ? 10 + v : 10 + Math.floor(v / 10 ** place);
                setWheelPosition(wheels[i], pos);
            }
            if (t < 1) {
                window.requestAnimationFrame(frame);
            } else {
                // 滚完回落纯文本（剔除跨位滚动时的高位前导 0）
                cell.textContent = fmt(to) + suffix;
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

    /** 对比上一次画面值，逐格滚动 + 角标 + 行闪光（回放只增不减，▲ 为主，防御性保留 ▼）；
     *  prev 由调用方在渲染时捕获——数值更新排在位移之后延迟执行，届时 rendered 已是新值，不能现查 */
    function updateReplayRow(el, row, prev) {
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
            // 滚轮工作在展示空间（0-100 整数），与 formatWinRate 的四舍五入口径一致
            tweenReplayValue(
                el.querySelector('.page15-data-winrate'),
                Math.round(from * 100),
                Math.round(nextRate * 100),
                (v) => String(Math.round(v)),
                '%',
            );
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

    /** 回放累计值 → 展示行（回放固定口径：使用次数降序、同值按登场场次） */
    function collectReplayRows(state) {
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
        // 展示「热门精灵逐步固化头部」的叙事
        rows.sort((a, b) => (b.picks - a.picks) || (b.games - a.games));
        return rows;
    }

    // 两段式动效节奏：先 FLIP 位移（520ms）让观众看清格局变化，位移基本落位（420ms 处）后
    // 再统一滚动数值 + 角标 + 闪光解释变化；520+480=900ms 刚好塞进标准速度 1300ms/场的节奏
    const REPLAY_FLIP_MS = 520;
    const REPLAY_VALUE_DELAY_MS = 420;
    // 渲染令牌：每轮渲染递增，延迟的数值回调过号即作废（快速连播/打断时旧回调不追着新画面跑）
    let replayRenderToken = 0;
    let replayValueTimer = null;

    /** keyed 增量渲染：复用已有行节点，先 FLIP 平移换位，数值动效延迟到位移基本落位后统一执行 */
    function renderReplay() {
        const state = replayState;
        const top = collectReplayRows(state).slice(0, REPLAY_TOP_N);

        const firstPos = new Map();
        const existing = new Map();
        document.querySelectorAll('.page15-rows .page15-row').forEach((el) => {
            const rect = el.getBoundingClientRect();
            firstPos.set(el.dataset.petId, { x: rect.left, y: rect.top });
            existing.set(el.dataset.petId, el);
        });

        const deferredUpdates = [];
        top.forEach((row, index) => {
            let el = existing.get(row.key);
            const isNew = !el;
            if (el) {
                existing.delete(row.key);
            } else {
                el = buildReplayRow(row);
            }
            (index < 10 ? leftRowsEl : rightRowsEl).appendChild(el);
            // 名次随位移第一阶段立即更新（新座次 + 新名次先立住，数值随后滚动跟上）
            el.querySelector('.page15-rank').textContent = String(index + 1);
            if (isNew) {
                el.querySelector('.page15-data-count').textContent = String(row.picks);
                el.querySelector('.page15-data-games').textContent = String(row.games);
                el.querySelector('.page15-data-winrate').textContent = formatWinRate(row.winRate);
                el.classList.add('is-entering');
                el.addEventListener('animationend', () => el.classList.remove('is-entering'), { once: true });
            } else {
                // 捕获旧画面值（rendered 随即写入新值，延迟回调要用旧值算差值）
                const prev = state.rendered.get(row.key) || { picks: 0, games: 0, wins: 0 };
                deferredUpdates.push({ el, row, prev });
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
                el.style.transition = `transform ${REPLAY_FLIP_MS}ms cubic-bezier(.22, .9, .26, 1)`;
                el.style.transform = 'translate(0, 0)';
                el.addEventListener('transitionend', () => {
                    el.style.transition = '';
                    el.style.transform = '';
                }, { once: true });
            }));
        });

        // 阶段二：位移基本落位后统一滚动数值 + 角标 + 闪光（过号/已脱离文档则跳过）
        const token = ++replayRenderToken;
        if (replayValueTimer) {
            window.clearTimeout(replayValueTimer);
        }
        replayValueTimer = window.setTimeout(() => {
            replayValueTimer = null;
            if (token !== replayRenderToken) {
                return;
            }
            deferredUpdates.forEach(({ el, row, prev }) => {
                if (el.isConnected) {
                    updateReplayRow(el, row, prev);
                }
            });
        }, REPLAY_VALUE_DELAY_MS);
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

    /** 回放收尾：角标提示 delay 毫秒后恢复实时口径（主动拉一次真实排行，renderSignature 已置空强制重绘） */
    function scheduleRealtimeRestore(badgeText, delay) {
        if (!replayState) {
            return;
        }
        replayBadgeText.textContent = badgeText;
        replayTimer = window.setTimeout(() => {
            replayActive = false;
            replayState = null;
            replayTimer = null;
            // 作废还没执行的延迟数值回调，避免恢复实时后追着旧画面跑
            replayRenderToken += 1;
            if (replayValueTimer) {
                window.clearTimeout(replayValueTimer);
                replayValueTimer = null;
            }
            replayBadge.hidden = true;
            renderSignature = null;
            void fetchRanking(currentTournamentId, currentStageIndex);
        }, delay);
    }

    /** 播完：角标提示后恢复实时口径；延迟至少盖过末场两段式动效（420ms 延迟 + 480ms 滚动），
     *  「快」速（650ms/场）下末场数值还没滚完就被实时重绘截断，所以取 max */
    function finishReplay() {
        if (!replayState) {
            return;
        }
        const hold = Math.max(replayState.interval, REPLAY_VALUE_DELAY_MS + 520);
        scheduleRealtimeRestore(`回放结束 · ${replayState.tournamentName}`, hold);
    }

    /** 不播放模式：所有场次增量一次累加，清空后静态渲染最终数据（无闪光/滑入/FLIP/数值滚动动效） */
    function renderFinalInstantly(state) {
        for (const step of state.steps) {
            for (const delta of step.deltas) {
                const entry = state.acc.get(delta.key) || { picks: 0, games: 0, wins: 0 };
                entry.picks += delta.picks;
                entry.games += delta.games;
                entry.wins += delta.wins;
                state.acc.set(delta.key, entry);
            }
        }
        state.cursor = state.steps.length;
        leftRowsEl.innerHTML = '';
        rightRowsEl.innerHTML = '';
        collectReplayRows(state).slice(0, REPLAY_TOP_N).forEach((row, index) => {
            const el = buildReplayRow(row);
            el.querySelector('.page15-rank').textContent = String(index + 1);
            el.querySelector('.page15-data-count').textContent = String(row.picks);
            el.querySelector('.page15-data-games').textContent = String(row.games);
            el.querySelector('.page15-data-winrate').textContent = formatWinRate(row.winRate);
            (index < 10 ? leftRowsEl : rightRowsEl).appendChild(el);
            state.rendered.set(row.key, { picks: row.picks, games: row.games, wins: row.wins });
        });
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
        if (replayValueTimer) {
            window.clearTimeout(replayValueTimer);
            replayValueTimer = null;
        }
        replayRenderToken += 1;
        replayActive = true;
        replayState = {
            sprites: payload.sprites && typeof payload.sprites === 'object' ? payload.sprites : {},
            steps,
            cursor: 0,
            acc: new Map(),
            rendered: new Map(),
            interval: REPLAY_INTERVALS[payload.speed] ?? REPLAY_INTERVALS.normal,
            tournamentName: String(payload.tournamentName || ''),
        };
        renderSignature = null;
        replayBadge.hidden = false;
        if (payload.play === true) {
            // 逐场播放：清空双列（同时清掉实时排行的旧行——它们没有 petId，keyed 复用认不出、
            // 不清会在下面追加出多余行），从空榜开始按场序累加播演化动画
            leftRowsEl.innerHTML = '';
            rightRowsEl.innerHTML = '';
            replayBadgeText.textContent = `0/${steps.length} 场 · ${replayState.tournamentName}`;
            replayTimer = window.setTimeout(playNextReplayStep, 500);
        } else {
            // 不播放（默认）：直接展示最终数据，停留片刻后恢复实时口径
            renderFinalInstantly(replayState);
            scheduleRealtimeRestore(`最终数据 · ${replayState.tournamentName}`, REPLAY_DIRECT_HOLD);
        }
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
