/*
 * 推流页面6（比赛结果）/ 页面8（比赛预告）共享渲染器。
 * 画面：蓝色渐变 + 主标题/副标题（Match Prediction）+ 3×3 对局卡片网格（最多 9 张）。
 * 场序时间由后端在 scheduleTimes 中下发（开始时间 + BO×30 分钟累加，手动覆盖由后台维护）。
 * 用法：MatchPredictionPage.mount({ apiUrl, role, updateEvent, defaultTitle })
 */
(function () {
    'use strict';

    // v2：SVG 加 preserveAspectRatio="none" 后铺满 412×166；/assets 为 30 天 immutable 缓存，
    // 文件名未变故用查询串版本号强制浏览器/OBS 重新拉取
    var CARD_BG = '/assets/ui/Rectangle-01.svg?v=2';
    var RANK_ICON = '/assets/ui/7.Wku3bA4b.png';
    var DEFAULT_AVATARS = {
        left: '/assets/ui/left-avatar.png',
        right: '/assets/ui/right-avatar.png'
    };
    var CHINESE_ORDINALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

    function formatRankText(value) {
        var digits = String(value || '').replace(/\D/g, '');
        if (!digits) {
            return '';
        }
        return Number(digits) > 10000 ? '10000+' : digits;
    }

    /** 卡片上方场序信息：「第一场 19:00」；无时间时只显示「第一场」 */
    function formatScheduleLabel(index, time) {
        var ordinal = CHINESE_ORDINALS[index] || String(index + 1);
        return time ? '第' + ordinal + '场 ' + time : '第' + ordinal + '场';
    }

    function buildRankIcon(rankValue) {
        var rank = document.createElement('div');
        rank.className = 'mp-rank';

        var icon = document.createElement('img');
        icon.src = RANK_ICON;
        icon.alt = '';
        rank.appendChild(icon);

        var text = formatRankText(rankValue);
        if (text) {
            var txt = document.createElement('div');
            txt.className = 'mp-rank-txt';
            txt.textContent = text;
            rank.appendChild(txt);
        }
        return rank;
    }

    function buildAvatar(side, avatarState) {
        var avatar = document.createElement('div');
        avatar.className = 'mp-avatar';

        var image = document.createElement('img');
        image.alt = (side === 'left' ? '左侧' : '右侧') + '选手头像';
        var state = avatarState || {};
        if (state.exists && state.path) {
            var cacheBuster = state.mtime ? Math.floor(state.mtime) : Date.now();
            image.src = state.path + '?t=' + cacheBuster;
        } else {
            image.src = DEFAULT_AVATARS[side];
        }
        avatar.appendChild(image);
        return avatar;
    }

    /** 选手条：头像 + 名字 + 比分 + rank（左右条结构一致，不镜像） */
    function buildSide(side, match, matchAvatars) {
        var sideEl = document.createElement('div');
        sideEl.className = 'mp-side mp-side-' + side;

        sideEl.appendChild(buildAvatar(side, matchAvatars ? matchAvatars[side] : null));

        var name = document.createElement('div');
        name.className = 'mp-name';
        name.textContent = (side === 'left' ? match.leftPlayer : match.rightPlayer) || (side === 'left' ? '左侧' : '右侧');
        sideEl.appendChild(name);

        var score = document.createElement('div');
        score.className = 'mp-score';
        var rawScore = side === 'left' ? match.leftScore : match.rightScore;
        score.textContent = (rawScore === null || rawScore === undefined) ? '-' : String(rawScore);
        sideEl.appendChild(score);

        sideEl.appendChild(buildRankIcon(side === 'left' ? match.leftRank : match.rightRank));

        return sideEl;
    }

    /** 单张对局卡片：场序信息行 + 底板 + BO + 场序数字 + 左右选手条 */
    function buildCard(index, match, time, avatars) {
        var item = document.createElement('div');
        item.className = 'mp-item';

        var info = document.createElement('div');
        info.className = 'mp-info';
        info.textContent = formatScheduleLabel(index, time);
        item.appendChild(info);

        var card = document.createElement('div');
        card.className = 'mp-card';

        var bg = document.createElement('img');
        bg.className = 'mp-card-bg';
        bg.src = CARD_BG;
        bg.alt = '';
        card.appendChild(bg);

        var bo = document.createElement('div');
        bo.className = 'mp-bo';
        bo.textContent = 'BO' + (match.bestOf ?? 1);
        card.appendChild(bo);

        var order = document.createElement('div');
        order.className = 'mp-order';
        order.textContent = String(index + 1);
        card.appendChild(order);

        var matchAvatars = avatars ? avatars[match.id] || null : null;
        card.appendChild(buildSide('left', match, matchAvatars));
        card.appendChild(buildSide('right', match, matchAvatars));

        item.appendChild(card);
        return item;
    }

    function mount(options) {
        var titleEl = document.getElementById('mpTitle');
        var gridEl = document.getElementById('mpGrid');
        var renderSignature = null;

        function applyTitle(state) {
            if (!titleEl) {
                return;
            }
            var text = String((state && state.title) || '').trim() || String(options.defaultTitle || '').trim();
            titleEl.textContent = text;
            titleEl.hidden = !text;
        }

        function renderGrid(data) {
            gridEl.innerHTML = '';
            var matches = (data && data.matches) || [];
            var avatars = (data && data.avatars) || null;
            var scheduleTimes = (data && data.scheduleTimes) || {};
            matches.slice(0, 9).forEach(function (match, index) {
                gridEl.appendChild(buildCard(index, match, scheduleTimes[match.id], avatars));
            });
        }

        // 渲染签名：标题/开始时间/手动时间/所选比赛/可见字段/头像 任一变化才重建网格
        function buildSignature(data) {
            var state = (data && data.state) || {};
            var matches = (data && data.matches) || [];
            var avatars = (data && data.avatars) || null;
            return JSON.stringify({
                title: String(state.title || '').trim(),
                startTime: state.startTime || '',
                matchTimes: state.matchTimes || {},
                scheduleTimes: data && data.scheduleTimes || {},
                matches: matches.map(function (match) {
                    return {
                        id: match.id,
                        bestOf: match.bestOf,
                        leftPlayer: match.leftPlayer,
                        rightPlayer: match.rightPlayer,
                        leftRank: match.leftRank,
                        rightRank: match.rightRank,
                        leftScore: match.leftScore === undefined ? null : match.leftScore,
                        rightScore: match.rightScore === undefined ? null : match.rightScore,
                    };
                }),
                avatars: avatars ? Object.keys(avatars).map(function (matchId) {
                    return {
                        matchId: matchId,
                        left: avatars[matchId] && avatars[matchId].left && avatars[matchId].left.exists
                            ? avatars[matchId].left.path + '?' + avatars[matchId].left.mtime : '',
                        right: avatars[matchId] && avatars[matchId].right && avatars[matchId].right.exists
                            ? avatars[matchId].right.path + '?' + avatars[matchId].right.mtime : '',
                    };
                }) : null,
            });
        }

        function applyAll(data) {
            var state = (data && data.state) || {};
            applyTitle(state);
            renderGrid(data);
            renderSignature = buildSignature(data);
        }

        async function loadData() {
            try {
                var data = await fetch(options.apiUrl, { credentials: 'same-origin' }).then(function (response) {
                    return response.json();
                });
                // 签名一致则跳过，避免无差异重渲染导致头像闪烁
                if (renderSignature !== null && renderSignature === buildSignature(data)) {
                    return;
                }
                applyAll(data);
            } catch (error) {
                console.error(options.role + ' 初始加载失败:', error);
            }
        }

        function connectSocket() {
            if (typeof io !== 'function') {
                return;
            }
            var socket = io({ transports: ['websocket', 'polling'], query: { role: options.role } });

            socket.on('snapshot', function (payload) {
                if (payload && payload[options.role]) {
                    void loadData();
                }
            });

            socket.on(options.updateEvent, function () {
                void loadData();
            });

            socket.on('matches:update', function () {
                void loadData();
            });

            socket.on('avatar:update', function () {
                // 头像按赛事隔离：重新拉取后由签名比对决定是否重渲染
                void loadData();
            });
        }

        document.addEventListener('DOMContentLoaded', function () {
            void loadData();
            connectSocket();
        });
    }

    window.MatchPredictionPage = { mount: mount };
})();
