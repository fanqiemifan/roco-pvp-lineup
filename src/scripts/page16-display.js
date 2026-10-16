(function () {
    'use strict';

    const MAX_SLOTS = 6;
    const DEFAULT_BEST_OF = 7;
    const SUPPORTED_BEST_OF = [1, 3, 5, 7];
    const DEFAULT_AVATARS = {
        left: '/assets/ui/left-avatar.png',
        right: '/assets/ui/right-avatar.png'
    };
    // petscard 资源基准：属性图标在 /resources/attribute、属性背景纹理在 /resources/roco-bg
    const PETSCARD_ASSET_BASE = '/resources';

    // 选手名字自适应字号：最大 14px，最小 11px，逐级 1px 缩小，触底仍放不下保留裁切
    const PLAYER_NAME_FONT_MAX = 14;
    const PLAYER_NAME_FONT_MIN = 11;

    // 排名数字字号与左偏移（按位数；超过 3 位按 3 位档处理）
    const RANK_STYLE_BY_LENGTH = {
        1: { size: 32, left: 16 },
        2: { size: 24, left: 12 },
        3: { size: 16, left: 12 }
    };

    // 画面设置：精灵图来源（sprite 原图 / icon 头像，语义与 page3 一致）与排名数字显隐
    let page16SpriteSource = 'sprite';
    let page16RankVisible = true;

    if (window.Petscard) {
        window.Petscard.assetBase = PETSCARD_ASSET_BASE;
    }

    const slotSpriteKeys = {
        left: new Array(MAX_SLOTS).fill(null),
        right: new Array(MAX_SLOTS).fill(null)
    };
    const panelDataCache = { left: null, right: null };
    let scoreboardSignature = null;
    const avatarSignatures = { left: null, right: null };
    let scoreboardDataCache = null;

    function normalizeBestOf(value) {
        const number = Number(value);
        return SUPPORTED_BEST_OF.includes(number) ? number : DEFAULT_BEST_OF;
    }

    // 排名只保留数字（1 万以上按 1 万+ 显示，与 page3 同口径）
    function formatRankText(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits) {
            return '';
        }
        return Number(digits) > 10000 ? '10000+' : digits;
    }

    function isSlotDead(slotData) {
        return Boolean(slotData && slotData.healthEnabled && Number(slotData.healthPercent) <= 0);
    }

    // petscard 属性背景/徽章：sprite.attribute 形如「光、翼」，取前两个属性名
    function getSlotAttributeNames(sprite) {
        if (!sprite) {
            return [];
        }
        return String(sprite.attribute || '')
            .split('、')
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 2);
    }

    // 选手名字阶梯缩小字号：14px 起按 1px 逐级降到 11px
    function fitPlayerName(el, text) {
        if (!el) {
            return;
        }
        el.textContent = text;
        let size = PLAYER_NAME_FONT_MAX;
        el.style.fontSize = `${size}px`;
        while (size > PLAYER_NAME_FONT_MIN && el.scrollWidth > el.clientWidth) {
            size -= 1;
            el.style.fontSize = `${size}px`;
        }
    }

    // 字体异步加载完成后用缓存数据重新适配名字号（首帧可能按降级字体度量）
    function refitPlayerNames() {
        const data = scoreboardDataCache || {};
        fitPlayerName(document.getElementById('page16LeftName'), String(data.leftName || '').trim());
        fitPlayerName(document.getElementById('page16RightName'), String(data.rightName || '').trim());
    }

    function renderRank(el, text) {
        if (!el) {
            return;
        }
        // 画面设置关闭排名时隐藏整个数字；开启但选手无排名时同样不显示
        const show = page16RankVisible && Boolean(text);
        el.hidden = !show;
        if (!show) {
            return;
        }
        const style = RANK_STYLE_BY_LENGTH[Math.min(text.length, 3)];
        el.textContent = text;
        el.style.fontSize = `${style.size}px`;
        el.style.left = `${style.left}px`;
    }

    function renderScoreboard(scoreboard) {
        const data = scoreboard || {};
        scoreboardDataCache = data;
        const leftScore = String(data.leftScore || '').trim() || '0';
        const rightScore = String(data.rightScore || '').trim() || '0';
        const bestOf = normalizeBestOf(data.bestOf);
        const leftName = String(data.leftName || '').trim();
        const rightName = String(data.rightName || '').trim();
        const leftRankText = formatRankText(data.leftRank);
        const rightRankText = formatRankText(data.rightRank);

        const nextSignature = JSON.stringify({
            leftScore, rightScore, bestOf, leftName, rightName, leftRankText, rightRankText,
            rankVisible: page16RankVisible
        });
        if (scoreboardSignature === nextSignature) {
            return;
        }
        scoreboardSignature = nextSignature;

        document.getElementById('page16Score').textContent = `${leftScore} : ${rightScore}`;
        document.getElementById('page16BestOf').textContent = `BO${bestOf}`;
        fitPlayerName(document.getElementById('page16LeftName'), leftName);
        fitPlayerName(document.getElementById('page16RightName'), rightName);
        renderRank(document.getElementById('page16LeftRank'), leftRankText);
        renderRank(document.getElementById('page16RightRank'), rightRankText);
    }

    function renderAvatar(side, avatarState) {
        const avatar = avatarState || {};
        const exists = Boolean(avatar.exists && avatar.path);
        const nextSignature = exists ? `${avatar.path}|${avatar.mtime || ''}` : 'default';
        if (avatarSignatures[side] === nextSignature) {
            return;
        }
        avatarSignatures[side] = nextSignature;

        const imageEl = document.getElementById(side === 'left' ? 'page16LeftAvatarImage' : 'page16RightAvatarImage');
        if (!imageEl) {
            return;
        }
        if (exists) {
            const cacheBuster = avatar.mtime ? Math.floor(avatar.mtime) : Date.now();
            imageEl.src = `${avatar.path}?t=${cacheBuster}`;
        } else {
            imageEl.src = DEFAULT_AVATARS[side];
        }
    }

    function renderAvatars(avatars) {
        const data = avatars || {};
        renderAvatar('left', data.left);
        renderAvatar('right', data.right);
    }

    // 精灵身份签名：精灵变化才重建卡片，阵亡/复活只切 className 交由过渡完成；
    // 签名含图片来源与 iconUrl——切换「原图/头像」设置时所有卡片重建
    function getSlotSpriteKey(sprite) {
        if (!sprite) {
            return null;
        }
        return JSON.stringify({
            id: sprite.id || sprite.path || '',
            path: sprite.path || '',
            iconUrl: sprite.iconUrl || '',
            name: String(sprite.displayName || sprite.name || '').trim(),
            source: page16SpriteSource
        });
    }

    // 头像来源优先 iconUrl（加载失败回退原图）；原图来源直接用立绘
    function getSlotImageCandidates(sprite) {
        const candidates = [];
        const portrait = sprite && sprite.path ? String(sprite.path) : '';
        const iconUrl = sprite && sprite.iconUrl ? String(sprite.iconUrl).trim() : '';
        if (page16SpriteSource === 'icon' && iconUrl) {
            candidates.push(iconUrl);
        }
        if (portrait) {
            candidates.push(portrait);
        }
        return candidates;
    }

    function renderSlot(slotEl, slotData) {
        const side = slotEl.dataset.side;
        const index = Number(slotEl.dataset.slot || 0);
        const sprite = slotData && slotData.sprite ? slotData.sprite : null;
        const dead = isSlotDead(slotData);
        const spriteKey = getSlotSpriteKey(sprite);

        if (slotSpriteKeys[side][index] !== spriteKey) {
            slotSpriteKeys[side][index] = spriteKey;
            slotEl.innerHTML = '';
            if (sprite && window.Petscard) {
                const imageCandidates = getSlotImageCandidates(sprite);
                window.Petscard.render(slotEl, {
                    name: String(sprite.displayName || sprite.name || '').trim(),
                    num: String(index + 1),
                    image: imageCandidates[0] || '',
                    useIcon: page16SpriteSource === 'icon',
                    side: side === 'right' ? '右' : '左',
                    dead,
                    attributes: getSlotAttributeNames(sprite)
                });
                // 头像加载失败逐级回退到候选图（头像 → 原图）
                const petImage = slotEl.querySelector('.petscard-pet');
                if (petImage && imageCandidates.length > 1) {
                    let imageIndex = 0;
                    petImage.onerror = () => {
                        imageIndex += 1;
                        if (imageIndex < imageCandidates.length) {
                            petImage.src = imageCandidates[imageIndex];
                        } else {
                            petImage.onerror = null;
                        }
                    };
                }
            }
        } else {
            const card = slotEl.querySelector('.petscard');
            if (card) {
                card.classList.toggle('is-dead', dead);
            }
        }
        slotEl.classList.toggle('is-dead', dead && Boolean(sprite));
    }

    function renderPanel(position, panelData) {
        const selected = panelData && Array.isArray(panelData.selected) ? panelData.selected : [];
        const slotEls = document.querySelectorAll(`.page16-slot[data-side="${position}"]`);
        slotEls.forEach((slotEl, index) => {
            renderSlot(slotEl, selected[index] || null);
        });
    }

    // 精灵图来源切换：签名里带 source，清空后按缓存面板重渲染
    function setPage16SpriteSource(source) {
        const next = source === 'icon' ? 'icon' : 'sprite';
        if (page16SpriteSource === next) {
            return;
        }
        page16SpriteSource = next;
        slotSpriteKeys.left.fill(null);
        slotSpriteKeys.right.fill(null);
        renderPanel('left', panelDataCache.left);
        renderPanel('right', panelDataCache.right);
    }

    function setPage16RankVisible(visible) {
        const next = visible === true;
        if (page16RankVisible === next) {
            return;
        }
        page16RankVisible = next;
        renderScoreboard(scoreboardDataCache);
    }

    function applySnapshot(payload) {
        const panels = payload && Array.isArray(payload.panels) ? payload.panels : [];
        panelDataCache.left = panels.find((panel) => panel && panel.position === 'left') || null;
        panelDataCache.right = panels.find((panel) => panel && panel.position === 'right') || null;
        setPage16SpriteSource(payload && payload.stage ? payload.stage.page16SpriteSource : 'sprite');
        setPage16RankVisible(payload && payload.stage ? payload.stage.page16RankVisible === true : true);
        renderPanel('left', panelDataCache.left);
        renderPanel('right', panelDataCache.right);
        renderScoreboard(payload ? payload.scoreboard : null);
        renderAvatars(payload ? payload.avatars : null);
    }

    async function loadInitialState() {
        const [panelsResponse, scoreboardResponse, avatarsResponse, stageResponse] = await Promise.all([
            fetch('api/panels'),
            fetch('api/scoreboard'),
            fetch('api/avatars'),
            fetch('api/stage')
        ]);

        const [panelsData, scoreboardData, avatarsData, stageData] = await Promise.all([
            panelsResponse.json(),
            scoreboardResponse.json(),
            avatarsResponse.json(),
            stageResponse.json()
        ]);

        applySnapshot({
            panels: panelsData.panels || [],
            scoreboard: scoreboardData,
            avatars: avatarsData,
            stage: stageData
        });
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            console.error('Socket.IO 客户端未加载');
            return;
        }

        const socket = io({
            transports: ['websocket', 'polling'],
            query: { role: 'page16' }
        });

        socket.on('snapshot', (payload) => {
            applySnapshot(payload || {});
        });

        socket.on('panel:update', (payload) => {
            if (payload && payload.panel && payload.panel.position) {
                renderPanel(payload.panel.position, payload.panel);
            }
        });

        socket.on('scoreboard:update', (payload) => {
            renderScoreboard(payload ? payload.scoreboard : null);
        });

        socket.on('avatar:update', (payload) => {
            renderAvatars(payload ? payload.avatars : null);
        });

        socket.on('stage:update', (payload) => {
            const stage = payload && payload.stage ? payload.stage : payload;
            setPage16SpriteSource(stage && stage.page16SpriteSource);
            setPage16RankVisible(stage && stage.page16RankVisible === true);
        });

        socket.on('connect_error', (error) => {
            console.error('Socket.IO 连接失败:', error);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        // MiSans 为异步加载的 @font-face，首帧可能按降级字体度量，字体就绪后重新适配名字号
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => refitPlayerNames());
        }
        loadInitialState()
            .then(connectSocket)
            .catch((error) => {
                console.error('初始化推流页面16失败:', error);
            });
    });
})();
