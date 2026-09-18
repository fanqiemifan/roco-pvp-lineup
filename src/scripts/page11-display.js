(function () {
    'use strict';

    /**
     * 选手介绍页渲染脚本（page11-13 共用，?mode=left/right/versus 区分画面）。
     *
     * 数据来源：GET /api/page11 -> { state, profiles, match, avatars, panels }
     * - state：后台配置。source=manual 用手动填写内容；source=match 用当前赛事选手名
     * - profiles：「信息录入」选手，按名字匹配补全头像/排名/宣言/常用精灵
     * - match / avatars：当前赛事（选手名/排位）与按赛事隔离的头像
     * - panels：左右实时阵容（对战页阵容条使用）
     */

    const SPIRIT_INDEX_URL = '/api/sprites';
    const MAX_PETS = 6;
    const DEFAULT_AVATAR = '/assets/ui/left-avatar.png';

    // 当前画面模式（left / right / versus）：初始值来自 URL，之后可被载体 postMessage 动态切换
    let mode = (new URLSearchParams(window.location.search).get('mode') || 'right').toLowerCase();
    const screenEl = document.getElementById('page11Screen');

    const els = {
        name: document.getElementById('page11Name'),
        rankWrap: document.getElementById('page11RankWrap'),
        rankTxt: document.getElementById('page11RankTxt'),
        avatar: document.getElementById('page11PhotoAvatar'),
        pets: document.getElementById('page11Pets'),
        declaration: document.getElementById('page11Declaration'),
    };

    const versusEls = {
        left: {
            name: document.getElementById('versusLeftName'),
            rankWrap: document.getElementById('versusLeftRankWrap'),
            rankTxt: document.getElementById('versusLeftRankTxt'),
            avatar: document.getElementById('versusLeftAvatar'),
            pets: document.getElementById('versusLeftPets'),
        },
        right: {
            name: document.getElementById('versusRightName'),
            rankWrap: document.getElementById('versusRightRankWrap'),
            rankTxt: document.getElementById('versusRightRankTxt'),
            avatar: document.getElementById('versusRightAvatar'),
            pets: document.getElementById('versusRightPets'),
        },
    };

    let spriteLookup = null;
    let renderSignature = null;
    // 最近一次拉取的数据缓存：仅切换 mode（无数据变化）时直接用它重渲染
    let lastData = null;
    // 「直播推流」面板开关：是否显示选手排位排名 div（关闭后三画面均不显示）
    let page11RankVisible = true;

    /* ---------- 通用工具（与 page10-display.js 保持一致） ---------- */

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



    /* ---------- 精灵索引 ---------- */

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

    /* ---------- petsdiv3 渲染（复用推流页面1 的结构与候选图逻辑） ---------- */

    function buildPetSlot(slotData) {
        const slotEl = document.createElement('div');
        const petId = slotData && slotData.pet_id ? String(slotData.pet_id).trim() : '';
        if (!petId) {
            slotEl.className = 'petsdiv3 is-empty';
            return slotEl;
        }

        const record = resolveSprite(petId);
        const isDead = Boolean(slotData.healthEnabled && Number(slotData.healthPercent) <= 0);
        slotEl.className = `petsdiv3 is-active${isDead ? ' is-dead' : ''}`;

        const imgEl = document.createElement('img');
        imgEl.alt = record ? record.displayName : petId;
        slotEl.appendChild(imgEl);

        // 头像优先，失败后回退精灵立绘
        const sources = [];
        if (record && record.iconUrl) {
            sources.push(record.iconUrl);
        }
        if (record && record.path) {
            sources.push(record.path);
        }

        if (!sources.length) {
            return slotEl;
        }

        let currentIndex = 0;
        const assignNext = () => {
            imgEl.src = sources[currentIndex];
        };
        imgEl.onerror = () => {
            currentIndex += 1;
            if (currentIndex >= sources.length) {
                imgEl.onerror = null;
                return;
            }
            assignNext();
        };
        assignNext();

        return slotEl;
    }

    /* ---------- 面板槽位转阵容槽位（pet_id） ---------- */

    function panelToSlots(panel) {
        if (!panel || !Array.isArray(panel.selected)) {
            return [];
        }
        // pet_id 用精灵 id，与持久化口径一致
        return panel.selected.map((slot) => ({
            pet_id: slot.sprite ? String(slot.sprite.id || slot.sprite.displayName || '') : '',
            healthEnabled: Boolean(slot.healthEnabled),
            healthPercent: slot.healthPercent,
        }));
    }

    /* ---------- 信息录入匹配 ---------- */

    function findProfileByName(profiles, name) {
        const key = normalizeText(name);
        if (!key || !profiles || !Array.isArray(profiles.players)) {
            return null;
        }
        return profiles.players.find((item) => normalizeText(item.name) === key) || null;
    }

    /* ---------- 选手解析：manual / match + 信息录入补全 ---------- */

    function resolveSide(data, side) {
        const state = data.state && data.state[side] ? data.state[side] : null;
        const match = data.match || null;

        // 选手名：match 模式取当前赛事；manual 模式用手动填写
        let name = '';
        if (state && state.source === 'match') {
            name = match ? (side === 'left' ? match.leftPlayer : match.rightPlayer) || '' : '';
        } else if (state) {
            name = state.name || '';
        }
        // match 模式下手动名字为空时也回退当前赛事选手名
        if (!name && match && state && state.source === 'manual') {
            name = (side === 'left' ? match.leftPlayer : match.rightPlayer) || '';
        }

        // 信息录入匹配：用解析后的最终选手名（而非配置里的手动名字），保证 match 模式也能匹配
        const profile = findProfileByName(data.profiles, name);

        // 排名：手动填写 > 赛事录入 > 信息录入匹配
        const matchRank = match ? (side === 'left' ? match.leftRank : match.rightRank) || '' : '';
        let rank = state && state.source === 'manual' && state.rank ? state.rank : '';
        if (!rank) {
            rank = matchRank;
        }
        if (!rank && profile) {
            rank = profile.rank || '';
        }

        // 宣言 / 擅长精灵：手动填写优先，否则回退信息录入按名字匹配
        const declaration = state && state.source === 'manual' && state.declaration
            ? state.declaration
            : (profile ? profile.declaration : '') || (state ? state.declaration : '');
        const pets = state && state.source === 'manual' && state.pets
            ? state.pets
            : (profile ? profile.pets : '') || (state ? state.pets : '');

        // 头像：当前赛事头像优先；无则回退信息录入头像；再无则默认占位图
        const avatarState = data.avatars ? data.avatars[side] : null;
        const profileAvatar = profile && profile.avatarExists
            ? `/runtime/profiles/players/${encodeURIComponent(profile.id)}.png?t=${profile.avatarMtime ?? 0}`
            : '';

        return { name, rank, declaration, pets, avatarState, profileAvatar };
    }

    /* ---------- 比赛宣言自适应：先缩字号，仍超长再横向滚动 ---------- */

    const DECLARE_FONT_MAX = 64;
    const DECLARE_FONT_MIN = 36;

    /**
     * 比赛宣言渲染：
     * 1. 默认 64px 单行居中；文本超宽时逐步缩小字号（最小 36px）尽量完整显示。
     * 2. 缩到最小仍放不下时改用横向往返滚动（CSS marquee）展示全文。
     */
    function renderDeclaration(el, text) {
        if (!el) {
            return;
        }
        // 复位：清除上次渲染可能残留的行内字号与滚动状态
        el.classList.remove('is-scroll');
        el.style.fontSize = '';
        el.textContent = text;

        if (!text) {
            return;
        }

        // 1) 逐步缩小字号，尽量单行完整显示；字号缩小后 top 调整为 140（设计稿基线）
        let size = DECLARE_FONT_MAX;
        el.style.fontSize = `${size}px`;
        el.style.top = '';
        while (size > DECLARE_FONT_MIN && el.scrollWidth > el.clientWidth) {
            size -= 2;
            el.style.fontSize = `${size}px`;
        }
        if (el.scrollWidth <= el.clientWidth) {
            if (size < DECLARE_FONT_MAX) {
                el.style.top = '140px';
            }
            return;
        }

        // 2) 最小字号仍放不下：包一层 span 做横向往返滚动（滚动模式同样 top 140）
        el.textContent = '';
        el.style.top = '140px';
        const inner = document.createElement('span');
        inner.className = 'page11-declare-text';
        inner.textContent = text;
        el.appendChild(inner);
        el.classList.add('is-scroll');

        // 滚动距离 = 文本宽 - 容器宽；时长按约 60px/秒 估算，至少 6 秒
        const shift = Math.max(0, inner.offsetWidth - el.clientWidth);
        inner.style.setProperty('--declare-shift', `-${shift}px`);
        inner.style.animationDuration = `${Math.max(6, Math.ceil(shift / 60))}s`;
    }

    /* ---------- 渲染 ---------- */

    function renderPhoto(target, info, avatarState) {
        if (!target) {
            return;
        }
        if (target.name) {
            target.name.textContent = info.name || '待定';
        }
        const rankDigits = String(info.rank || '').replace(/\D/g, '');
        const rankVisible = page11RankVisible && Boolean(rankDigits);
        if (target.rankWrap) {
            target.rankWrap.hidden = !rankVisible;
        }
        if (target.rankTxt) {
            target.rankTxt.textContent = rankDigits;
        }
        if (target.avatar) {
            if (avatarState && avatarState.exists && avatarState.path) {
                const cacheBuster = avatarState.mtime ? Math.floor(avatarState.mtime) : Date.now();
                target.avatar.src = `${avatarState.path}?t=${cacheBuster}`;
            } else if (info.profileAvatar) {
                target.avatar.src = info.profileAvatar;
            } else {
                target.avatar.src = DEFAULT_AVATAR;
            }
        }
    }

    // 擅长精灵：自由文本按 / 、 ， , 空格 分隔，最多 6 个
    function parsePetsText(text) {
        return String(text || '')
            .split(/[/、,，\s]+/)
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, MAX_PETS);
    }

    function renderPets(el, petsText) {
        if (!el) {
            return;
        }
        el.innerHTML = '';
        parsePetsText(petsText).forEach((name) => {
            el.appendChild(buildPetSlot({ pet_id: name }));
        });
    }

    function applyAll(data) {
        page11RankVisible = Boolean(data && data.stage && data.stage.page11RankVisible !== undefined
            ? data.stage.page11RankVisible
            : true);
        screenEl.setAttribute('data-mode', mode);

        const leftInfo = resolveSide(data, 'left');
        const rightInfo = resolveSide(data, 'right');

        if (mode === 'versus') {
            renderPhoto(versusEls.left, leftInfo, data.avatars ? data.avatars.left : null);
            renderPhoto(versusEls.right, rightInfo, data.avatars ? data.avatars.right : null);
            // 对战页阵容：当前赛事双方实时阵容面板
            renderPets(versusEls.left.pets, null);
            renderPets(versusEls.right.pets, null);
            const panels = Array.isArray(data.panels) ? data.panels : [];
            const leftPanel = panels.find((panel) => panel.position === 'left') || null;
            const rightPanel = panels.find((panel) => panel.position === 'right') || null;
            panelToSlots(leftPanel).forEach((slot) => versusEls.left.pets.appendChild(buildPetSlot(slot)));
            panelToSlots(rightPanel).forEach((slot) => versusEls.right.pets.appendChild(buildPetSlot(slot)));
        } else {
            // 介绍单侧选手：left 模式显示左侧选手，right 模式显示右侧选手
            const side = mode === 'left' ? 'left' : 'right';
            const info = side === 'left' ? leftInfo : rightInfo;
            renderPhoto(els, info, data.avatars ? data.avatars[side] : null);
            renderPets(els.pets, info.pets);
            renderDeclaration(els.declaration, info.declaration || '');
        }

        renderSignature = buildSignature(data);
    }

    // 渲染签名：任一相关数据变化才重渲染
    function buildSignature(data) {
        return JSON.stringify({
            mode,
            stageRankVisible: data && data.stage ? data.stage.page11RankVisible : true,
            state: data.state,
            profiles: data.profiles && Array.isArray(data.profiles.players)
                ? data.profiles.players.map((item) => [item.name, item.rank, item.declaration, item.pets, item.avatarMtime])
                : [],
            match: data.match ? {
                id: data.match.id,
                leftPlayer: data.match.leftPlayer,
                rightPlayer: data.match.rightPlayer,
                leftRank: data.match.leftRank,
                rightRank: data.match.rightRank,
            } : null,
            avatars: data.avatars
                ? {
                    left: data.avatars.left && data.avatars.left.exists ? `${data.avatars.left.path}?${data.avatars.left.mtime}` : '',
                    right: data.avatars.right && data.avatars.right.exists ? `${data.avatars.right.path}?${data.avatars.right.mtime}` : '',
                }
                : null,
            panels: (Array.isArray(data.panels) ? data.panels : []).map((panel) => ({
                position: panel.position,
                selected: (panel.selected || []).map((slot) => [
                    slot.sprite ? slot.sprite.displayName : '',
                    slot.healthEnabled,
                    slot.healthPercent,
                ]),
            })),
        });
    }

    async function loadData() {
        try {
            const data = await fetch('/api/page11', { credentials: 'same-origin' }).then((response) => response.json());
            if (renderSignature !== null && renderSignature === buildSignature(data)) {
                return;
            }
            lastData = data;
            applyAll(data);
        } catch (error) {
            console.error('page11 初始加载失败:', error);
        }
    }

    // 载体（stage-carrier）在同家族画面间切换时通过 postMessage 通知本页换 mode：
    // 不重载页面，直接用缓存数据按新模式重渲染，元素动效由 CSS 完成
    function setMode(nextMode) {
        if (nextMode !== 'left' && nextMode !== 'right' && nextMode !== 'versus') {
            return;
        }
        if (nextMode === mode) {
            return;
        }
        mode = nextMode;
        if (lastData) {
            applyAll(lastData);
        } else {
            void loadData();
        }
    }

    window.addEventListener('message', (event) => {
        const payload = event.data;
        if (payload && payload.type === 'page11-mode') {
            setMode(payload.mode);
        }
    });

    function connectSocket() {
        if (typeof io !== 'function') {
            return;
        }

        const socket = io({ transports: ['websocket', 'polling'] });

        socket.on('snapshot', () => {
            void loadData();
        });

        socket.on('matches:update', () => {
            void loadData();
        });

        socket.on('avatar:update', () => {
            void loadData();
        });

        socket.on('panel:update', () => {
            void loadData();
        });

        socket.on('stage:update', () => {
            void loadData();
        });

        socket.on('page11:update', () => {
            void loadData();
        });

        socket.on('profiles:update', () => {
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
