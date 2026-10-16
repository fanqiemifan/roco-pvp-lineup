/**
 * petsicon 精灵头像卡组件 · 独立版（零依赖，浏览器直接引入）
 *
 * 收敛自推流页面1 的 petsdiv3 家族实现：圆形底托 + 精灵头像（失败回退立绘）+
 * 阵亡置灰与斜杠渐变。page1 比分栏 / float 阵容悬浮窗 / page4 / page7 / page10 / page11 共用。
 *
 * 用法：
 *   <link rel="stylesheet" href="petsicon.css">
 *   <script src="petsicon.js"></script>
 *   const slot = Petsicon.create({ pet: sprite, dead: false });
 *   Petsicon.render(slotEl, { pet: sprite, dead: true, fallbackSrc: '/assets/ui/back.png' });
 *
 * 选项：
 *   pet          精灵身份 { id, name, displayName, path, iconUrl }；null/undefined = 空槽（is-empty）
 *   name         覆盖 <img alt> 文案（缺省 = displayName || name || path 文件名）
 *   dead         阵亡态；只切 is-dead class 走 CSS 渐变，不重建图片
 *   fallbackSrc  全部候选图都加载失败后的兜底图（如 float 的 back.png）
 *
 * 行为约束（沿用 petsdiv3 语义，改动前先读 .agents/09）：
 *   - 增量更新：精灵身份签名不变时只切状态 class，绝不重建 <img>（阵亡 240ms 渐变不能被打断）；
 *   - 头像优先：iconUrl 在前、path 兜底；加载失败的头像路径记入会话黑名单，之后不再重试；
 *   - 类名契约：根类 petsicon + is-active/is-empty/is-dead/is-sprite-icon，槽位上的
 *     页面自有类（如 page4 的 mvp-item-avatar）render 时原样保留；
 *   - 组件只认槽位直接子级的 <img>（page4 的 MVP 徽章 img 在子容器里，不会被误认）。
 * 缩放：容器基准 98px，页面用 --petsicon-scale 覆盖（必须写在 .petsicon 自身，写在父容器无效）。
 */

