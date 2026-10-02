(function () {
    'use strict';

    // 页面布局常量：一屏固定 4 行，行高 168、行间距 32，第一行距主标题 32
    const ROWS_PER_PAGE = 4;
    const ROW_HEIGHT = 168;
    const ROW_GAP = 32;
    const ROW_STRIDE = ROW_HEIGHT + ROW_GAP; // 每行步进 200px

    // 整屏切换间隔（秒）：来自「画面设置 → 战绩详情切屏间隔」，默认 10 秒；改设置立即按新节奏走
    const DEFAULT_SWITCH_SECONDS = 10;
    const SWITCH_MIN_SECONDS = 2;

    const DEFAULT_TITLE = '战绩详情';
    const DEFAULT_NOTICE = '温馨提示：排名选自选手历史最高非实时';
    const DEFAULT_AVATARS = {
        left: '/assets/ui/left-avatar.png',
        right: '/assets/ui/right-avatar.png'
    };
    const WIN_ICON = '/assets/ui/win-icon.DJfsgL3i.png';
    const FAIL_ICON = '/assets/ui/fail-icon.ChpzWjNv.png';
    const STAY_TUNED_ICON = '/assets/ui/icon-stay-tuned.DHbzz5us.png';
    const RANK_ICON = '/assets/ui/7.Wku3bA4b.png';
    const SPIRIT_INDEX_URL = '/api/sprites';

    // 复用 page3 的排名数字偏移：按显示位数设置数字距图标左侧的 x（10000+ 视为 6 位）
    const RANK_TEXT_LEFT_BY_LENGTH = { 1: 22, 2: 16, 3: 12, 4: 7, 5: 3, 6: -2 };

    const titleEl = document.getElementById('page7Title');
    const trackEl = document.getElementById('page7RowsTrack');
    const noticeEl = document.getElementById('page7Notice');

    let spriteLookup = null;
    let renderSignature = null;
    /** 交叉淡入淡出的两层：切换时把新一屏建到隐藏层，再同时翻两层的透明度（不做位移） */
    let layers = [];
    let activeLayer = 0;
    /** 当前屏下标与总屏数（数据更新时保持页码，不再像滚动实现那样跳回第一场） */
    let currentPage = 0;
    let pageCount = 1;
    let currentEntries = [];
    let currentAvatars = null;
    let holdTimer = null;
    /** 整屏切换间隔（毫秒）：画面设置里的秒数换算而来 */
    let switchMs = DEFAULT_SWITCH_SECONDS * 1000;

    /* ---------- 通用工具 ---------- */

    function normalizeText(value) {
        return String(value ?? '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[·・.。_\-－—]/g, '');
    }

    function stripVariantName(value) {
        return String(value ?? '').trim().replace(/[-_－—]\d+$/, '');
    }


    function formatRankText(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits) {
            return '';
        }
        return Number(digits) > 10000 ? '10000+' : digits;
    }

    /* ---------- 精灵索引（用于把小局阵容的 pet_id 解析成图片） ---------- */

    function buildSpriteLookup(records) {
        const byId = new Map();
        const byName = new Map();
        const byBaseName = new Map();
        records.forEach((record) => {
            // 阵容槽位存 pet_id，优先按 id 匹配；名字匹配兜底兼容旧数据
            const idKey = String(record.id || '').trim();
            const displayName = String(record.displayName || '').trim();
            const shortName = stripVariantName(displayName);
            const nameKey = normalizeText(displayName);
            const baseKey = normalizeText(shortName);
            if (idKey && !byId.has(idKey)) {
                byId.set(idKey, record);
            }
            if (nameKey && !byName.has(nameKey)) {
                byName.set(nameKey, record);
            }
            if (baseKey && !byBaseName.has(baseKey)) {
                byBaseName.set(baseKey, record);
            }
        });
        return { byId, byName, byBaseName };
    }

    async function loadSpriteIndex() {
        const response = await fetch(SPIRIT_INDEX_URL);
        if (!response.ok) {
            throw new Error(`精灵索引加载失败: ${response.status}`);
        }
        const payload = await response.json();
        // /api/sprites 返回 { sprites, count }，记录已含 id / displayName / path / iconUrl
        const records = Array.isArray(payload) ? payload : (payload.sprites || []);
        spriteLookup = buildSpriteLookup(records);
    }

    function resolveSprite(petId) {
        if (!petId || !spriteLookup) {
            return null;
        }
        const raw = String(petId).trim();
        const name = normalizeText(raw);
        const base = normalizeText(stripVariantName(raw));
        return spriteLookup.byId.get(raw) || spriteLookup.byName.get(name) || spriteLookup.byBaseName.get(base) || null;
    }

    /* ---------- 单个精灵卡（参考 page1 petsdiv3：精灵头像优先 + 圆形底托，比例 80x80） ---------- */


    function buildPetCard(petId) {
        const card = document.createElement('div');
        card.className = 'page7-pet';

        const image = document.createElement('img');
        image.alt = '';
        card.appendChild(image);

        const record = resolveSprite(petId);
        if (!record) {
            console.warn('[page7] 精灵索引中未找到:', petId);
            return card;
        }

        card.classList.add('is-active');

        // 头像优先，失败后回退精灵立绘
        const sources = [];
        if (record.iconUrl) {
            sources.push(record.iconUrl);
        }
        if (record.path) {
            sources.push(record.path);
        }

        if (!sources.length) {
            return card;
        }

        let currentIndex = 0;
        const assignNext = () => {
            image.src = sources[currentIndex];
        };
        image.onerror = () => {
            currentIndex += 1;
            if (currentIndex >= sources.length) {
                image.onerror = null;
                return;
            }
            assignNext();
        };
        assignNext();

        return card;
    }

    /* ---------- 排位排名（复用 page3 rank div） ---------- */

    function buildRankIcon(rankValue) {
        const rank = document.createElement('div');
        rank.className = 'page7-rank';

        const icon = document.createElement('img');
        icon.src = RANK_ICON;
        icon.alt = '';
        rank.appendChild(icon);

        const txt = document.createElement('div');
        txt.className = 'page7-rank-txt';
        const text = formatRankText(rankValue);
        if (text) {
            txt.textContent = text;
            txt.style.left = `${RANK_TEXT_LEFT_BY_LENGTH[Math.min(text.length, 6)]}px`;
        } else {
            txt.hidden = true;
        }
        rank.appendChild(txt);
        return rank;
    }

    /* ---------- 头像 ---------- */

    function buildAvatar(side, avatarState) {
        const avatar = document.createElement('div');
        avatar.className = 'page7-avatar';

        const image = document.createElement('img');
        image.alt = `${side === 'left' ? '左侧' : '右侧'}选手头像`;
        const state = avatarState || {};
        if (state.exists && state.path) {
            const cacheBuster = state.mtime ? Math.floor(state.mtime) : Date.now();
            image.src = `${state.path}?t=${cacheBuster}`;
        } else {
            image.src = DEFAULT_AVATARS[side];
        }
        avatar.appendChild(image);
        return avatar;
    }

    /* ---------- 半区（left / right div） ---------- */

    function buildSide(side, match, game, matchAvatars) {
        const sideEl = document.createElement('div');
        sideEl.className = `page7-side page7-side-${side}`;

        const winner = game ? game.winner : null;
        if (winner === side) {
            sideEl.classList.add('is-winner');
        }

        // 头像（按比赛 id 从 avatars 映射中取该场的头像）
        sideEl.appendChild(buildAvatar(side, matchAvatars ? matchAvatars[side] : null));

        const name = document.createElement('div');
        name.className = 'page7-name';
        name.textContent = (side === 'left' ? match.leftPlayer : match.rightPlayer) || (side === 'left' ? '左侧' : '右侧');
        sideEl.appendChild(name);

        sideEl.appendChild(buildRankIcon(side === 'left' ? match.leftRank : match.rightRank));

        // 精灵卡（该小局阵容，最多 6 张，每张 80x80 间隙 12px）
        const pets = document.createElement('div');
        pets.className = 'page7-pets';
        const slots = game ? (side === 'left' ? game.leftSlots : game.rightSlots) : null;
        (slots || []).forEach((slot) => {
            if (slot && slot.pet_id) {
                pets.appendChild(buildPetCard(slot.pet_id));
            }
        });
        sideEl.appendChild(pets);

        // 胜负图标：胜方 win-icon、败方 fail-icon，未分出胜负时不显示
        if (winner === 'left' || winner === 'right') {
            const result = document.createElement('div');
            result.className = 'page7-result';
            const icon = document.createElement('img');
            icon.src = winner === side ? WIN_ICON : FAIL_ICON;
            icon.alt = winner === side ? '胜' : '负';
            result.appendChild(icon);
            sideEl.appendChild(result);
        }

        return sideEl;
    }

    /* ---------- 行渲染 ---------- */

    // 参与展示的小局：已分出胜负，或已录入阵容（进行中/待开始的下一局）
    function getDisplayGames(match) {
        if (!match || !Array.isArray(match.games)) {
            return [];
        }
        return match.games.filter((game) => {
            if (game.status === 'completed') {
                return true;
            }
            const leftCount = Array.isArray(game.leftLineup) ? game.leftLineup.length : 0;
            const rightCount = Array.isArray(game.rightLineup) ? game.rightLineup.length : 0;
            return leftCount + rightCount > 0;
        });
    }

    // 多场比赛按选择顺序合并：每场比赛的每个参与小局占一行；系列赛对局带上服务端下发的阶段标签
    function collectDisplayEntries(matches, labels) {
        const entries = [];
        (matches || []).forEach((match) => {
            getDisplayGames(match).forEach((game) => {
                entries.push({ match, game, label: labels ? labels[match.id] : null });
            });
        });
        return entries;
    }

    /**
     * 行首标签：系列赛对局用服务端下发的「阶段·轮次」（两段换行显示，如「8进4」/「败者组 R2」）；
     * 普通对局仍用全局 GAME 序号（勾选顺序即行序）。
     */
    function buildRowLabel(entry, entryIndex) {
        const label = entry && entry.label ? String(entry.label).trim() : '';
        if (label) {
            return label.split('·').map((part) => part.trim()).filter(Boolean).join('\n');
        }
        return `GAME${entryIndex + 1}`;
    }

    function buildRow(slotIndex, entry, labelText, avatars) {
        const match = entry ? entry.match : null;
        const game = entry ? entry.game : null;
        const row = document.createElement('div');
        row.className = 'page7-row';
        row.style.top = `${slotIndex * ROW_STRIDE}px`;

        // 行首标签：GAME1、GAME2…（空占位行也正常显示）；系列赛为两行「阶段 / 轮次」
        const label = document.createElement('div');
        label.className = 'page7-row-label';
        if (labelText.indexOf('\n') >= 0) {
            label.classList.add('is-stacked');
        }
        label.textContent = labelText;
        row.appendChild(label);

        const card = document.createElement('div');
        if (game && match) {
            card.className = 'page7-card';
            const matchAvatars = avatars ? avatars[match.id] || null : null;
            card.appendChild(buildSide('left', match, game, matchAvatars));
            card.appendChild(buildSide('right', match, game, matchAvatars));
        } else {
            card.className = 'page7-card page7-card-empty';
            const icon = document.createElement('img');
            icon.src = STAY_TUNED_ICON;
            icon.alt = '敬请期待';
            card.appendChild(icon);
        }
        row.appendChild(card);

        return row;
    }

    /* ---------- 整屏过渡：一屏 4 行，超过一屏时交叉淡入淡出（不滚动、不回卷） ---------- */

    function ensureLayers() {
        if (layers.length) {
            return;
        }
        layers = [0, 1].map(() => {
            const layer = document.createElement('div');
            layer.className = 'page7-rows-layer';
            trackEl.appendChild(layer);
            return layer;
        });
        layers[0].classList.add('is-visible');
    }

    function stopPager() {
        if (holdTimer !== null) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
    }

    /**
     * 建一屏：4 行（不足补空占位行）。只重建这一层的 4 行——层在过渡期间不可见，
     * 因此不会有闪烁；整屏的行元素数量恒定，与选了多少场无关。
     */
    function renderPageInto(layer, pageIndex, avatars) {
        layer.innerHTML = '';
        for (let slot = 0; slot < ROWS_PER_PAGE; slot += 1) {
            const entryIndex = pageIndex * ROWS_PER_PAGE + slot;
            const entry = currentEntries[entryIndex] || null;
            layer.appendChild(buildRow(slot, entry, buildRowLabel(entry, entryIndex), avatars));
        }
    }

    /** 过渡到某一屏：建到隐藏层 → 同时翻两层透明度（整屏交叉淡入淡出） */
    function presentPage(pageIndex) {
        ensureLayers();
        const nextIndex = ((pageIndex % pageCount) + pageCount) % pageCount;
        const incoming = 1 - activeLayer;
        renderPageInto(layers[incoming], nextIndex, currentAvatars);
        layers[incoming].classList.add('is-visible');
        layers[activeLayer].classList.remove('is-visible');
        activeLayer = incoming;
        currentPage = nextIndex;
    }

    function scheduleNextPage() {
        stopPager();
        if (pageCount <= 1) {
            return;
        }
        holdTimer = setTimeout(() => {
            presentPage(currentPage + 1);
            scheduleNextPage();
        }, switchMs);
    }

    /**
     * 应用画面设置里的切屏间隔（秒）：非法/过小值回退默认；
     * 当前屏的停留定时器一并按新间隔重排——用户改完设置不用等旧周期走完。
     */
    function applySwitchSeconds(value) {
        const seconds = Number(value);
        const next = Number.isFinite(seconds) && seconds >= SWITCH_MIN_SECONDS
            ? seconds
            : DEFAULT_SWITCH_SECONDS;
        if (Math.round(next * 1000) === switchMs) {
            return;
        }
        switchMs = Math.round(next * 1000);
        scheduleNextPage();
    }

    /**
     * 应用一份数据：重算分屏 → 原地过渡到当前屏（页码尽量保持）。
     * 数据更新（新登记一小局 / 头像变化）走同一条路径，画面是"慢慢换成新的"而不是闪一下重建。
     */
    function applyData(data) {
        currentEntries = collectDisplayEntries(
            (data && data.matches) || [],
            (data && data.tournamentLabels) || null,
        );
        currentAvatars = (data && data.avatars) || null;
        pageCount = Math.max(1, Math.ceil(currentEntries.length / ROWS_PER_PAGE));
        // 选场变少导致当前页越界时回到第一屏
        if (currentPage >= pageCount) {
            currentPage = 0;
        }
        presentPage(currentPage);
        scheduleNextPage();
    }

    // 计算渲染签名：标题/提示/所选比赛/小局/头像/阶段标签 任一变化才重渲染
    function buildSignature(data) {
        const state = (data && data.state) || {};
        const matches = (data && data.matches) || [];
        const avatars = (data && data.avatars) || null;
        const labels = (data && data.tournamentLabels) || null;

        return JSON.stringify({
            title: String(state.title || '').trim() || DEFAULT_TITLE,
            notice: String(state.notice || '').trim() || DEFAULT_NOTICE,
            matchIds: state.matchIds || [],
            // 行首标签（阶段·轮次）随系列赛编排变化（如季军赛波次建出来）→ 必须进签名
            labels: labels ? Object.keys(labels).sort().map((matchId) => [matchId, labels[matchId]]) : null,
            matches: matches.map((match) => ({
                id: match.id,
                leftPlayer: match.leftPlayer,
                rightPlayer: match.rightPlayer,
                leftRank: match.leftRank,
                rightRank: match.rightRank,
                games: (match.games || []).map((game) => ({
                    gameNumber: game.gameNumber,
                    winner: game.winner,
                    status: game.status,
                    leftLineup: game.leftLineup,
                    rightLineup: game.rightLineup,
                })),
            })),
            avatars: avatars ? Object.keys(avatars).map((matchId) => ({
                matchId,
                left: avatars[matchId] && avatars[matchId].left && avatars[matchId].left.exists
                    ? `${avatars[matchId].left.path}?${avatars[matchId].left.mtime}` : '',
                right: avatars[matchId] && avatars[matchId].right && avatars[matchId].right.exists
                    ? `${avatars[matchId].right.path}?${avatars[matchId].right.mtime}` : '',
            })) : null,
        });
    }

    function applyAll(data) {
        const state = (data && data.state) || {};

        titleEl.textContent = String(state.title || '').trim() || DEFAULT_TITLE;
        noticeEl.textContent = String(state.notice || '').trim() || DEFAULT_NOTICE;

        applyData(data);

        renderSignature = buildSignature(data);
    }

    async function loadData() {
        try {
            const data = await fetch('/api/page7', { credentials: 'same-origin' }).then((response) => response.json());
            // 先用同一份签名逻辑判断是否有变化，避免无差异重渲染导致图片闪烁
            if (renderSignature !== null && renderSignature === buildSignature(data)) {
                return;
            }
            applyAll(data);
        } catch (error) {
            console.error('page7 初始加载失败:', error);
        }
    }

    /** 画面设置（stage）里的战绩详情配置：目前只有整屏切换间隔 */
    async function loadStageConfig() {
        const data = await fetch('/api/stage', { credentials: 'same-origin' }).then((response) => response.json());
        applySwitchSeconds(data && data.page7SwitchSeconds);
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            return;
        }
        const socket = io({ transports: ['websocket', 'polling'], query: { role: 'page7' } });

        socket.on('snapshot', (payload) => {
            if (payload && payload.page7) {
                void loadData();
            }
        });

        socket.on('page7:update', () => {
            void loadData();
        });

        socket.on('matches:update', () => {
            void loadData();
        });

        socket.on('avatar:update', () => {
            // 头像按赛事隔离：重新拉取后由签名比对决定是否重渲染
            void loadData();
        });

        // 画面设置改动（切屏间隔）实时生效：重排当前屏的停留定时器
        socket.on('stage:update', (payload) => {
            const stage = payload && payload.stage ? payload.stage : payload;
            applySwitchSeconds(stage && stage.page7SwitchSeconds);
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            await loadSpriteIndex();
        } catch (error) {
            console.error('精灵索引加载失败:', error);
        }
        try {
            await loadStageConfig();
        } catch (error) {
            // 拉不到画面设置不影响出画面：切屏间隔回退默认 10 秒
            console.error('画面设置加载失败（切屏间隔用默认值）:', error);
        }
        void loadData();
        connectSocket();
    });
})();
