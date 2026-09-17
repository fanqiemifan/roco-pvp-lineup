(function () {
    'use strict';

    /**
     * 推流页面10（胜者结算画面）渲染脚本。
     *
     * 数据来源：GET /api/page10 -> { match, avatars }
     * - match：当前活跃比赛（含每个小局的胜负与阵容槽位）
     * - avatars：当前活跃比赛的左右选手头像
     *
     * 胜者取「最近一个已分胜负的小局」：
     * 例如 BO5 打到第 3 局，第 3 局已分胜负则取第 3 局胜者，第 3 局进行中则取第 2 局胜者。
     * 阵容精灵卡复用推流页面1 的 petsdiv3（精灵头像优先，失败回退精灵立绘）。
     */

    const SPIRIT_INDEX_URL = '/api/sprites';
    const DEFAULT_AVATARS = {
        left: '/assets/ui/left-avatar.png',
        right: '/assets/ui/right-avatar.png'
    };

    const nameEl = document.getElementById('page10Name');
    const avatarImgEl = document.getElementById('page10Avatar');
    const petsEl = document.getElementById('page10Pets');

    let spriteLookup = null;
    let renderSignature = null;

    /* ---------- 通用工具（与 page7-display.js 保持一致） ---------- */

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



    /* ---------- 精灵索引（把小局阵容的 pet_id 解析成图片） ---------- */

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

    /* ---------- 胜者解析：最近一个已分胜负的小局 ---------- */

    function getLatestCompletedGame(match) {
        if (!match || !Array.isArray(match.games)) {
            return null;
        }
        const completed = match.games.filter((game) => (
            game && game.status === 'completed' && (game.winner === 'left' || game.winner === 'right')
        ));
        return completed.length ? completed[completed.length - 1] : null;
    }

    /* ---------- 渲染 ---------- */

    function applyAll(data) {
        const match = data && data.match ? data.match : null;
        const avatars = data && data.avatars ? data.avatars : null;
        const game = getLatestCompletedGame(match);
        const side = game ? game.winner : null;

        // 主标题：获胜选手名字
        let playerName = '待定';
        if (match && side) {
            playerName = (side === 'left' ? match.leftPlayer : match.rightPlayer) || '待定';
        }
        nameEl.textContent = playerName;

        // 头像：优先当前比赛头像，无头像时回退默认占位图
        const avatarState = side && avatars ? avatars[side] : null;
        if (avatarState && avatarState.exists && avatarState.path) {
            const cacheBuster = avatarState.mtime ? Math.floor(avatarState.mtime) : Date.now();
            avatarImgEl.src = `${avatarState.path}?t=${cacheBuster}`;
        } else {
            avatarImgEl.src = side ? DEFAULT_AVATARS[side] : DEFAULT_AVATARS.left;
        }

        // 获胜方阵容：取该小局获胜一侧的槽位
        petsEl.innerHTML = '';
        if (game && side) {
            const slots = side === 'left' ? game.leftSlots : game.rightSlots;
            (slots || []).forEach((slot) => {
                petsEl.appendChild(buildPetSlot(slot));
            });
        }

        renderSignature = buildSignature(data);
    }

    // 渲染签名：比赛/小局胜负/阵容槽位/头像 任一变化才重渲染
    function buildSignature(data) {
        const match = data && data.match ? data.match : null;
        const avatars = data && data.avatars ? data.avatars : null;
        return JSON.stringify({
            matchId: match ? match.id : null,
            leftPlayer: match ? match.leftPlayer : '',
            rightPlayer: match ? match.rightPlayer : '',
            games: match && Array.isArray(match.games)
                ? match.games.map((game) => ({
                    gameNumber: game.gameNumber,
                    winner: game.winner,
                    status: game.status,
                    leftSlots: game.leftSlots || [],
                    rightSlots: game.rightSlots || [],
                }))
                : [],
            avatars: avatars
                ? {
                    left: avatars.left && avatars.left.exists ? `${avatars.left.path}?${avatars.left.mtime}` : '',
                    right: avatars.right && avatars.right.exists ? `${avatars.right.path}?${avatars.right.mtime}` : '',
                }
                : null,
        });
    }

    async function loadData() {
        try {
            const data = await fetch('/api/page10', { credentials: 'same-origin' }).then((response) => response.json());
            if (renderSignature !== null && renderSignature === buildSignature(data)) {
                return;
            }
            applyAll(data);
        } catch (error) {
            console.error('page10 初始加载失败:', error);
        }
    }

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