(function (global) {
    'use strict';

    // 精灵头像目录（sprites-icon，与 sprites-img 立绘同命名：{pet_id}_{name}.png）
    const SPRITE_ICON_RESOURCE_BASE = '/resources/sprites-icon';
    // 会话内已证实加载失败的头像路径：跳过重试，避免每次增量更新都打一遍坏地址
    const unavailableIconPaths = new Set();
    // 组件保留字类名：render 时槽位上其余类名一律原样保留
    const OWN_CLASSES = ['petsicon', 'is-active', 'is-empty', 'is-dead', 'is-sprite-icon'];

    function basename(value) {
        return String(value || '').split('/').filter(Boolean).pop() || '';
    }

    function displayNameOf(pet) {
        if (!pet || typeof pet !== 'object') {
            return '';
        }
        return String(pet.displayName || pet.name || basename(pet.path) || '').trim();
    }

    /** 精灵身份签名：不含阵亡态（阵亡只切 class，不触发重建） */
    function spriteKeyOf(pet, name) {
        return JSON.stringify({
            id: (pet && pet.id) || (pet && pet.path) || name,
            name: name,
            path: (pet && pet.path) || '',
            iconUrl: (pet && pet.iconUrl) || '',
        });
    }

    /** 头像优先、立绘兜底的候选队列（过滤会话内已失败的头像路径） */
    function buildSourceQueue(pet) {
        const iconUrl = String((pet && pet.iconUrl) || '').trim();
        const path = String((pet && pet.path) || '').trim();
        const queue = [];
        if (iconUrl && !unavailableIconPaths.has(iconUrl)) {
            queue.push(iconUrl);
        }
        if (path) {
            queue.push(path);
        }
        return queue;
    }

    /** 槽位的图片节点 = 直接子级里的第一个 <img>；没有就建一个 */
    function ensureImgEl(slotEl) {
        const children = slotEl.children || [];
        for (let index = 0; index < children.length; index += 1) {
            if (String(children[index].tagName).toUpperCase() === 'IMG') {
                return children[index];
            }
        }
        const imgEl = (slotEl.ownerDocument || document).createElement('img');
        imgEl.alt = '';
        slotEl.appendChild(imgEl);
        return imgEl;
    }

    function clearImage(imgEl, slotEl) {
        imgEl.onerror = null;
        imgEl.alt = '';
        delete imgEl.dataset.imageSignature;
        delete imgEl.dataset.currentSrc;
        imgEl.removeAttribute('src');
        slotEl.classList.remove('is-sprite-icon');
    }

    function assignImage(imgEl, slotEl, queue, fallbackSrc) {
        const sources = fallbackSrc ? queue.concat([String(fallbackSrc)]) : queue;
        const signature = JSON.stringify(sources);
        if (imgEl.dataset.imageSignature === signature) {
            return;
        }

        if (sources.length === 0) {
            imgEl.dataset.imageSignature = signature;
            clearImage(imgEl, slotEl);
            return;
        }

        imgEl.dataset.imageSignature = signature;
        let currentIndex = 0;

        const assignNext = () => {
            const nextSrc = sources[currentIndex];
            imgEl.dataset.currentSrc = nextSrc;
            slotEl.classList.toggle('is-sprite-icon', nextSrc.indexOf(SPRITE_ICON_RESOURCE_BASE) === 0);
            imgEl.src = nextSrc;
        };

        imgEl.onerror = () => {
            const failedSrc = imgEl.dataset.currentSrc || '';
            if (failedSrc.indexOf(SPRITE_ICON_RESOURCE_BASE) === 0) {
                unavailableIconPaths.add(failedSrc);
            }
            currentIndex += 1;
            if (currentIndex >= sources.length) {
                imgEl.onerror = null;
                return;
            }
            assignNext();
        };

        assignNext();
    }

    /**
     * 把槽位渲染成精灵头像卡（增量：身份不变时只切状态 class，不重建 <img>）
     */
    function render(slotEl, options) {
        const opts = options || {};
        const pet = opts.pet || null;
        const name = String(opts.name !== undefined && opts.name !== null ? opts.name : displayNameOf(pet)).trim();
        const dead = opts.dead === true;

        // 类名整体重写，但槽位上页面自有类（组件保留字之外）原样保留
        const foreignClasses = [];
        const classList = slotEl.classList;
        for (let index = 0; index < classList.length; index += 1) {
            const cls = classList.item(index);
            if (cls && OWN_CLASSES.indexOf(cls) === -1) {
                foreignClasses.push(cls);
            }
        }
        const classes = ['petsicon', pet ? 'is-active' : 'is-empty'];
        if (dead) {
            classes.push('is-dead');
        }
        slotEl.className = classes.concat(foreignClasses).join(' ');

        if (!pet) {
            delete slotEl.dataset.petsiconKey;
            clearImage(ensureImgEl(slotEl), slotEl);
            return;
        }

        if (slotEl.dataset.petsiconKey !== spriteKeyOf(pet, name)) {
            slotEl.dataset.petsiconKey = spriteKeyOf(pet, name);
            // 身份变化才换 <img>（旧节点连带 src/onerror/签名一起丢弃）
            ensureImgEl(slotEl).remove();
            const imgEl = (slotEl.ownerDocument || document).createElement('img');
            imgEl.alt = '';
            slotEl.appendChild(imgEl);
        }

        const imgEl = ensureImgEl(slotEl);
        imgEl.alt = name;
        assignImage(imgEl, slotEl, buildSourceQueue(pet), opts.fallbackSrc);
    }

    /** 新建一个精灵头像卡元素 */
    function create(options) {
        const slotEl = document.createElement('div');
        slotEl.className = 'petsicon';
        const imgEl = document.createElement('img');
        imgEl.alt = '';
        slotEl.appendChild(imgEl);
        render(slotEl, options);
        return slotEl;
    }

    global.Petsicon = {
        render: render,
        create: create,
        SPRITE_ICON_RESOURCE_BASE: SPRITE_ICON_RESOURCE_BASE,
    };
})(typeof window !== 'undefined' ? window : this);
