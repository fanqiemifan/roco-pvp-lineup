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

    // 排名数字字号与左偏移（按位数；'1000+' 档固定 12px 小字）
    const RANK_STYLE_BY_LENGTH = {
        1: { size: 32, left: 16 },
        2: { size: 24, left: 12 },
        3: { size: 16, left: 12 },
        5: { size: 12, left: 12 }
    };

    // 画面设置：精灵图来源（sprite 原图 / icon 头像，语义与 page3 一致）、排名数字显隐、
    // 卡片标签与 1-12 序号排序依据（stats 任意字段：sum = 种族值总和（默认，橙色）/
    // hp/physical_attack/physical_defense/magic_attack/magic_defense/speed = 对应种族值项；
    // name = 只显名字，排序仍按 sum。与 shared/constants PAGE16_CARD_LABEL_OPTIONS 保持一致）
    let page16SpriteSource = 'sprite';
    let page16RankVisible = true;
    let page16CardLabel = 'sum';
    const SUPPORTED_CARD_LABELS = [
        'sum', 'hp', 'physical_attack', 'physical_defense',
        'magic_attack', 'magic_defense', 'speed', 'name'
    ];

    if (window.Petscard) {
        window.Petscard.assetBase = PETSCARD_ASSET_BASE;
    }

    // 卡位横向坐标（6 个展示位）：左侧 left 从左缘向中缝递增；右侧为「距右缘距离」，
    // 换算成 left（1920 - 卡宽122 - 右距）统一走 left 过渡，左右互换才能平移动画
    const CARD_LEFT_X = [220, 332, 442, 552, 662, 772];
    const CARD_RIGHT_X = CARD_LEFT_X.map((x) => 1920 - 122 - x);

    // z-index 与展示位绑定（不随排名）：左侧向中缝递增 1-6，右侧镜像 6-1，保持既有叠放方向；
    // 卡片换位时由 positionCard 同步更新，防止旧层级残留导致新位置被压在底下
    function cardZIndex(side, orderIndex) {
        return side === 'left' ? orderIndex + 1 : 6 - orderIndex;
    }

    // stat 图标目录（resources/stat，文件名 = 属性字段名）
    const STAT_ICON_BASE = '/resources/stat';

    const cardRecords = {
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

    // 排名只保留数字（≥1000 按 '1000+' 显示、12px 小字档——page16 头像卡专属口径，与 page3 的 1 万+ 不同）
    function formatRankText(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits) {
            return '';
        }
        return Number(digits) >= 1000 ? '1000+' : digits;
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
        const style = RANK_STYLE_BY_LENGTH[text.length] || RANK_STYLE_BY_LENGTH[3];
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

    // 卡片标签内容：stat 字段 → 该项图标+数值（sum 橙色高亮）；name 或数值缺失 → null（回退显示名字）
    function buildCardStat(sprite) {
        if (!sprite || page16CardLabel === 'name') {
            return null;
        }
        const stats = sprite.stats || null;
        const value = stats ? stats[page16CardLabel] : null;
        if (value == null) {
            return null;
        }
        return {
            icon: `${STAT_ICON_BASE}/${page16CardLabel}.png`,
            text: String(value),
            highlight: page16CardLabel === 'sum'
        };
    }

    function getScreenHost() {
        return document.querySelector('.page16-screen');
    }

    // 新建一张卡片并挂到画面（left/z-index 在同一帧内注入，初始定位不触发过渡）
    function createCard(sprite, side, dead) {
        const imageCandidates = getSlotImageCandidates(sprite);
        const el = window.Petscard.render(getScreenHost(), {
            name: String(sprite.displayName || sprite.name || '').trim(),
            num: '1',
            image: imageCandidates[0] || '',
            useIcon: page16SpriteSource === 'icon',
            side: side === 'right' ? '右' : '左',
            dead,
            attributes: getSlotAttributeNames(sprite)
        });
        el.classList.add('page16-card');
        // 头像加载失败逐级回退到候选图（头像 → 原图）
        const petImage = el.querySelector('.petscard-pet');
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
        return el;
    }

    // 展示位与层级：left（两侧统一用 left 才能平移过渡）+ z-index 随展示位同步更新
    function positionCard(el, side, orderIndex) {
        el.style.left = `${side === 'left' ? CARD_LEFT_X[orderIndex] : CARD_RIGHT_X[orderIndex]}px`;
        el.style.zIndex = String(cardZIndex(side, orderIndex));
    }

    function updateCardContent(el, sprite, rank, slotData) {
        window.Petscard.update(el, {
            num: rank,
            name: String(sprite.displayName || sprite.name || '').trim(),
            stat: buildCardStat(sprite)
        });
        el.classList.toggle('is-dead', isSlotDead(slotData));
    }

    /**
     * 双方阵容统一重排（排名跨两侧，单侧变化也会影响另一侧序号，必须整屏重算）：
     * 1) 收集两侧上场精灵 → Page16Rank 编排 1-12 名次（同值同名次）；
     * 2) 每侧按名次升序分配展示位（同名次按槽位号），排序切换时卡片 left 平移换位、z-index 随展示位更新；
     * 3) 卡片按「槽位 + 精灵身份签名」复用——签名没变只改序号/标签/阵亡态，精灵图不重载
     */
    function renderPanels() {
        if (!window.Petscard) {
            return;
        }
        const entries = [];
        ['left', 'right'].forEach((side) => {
            const panel = panelDataCache[side];
            const selected = panel && Array.isArray(panel.selected) ? panel.selected : [];
            selected.slice(0, MAX_SLOTS).forEach((slotData, slot) => {
                const sprite = slotData && slotData.sprite ? slotData.sprite : null;
                if (sprite) {
                    entries.push({ side, slot, sprite, slotData });
                }
            });
        });
        const rankMap = window.Page16Rank
            ? window.Page16Rank.assignRanks(entries, page16CardLabel)
            : new Map();

        ['left', 'right'].forEach((side) => {
            const ordered = entries
                .filter((entry) => entry.side === side)
                .map((entry) => {
                    const rankInfo = rankMap.get(`${side}:${entry.slot}`);
                    return { entry, rank: rankInfo ? rankInfo.rank : MAX_SLOTS * 2 };
                })
                .sort((left, right) => (left.rank - right.rank) || (left.entry.slot - right.entry.slot));
            const orderOfSlot = new Map();
            ordered.forEach((item, orderIndex) => {
                orderOfSlot.set(item.entry.slot, orderIndex);
            });

            const records = cardRecords[side];
            const activeSlots = new Set();
            ordered.forEach(({ entry, rank }) => {
                const { slot, sprite, slotData } = entry;
                activeSlots.add(slot);
                const spriteKey = getSlotSpriteKey(sprite);
                let record = records[slot];
                if (record && record.spriteKey !== spriteKey) {
                    record.el.remove();
                    record = null;
                }
                if (!record) {
                    record = { el: createCard(sprite, side, isSlotDead(slotData)), spriteKey };
                    records[slot] = record;
                }
                positionCard(record.el, side, orderOfSlot.get(slot) || 0);
                updateCardContent(record.el, sprite, rank, slotData);
            });

            // 未上场/清空的槽位：移除卡片
            records.forEach((record, slot) => {
                if (record && !activeSlots.has(slot)) {
                    record.el.remove();
                    records[slot] = null;
                }
            });
        });
    }

    // 精灵图来源切换：卡片签名含 source，重排时签名不一致的卡片自动重建
    function setPage16SpriteSource(source) {
        const next = source === 'icon' ? 'icon' : 'sprite';
        if (page16SpriteSource === next) {
            return;
        }
        page16SpriteSource = next;
        renderPanels();
    }

    function setPage16CardLabel(value) {
        const next = SUPPORTED_CARD_LABELS.indexOf(value) >= 0 ? value : 'sum';
        if (page16CardLabel === next) {
            return;
        }
        page16CardLabel = next;
        // 标签与序号排序依据变化：序号重排 + 卡片平移换位（卡片本体复用，不重建）
        renderPanels();
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
        setPage16CardLabel(payload && payload.stage ? payload.stage.page16CardLabel : 'sum');
        renderPanels();
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
                // 排名跨两侧，单侧面板变化也要整屏重算序号与位置
                panelDataCache[payload.panel.position] = payload.panel;
                renderPanels();
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
            setPage16CardLabel(stage && stage.page16CardLabel);
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
