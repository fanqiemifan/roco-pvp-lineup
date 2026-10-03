(function () {
    'use strict';

    /**
     * 悬浮窗操作练习（原生 JS，静态伺服，不进 Vite 构建）。
     *
     * ⚠ 本页是**纯仿真**：不连 socket、不调 /api/panels，所有点选只改页内数组，
     *    练习不会改真实阵容、不会切推流画面、也不会往 localStorage 写任何进度
     *    （引导进度只有后台侧在写；本页不参与，故没有 `:float` 之类的键）。
     *
     * 复刻的是真实悬浮窗（float.js）的四类交互：左键阵亡/复活、右键更换精灵、
     * 中央圆钮选下场对局、按住阵容条拖动窗口位置（外加悬停出现的关闭按钮）。
     */

    const MAX_SLOTS = 6;
    const SPRITE_ICON_BASE = '/resources/sprites-icon';
    const FALLBACK_IMG = '/assets/ui/back.png';

    /**
     * 练习用备选精灵：id 用真 `pet_id`，名字必须是**真精灵库里的纯名**
     * （图标文件名 = `{pet_id}_{name}.png`；名字写错/带形态后缀会静默 404、整条阵容条变占位图——
     *  踩过：原来这里写的是多形态精灵的纯名，而它们的图标文件名带「（形态）」后缀）。
     */
    const SPRITE_OPTIONS = [
        { id: 5025, name: '圣光迪莫' },
        { id: 3007, name: '魔力猫' },
        { id: 5003, name: '叶冕魔力猫' },
        { id: 5061, name: '武斗酷猫' },
        { id: 3006, name: '火神' },
        { id: 5017, name: '烈火战神' },
        { id: 5021, name: '圣剑骑士' },
        { id: 5022, name: '伊兰龙' },
    ];

    /** 下场对局候选（假数据） */
    const NEXT_GAME_OPTIONS = [
        { id: 'demo-1', label: '小明 vs 小红 · 第 2 局' },
        { id: 'demo-2', label: '小明 vs 小红 · 第 3 局' },
        { id: 'demo-3', label: '阿布 vs 迪莫 · 第 1 局' },
    ];

    /** 页内状态：阵容条两侧各 6 个槽位（null = 空槽），以及每个槽位是否已阵亡 */
    const state = {
        left: [0, 1, 2, 0, 1, 2],
        right: [3, 4, 5, 6, 7, 3],
        dead: { left: [false, false, false, false, false, false], right: [false, false, false, false, false, false] },
        nextGameId: null,
        dragOffset: { x: 0, y: 0 },
        /** 被右键的那只槽位（更换精灵的目标） */
        menuTarget: null,
    };

    const els = {
        stage: document.querySelector('.demo-stage'),
        bar: document.getElementById('demoFloatBar'),
        leftLineup: document.querySelector('.lineup-left'),
        rightLineup: document.querySelector('.lineup-right'),
        nextGameBtn: document.getElementById('demoNextGameBtn'),
        closeBtn: document.getElementById('demoCloseBtn'),
        hiddenMask: document.getElementById('demoHiddenMask'),
        reopenBtn: document.getElementById('demoReopenBtn'),
        spriteMenu: document.getElementById('demoSpriteMenu'),
        spriteMenuTitle: document.getElementById('demoSpriteMenuTitle'),
        spriteMenuClose: document.getElementById('demoSpriteMenuClose'),
        spriteSearch: document.getElementById('demoSpriteSearch'),
        spriteList: document.getElementById('demoSpriteList'),
        nextGameMenu: document.getElementById('demoNextGameMenu'),
        nextGameClose: document.getElementById('demoNextGameClose'),
        nextGameList: document.getElementById('demoNextGameList'),
        checklist: document.getElementById('demoChecklist'),
        progress: document.getElementById('demoProgress'),
        resetBtn: document.getElementById('demoResetBtn'),
    };

    /** 练习进度：只用于页面底部的勾选提示，不落盘 */
    const practiced = { dead: false, swap: false, next: false, drag: false, close: false };
    const PRACTICE_TOTAL = Object.keys(practiced).length;

    /**
     * 取某一格要显示的精灵：`slotValue` 是**下标**（`state.left/right` 里存的就是下标）。
     *
     * 这里踩过一个坑：原来写成 `SPRITE_OPTIONS.find((item) => item.id === slotValue)`，
     * 拿真 `pet_id`（5025）去跟下标（0）比，永远匹配不到 → 整条阵容条静默变成占位图。
     * 阵容条只关心"这一格摆哪只"，所以直接按下标取最简单也最不容易错。
     */
    function spriteBySlot(slotValue) {
        if (slotValue === null || slotValue === undefined) {
            return null;
        }
        return SPRITE_OPTIONS[slotValue] || null;
    }

    function spriteIconSrc(sprite) {
        return sprite ? `${SPRITE_ICON_BASE}/${sprite.id}_${sprite.name}.png` : FALLBACK_IMG;
    }

    /* ==================== 阵容条渲染 ==================== */

    function buildSlotEl(side, index) {
        const el = document.createElement('div');
        el.className = 'demo-slot';
        el.dataset.side = side;
        el.dataset.slot = String(index);
        el.innerHTML = '<img alt="" />';

        el.querySelector('img').addEventListener('error', (event) => {
            // 图标缺失（换机器 / 未同步图片）时退回占位图，练习页不报错
            const img = event.currentTarget;
            if (!img.src.endsWith(FALLBACK_IMG)) {
                img.src = FALLBACK_IMG;
            }
        });

        // 左键：判阵亡 / 复活（与真实悬浮窗同一语义）
        el.addEventListener('click', () => {
            if (el.dataset.suppressClick === '1') {
                // 这一下是拖动结束的那次 click，吞掉避免误判阵亡
                delete el.dataset.suppressClick;
                return;
            }
            const isDead = state.dead[side][index];
            if (isDead) {
                state.dead[side][index] = false;
            } else {
                markPracticed('dead');
                state.dead[side][index] = true;
            }
            renderSlot(el, side, index);
        });

        // 右键：打开「更换精灵」浮层
        el.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            openSpriteMenu(side, index, el);
        });

        return el;
    }

    function renderSlot(el, side, index) {
        const sprite = spriteBySlot(state[side][index]);
        const isDead = state.dead[side][index];
        const img = el.querySelector('img');

        img.src = spriteIconSrc(sprite);
        img.alt = sprite ? sprite.name : '';
        el.classList.toggle('is-dead', isDead);
        el.title = sprite
            ? `${sprite.name}（左键${isDead ? '复活' : '阵亡'} · 右键更换）`
            : '右键添加精灵';
    }

    function renderAllSlots() {
        ['left', 'right'].forEach((side) => {
            const container = side === 'left' ? els.leftLineup : els.rightLineup;
            Array.from(container.children).forEach((el, index) => renderSlot(el, side, index));
        });
    }

    /* ==================== 更换精灵浮层 ==================== */

    function openSpriteMenu(side, index, anchorEl) {
        state.menuTarget = { side, index };
        markPracticed('swap');

        const sprite = spriteBySlot(state[side][index]);
        els.spriteMenuTitle.textContent = sprite ? `更换精灵 · ${sprite.name}` : '添加精灵';
        els.spriteSearch.value = '';
        renderSpriteOptions('');
        els.spriteMenu.hidden = false;

        // 浮层出现在被点槽位下方（与真实小窗跟随精灵的定位语义一致）
        const barRect = els.bar.getBoundingClientRect();
        const slotRect = anchorEl.getBoundingClientRect();
        const left = Math.max(8, Math.min(slotRect.left - barRect.left, barRect.width - 244));
        els.spriteMenu.style.left = `${Math.round(left)}px`;
        els.spriteMenu.style.top = `${Math.round(slotRect.bottom - barRect.top + 8)}px`;
        els.spriteSearch.focus();
    }

    function renderSpriteOptions(keyword) {
        const normalized = keyword.trim().toLowerCase();
        const target = state.menuTarget;
        const currentId = target ? state[target.side][target.index] : null;

        els.spriteList.innerHTML = '';
        SPRITE_OPTIONS
            .filter((sprite) => !normalized || sprite.name.toLowerCase().includes(normalized))
            .forEach((sprite) => {
                const option = document.createElement('button');
                option.type = 'button';
                option.className = `demo-sprite-option${sprite.id === currentId ? ' is-current' : ''}`;
                option.innerHTML = `<img alt="" src="${spriteIconSrc(sprite)}"><span>${sprite.name}</span>`;
                // 图标缺失回退占位图
                option.querySelector('img').addEventListener('error', (event) => {
                    event.currentTarget.src = FALLBACK_IMG;
                });
                option.addEventListener('click', () => {
                    if (!state.menuTarget) {
                        return;
                    }
                    const { side, index } = state.menuTarget;
                    state[side][index] = sprite.id;
                    // 换精灵视为重新上场：清掉这一格的阵亡标记
                    state.dead[side][index] = false;
                    renderSlot(els[side === 'left' ? 'leftLineup' : 'rightLineup'].children[index], side, index);
                    closeSpriteMenu();
                });
                els.spriteList.appendChild(option);
            });

        if (!els.spriteList.children.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'grid-column:1/-1;color:#9b9186;font-size:12px;padding:6px 2px;';
            empty.textContent = '没有匹配的精灵';
            els.spriteList.appendChild(empty);
        }
    }

    function closeSpriteMenu() {
        state.menuTarget = null;
        els.spriteMenu.hidden = true;
    }

    /* ==================== 下场对局浮层 ==================== */

    function renderNextGameList() {
        els.nextGameList.innerHTML = '';
        NEXT_GAME_OPTIONS.forEach((item) => {
            const li = document.createElement('li');
            li.textContent = item.label;
            li.classList.toggle('is-current', item.id === state.nextGameId);
            li.addEventListener('click', () => {
                state.nextGameId = item.id;
                markPracticed('next');
                renderNextGameList();
            });
            els.nextGameList.appendChild(li);
        });
    }

    function openNextGameMenu() {
        renderNextGameList();
        els.nextGameMenu.hidden = false;
    }

    function closeNextGameMenu() {
        els.nextGameMenu.hidden = true;
    }

    /* ==================== 拖动窗口 ==================== */

    function bindDrag() {
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let originX = 0;
        let originY = 0;

        els.bar.addEventListener('pointerdown', (event) => {
            // 交互件（精灵槽 / 圆钮 / 关闭）不参与拖动
            const target = event.target instanceof Element ? event.target : null;
            if (event.button !== 0 || (target && target.closest('.demo-slot, .float-nextgame-btn, .float-close'))) {
                return;
            }
            dragging = true;
            startX = event.clientX;
            startY = event.clientY;
            originX = state.dragOffset.x;
            originY = state.dragOffset.y;
            els.bar.setPointerCapture(event.pointerId);
        });

        els.bar.addEventListener('pointermove', (event) => {
            if (!dragging) {
                return;
            }
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            state.dragOffset = { x: originX + dx, y: originY + dy };
            applyDragOffset();
            if (Math.abs(dx) + Math.abs(dy) > 4) {
                els.bar.classList.add('is-dragging');
                markPracticed('drag');
            }
        });

        const endDrag = (event) => {
            if (!dragging) {
                return;
            }
            dragging = false;
            els.bar.classList.remove('is-dragging');
            try {
                if (els.bar.hasPointerCapture(event.pointerId)) {
                    els.bar.releasePointerCapture(event.pointerId);
                }
            } catch (error) {
                // 指针已释放（例如 pointercancel）时忽略
            }
        };

        els.bar.addEventListener('pointerup', endDrag);
        els.bar.addEventListener('pointercancel', endDrag);
    }

    /** 拖动 = 改 left/top，与真实窗口「位置被拖动」一致（因为要整块偏移，这里用 transform 更顺滑） */
    function applyDragOffset() {
        els.bar.style.transform = `translateX(-50%) translate(${Math.round(state.dragOffset.x)}px, ${Math.round(state.dragOffset.y)}px)`;
    }

    /* ==================== 关闭 / 重新显示 ==================== */

    function closeFloat() {
        markPracticed('close');
        closeSpriteMenu();
        closeNextGameMenu();
        els.hiddenMask.hidden = false;
    }

    function reopenFloat() {
        els.hiddenMask.hidden = true;
    }

    /* ==================== 练习进度勾选 ==================== */

    function markPracticed(key) {
        if (practiced[key]) {
            return;
        }
        practiced[key] = true;
        updateChecklist();
    }

    function updateChecklist() {
        const doneCount = Object.values(practiced).filter(Boolean).length;
        Array.from(els.checklist.children).forEach((li) => {
            li.classList.toggle('is-done', Boolean(practiced[li.dataset.check]));
        });
        els.progress.textContent = doneCount >= PRACTICE_TOTAL
            ? `全部练完了（${doneCount} / ${PRACTICE_TOTAL}）· 可以回后台继续引导`
            : `已练习 ${doneCount} / ${PRACTICE_TOTAL}`;
    }

    /* ==================== 重置 ==================== */

    function resetAll() {
        state.left = [0, 1, 2, 0, 1, 2];
        state.right = [3, 4, 5, 6, 7, 3];
        state.dead = {
            left: [false, false, false, false, false, false],
            right: [false, false, false, false, false, false],
        };
        state.nextGameId = null;
        state.dragOffset = { x: 0, y: 0 };
        state.menuTarget = null;

        applyDragOffset();
        renderAllSlots();
        closeSpriteMenu();
        closeNextGameMenu();
        reopenFloat();

        Object.keys(practiced).forEach((key) => {
            practiced[key] = false;
        });
        updateChecklist();
    }

    /* ==================== 初始化 ==================== */

    function init() {
        ['left', 'right'].forEach((side) => {
            const container = side === 'left' ? els.leftLineup : els.rightLineup;
            for (let index = 0; index < MAX_SLOTS; index += 1) {
                container.appendChild(buildSlotEl(side, index));
            }
        });
        renderAllSlots();
        applyDragOffset();

        els.nextGameBtn.addEventListener('click', openNextGameMenu);
        els.nextGameClose.addEventListener('click', closeNextGameMenu);
        els.closeBtn.addEventListener('click', closeFloat);
        els.reopenBtn.addEventListener('click', reopenFloat);
        els.spriteMenuClose.addEventListener('click', closeSpriteMenu);
        els.spriteSearch.addEventListener('input', (event) => renderSpriteOptions(event.target.value));
        els.resetBtn.addEventListener('click', resetAll);

        // 点舞台空白处收起浮层（与真实小窗「失焦自动关闭」同感）
        els.stage.addEventListener('pointerdown', (event) => {
            if (event.target === els.stage || event.target.closest('.demo-game-layer')) {
                closeSpriteMenu();
                closeNextGameMenu();
            }
        });

        // Esc 关闭浮层（不影响 iframe 外的引导操作）
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeSpriteMenu();
                closeNextGameMenu();
            }
        });

        bindDrag();
        updateChecklist();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
