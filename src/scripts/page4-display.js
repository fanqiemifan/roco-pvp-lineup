(function () {
    'use strict';

    /**
     * 推流页面4（MVP 结算画面）渲染脚本。
     *
     * 数据来源：
     * - GET /api/mvp -> { state: { slots: [{ petId, tag, isMvp }], winner }, winner: MvpWinnerInfo }
     *   （后台「结算画面」保存的精灵项/标签/MVP 标记与胜方快照；切换对局不会改变，需后台重新载入保存）
     * - GET /api/sprites -> 精灵索引（petId 解析出头像 iconUrl / 立绘 path / webm 文件名）
     *
     * 精灵项固定 6 个槽位：最左 x80，单个 290 宽 + 4 间隔；未赋值的槽位不展示。
     * webm 按 pet_id 从 resources/sprites-260-630-webm 取文件（与立绘/头像同源命名 {pet_id}_{name}.webm）。
     */

    const SLOT_LEFT_BASE = 80;
    const SLOT_STRIDE = 294;   // 单个 290 宽 + 间隔 4
    const WEBM_BASE = '/resources/sprites-260-630-webm';
    const MVP_IMAGE = '/assets/ui/MVP.png';
    // 逐个入场：等切换过渡动效播完（载体 blinds 过渡约 980ms）后再从第一个槽位依次淡入
    const ENTER_DELAY_MS = 900;
    const DEFAULT_AVATARS = {
        left: '/assets/ui/left-avatar.png',
        right: '/assets/ui/right-avatar.png'
    };

    const slotEls = Array.from(document.querySelectorAll('.mvp-item'));
    const winnerEl = document.querySelector('.mvp-winner');
    const winnerAvatarEl = document.getElementById('mvpWinnerAvatar');
    const winnerNameEl = document.getElementById('mvpWinnerName');

    let spriteLookup = null;
    let stateCache = null;
    let entryStarted = false;
    let winnerSignature = null;

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

    /* ---------- 精灵索引（pet_id 解析成头像 / 立绘 / webm） ---------- */

    function buildSpriteLookup(records) {
        const byId = new Map();
        const byName = new Map();
        const byBaseName = new Map();
        records.forEach((record) => {
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
        const response = await fetch('/api/sprites');
        if (!response.ok) {
            throw new Error(`精灵索引加载失败: ${response.status}`);
        }
        const payload = await response.json();
        const records = Array.isArray(payload) ? payload : (payload.sprites || []);
        spriteLookup = buildSpriteLookup(records);
        // 索引晚于状态到达：清掉签名让槽位按解析后的图片重新渲染
        slotEls.forEach((itemEl) => {
            delete itemEl.dataset.signature;
        });
        if (stateCache) {
            applyState(stateCache);
        }
    }

    function resolveSprite(petId) {
        if (!petId || !spriteLookup) {
            return null;
        }
        const raw = String(petId).trim();
        return spriteLookup.byId.get(raw)
            || spriteLookup.byName.get(normalizeText(raw))
            || spriteLookup.byBaseName.get(normalizeText(stripVariantName(raw)))
            || null;
    }

    /** webm 地址：由精灵索引文件名（{pet_id}_{name}.png）推导同源命名的 .webm；
    索引未命中（精灵已删除/改名）时不请求，避免拼错文件名产生 404 */
    function buildWebmUrl(record) {
        const filename = record && record.filename ? String(record.filename) : '';
        if (!filename) {
            return '';
        }
        return `${WEBM_BASE}/${encodeURIComponent(filename.replace(/\.[^.]+$/, ''))}.webm`;
    }

    /* ---------- 逐个入场（过渡动效播完后按槽位依次淡入上浮） ---------- */

    /** 单个精灵项入场：按槽位设置动画延迟（重复入场只影响尚未显示过的项） */
    function playItemEntry(itemEl, index) {
        itemEl.style.setProperty('--mvp-item-order', String(index));
        itemEl.classList.remove('is-visible');
        void itemEl.offsetWidth; // 强制重排，确保同名动画能重新触发
        itemEl.classList.add('is-visible');
    }

    /** 过渡动效播完：把当前已赋值的槽位按顺序依次入场（只播一次；选手信息条最后出现） */
    function startItemEntry() {
        if (entryStarted) {
            return;
        }
        entryStarted = true;
        slotEls.forEach((itemEl, index) => {
            if (!itemEl.hidden) {
                playItemEntry(itemEl, index);
            }
        });
        // 选手信息条排在最后一个精灵项之后入场
        if (winnerEl) {
            playItemEntry(winnerEl, slotEls.length);
        }
    }

    /* ---------- 胜方选手信息条（名字 + 头像，由后端 GET /api/mvp 的 winner 下发） ---------- */

    function renderWinner(winner) {
        const data = winner || {};
        const side = data.side === 'left' || data.side === 'right' ? data.side : null;
        const playerName = String(data.playerName || '').trim();
        const avatarPath = data.avatarExists && data.avatarPath ? String(data.avatarPath) : '';
        const avatarMtime = avatarPath && data.avatarMtime ? Math.floor(data.avatarMtime) : null;

        const signature = JSON.stringify({ side, playerName, avatarPath, avatarMtime });
        if (winnerSignature === signature) {
            return;
        }
        winnerSignature = signature;

        if (winnerNameEl) {
            winnerNameEl.textContent = playerName || '待定';
        }
        if (!winnerAvatarEl) {
            return;
        }
        // 头像按已载入胜方快照的 matchId+side 解析，未上传时回退对应侧的默认占位图
        winnerAvatarEl.src = avatarPath
            ? `${avatarPath}${avatarMtime ? `?t=${avatarMtime}` : ''}`
            : DEFAULT_AVATARS[side || 'left'];
        winnerAvatarEl.alt = playerName || '胜方选手';
    }

    /* ---------- 槽位渲染（增量：签名不变不覆写 DOM） ---------- */

    function ensureItemDom(itemEl) {
        if (itemEl.querySelector('.mvp-item-webm')) {
            return;
        }
        itemEl.innerHTML = `
            <video class="mvp-item-webm" autoplay loop muted playsinline aria-hidden="true"></video>
            <div class="mvp-item-tag" hidden><span class="mvp-item-tag-text"></span></div>
            <div class="mvp-item-mvp" hidden><img src="${MVP_IMAGE}" alt="MVP"></div>
            <div class="mvp-item-avatar petsdiv3 is-empty"><img alt=""></div>
        `;
    }

    /** 头像优先、失败回退立绘；图片来源未变化时不重设 src，避免图片重新加载闪烁 */
    function applyImageSources(imgEl, sources) {
        const key = sources.join('|');
        if (imgEl.dataset.sourceKey === key) {
            return;
        }
        imgEl.dataset.sourceKey = key;

        let index = 0;
        const assign = () => {
            imgEl.src = sources[index];
        };
        imgEl.onerror = () => {
            index += 1;
            if (index >= sources.length) {
                imgEl.onerror = null;
                return;
            }
            assign();
        };
        assign();
    }

    function renderItem(itemEl, index, entry) {
        const petId = entry && entry.petId ? String(entry.petId) : '';
        if (!petId) {
            if (!itemEl.hidden) {
                itemEl.hidden = true;
                itemEl.innerHTML = '';
                itemEl.classList.remove('is-visible');
                delete itemEl.dataset.signature;
            }
            return;
        }

        const record = resolveSprite(petId);
        const iconUrl = record && record.iconUrl ? String(record.iconUrl) : '';
        const spritePath = record && record.path ? String(record.path) : '';
        const webmUrl = buildWebmUrl(record);
        const tag = String(entry.tag || '').trim();
        const isMvp = entry.isMvp === true;

        const signature = JSON.stringify({ petId, tag, isMvp, iconUrl, spritePath, webmUrl });
        if (itemEl.dataset.signature === signature) {
            return;
        }
        itemEl.dataset.signature = signature;

        const wasHidden = itemEl.hidden;
        itemEl.hidden = false;
        itemEl.style.left = `${SLOT_LEFT_BASE + index * SLOT_STRIDE}px`;
        ensureItemDom(itemEl);

        // 入场时机：过渡动效播完后新出现的槽位（后台临时增补）立即入场；未到时机则等 startItemEntry 统一依次入场
        if (wasHidden && entryStarted) {
            playItemEntry(itemEl, index);
        }

        // 精灵 webm：按 pet_id 索引，缺文件时隐藏（保留标签与头像）
        const videoEl = itemEl.querySelector('.mvp-item-webm');
        if (videoEl.dataset.srcKey !== webmUrl) {
            videoEl.dataset.srcKey = webmUrl;
            videoEl.onerror = () => {
                videoEl.hidden = true;
            };
            if (webmUrl) {
                videoEl.hidden = false;
                videoEl.muted = true;
                videoEl.src = webmUrl;
            } else {
                videoEl.hidden = true;
                videoEl.removeAttribute('src');
                videoEl.load();
            }
        }

        // tag div：内容可选，未标记时不显示
        const tagEl = itemEl.querySelector('.mvp-item-tag');
        tagEl.hidden = !tag;
        if (tag) {
            itemEl.querySelector('.mvp-item-tag-text').textContent = tag;
        }

        // MVP div：仅标记为 MVP 的精灵显示
        itemEl.querySelector('.mvp-item-mvp').hidden = !isMvp;

        // 精灵头像 div：复用 petsdiv3
        const avatarEl = itemEl.querySelector('.mvp-item-avatar');
        const avatarImg = avatarEl.querySelector('img');
        const sources = [iconUrl, spritePath].filter(Boolean);
        if (!sources.length) {
            avatarEl.className = 'mvp-item-avatar petsdiv3 is-empty';
            delete avatarImg.dataset.sourceKey;
            avatarImg.removeAttribute('src');
            return;
        }
        avatarEl.className = 'mvp-item-avatar petsdiv3 is-active';
        avatarImg.alt = record ? String(record.displayName || '') : '';
        applyImageSources(avatarImg, sources);
    }

    function applyState(state) {
        stateCache = state || null;
        const slots = state && Array.isArray(state.slots) ? state.slots : [];
        slotEls.forEach((itemEl, index) => {
            renderItem(itemEl, index, slots[index] || null);
        });
    }

    /** 拉取 MVP 结算状态与胜方选手（名字 + 头像），增量渲染 */
    async function loadMvpData() {
        try {
            const data = await fetch('/api/mvp', { credentials: 'same-origin' }).then((response) => response.json());
            applyState(data ? data.state : null);
            renderWinner(data ? data.winner : null);
        } catch (error) {
            console.error('page4 数据加载失败:', error);
        }
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            console.error('Socket.IO 客户端未加载');
            return;
        }

        const socket = io({ transports: ['websocket', 'polling'] });

        socket.on('snapshot', (payload) => {
            applyState(payload ? payload.mvp : null);
        });

        socket.on('mvp:update', () => {
            // 保存精灵项/标签/MVP 标记或载入胜方快照都会广播本事件，统一重拉（state + winner）
            void loadMvpData();
        });

        // 上传头像会影响胜方选手信息条（按已载入快照的 matchId+side 解析头像）
        socket.on('avatar:update', () => {
            void loadMvpData();
        });

        socket.on('connect_error', (error) => {
            console.error('Socket.IO 连接失败:', error);
        });
    }

    // 直播推流切入本页时，载体（index.html）完成 iframe 加载后由 stage-enter.js 派发 stage-enter：
    // 再等过渡动效播完（载体 blinds 过渡约 980ms）才开始逐个入场，避免精灵项在过渡动画期间就全部出现。
    // 直接打开页面（无载体过渡）时同样走这里，延迟后逐个入场。
    document.addEventListener('stage-enter', () => {
        window.setTimeout(startItemEntry, ENTER_DELAY_MS);
    });

    document.addEventListener('DOMContentLoaded', async () => {
        await loadMvpData();
        connectSocket();
        try {
            await loadSpriteIndex();
        } catch (error) {
            console.error('精灵索引加载失败:', error);
        }
    });
})();