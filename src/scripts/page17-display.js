(function () {
    'use strict';

    const MAX_SLOTS = 6;
    const DEFAULT_BEST_OF = 7;
    const SUPPORTED_BEST_OF = [1, 3, 5, 7];
    const DEFAULT_AVATARS = {
        left: '/assets/ui/left-avatar.png',
        right: '/assets/ui/right-avatar.png'
    };
    // petscard2 资源基准：属性图标在 /resources/attribute、属性背景纹理在 /resources/roco-bg
    const PETSCARD2_ASSET_BASE = '/resources';
    // petscard2 视觉尺寸：214×238 基准整体缩放到 108 宽（238 × 108/214 ≈ 120 高）
    const CARD_VISUAL_WIDTH = 108;
    const CARD_SCALE = CARD_VISUAL_WIDTH / 214;

    // 选手名字自适应字号：最大 36px，最小 28px，逐级 2px 缩小，触底保留省略号截断（page3 同款）
    const PLAYER_NAME_FONT_MAX = 36;
    const PLAYER_NAME_FONT_MIN = 28;
    const PLAYER_NAME_FONT_STEP = 2;

    // 排名数字距离图标左侧的 x 偏移（按显示位数，10000+ 视为 6 位；page3 同款查表）
    const RANK_TEXT_LEFT_BY_LENGTH = { 1: 22, 2: 16, 3: 12, 4: 7, 5: 3, 6: -2 };

    // 画面设置（与推流页面16 共用同一组配置）：精灵图来源（sprite 原图 / icon 头像）、
    // 卡片标签与 1-12 序号排序依据（种族值 baseStats 任意字段 / name）；种族值条展示字段
    // 在 name 档回落 sum（petscard2 无名字条，标签条始终有值）
    let page16SpriteSource = 'sprite';
    let page16CardLabel = 'sum';
    const SUPPORTED_CARD_LABELS = [
        'sum', 'hp', 'physical_attack', 'physical_defense',
        'magic_attack', 'magic_defense', 'speed', 'name'
    ];

    // 比分栏排位排名图标显隐（与页面3 共用同一开关 stage.page3RankVisible）
    let page3RankVisible = false;

    // 阵容镜像反转（与页面1-3/16 共用顶栏开关 stage.mirrorSides）：仅展示层左右互换，不改数据与胜负登记
    let mirrorSides = false;

    if (window.Petscard2) {
        window.Petscard2.assetBase = PETSCARD2_ASSET_BASE;
    }

    // 视图侧 → 实际数据侧：镜像开启时左右互换（渲染时映射，禁止 CSS 整页翻转）
    function mapSide(side) {
        if (!mirrorSides) {
            return side;
        }
        return side === 'left' ? 'right' : 'left';
    }

    // 记分板视图数据：镜像时交换左右名字/比分/排名（渲染口径，数据不变）
    function getViewScoreboard(data) {
        if (!mirrorSides) {
            return data;
        }
        return {
            ...data,
            leftName: data.rightName,
            rightName: data.leftName,
            leftScore: data.rightScore,
            rightScore: data.leftScore,
            leftRank: data.rightRank,
            rightRank: data.leftRank
        };
    }

    // 卡位坐标（6 个展示位，视图侧）：y196 起步、卡高 120 + 间隔 8 = 步进 128；
    // 首末位（第 1/6 位）x82 外扩、中间四位 x32。右侧为「距右缘距离」与左侧同一组数值，
    // 换算成 left（1920 - 视觉卡宽 108 - 距离）统一走 left 过渡，左右互换才能平移动画
    const CARD_LEFT_X = [82, 32, 32, 32, 32, 82];
    const CARD_TOP_Y = [196, 324, 452, 580, 708, 836];
    const CARD_RIGHT_X = CARD_LEFT_X.map((x) => 1920 - CARD_VISUAL_WIDTH - x);

    // z-index 与展示位绑定（不随排名）：左侧向中缝递增 1-6，右侧镜像 6-1，保持既有叠放方向；
    // 卡片换位时由 positionCard 同步更新，防止旧层级残留导致新位置被压在底下
    function cardZIndex(side, orderIndex) {
        return side === 'left' ? orderIndex + 1 : 6 - orderIndex;
    }

    // base stats 图标目录（resources/base-stats，文件名 = 种族值字段名）
    const STAT_ICON_BASE = '/resources/base-stats';

    const cardRecords = {
        left: new Array(MAX_SLOTS).fill(null),
        right: new Array(MAX_SLOTS).fill(null)
    };
    const panelDataCache = { left: null, right: null };
    let scoreboardSignature = null;
    const avatarSignatures = { left: null, right: null };
    let scoreboardDataCache = null;
    let avatarDataCache = null;

    function clamp(value, min, max, fallback) {
        if (value === null || value === undefined || value === '') {
            return fallback;
        }
        const number = Number(value);
        if (Number.isNaN(number)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, number));
    }

    function normalizeBestOf(value) {
        const number = Number(value);
        return SUPPORTED_BEST_OF.includes(number) ? number : DEFAULT_BEST_OF;
    }

    // 后台字号配置（12-160 档）折算到比分栏展示字号
    function scaleNameFont(value) {
        return Math.round(clamp(value, 12, 160, 64) * 0.5625);
    }

    function scaleScoreFont(value) {
        return Math.round(clamp(value, 12, 160, 64) * 0.75);
    }

    function getScoreboardNameBaseSize(data) {
        return clamp(scaleNameFont(data && data.nameFontSize), 24, 42, PLAYER_NAME_FONT_MAX);
    }

    // 选手名字阶梯缩小字号：以配置字号为起点（封顶 36px）按 2px 逐级降到 28px，
    // 触底仍超出时由 CSS 的 nowrap + 省略号截断（page3 同款）
    function fitPlayerName(el, baseSize) {
        if (!el) {
            return;
        }
        const startSize = Math.min(baseSize, PLAYER_NAME_FONT_MAX);
        let size = startSize;
        el.style.fontSize = `${size}px`;
        while (size > PLAYER_NAME_FONT_MIN && el.scrollWidth > el.clientWidth) {
            size = Math.max(PLAYER_NAME_FONT_MIN, size - PLAYER_NAME_FONT_STEP);
            el.style.fontSize = `${size}px`;
        }
    }

    // 字体异步加载完成后用缓存数据重新适配名字号（首帧可能按降级字体度量）
    function refitPlayerNames() {
        const baseSize = getScoreboardNameBaseSize(scoreboardDataCache || {});
        fitPlayerName(document.getElementById('page17LeftName'), baseSize);
        fitPlayerName(document.getElementById('page17RightName'), baseSize);
    }

    // 排名只保留数字（>10000 按 '10000+' 显示——page3 比分栏口径）
    function formatRankText(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits) {
            return '';
        }
        return Number(digits) > 10000 ? '10000+' : digits;
    }

    function renderRank(side, value) {
        const rankEl = document.getElementById(side === 'left' ? 'page17LeftRank' : 'page17RightRank');
        if (!rankEl) {
            return;
        }
        const txtEl = rankEl.querySelector('.page17-rank-txt');
        const text = formatRankText(value);

        // 开关关闭时隐藏整个图标；开启但选手无排名时仅隐藏数字
        rankEl.hidden = !page3RankVisible;
        if (!txtEl) {
            return;
        }
        txtEl.hidden = !page3RankVisible || !text;
        if (!text) {
            return;
        }
        txtEl.textContent = text;
        txtEl.style.left = `${RANK_TEXT_LEFT_BY_LENGTH[Math.min(text.length, 6)]}px`;
    }

    function getInitial(name, fallback) {
        const text = String(name || '').trim();
        if (!text) {
            return fallback;
        }
        return text[0].toUpperCase();
    }

    function renderScoreboard(scoreboard) {
        const data = scoreboard || {};
        scoreboardDataCache = data;
        const nextSignature = JSON.stringify({
            leftName: data.leftName || '',
            leftScore: data.leftScore || '0',
            leftRank: data.leftRank || '',
            rightName: data.rightName || '',
            rightScore: data.rightScore || '0',
            rightRank: data.rightRank || '',
            bestOf: normalizeBestOf(data.bestOf),
            scoreboardEnabled: data.scoreboardEnabled !== false,
            nameFontSize: scaleNameFont(data.nameFontSize),
            scoreFontSize: scaleScoreFont(data.scoreFontSize),
            rankVisible: page3RankVisible,
            // 镜像反转改变渲染左右，须进签名才能触发重渲染
            mirrorSides
        });

        if (scoreboardSignature === nextSignature) {
            return;
        }
        scoreboardSignature = nextSignature;

        const scoreboardEl = document.getElementById('page17Scoreboard');
        scoreboardEl.classList.toggle('is-hidden', data.scoreboardEnabled === false);
        const nameFontBase = getScoreboardNameBaseSize(data);
        scoreboardEl.style.setProperty('--page17-name-size', `${nameFontBase}px`);
        scoreboardEl.style.setProperty('--page17-score-size', `${clamp(scaleScoreFont(data.scoreFontSize), 32, 60, 48)}px`);

        // 镜像反转：仅交换渲染的左右数据（数据、胜负登记与统计口径不变）
        const view = getViewScoreboard(data);
        const leftName = String(view.leftName || '');
        const rightName = String(view.rightName || '');

        const leftNameEl = document.getElementById('page17LeftName');
        const rightNameEl = document.getElementById('page17RightName');
        leftNameEl.textContent = leftName;
        rightNameEl.textContent = rightName;
        fitPlayerName(leftNameEl, nameFontBase);
        fitPlayerName(rightNameEl, nameFontBase);
        document.getElementById('page17LeftScore').textContent = view.leftScore || '0';
        document.getElementById('page17RightScore').textContent = view.rightScore || '0';
        document.getElementById('page17BestOf').textContent = `BO${normalizeBestOf(data.bestOf)}`;
        document.getElementById('page17LeftAvatar').textContent = getInitial(leftName, 'L');
        document.getElementById('page17RightAvatar').textContent = getInitial(rightName, 'R');

        renderRank('left', view.leftRank);
        renderRank('right', view.rightRank);
    }

    function renderAvatar(side, avatarState) {
        const avatar = avatarState || {};
        const exists = Boolean(avatar.exists && avatar.path);
        const nextSignature = exists ? `${avatar.path}|${avatar.mtime || ''}` : 'default';
        if (avatarSignatures[side] === nextSignature) {
            return;
        }
        avatarSignatures[side] = nextSignature;

        const imageEl = document.getElementById(side === 'left' ? 'page17LeftAvatarImage' : 'page17RightAvatarImage');
        const textEl = document.getElementById(side === 'left' ? 'page17LeftAvatar' : 'page17RightAvatar');
        if (!imageEl) {
            return;
        }
        if (exists) {
            const cacheBuster = avatar.mtime ? Math.floor(avatar.mtime) : Date.now();
            imageEl.src = `${avatar.path}?t=${cacheBuster}`;
        } else {
            // 无头像时回退默认占位头像（page3 同款：默认头像常显，而不是只剩字母牌）
            imageEl.src = DEFAULT_AVATARS[side];
        }
        // CSS 默认 display:none 防破图闪现，src 就绪后显示并隐藏字母占位
        imageEl.style.display = 'block';
        if (textEl) {
            textEl.style.display = 'none';
        }
    }

    function renderAvatars(avatars) {
        const data = avatars || {};
        avatarDataCache = data;
        // 镜像反转：仅交换渲染左右（头像缺失时视图侧各用各的占位图，无需额外处理）
        renderAvatar('left', mirrorSides ? data.right : data.left);
        renderAvatar('right', mirrorSides ? data.left : data.right);
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

    function isSlotDead(slotData) {
        return Boolean(slotData && slotData.healthEnabled && Number(slotData.healthPercent) <= 0);
    }

    // petscard2 属性背景/属性圈：sprite.attribute 形如「光、翼」，取前两个属性名
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

    // 种族值条内容：排序字段对应项图标+数值（sum 橙色高亮）；name 档无名字条可回退，改显 sum
    function buildCardStat(sprite) {
        if (!sprite) {
            return null;
        }
        const field = page16CardLabel === 'name' ? 'sum' : page16CardLabel;
        const baseStats = sprite.baseStats || null;
        const value = baseStats ? baseStats[field] : null;
        if (value == null) {
            return null;
        }
        return {
            icon: `${STAT_ICON_BASE}/${field}.png`,
            text: String(value),
            highlight: field === 'sum'
        };
    }

    function getScreenHost() {
        return document.querySelector('.page17-screen');
    }

    // 新建一张卡片并挂到画面（left/top/z-index 在同一帧内注入，初始定位不触发过渡）
    function createCard(sprite, side, dead) {
        const imageCandidates = getSlotImageCandidates(sprite);
        const el = window.Petscard2.render(getScreenHost(), {
            num: '1',
            name: String(sprite.displayName || sprite.name || '').trim(),
            image: imageCandidates[0] || '',
            useIcon: page16SpriteSource === 'icon',
            side: side === 'right' ? '右' : '左',
            dead,
            attributes: getSlotAttributeNames(sprite),
            stat: buildCardStat(sprite),
            scale: CARD_SCALE
        });
        el.classList.add('page17-card');
        // 头像加载失败逐级回退到候选图（头像 → 原图）
        const petImage = el.querySelector('.petscard2-pet');
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

    // 展示位与层级：left/top（两侧统一用 left 才能平移过渡）+ z-index 随展示位同步更新
    function positionCard(el, side, orderIndex) {
        el.style.left = `${side === 'left' ? CARD_LEFT_X[orderIndex] : CARD_RIGHT_X[orderIndex]}px`;
        el.style.top = `${CARD_TOP_Y[orderIndex]}px`;
        el.style.zIndex = String(cardZIndex(side, orderIndex));
    }

    function updateCardContent(el, sprite, rank, slotData) {
        window.Petscard2.update(el, {
            num: rank,
            stat: buildCardStat(sprite)
        });
        el.classList.toggle('is-dead', isSlotDead(slotData));
    }

    /**
     * 双方阵容统一重排（排名跨两侧，单侧变化也会影响另一侧序号，必须整屏重算）：
     * 1) 收集两侧上场精灵（按实际数据侧）→ Page16Rank 编排 1-12 名次（同值同名次）；
     * 2) 渲染按视图侧取数（镜像反转时 mapSide 左右互换），每侧按名次升序分配展示位
     *    （同名次按槽位号），排序切换时卡片 left/top 平移换位、z-index 随展示位更新；
     * 3) 卡片按「槽位 + 精灵身份签名」复用——签名没变只改序号/种族值/阵亡态，精灵图不重载
     */
    function renderPanels() {
        if (!window.Petscard2) {
            return;
        }
        const entries = [];
        ['left', 'right'].forEach((dataSide) => {
            const panel = panelDataCache[dataSide];
            const selected = panel && Array.isArray(panel.selected) ? panel.selected : [];
            selected.slice(0, MAX_SLOTS).forEach((slotData, slot) => {
                const sprite = slotData && slotData.sprite ? slotData.sprite : null;
                if (sprite) {
                    entries.push({ side: dataSide, slot, sprite, slotData });
                }
            });
        });
        const rankMap = window.Page16Rank
            ? window.Page16Rank.assignRanks(entries, page16CardLabel)
            : new Map();

        ['left', 'right'].forEach((viewSide) => {
            const ordered = entries
                .filter((entry) => mapSide(entry.side) === viewSide)
                .map((entry) => {
                    const rankInfo = rankMap.get(`${entry.side}:${entry.slot}`);
                    return { entry, rank: rankInfo ? rankInfo.rank : MAX_SLOTS * 2 };
                })
                .sort((left, right) => (left.rank - right.rank) || (left.entry.slot - right.entry.slot));
            const orderOfSlot = new Map();
            ordered.forEach((item, orderIndex) => {
                orderOfSlot.set(item.entry.slot, orderIndex);
            });

            const records = cardRecords[viewSide];
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
                    record = { el: createCard(sprite, viewSide, isSlotDead(slotData)), spriteKey };
                    records[slot] = record;
                }
                positionCard(record.el, viewSide, orderOfSlot.get(slot) || 0);
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

    // 精灵图来源切换（与页面16 共用设置）：卡片签名含 source，重排时签名不一致的卡片自动重建
    function setPage16SpriteSource(source) {
        const next = source === 'icon' ? 'icon' : 'sprite';
        if (page16SpriteSource === next) {
            return;
        }
        page16SpriteSource = next;
        renderPanels();
    }

    // 卡片标签与序号排序依据变化（与页面16 共用设置）：序号重排 + 卡片平移换位（卡片本体复用）
    function setPage16CardLabel(value) {
        const next = SUPPORTED_CARD_LABELS.indexOf(value) >= 0 ? value : 'sum';
        if (page16CardLabel === next) {
            return;
        }
        page16CardLabel = next;
        renderPanels();
    }

    // 比分栏排位排名图标显隐（与页面3 共用设置）
    function setPage3RankVisible(visible) {
        const next = visible === true;
        if (page3RankVisible === next) {
            return;
        }
        page3RankVisible = next;
        renderScoreboard(scoreboardDataCache);
    }

    // 镜像反转切换：按新映射立即重渲染（增量更新，不整页重载）
    function setPage17MirrorSides(value) {
        const next = value === true;
        if (next === mirrorSides) {
            return;
        }
        mirrorSides = next;
        renderPanels();
        renderScoreboard(scoreboardDataCache);
        renderAvatars(avatarDataCache);
    }

    function applySnapshot(payload) {
        const panels = payload && Array.isArray(payload.panels) ? payload.panels : [];
        panelDataCache.left = panels.find((panel) => panel && panel.position === 'left') || null;
        panelDataCache.right = panels.find((panel) => panel && panel.position === 'right') || null;
        setPage17MirrorSides(payload && payload.stage ? payload.stage.mirrorSides === true : false);
        setPage16SpriteSource(payload && payload.stage ? payload.stage.page16SpriteSource : 'sprite');
        setPage3RankVisible(payload && payload.stage ? payload.stage.page3RankVisible === true : false);
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
            query: { role: 'page17' }
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
            setPage17MirrorSides(stage && stage.mirrorSides === true);
            setPage16SpriteSource(stage && stage.page16SpriteSource);
            setPage3RankVisible(stage && stage.page3RankVisible === true);
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
                console.error('初始化推流页面17失败:', error);
            });
    });
})();
