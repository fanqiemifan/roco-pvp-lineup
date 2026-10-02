(function () {
    'use strict';

    /**
     * 推流页面9（团队积分榜）渲染脚本：初始 GET /api/page9 + socket（snapshot / page9:update）刷新。
     * 排名与总积分自动计算：按总积分降序，同分保持录入顺序；
     * 未输入的积分显示「-」，三轮全空的战队总积分显示「-」。
     */

    // 数据行区域总高度（含行间隔），与 CSS 卡片设计稿保持一致
    var ROWS_REGION_HEIGHT = 320;
    var ROW_GAP_HEIGHT = 20;
    var DEFAULT_TITLE = '团队积分榜';
    var EMPTY_TEXT = '-';

    var titleEl = document.getElementById('page9Title');
    var rowsEl = document.getElementById('page9Rows');

    function toScoreText(value) {
        var text = String(value == null ? '' : value).trim();
        return text === '' ? EMPTY_TEXT : text;
    }

    function toScoreNumber(value) {
        var text = String(value == null ? '' : value).replace(/\D/g, '');
        return text === '' ? 0 : Number(text);
    }

    // 战队行是否有效：名称或任一轮积分非空才展示
    function isVisibleTeam(team) {
        return Boolean(team) && (
            String(team.name || '').trim() !== ''
            || String(team.r1 || '').trim() !== ''
            || String(team.r2 || '').trim() !== ''
            || String(team.r3 || '').trim() !== ''
        );
    }

    // 按总积分降序排名（稳定排序：同分保持录入顺序）
    function rankTeams(teams) {
        var rows = (teams || []).filter(isVisibleTeam).map(function (team) {
            var scores = [team.r1, team.r2, team.r3].map(toScoreNumber);
            var hasAnyScore = [team.r1, team.r2, team.r3].some(function (value) {
                return String(value == null ? '' : value).trim() !== '';
            });
            return {
                name: String(team.name || '').trim(),
                scoreTexts: [toScoreText(team.r1), toScoreText(team.r2), toScoreText(team.r3)],
                total: scores[0] + scores[1] + scores[2],
                totalText: hasAnyScore ? String(scores[0] + scores[1] + scores[2]) : EMPTY_TEXT,
            };
        });

        rows.sort(function (a, b) { return b.total - a.total; });
        rows.forEach(function (row, index) { row.rank = index + 1; });
        return rows;
    }

    // 行高与字号自适应：行多时压缩行高，保证卡片不超出画面
    function applyRowMetrics(count) {
        var usable = ROWS_REGION_HEIGHT - (count - 1) * ROW_GAP_HEIGHT;
        var rowHeight = Math.min(150, Math.floor(usable / count));
        var rowFont = Math.max(28, Math.min(64, Math.round(rowHeight * 0.36)));
        rowsEl.style.setProperty('--page9-row-h', rowHeight + 'px');
        rowsEl.style.setProperty('--page9-row-fs', rowFont + 'px');
    }

    function buildCell(className, text) {
        var span = document.createElement('span');
        span.className = className;
        span.textContent = text;
        return span;
    }

    function renderRows(teams) {
        var rows = rankTeams(teams);
        rowsEl.innerHTML = '';

        if (!rows.length) {
            return;
        }

        applyRowMetrics(rows.length);

        rows.forEach(function (row, index) {
            if (index > 0) {
                var gap = document.createElement('div');
                gap.className = 'page9-gap';
                rowsEl.appendChild(gap);
            }

            var item = document.createElement('div');
            item.className = 'page9-row page9-item';
            item.appendChild(buildCell('page9-gold', String(row.rank)));
            item.appendChild(buildCell('page9-ink page9-team', row.name || EMPTY_TEXT));
            item.appendChild(buildCell('page9-ink', row.scoreTexts[0]));
            item.appendChild(buildCell('page9-ink', row.scoreTexts[1]));
            item.appendChild(buildCell('page9-ink', row.scoreTexts[2]));
            item.appendChild(buildCell('page9-gold', row.totalText));
            rowsEl.appendChild(item);
        });
    }

    function applyAll(state) {
        var data = state || {};
        var title = String(data.title || '').trim();
        titleEl.textContent = title || DEFAULT_TITLE;
        renderRows(data.teams);
    }

    async function loadData() {
        try {
            var data = await fetch('/api/page9', { credentials: 'same-origin' }).then(function (response) {
                return response.json();
            });
            applyAll(data && data.state);
        } catch (error) {
            console.error('page9 初始加载失败:', error);
        }
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            return;
        }
        var socket = io({ transports: ['websocket', 'polling'], query: { role: 'page9' } });

        socket.on('snapshot', function (payload) {
            if (payload && payload.page9) {
                applyAll(payload.page9);
            }
        });

        socket.on('page9:update', function (payload) {
            if (payload && payload.state) {
                applyAll(payload.state);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        void loadData();
        connectSocket();
    });
})();
