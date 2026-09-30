/**
 * 推流页面14：晋级积分榜（原生 JS）
 *
 * 数据全部来自 GET /api/page14（服务端按系列赛阶段的现存节点重算 W/L，只统计系列赛内的比赛）：
 *   { state: Page14State, standings: StageStandings | null }
 * 页面只负责渲染——分栏（最多 3 栏）、每页最多 32 行由 state.page 决定，翻页与阶段切换在后台控制。
 *
 * 增量更新约束（直播画面不能抖）：行元素按 playerId 复用、只改文本与类名，
 * 绝不整段 innerHTML 重写；签名一致时直接跳过渲染。
 */
(function () {
    'use strict';

    var DEFAULT_TITLE = '晋级积分榜';
    /** 行数超过该值时改用三栏（与参考页一致：32 人一屏三栏） */
    var COLUMN_BREAKPOINT = 24;
    /** 榜单可用高度：1080 - 顶部 168 - 底部 48 */
    var BOARD_HEIGHT = 864;
    var HEAD_HEIGHT = 50;
    /** 单行最大高度 / 各字号上限（行数多时按比例缩小） */
    var MAX_ROW_HEIGHT = 74;
    var REFETCH_DEBOUNCE_MS = 200;

    var titleEl = document.getElementById('page14Title');
    var subtitleEl = document.getElementById('page14Subtitle');
    var boardEl = document.getElementById('page14Board');
    var emptyEl = document.getElementById('page14Empty');
    var emptyTextEl = document.getElementById('page14EmptyText');
    var footerEl = document.getElementById('page14Footer');
    var stageNameEl = document.getElementById('page14StageName');
    var pageTextEl = document.getElementById('page14PageText');

    /** 列容器（索引即栏序），创建后复用 */
    var columns = [];
    /** playerId -> 行元素（跨页/跨阶段复用，避免重建导致闪烁） */
    var rowElements = new Map();

    var socket = null;
    var refetchTimer = null;
    var fetchInFlight = false;
    var refetchQueued = false;
    /** 上次渲染的签名：数据没变就不动 DOM */
    var lastSignature = '';

    function createCell(className, text) {
        var cell = document.createElement('span');
        cell.className = className;
        cell.textContent = text;
        return cell;
    }

    /** 建一行（4 格：名次 / 选手 / 胜 / 负），格子引用挂在元素上便于增量改写 */
    function createRow() {
        var row = document.createElement('div');
        row.className = 'page14-row';
        var rank = createCell('page14-rank', '');
        var name = createCell('page14-name', '');
        var win = createCell('page14-num is-win', '');
        var loss = createCell('page14-num', '');
        row.appendChild(rank);
        row.appendChild(name);
        row.appendChild(win);
        row.appendChild(loss);
        row.cells = { rank: rank, name: name, win: win, loss: loss };
        return row;
    }

    function ensureColumns(count) {
        while (columns.length < count) {
            var column = document.createElement('div');
            column.className = 'page14-col';
            var head = document.createElement('div');
            head.className = 'page14-row page14-row-head';
            head.appendChild(createCell('page14-rank', '#'));
            head.appendChild(createCell('page14-name', '选手'));
            head.appendChild(createCell('page14-num is-win', '胜'));
            head.appendChild(createCell('page14-num', '负'));
            column.appendChild(head);
            boardEl.appendChild(column);
            columns.push(column);
        }
        while (columns.length > count) {
            var removed = columns.pop();
            removed.remove();
        }
        boardEl.style.setProperty('--page14-cols', String(count || 1));
    }

    /** 行高/字号按每栏行数收敛，保证 never 溢出画面（与 page9 的自适应思路一致） */
    function applyRowMetrics(rowsPerColumn) {
        var usable = BOARD_HEIGHT - HEAD_HEIGHT;
        var rowHeight = rowsPerColumn > 0
            ? Math.min(MAX_ROW_HEIGHT, Math.floor(usable / rowsPerColumn))
            : MAX_ROW_HEIGHT;
        var root = document.documentElement;
        root.style.setProperty('--page14-row-h', rowHeight + 'px');
        root.style.setProperty('--page14-row-fs', Math.max(15, Math.min(18, Math.round(rowHeight * 0.24))) + 'px');
        root.style.setProperty('--page14-num-fs', Math.max(18, Math.min(22, Math.round(rowHeight * 0.30))) + 'px');
        root.style.setProperty('--page14-rank-fs', Math.max(20, Math.min(27, Math.round(rowHeight * 0.36))) + 'px');
    }

    /** 阶段与赛制自动副标题（后台留空时使用） */
    function autoSubtitle(standings) {
        if (!standings || !standings.stageName) {
            return '';
        }
        var formatText = standings.format === 'double-life' ? '双败淘汰' : '单败淘汰';
        var rule = standings.format === 'double-life' ? ' · 赢满 2 场晋级' : ' · 胜者晋级';
        return standings.stageName + ' · ' + formatText + ' · BO' + standings.bestOf + rule;
    }

    function renderTitle(state, standings) {
        var title = state.title || DEFAULT_TITLE;
        if (titleEl.textContent !== title) {
            titleEl.textContent = title;
        }
        var subtitle = state.subtitle || autoSubtitle(standings);
        if (subtitleEl.textContent !== subtitle) {
            subtitleEl.textContent = subtitle;
        }
    }

    function renderFooter(state, standings) {
        if (!standings || standings.pageCount <= 1 || !standings.rows.length) {
            footerEl.hidden = true;
            return;
        }
        footerEl.hidden = false;
        stageNameEl.textContent = standings.stageName;
        pageTextEl.textContent = '第 ' + (state.page + 1) + ' / ' + standings.pageCount + ' 页';
    }

    function showEmpty(text) {
        columns.forEach(function (column) { column.remove(); });
        columns = [];
        rowElements.forEach(function (row) { row.remove(); });
        rowElements.clear();
        boardEl.style.display = 'none';
        emptyTextEl.textContent = text;
        emptyEl.hidden = false;
    }

    /**
     * 增量渲染：按 state.page 切片，超过 24 行分 3 栏，其余分 2 栏；
     * 行元素按 playerId 复用并按顺序 appendChild（appendChild 会移动已有节点）。
     */
    function renderBoard(state, standings) {
        var rows = standings ? standings.rows : [];
        var pageSize = standings && standings.pageSize ? standings.pageSize : rows.length || 1;
        var start = Math.max(0, state.page) * pageSize;
        var pageRows = rows.slice(start, start + pageSize);

        if (!pageRows.length) {
            showEmpty(
                !state.tournamentId
                    ? '等待裁判端在「比赛管理 → 晋级积分榜」选择系列赛与阶段'
                    : (standings ? '该阶段尚无参赛数据' : '系列赛不存在或尚未同步到本机'),
            );
            return;
        }

        emptyEl.hidden = true;
        boardEl.style.display = '';

        var colCount = pageRows.length > COLUMN_BREAKPOINT ? 3 : 2;
        var perColumn = Math.ceil(pageRows.length / colCount);
        ensureColumns(colCount);
        applyRowMetrics(perColumn);

        var used = new Set();
        for (var columnIndex = 0; columnIndex < colCount; columnIndex += 1) {
            var slice = pageRows.slice(columnIndex * perColumn, (columnIndex + 1) * perColumn);
            slice.forEach(function (row) {
                used.add(row.playerId);
                var element = rowElements.get(row.playerId);
                if (!element) {
                    element = createRow();
                    element.dataset.playerId = row.playerId;
                    rowElements.set(row.playerId, element);
                }
                if (element.cells.rank.textContent !== String(row.rank)) {
                    element.cells.rank.textContent = String(row.rank);
                }
                if (element.cells.name.textContent !== row.name) {
                    element.cells.name.textContent = row.name;
                }
                var winText = String(row.wins);
                if (element.cells.win.textContent !== winText) {
                    element.cells.win.textContent = winText;
                }
                var lossText = String(row.losses);
                if (element.cells.loss.textContent !== lossText) {
                    element.cells.loss.textContent = lossText;
                }
                var isOut = row.state === 'eliminated';
                element.classList.toggle('is-out', isOut);
                element.classList.toggle('is-top', !isOut && row.rank <= 3);
                // 名次/战绩变化时按新顺序落位（appendChild 只移动不重建）
                columns[columnIndex].appendChild(element);
            });
        }

        // 清掉本次未使用的行（换页/换阶段后不再出现的选手）
        rowElements.forEach(function (element, playerId) {
            if (!used.has(playerId)) {
                element.remove();
                rowElements.delete(playerId);
            }
        });
    }

    function signatureOf(state, standings) {
        if (!standings) {
            return JSON.stringify([state.tournamentId, state.title, state.subtitle, state.page, null]);
        }
        return JSON.stringify([
            standings.stageIndex,
            standings.stageName,
            state.title,
            state.subtitle,
            state.page,
            standings.rows.map(function (row) {
                return [row.playerId, row.rank, row.wins, row.losses, row.state];
            }),
        ]);
    }

    function render(state, standings) {
        renderTitle(state, standings);
        renderFooter(state, standings);
        renderBoard(state, standings);
    }

    function applyView(data) {
        var state = (data && data.state) || {
            tournamentId: '', stageIndexes: [], activeStageIndex: -1, page: 0, title: '', subtitle: '',
        };
        var standings = (data && data.standings) || null;
        var signature = signatureOf(state, standings);
        if (signature === lastSignature) {
            return;
        }
        lastSignature = signature;
        render(state, standings);
    }

    function fetchView() {
        if (fetchInFlight) {
            refetchQueued = true;
            return;
        }
        fetchInFlight = true;
        fetch('/api/page14', { credentials: 'same-origin' })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('page14 状态请求失败');
                }
                return response.json();
            })
            .then(function (data) {
                applyView(data);
            })
            .catch(function (error) {
                console.error('晋级积分榜数据加载失败:', error);
            })
            .then(function () {
                fetchInFlight = false;
                if (refetchQueued) {
                    refetchQueued = false;
                    fetchView();
                }
            });
    }

    /** 广播到达时防抖重取（比赛/编排变化可能连续到达多条） */
    function scheduleFetch() {
        if (refetchTimer) {
            window.clearTimeout(refetchTimer);
        }
        refetchTimer = window.setTimeout(function () {
            refetchTimer = null;
            fetchView();
        }, REFETCH_DEBOUNCE_MS);
    }

    function connectSocket() {
        if (typeof io !== 'function') {
            console.error('Socket.IO 客户端未加载，晋级积分榜将无法实时刷新');
            return;
        }
        socket = io({ transports: ['websocket', 'polling'], query: { role: 'page14' } });
        socket.on('snapshot', function (payload) {
            if (payload && payload.page14) {
                scheduleFetch();
            }
        });
        socket.on('page14:update', function () {
            scheduleFetch();
        });
        // 系列赛赛果或编排变化都会影响榜单（服务端重算，页面只需要重取）
        socket.on('matches:update', function () {
            scheduleFetch();
        });
        socket.on('tournament:update', function () {
            scheduleFetch();
        });
        socket.on('connect_error', function (error) {
            console.error('Socket.IO 连接失败:', error);
        });
    }

    function init() {
        fetchView();
        connectSocket();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
