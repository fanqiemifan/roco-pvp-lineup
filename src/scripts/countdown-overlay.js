(function () {
    'use strict';

    /**
     * 倒计时插件渲染脚本（推流载体页顶部叠加小插件）。
     *
     * 数据来源：GET /api/countdown -> { state, serverNow }
     * - state.visible：是否显示（false 时播放退场动效后隐藏）
     * - state.running：倒计时是否进行中（false = 时间静止）
     * - state.theme：配色 dark / light（背景与文字颜色切换）
     * 实时更新：Socket.IO countdown:update 事件
     *
     * 时间计算：running 时以服务端 endAt 为准，用 serverNow 校准客户端时钟偏差，
     * 本地每 200ms 刷新一次显示；静止时直接显示 remainingSeconds。
     *
     * 几何：位置固定在 1920x1080 设计坐标系（left 710px 顶部居中、贴顶、500x120），
     * 由 countdown-overlay.css 纯 CSS 定义，不随视口尺寸/缩放变动。
     */

    var overlayEl = document.getElementById('countdownOverlay');
    var timeEl = document.getElementById('countdownTime');

    // 服务端时钟偏差（serverNow - 收到时的本地时间），用于 endAt 换算
    var clockOffset = 0;
    var tickTimer = null;
    var currentState = null;
    // 上次渲染的秒数（避免重复写 DOM）
    var lastRenderedSeconds = -1;

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    /** mm:ss 格式化 */
    function formatSeconds(total) {
        var seconds = Math.max(0, Math.floor(total));
        var mm = Math.floor(seconds / 60);
        var ss = seconds % 60;
        return pad2(mm) + ':' + pad2(ss);
    }

    /** 当前剩余秒数：running 用 endAt 实时计算，静止用 remainingSeconds */
    function computeRemainingSeconds() {
        if (!currentState) {
            return 0;
        }
        if (!currentState.running || currentState.endAt === null) {
            return Math.max(0, Math.round(currentState.remainingSeconds || 0));
        }
        return Math.max(0, Math.ceil((currentState.endAt - (Date.now() + clockOffset)) / 1000));
    }

    function renderTime() {
        if (!timeEl) {
            return;
        }
        var seconds = computeRemainingSeconds();
        if (seconds !== lastRenderedSeconds) {
            lastRenderedSeconds = seconds;
            timeEl.textContent = formatSeconds(seconds);
        }
    }

    /** 倒计时进行中：本地节拍刷新（可见与不可见都保持节拍，重新显示时时间正确） */
    function syncTick() {
        if (tickTimer) {
            clearInterval(tickTimer);
            tickTimer = null;
        }
        if (currentState && currentState.running) {
            tickTimer = setInterval(renderTime, 200);
        }
    }

    function applyState(state, serverNow) {
        currentState = state;
        if (typeof serverNow === 'number' && Number.isFinite(serverNow)) {
            clockOffset = serverNow - Date.now();
        }

        if (!overlayEl) {
            return;
        }

        // 显示 / 隐藏（进退场动效由 CSS transition 完成）
        overlayEl.classList.toggle('is-visible', Boolean(state && state.visible));

        var theme = state && state.theme === 'light' ? 'light' : 'dark';
        overlayEl.setAttribute('data-theme', theme);

        lastRenderedSeconds = -1;
        renderTime();
        syncTick();
    }

    async function loadState() {
        try {
            var response = await fetch('/api/countdown', { credentials: 'same-origin' });
            var data = await response.json();
            applyState(data.state, data.serverNow);
        } catch (error) {
            console.error('倒计时插件状态加载失败:', error);
        }
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            return;
        }
        var socket = io({ transports: ['websocket', 'polling'], query: { role: 'countdown' } });
        socket.on('countdown:update', function (payload) {
            if (payload && payload.state) {
                applyState(payload.state, payload.serverNow);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            void loadState();
            connectSocket();
        });
    } else {
        void loadState();
        connectSocket();
    }
})();
