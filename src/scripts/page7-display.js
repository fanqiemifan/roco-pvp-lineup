(function () {
    'use strict';

    // 页面布局常量：最多同时显示 4 行，行高 168、行间距 32，第一行距主标题 32
    const MAX_VISIBLE_ROWS = 4;
    const ROW_HEIGHT = 168;
    const ROW_GAP = 32;
    const ROW_STRIDE = ROW_HEIGHT + ROW_GAP; // 每行步进 200px

    // 循环滚动节奏（先快后慢）：起始停留短，越接近底部停留越长，回到第一场后重置
    const SCROLL_HOLD_FAST_MS = 1600;
    const SCROLL_HOLD_SLOW_MS = 3600;

    const DEFAULT_TITLE = '对局推送';
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
    const rowsEl = document.getElementById('page7RowsTrack');
    const noticeEl = document.getElementById('page7Notice');

    let spriteLookup = null;
    let renderSignature = null;
    let scrollTimer = null;
    let currentScrollOffset = 0;

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

        // 选手名字
        const name = document.createElement('div');
        name.className = 'page7-name';
        name.textContent = (side === 'left' ? match.leftPlayer : match.rightPlayer) || (side === 'left' ? '左侧' : '右侧');
        sideEl.appendChild(name);

        // 排位排名图标
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

    // 多场比赛按选择顺序合并：每场比赛的每个参与小局占一行
    function collectDisplayEntries(matches) {
        const entries = [];
        (matches || []).forEach((match) => {
            getDisplayGames(match).forEach((game) => {
                entries.push({ match, game });
            });
        });
        return entries;
    }

    function buildRow(index, entry, gameNumber, avatars) {
        const match = entry ? entry.match : null;
        const game = entry ? entry.game : null;
        const row = document.createElement('div');
        row.className = 'page7-row';
        row.style.top = `${index * ROW_STRIDE}px`;

        // 对局序号：GAME1、GAME2…（空占位行也正常显示）
        const label = document.createElement('div');
        label.className = 'page7-row-label';
        label.textContent = `GAME${gameNumber}`;
        row.appendChild(label);

        const card = document.createElement('div');
        if (game && match) {
            card.className = 'page7-card';
            const matchAvatars = avatars ? avatars[match.id] || null : null;
            card.appendChild(buildSide('left', match, game, matchAvatars));
            card.appendChild(buildSide('right', match, game, matchAvatars));
        } else {
            // 空占位卡：icon-stay-tuned 居中
            card.className = 'page7-card page7-card-empty';
            const icon = document.createElement('img');
            icon.src = STAY_TUNED_ICON;
            icon.alt = '敬请期待';
            card.appendChild(icon);
        }
        row.appendChild(card);

        return row;
    }

    /* ---------- 循环滚动：超过 4 行时逐行下滚，到底后滚回第一场，节奏先快后慢 ---------- */

    function stopAutoScroll() {
        if (scrollTimer !== null) {
            clearTimeout(scrollTimer);
            scrollTimer = null;
        }
    }

    function scheduleAutoScroll(rowCount) {
        const maxOffset = rowCount - MAX_VISIBLE_ROWS;
        if (maxOffset <= 0) {
            return;
        }
        // 先快后慢：按滚动进度在快/慢停留时长之间线性过渡，回到第一场后节奏重置
        const progress = Math.min(1, Math.max(0, currentScrollOffset / maxOffset));
        const holdMs = SCROLL_HOLD_FAST_MS + (SCROLL_HOLD_SLOW_MS - SCROLL_HOLD_FAST_MS) * progress;
        scrollTimer = setTimeout(() => {
            currentScrollOffset = currentScrollOffset >= maxOffset ? 0 : currentScrollOffset + 1;
            rowsEl.style.transform = `translateY(${-currentScrollOffset * ROW_STRIDE}px)`;
            scheduleAutoScroll(rowCount);
        }, holdMs);
    }

    function startAutoScroll(rowCount) {
        stopAutoScroll();
        currentScrollOffset = 0;
        rowsEl.style.transition = 'none';
        rowsEl.style.transform = 'translateY(0)';
        // 下一帧恢复过渡，避免重置位置时出现滑动动画
        requestAnimationFrame(() => {
            rowsEl.style.transition = '';
        });
        if (rowCount > MAX_VISIBLE_ROWS) {
            scheduleAutoScroll(rowCount);
        }
    }

    function renderRows(data) {
        const matches = (data && data.matches) || [];
        const avatars = (data && data.avatars) || null;

        rowsEl.innerHTML = '';

        // 全部参与展示的小局按选择顺序合并渲染（GAME 序号连续编号）
        const entries = collectDisplayEntries(matches);
        // 不足 4 行时用空占位行补齐到 4 行
        const rowCount = Math.max(MAX_VISIBLE_ROWS, entries.length);

        for (let index = 0; index < rowCount; index += 1) {
            const entry = entries[index] || null;
            rowsEl.appendChild(buildRow(index, entry, index + 1, avatars));
        }

        startAutoScroll(rowCount);
    }

    // 计算渲染签名：标题/提示/所选比赛/小局/头像 任一变化才重渲染
    function buildSignature(data) {
        const state = (data && data.state) || {};
        const matches = (data && data.matches) || [];
        const avatars = (data && data.avatars) || null;

        return JSON.stringify({
            title: String(state.title || '').trim() || DEFAULT_TITLE,
            notice: String(state.notice || '').trim() || DEFAULT_NOTICE,
            matchIds: state.matchIds || [],
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

        renderRows(data);

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

    function connectSocket() {
        if (typeof io !== 'function') {
            return;
        }
        const socket = io({ transports: ['websocket', 'polling'] });

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
    }

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            await loadSpriteIndex();
        } catch (error) {
            console.error('精灵索引加载失败:', error);
        }
        void loadData();
        connectSocket();
    });
})();
