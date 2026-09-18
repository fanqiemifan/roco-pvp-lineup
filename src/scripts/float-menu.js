(function () {
    'use strict';

    const FALLBACK_IMG = '/assets/ui/back.png';

    const params = new URLSearchParams(window.location.search);
    const side = params.get('side') === 'right' ? 'right' : 'left';
    const slotIndex = Math.min(5, Math.max(0, Number.parseInt(params.get('slot') || '0', 10) || 0));

    const menuView = document.getElementById('menuView');
    const menuTitle = document.getElementById('menuTitle');
    const menuBody = document.getElementById('menuBody');
    const openPickerBtn = document.getElementById('openPickerBtn');
    const pickerView = document.getElementById('pickerView');
    const backBtn = document.getElementById('backBtn');
    const searchInput = document.getElementById('searchInput');
    const pickerGrid = document.getElementById('pickerGrid');
    const menuCloseBtn = document.getElementById('menuCloseBtn');
    const pickerCurrent = document.getElementById('pickerCurrent');

    let slotData = null;
    let spriteCache = [];

    function basename(value) {
        return String(value || '').split('/').filter(Boolean).pop() || '';
    }

    function getSpriteDisplayName(sprite) {
        if (!sprite || typeof sprite !== 'object') {
            return '';
        }
        // 优先使用原始名称（精灵名称），如 卡瓦重（草地附近的样子），而非去掉变体后缀的短名 displayName
        return String(sprite.name || sprite.displayName || basename(sprite.path) || '').trim();
    }

    function getSpriteForm(sprite) {
        return sprite && sprite.form ? String(sprite.form).trim() : '';
    }

    function spriteImgSrc(sprite) {
        return sprite && sprite.path ? String(sprite.path) : FALLBACK_IMG;
    }

    // 多形态匹配：同图鉴编号 + 同名（如 鸭吉吉 的多种样子/多个 pet_id 变体）；
    // pets.json 命名后文件名基名不再共享，改为按 number（handbook_no）+ displayName 分组
    function variantGroupKey(sprite) {
        if (!sprite || typeof sprite !== 'object') {
            return '';
        }
        const number = sprite.number ? String(sprite.number) : '';
        const name = String(sprite.displayName || sprite.name || '').trim();
        if (number && name) {
            return `${number}|${name}`;
        }
        const filename = String(sprite.filename || sprite.id || basename(sprite.path || '') || '').trim();
        return basename(filename)
            .replace(/\.(png|jpg|jpeg|webp)$/i, '')
            .replace(/[-_](\d+)$/u, '');
    }

    function getSiblings(sprite) {
        if (!sprite || typeof sprite !== 'object') {
            return [];
        }
        const key = variantGroupKey(sprite);
        if (!key) {
            return [];
        }
        return spriteCache.filter((item) => variantGroupKey(item) === key && item.id !== sprite.id);
    }

    async function requestJson(url, options) {
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
        }
        return response.json();
    }

    async function loadData() {
        const images = await requestJson('/api/panels');
        const panels = images && Array.isArray(images.panels) ? images.panels : [];
        const panel = panels.find((item) => item && item.position === side) || null;
        slotData = panel && Array.isArray(panel.selected) ? panel.selected[slotIndex] || null : null;

        const sprites = await requestJson('/api/sprites');
        spriteCache = Array.isArray(sprites.sprites) ? sprites.sprites : [];
    }

    function buildPayload(petId) {
        return {
            slot: slotIndex,
            sprite: petId,
            opacityEnabled: Boolean(slotData && slotData.opacityEnabled),
            opacity: Number(slotData && slotData.opacity) || 1,
            saturation: Number(slotData && slotData.saturation) || 1,
            healthEnabled: true,
            healthPercent: 100,
            energyValue: 10,
        };
    }

    async function replaceSlot(petId) {
        try {
            await requestJson(`/api/panels/${side}/slots/${slotIndex}`, {
                method: 'PATCH',
                body: JSON.stringify({ slot: buildPayload(petId) }),
            });
        } catch (error) {
            console.error('更换精灵失败:', error);
        } finally {
            closeWindow();
        }
    }

    function closeWindow() {
        if (window.rocoFloat && typeof window.rocoFloat.closeMenu === 'function') {
            window.rocoFloat.closeMenu();
            return;
        }
        window.close();
        // 兜底：部分浏览器会忽略非脚本打开窗口的 window.close()
        window.setTimeout(() => {
            if (!window.closed) {
                window.open('', '_self');
                window.close();
            }
        }, 50);
    }

    // 点击窗口外部（页面失焦）时自动关闭；仅在本窗口曾获得焦点后生效，避免打开瞬间误关
    let hasHadFocus = false;
    window.addEventListener('focus', () => {
        hasHadFocus = true;
    });
    window.addEventListener('blur', () => {
        if (hasHadFocus) {
            closeWindow();
        }
    });

    function getCurrentSpriteLabel() {
        const currentSprite = slotData && slotData.sprite ? slotData.sprite : null;
        const slotLabel = `${side === 'left' ? '左侧' : '右侧'} 第 ${slotIndex + 1} 位`;
        return currentSprite
            ? `正在编辑：${getSpriteDisplayName(currentSprite)}${getSpriteForm(currentSprite) ? `（${getSpriteForm(currentSprite)}）` : ''} · ${slotLabel}`
            : `正在编辑：空槽位 · ${slotLabel}`;
    }

    function renderPickerCurrent() {
        pickerCurrent.textContent = getCurrentSpriteLabel();
    }

    function renderMenu() {
        const currentSprite = slotData && slotData.sprite ? slotData.sprite : null;
        menuTitle.textContent = getCurrentSpriteLabel();

        menuBody.innerHTML = '';

        const siblings = getSiblings(currentSprite);
        if (siblings.length > 0) {
            const section = document.createElement('div');
            section.className = 'menu-section';
            section.textContent = '其他形态';
            menuBody.appendChild(section);

            siblings.slice(0, 30).forEach((sprite) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'menu-item';
                button.innerHTML = '<img alt="" /><span class="menu-item-text"></span>';
                const img = button.querySelector('img');
                img.src = spriteImgSrc(sprite);
                img.alt = getSpriteDisplayName(sprite);
                button.querySelector('.menu-item-text').textContent = getSpriteDisplayName(sprite);
                const form = getSpriteForm(sprite);
                if (form) {
                    const formTag = document.createElement('span');
                    formTag.className = 'menu-item-form';
                    formTag.textContent = form;
                    button.appendChild(formTag);
                }
                button.addEventListener('click', () => {
                    void replaceSlot(sprite.id);
                });
                menuBody.appendChild(button);
            });
        } else if (currentSprite) {
            const hint = document.createElement('div');
            hint.className = 'menu-hint';
            hint.textContent = '该精灵没有其他形态';
            menuBody.appendChild(hint);
        } else {
            const hint = document.createElement('div');
            hint.className = 'menu-hint';
            hint.textContent = '点击下方按钮选择一只全新精灵';
            menuBody.appendChild(hint);
        }
    }

    function hasMultiForms() {
        const currentSprite = slotData && slotData.sprite ? slotData.sprite : null;
        return currentSprite ? getSiblings(currentSprite).length > 0 : false;
    }

    function renderPickerGrid() {
        const keyword = searchInput.value.trim().toLowerCase();
        const results = keyword
            ? spriteCache.filter((sprite) => {
                const haystack = [
                    sprite.displayName,
                    sprite.name,
                    sprite.filename,
                    sprite.aliases ? sprite.aliases.join(' ') : '',
                ].join(' ').toLowerCase();
                return haystack.includes(keyword);
            })
            : spriteCache;

        pickerGrid.innerHTML = '';
        if (results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'picker-empty';
            empty.textContent = '没有匹配的精灵';
            pickerGrid.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        results.slice(0, 120).forEach((sprite) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'picker-item';
            item.innerHTML = '<img alt="" /><span></span>';
            const img = item.querySelector('img');
            img.src = spriteImgSrc(sprite);
            img.alt = getSpriteDisplayName(sprite);
            item.querySelector('span').textContent = getSpriteDisplayName(sprite);
            item.title = `${getSpriteDisplayName(sprite)}${getSpriteForm(sprite) ? `（${getSpriteForm(sprite)}）` : ''}`;
            item.addEventListener('click', () => {
                void replaceSlot(sprite.id);
            });
            fragment.appendChild(item);
        });
        pickerGrid.appendChild(fragment);
    }

    function showPicker() {
        menuView.hidden = true;
        pickerView.hidden = false;
        renderPickerCurrent();
        searchInput.focus();
        renderPickerGrid();
    }

    function showMenu() {
        pickerView.hidden = true;
        menuView.hidden = false;
    }

    openPickerBtn.addEventListener('click', showPicker);
    backBtn.addEventListener('click', showMenu);
    searchInput.addEventListener('input', renderPickerGrid);
    menuCloseBtn.addEventListener('click', closeWindow);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeWindow();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        void loadData()
            .then(() => {
                renderMenu();
                renderPickerGrid();
                // 没有多形态时直接进入更换精灵选择器
                if (!hasMultiForms()) {
                    showPicker();
                }
            })
            .catch((error) => {
                menuBody.innerHTML = '';
                const hint = document.createElement('div');
                hint.className = 'menu-hint';
                hint.textContent = `加载失败：${error.message}`;
                menuBody.appendChild(hint);
            });
    });
})();
