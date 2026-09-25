(function () {
    'use strict';

    /**
     * 推流载体脚本：负责把直播推流指定的推流页面加载进全屏 iframe。
     *
     * 工作流程：
     * 1. 页面加载后通过 HTTP 拉取当前导播画面 (GET /api/stage)。
     * 2. 建立 Socket.IO 连接，监听 stage:update 事件，实时切换画面。
     * 3. 切换时做淡入淡出过渡，加载失败展示回退提示。
     *
     * 导播画面用页面 key 标识，支持的 key 与对应路径：
     *   - page1-overlay : 推流页面1（Overlay 比分栏布局）  -> /roco-pvp-page1.html
     *   - page2         : 推流页面2（全局阵容展示）       -> /roco-pvp-page2.html
     *   - page3         : 推流页面3（头像比分阵容）       -> /roco-pvp-page3.html
     *   - page4         : 推流页面4（MVP 结算画面）      -> /roco-pvp-page4.html
     *   - page5         : 推流页面5（使用率/胜率排行）    -> /roco-pvp-page5.html
     *   - page6         : 推流页面6（比赛结果）           -> /roco-pvp-page6.html
     *   - page7         : 推流页面7（对局推送）           -> /roco-pvp-page7.html
     *   - page8         : 推流页面8（比赛预告）           -> /roco-pvp-page8.html
     *   - page9         : 推流页面9（团队积分榜）       -> /roco-pvp-page9.html
     *   - page10        : 推流页面10（胜者结算画面）    -> /roco-pvp-page10.html
     *   - page11        : 选手介绍-左侧选手             -> /roco-pvp-page11.html?mode=left
     *   - page12        : 选手介绍-右侧选手             -> /roco-pvp-page11.html?mode=right
     *   - page13        : 选手介绍-对战页               -> /roco-pvp-page11.html?mode=versus
     *   - blank         : 黑场（不加载任何画面）
     */

    var STAGE_PAGES = {
        'page1-overlay': { label: '推流页面1', path: '/roco-pvp-page1.html' },
        'page2': { label: '推流页面2', path: '/roco-pvp-page2.html' },
        'page3': { label: '推流页面3', path: '/roco-pvp-page3.html' },
        'page4': { label: '推流页面4（MVP 结算画面）', path: '/roco-pvp-page4.html' },
        'page5': { label: '推流页面5', path: '/roco-pvp-page5.html' },
        'page6': { label: '推流页面6', path: '/roco-pvp-page6.html' },
        'page7': { label: '推流页面7（对局推送）', path: '/roco-pvp-page7.html' },
        'page8': { label: '推流页面8（比赛预告）', path: '/roco-pvp-page8.html' },
        'page9': { label: '推流页面9（团队积分榜）', path: '/roco-pvp-page9.html' },
        'page10': { label: '推流页面10（胜者结算画面）', path: '/roco-pvp-page10.html' },
        'page11': { label: '选手介绍-左侧选手', path: '/roco-pvp-page11.html?mode=left' },
        'page12': { label: '选手介绍-右侧选手', path: '/roco-pvp-page11.html?mode=right' },
        'page13': { label: '选手介绍-对战页', path: '/roco-pvp-page11.html?mode=versus' },
        'blank': { label: '黑场', path: null }
    };

    var DEFAULT_PAGE = 'page3';
    var DEFAULT_TRANSITION = 'blinds';
    var TRANSITION_MS = 420;

    // 「狼头揭幕」过渡（参考 docs/页面切换效果/intro.html）：
    // 黑幕盖屏 → 白狼淡入 → 停留 → 瞬间镂空 + 白狼淡出（黑幕掩护下换画）
    // → 镂空窗口放大穿越（由快到慢，新画面轻微视差）→ 窗口回落，露出完整新画面
    var WOLF_TIMING = { fadeInDelay: 120, fadeIn: 260, hold: 140, fadeOut: 440, pause: 80, zoom: 640, settle: 320 };
    var WOLF_BOX = 1920;    // 狼形 path 坐标系尺寸
    var WOLF_RATIO = 0.6;   // 狼形洞占屏幕短边比例，与 CSS 中白狼 Logo 的 60vmin 对齐
    // 放大倍数需足够大，让狼形 path 的细节线条完全移出画面：
    // 实测 16:9 下 34 倍仍残留针尖大小的角、40 倍干净，取 44 倍兼顾超宽/5:4 画幅余量
    var WOLF_ZOOM_MAX = 44;
    var WOLF_PARALLAX = 1.12; // 穿越时新画面的视差缩放
    var WOLF_PATH = (typeof window.STAGE_WOLF_PATH === 'string' && window.STAGE_WOLF_PATH)
        ? window.STAGE_WOLF_PATH : '';

    // 选手介绍三画面（page11/12/13）共用同一页面文件，仅 mode 不同：
    // 家族内切换不重载 iframe、不播全屏过渡，直接通知页面内部切换 mode，
    // 由页面内的元素动效完成变换（本身就是同一画面的内容变动）
    var INTRO_FAMILY = { page11: 'left', page12: 'right', page13: 'versus' };

    var carrier = document.getElementById('stageCarrier');
    var frame = document.getElementById('stageFrame');
    var fallback = document.getElementById('stageFallback');
    var fallbackText = document.getElementById('stageFallbackText');
    var transitionLayer = document.getElementById('stageTransition');

    var currentPage = null;
    var currentTransition = DEFAULT_TRANSITION;
    var socket = null;
    var transitionTimer = null;
    var transitionSeq = 0; // 过渡流水号：快速连续切换时使旧序列的定时器失效
    var wolfHole = null;   // 狼形镂空 <g>（fx-wolf 过渡期间有效）
    var wolfUnit = 0;      // 狼形坐标 -> 屏幕像素的缩放系数

    function resolveStage(page) {
        if (!page || typeof page !== 'string') {
            return STAGE_PAGES[DEFAULT_PAGE];
        }
        var trimmed = page.trim();
        if (STAGE_PAGES[trimmed]) {
            return STAGE_PAGES[trimmed];
        }
        // 兼容后端直接下发完整路径或相对路径
        if (/^\/[^\\]/.test(trimmed)) {
            return { label: trimmed, path: trimmed };
        }
        return STAGE_PAGES[DEFAULT_PAGE];
    }

    function applyFallback(show, text) {
        fallbackText.textContent = text || '正在等待导播画面…';
        fallback.classList.toggle('is-visible', !!show);
    }

    function setCarrierStage(page) {
        carrier.setAttribute('data-stage', page || 'blank');
    }

    function setBlank() {
        currentPage = 'blank';
        frame.classList.add('is-hidden');
        // 黑场：完全透明，不显示任何提示
        applyFallback(false, '');
        setCarrierStage('blank');
    }

    // ---------- 切换过渡动画层 ----------

    // 清空并构建过渡层 DOM；fx 为 'blinds' | 'wolf'
    function buildTransition(fx) {
        if (!transitionLayer) {
            return;
        }
        transitionLayer.className = 'stage-transition fx-' + fx;
        transitionLayer.innerHTML = '';

        if (fx === 'blinds') {
            var count = 10;
            for (var i = 0; i < count; i++) {
                var blind = document.createElement('div');
                blind.className = 'fx-blind';
                // 相邻百叶交错展开，形成扇面扫过效果
                blind.style.animationDelay = (i % 2 === 0 ? 0 : 70) + 'ms';
                transitionLayer.appendChild(blind);
            }
        } else if (fx === 'wolf') {
            // 黑幕：全屏黑底 + 狼形镂空遮罩（白幕上挖狼形黑洞，洞内露出画面）
            // 白狼 Logo：与镂空窗口对齐展示，淡出后由窗口承担视觉主体
            transitionLayer.innerHTML =
                '<svg class="fx-wolf-curtain" xmlns="http://www.w3.org/2000/svg">' +
                '<defs><mask id="fx-wolf-hole-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">' +
                '<rect class="fx-wolf-field" x="0" y="0" fill="#fff"/>' +
                '<g class="fx-wolf-hole"><path fill="#000" d="' + WOLF_PATH + '"/></g>' +
                '</mask></defs>' +
                '<rect x="0" y="0" width="100%" height="100%" fill="#000" mask="url(#fx-wolf-hole-mask)"/>' +
                '</svg>' +
                '<img class="fx-wolf-logo" src="/assets/wolf/wolf-only.svg" alt="">';
        }
    }

    // ---------- 狼头揭幕过渡（fx-wolf） ----------

    // 按当前视口布设狼形镂空遮罩；成功返回 true
    function layoutWolfCurtain() {
        var svg = transitionLayer.querySelector('.fx-wolf-curtain');
        var mask = transitionLayer.querySelector('#fx-wolf-hole-mask');
        var field = transitionLayer.querySelector('.fx-wolf-field');
        wolfHole = transitionLayer.querySelector('.fx-wolf-hole');
        if (!svg || !mask || !field || !wolfHole) {
            wolfHole = null;
            return false;
        }
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        wolfUnit = (Math.min(vw, vh) * WOLF_RATIO) / WOLF_BOX;
        mask.setAttribute('x', '0');
        mask.setAttribute('y', '0');
        mask.setAttribute('width', String(vw));
        mask.setAttribute('height', String(vh));
        field.setAttribute('width', String(vw));
        field.setAttribute('height', String(vh));
        svg.setAttribute('viewBox', '0 0 ' + vw + ' ' + vh);
        setWolfHole(0); // 洞为 0：纯黑无洞
        return true;
    }

    // 缩放狼形镂空：zoom=0 全黑，1 为与白狼 Logo 对齐的原尺寸
    function setWolfHole(zoom) {
        if (!wolfHole) {
            return;
        }
        var s = wolfUnit * zoom;
        wolfHole.setAttribute('transform',
            'translate(' + (window.innerWidth / 2) + ' ' + (window.innerHeight / 2) + ') scale(' + s + ')' +
            ' translate(' + (-WOLF_BOX / 2) + ' ' + (-WOLF_BOX / 2) + ')');
    }

    // rAF 数值补间（窗洞放大、画面视差共用）
    function tweenNumber(from, to, dur, ease, onUpdate) {
        var t0 = performance.now();
        (function frame(now) {
            var p = Math.min(1, (now - t0) / dur);
            onUpdate(from + (to - from) * ease(p));
            if (p < 1) {
                requestAnimationFrame(frame);
            }
        })(t0);
    }

    var easeOutQuart = function (p) { return 1 - Math.pow(1 - p, 4); }; // 由快到慢（减速）

    // 狼头揭幕时序；seq 用于快速连续切换时丢弃旧序列的定时器回调
    function runWolfSequence(seq, onReveal) {
        var t = WOLF_TIMING;
        var wolfImg = transitionLayer.querySelector('.fx-wolf-logo');
        var curtainSvg = transitionLayer.querySelector('.fx-wolf-curtain');
        // 快捷守卫：过渡层已被重建（新过渡开始）时，旧回调直接作废
        function live() { return seq === transitionSeq; }

        transitionLayer.classList.add('is-running');

        // ① 白狼淡入 → ② 停留（纯透明度，不缩放不位移）
        window.setTimeout(function () {
            if (live() && wolfImg) {
                wolfImg.animate([{ opacity: 0 }, { opacity: 1 }],
                    { duration: t.fadeIn, fill: 'forwards', easing: 'ease-out' });
            }
        }, t.fadeInDelay);

        // ③ 窗口瞬间满尺寸（藏在仍不透明的白狼后，不穿帮），白狼只做透明度淡出；
        //    同刻在黑幕掩护下换画，狼形窗口内完成新旧画面交替
        var tHole = t.fadeInDelay + t.fadeIn + t.hold;
        window.setTimeout(function () {
            if (!live()) {
                return;
            }
            setWolfHole(1);
            if (wolfImg) {
                wolfImg.animate([{ opacity: 1 }, { opacity: 0 }],
                    { duration: t.fadeOut, fill: 'forwards', easing: 'ease-in-out' });
            }
            if (typeof onReveal === 'function') {
                onReveal();
            }
        }, tHole);

        // ④ 窗口放大穿越（由快到慢），新画面轻微视差
        var tZoom = tHole + t.fadeOut + t.pause;
        window.setTimeout(function () {
            if (!live()) {
                return;
            }
            tweenNumber(1, WOLF_ZOOM_MAX, t.zoom, easeOutQuart, setWolfHole);
            tweenNumber(1, WOLF_PARALLAX, t.zoom, easeOutQuart, function (s) {
                if (live()) {
                    frame.style.transform = 'scale(' + s + ')';
                }
            });
        }, tZoom);

        // 峰值：窗洞盖满屏幕
        var peakDelay = tZoom + t.zoom;

        // ⑤ 画面缓缓回落（1.12 → 1），与黑幕淡出同步完成，避免清理时跳变
        window.setTimeout(function () {
            if (!live()) {
                return;
            }
            tweenNumber(WOLF_PARALLAX, 1, t.settle, easeOutQuart, function (s) {
                if (live()) {
                    frame.style.transform = 'scale(' + s + ')';
                }
            });
            if (curtainSvg) {
                curtainSvg.animate([{ opacity: 1 }, { opacity: 0 }],
                    { duration: t.settle, fill: 'forwards', easing: 'ease-in' });
            }
        }, peakDelay);

        transitionTimer = window.setTimeout(function () {
            if (!live()) {
                return;
            }
            transitionLayer.classList.remove('is-running');
            frame.style.transform = '';
            transitionTimer = null;
        }, peakDelay + t.settle + 60);
    }

    // 播放过渡动画；onReveal 在黑幕/遮罩掩护下触发，用于换画
    function playTransition(fx, onReveal) {
        if (!transitionLayer) {
            // 无过渡层节点时直接执行换画
            if (typeof onReveal === 'function') {
                onReveal();
            }
            return;
        }
        if (fx === 'none') {
            if (typeof onReveal === 'function') {
                onReveal();
            }
            return;
        }
        if (fx === 'wolf' && !WOLF_PATH) {
            // 狼形 path 资源缺失时降级为百叶窗
            fx = 'blinds';
        }

        buildTransition(fx);

        var seq = ++transitionSeq;
        if (transitionTimer) {
            window.clearTimeout(transitionTimer);
        }

        if (fx === 'wolf') {
            if (layoutWolfCurtain()) {
                runWolfSequence(seq, onReveal);
                return;
            }
            // 遮罩构建异常时退回百叶窗
            fx = 'blinds';
            buildTransition(fx);
        }

        // 峰值时长：动画遮满屏幕所需的时长（约 62% 处）
        var peakDelay = 384;
        // 总时长需大于单 iframe 淡出 420ms，保证换画发生在遮罩之下
        var totalMs = 980;

        // 强制重排，确保同名动画能重新触发
        void transitionLayer.offsetWidth;
        transitionLayer.classList.add('is-running');

        window.setTimeout(function () {
            // 流水号不符说明已有新过渡接管，放弃本次换画
            if (seq === transitionSeq && typeof onReveal === 'function') {
                onReveal();
            }
        }, peakDelay);

        transitionTimer = window.setTimeout(function () {
            if (seq !== transitionSeq) {
                return;
            }
            transitionLayer.classList.remove('is-running');
            transitionTimer = null;
        }, totalMs);
    }

    function loadStage(page, options) {
        var opts = options || {};
        var stage = resolveStage(page);
        var nextKey = page || DEFAULT_PAGE;
        var fx = typeof opts.transition === 'string' ? opts.transition : currentTransition;

        if (stage.path === null) {
            setBlank();
            return;
        }

        if (currentPage === nextKey && frame.getAttribute('src') === stage.path) {
            // 已经是目标画面，无需重复加载
            return;
        }

        // 选手介绍家族内切换（page11 <-> page12 <-> page13）：同一画面内容变动，
        // 不重载 iframe，postMessage 通知页面切换 mode，元素动效由页面自身 CSS 完成
        if (currentPage && INTRO_FAMILY[currentPage] && INTRO_FAMILY[nextKey]) {
            currentPage = nextKey;
            setCarrierStage(nextKey);
            frame.classList.remove('is-hidden');
            try {
                frame.contentWindow.postMessage({ type: 'page11-mode', mode: INTRO_FAMILY[nextKey] }, '*');
            } catch (error) {
                console.error('选手介绍模式切换通知失败:', error);
            }
            return;
        }

        currentPage = nextKey;
        setCarrierStage(nextKey);

        var done = function () {
            frame.classList.remove('is-hidden');
            applyFallback(false, '');
            // 通知新页面内容依次入场（fadeUp）：页面 stage-enter.js 收信后触发 .fx-enter 区块动画
            try {
                frame.contentWindow.postMessage({ type: 'stage-enter' }, '*');
            } catch (error) {
                console.error('推流页面入场通知失败:', error);
            }
        };

        // 切换路径。先置空再赋值可强制触发某些页面的重新初始化。
        var applyNewSrc = function () {
            frame.classList.add('is-hidden');
            frame.onload = function () {
                // 给浏览器一帧时间应用样式后再淡入
                window.setTimeout(done, 16);
            };
            frame.onerror = function () {
                applyFallback(true, '画面加载失败：' + stage.label);
            };
            frame.setAttribute('src', stage.path);

            // 兜底：若 onload 迟迟未触发（极端情况），仍淡入避免长期黑屏
            window.setTimeout(function () {
                if (frame.classList.contains('is-hidden')) {
                    done();
                }
            }, TRANSITION_MS + 1600);
        };

        // 播放过渡动画：动画遮满屏幕后触发射换新画面，动画淡出时露出新画面。
        playTransition(fx, applyNewSrc);
    }

    function applyStagePayload(payload) {
        if (!payload || typeof payload !== 'object') {
            return;
        }
        // 后端广播 stage:update 的 payload 形如 { stage: { page: 'page2' } }；
        // GET /api/stage 返回顶层 { page: 'page2' }。两种结构都要兼容。
        var page = null;
        var transition = null;
        if (payload.stage && typeof payload.stage === 'object') {
            page = payload.stage.page || payload.stage.stagePage;
            transition = payload.stage.transition;
        }
        if (page === undefined || page === null || page === '') {
            page = payload.page || payload.stagePage;
        }
        if (transition === undefined || transition === null || transition === '') {
            transition = payload.transition;
        }
        if (page === undefined || page === null || page === '') {
            return;
        }
        if (typeof transition === 'string' && transition) {
            currentTransition = transition;
        }
        loadStage(page, { transition: transition || currentTransition });
    }

    function loadInitialState() {
        fetch('/api/stage', { credentials: 'same-origin' })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('stage 状态请求失败');
                }
                return response.json();
            })
            .then(function (data) {
                var page = data && (data.page || data.stagePage);
                var transition = data && data.transition;
                if (typeof transition === 'string' && transition) {
                    currentTransition = transition;
                }
                loadStage(page || DEFAULT_PAGE, { transition: transition || currentTransition });
            })
            .catch(function () {
                // 拉取失败时回退到默认画面，避免长期空白
                loadStage(DEFAULT_PAGE);
            });
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            console.error('Socket.IO 客户端未加载，导播画面切换将不可用');
            return;
        }

        socket = io({ transports: ['websocket', 'polling'] });

        socket.on('connect', function () {
            // 连接建立后服务端会下发 snapshot，其中包含 stage 字段
        });

        socket.on('snapshot', function (payload) {
            applyStagePayload(payload && payload.stage ? { page: payload.stage.page } : null);
        });

        socket.on('stage:update', function (payload) {
            applyStagePayload(payload);
        });

        socket.on('connect_error', function (error) {
            console.error('Socket.IO 连接失败:', error);
        });
    }

    function init() {
        if (!frame || !carrier) {
            console.error('推流载体 DOM 节点缺失');
            return;
        }
        // 初始占位：保持透明，等待导播画面加载
        setBlank();
        // 预载狼头揭幕素材，避免首次过渡时白狼图未就绪
        if (WOLF_PATH) {
            var wolfPreload = new Image();
            wolfPreload.src = '/assets/wolf/wolf-only.svg';
        }
        loadInitialState();
        connectSocket();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
