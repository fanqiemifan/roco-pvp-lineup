(function () {
    'use strict';

    // 页面布局常量：最多同时显示 4 条比赛信息
    const MAX_MATCHES = 4;

    const DEFAULT_AVATARS = {
        left: '/assets/ui/left-avatar.png',
        right: '/assets/ui/right-avatar.png'
    };
    const RANK_ICON = '/assets/ui/7.Wku3bA4b.png';

    // 复用 page3 的排名数字偏移：按显示位数设置数字距图标左侧的 x（10000+ 视为 6 位）
    const RANK_TEXT_LEFT_BY_LENGTH = { 1: 22, 2: 16, 3: 12, 4: 7, 5: 3, 6: -2 };

    const screenEl = document.getElementById('page8Screen');
    const titleEl = document.getElementById('page8Title');
    const gridEl = document.getElementById('page8Grid');

    let renderSignature = null;

    function formatRankText(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits) {
            return '';
        }
        return Number(digits) > 10000 ? '10000+' : digits;
    }

    function applyBackground(state) {
        const data = state || {};
        const mode = data.background === 'image-2' || data.background === 'custom' ? data.background : 'image';
        screenEl.classList.toggle('page8-mode-image-2', mode === 'image-2');
        screenEl.classList.toggle('page8-mode-custom', mode === 'custom');
        screenEl.style.setProperty('--page8-wallpaper', mode === 'custom' && data.wallpaperUrl ? `url("${data.wallpaperUrl}")` : 'none');
    }

    function applyTitle(state) {
        const title = String((state && state.title) || '').trim();
        titleEl.textContent = title;
        titleEl.hidden = !title;
    }

    /* ---------- 排位排名（复用 page3 rank div） ---------- */

    function buildRankIcon(rankValue) {
        const rank = document.createElement('div');
        rank.className = 'page8-rank';

        const icon = document.createElement('img');
        icon.src = RANK_ICON;
        icon.alt = '';
        rank.appendChild(icon);

        const txt = document.createElement('div');
        txt.className = 'page8-rank-txt';
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
        avatar.className = 'page8-avatar';

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

    /* ---------- 选手信息 div（头像 + 名字 + 排位排名） ---------- */

    function buildSide(side, match, matchAvatars) {
        const sideEl = document.createElement('div');
        sideEl.className = `page8-side page8-side-${side}`;

        sideEl.appendChild(buildAvatar(side, matchAvatars ? matchAvatars[side] : null));

        const name = document.createElement('div');
        name.className = 'page8-name';
        name.textContent = (side === 'left' ? match.leftPlayer : match.rightPlayer) || (side === 'left' ? '左侧' : '右侧');
        sideEl.appendChild(name);

        sideEl.appendChild(buildRankIcon(side === 'left' ? match.leftRank : match.rightRank));

        return sideEl;
    }

    /* ---------- 比赛信息卡：左右选手信息 div + 中央 vs ---------- */

    function buildMatchCard(match, avatars) {
        const card = document.createElement('div');
        card.className = 'page8-match';

        const matchAvatars = avatars ? avatars[match.id] || null : null;
        card.appendChild(buildSide('left', match, matchAvatars));

        const vs = document.createElement('div');
        vs.className = 'page8-vs';
        vs.textContent = 'vs';
        card.appendChild(vs);

        card.appendChild(buildSide('right', match, matchAvatars));

        return card;
    }

    function renderGrid(matches, avatars) {
        gridEl.innerHTML = '';
        (matches || []).slice(0, MAX_MATCHES).forEach((match) => {
            gridEl.appendChild(buildMatchCard(match, avatars));
        });
    }

    function applyAll(data) {
        const state = (data && data.state) || {};
        applyBackground(state);
        applyTitle(state);
        renderGrid(data && data.matches, data && data.avatars);
        renderSignature = buildSignature(data);
    }

    // 计算渲染签名：标题/背景/所选比赛/头像 任一变化才重渲染
    function buildSignature(data) {
        const state = (data && data.state) || {};
        const matches = (data && data.matches) || [];
        const avatars = (data && data.avatars) || null;

        return JSON.stringify({
            title: String(state.title || '').trim(),
            background: state.background || 'image',
            wallpaperUrl: state.wallpaperUrl || '',
            matchIds: state.matchIds || [],
            matches: matches.map((match) => ({
                id: match.id,
                leftPlayer: match.leftPlayer,
                rightPlayer: match.rightPlayer,
                leftRank: match.leftRank,
                rightRank: match.rightRank,
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

    async function loadData() {
        try {
            const data = await fetch('/api/page8', { credentials: 'same-origin' }).then((response) => response.json());
            // 签名一致则跳过，避免无差异重渲染导致头像闪烁
            if (renderSignature !== null && renderSignature === buildSignature(data)) {
                return;
            }
            applyAll(data);
        } catch (error) {
            console.error('page8 初始加载失败:', error);
        }
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            return;
        }
        const socket = io({ transports: ['websocket', 'polling'], query: { role: 'page8' } });

        socket.on('snapshot', (payload) => {
            if (payload && payload.page8) {
                void loadData();
            }
        });

        socket.on('page8:update', () => {
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

    document.addEventListener('DOMContentLoaded', () => {
        void loadData();
        connectSocket();
    });
})();
