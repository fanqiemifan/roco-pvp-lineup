/**
 * petscard2 精灵卡片组件 · 独立版（需先引入 petscard.js 复用属性→背景/图标映射）
 *
 * 基准画布 214×238，opts.scale 整体缩放（transform，原点左上；布局盒不缩放）。
 * 层级：卡面 z0（Rectangle-03）← 蒙版 z1（Rectangle-04 clip-path，嵌套内容不超出）← 序号 z2
 *       ← 种族值条 z2 ← 属性圈 z3；蒙版内：属性背景 z0 / 精灵图 z1。
 *
 * 用法：
 *   <link rel="stylesheet" href="petscard2.css">
 *   <script src="petscard.js"></script>
 *   <script src="petscard2.js"></script>
 *   Petscard2.render(document.body, {
 *     num: '1',                             // 序号 1-12（双位数自动左移 3px）
 *     image: '/img/3004_迪莫.png',           // 立绘或头像 URL，226×226 Y0 水平居中
 *     useIcon: false,                       // true = 头像（配合 side:'右' 水平镜像）
 *     side: '左',                            // 站位：'左' | '右'
 *     dead: false,                          // 阵亡态（背景/精灵图/序号/属性图/种族值减淡）
 *     attributes: ['火', '翼'],              // 属性1 匹配背景，两枚属性圈
 *     stat: { icon: '/resources/base-stats/sum.png', text: '582', highlight: true },
 *                                           // 种族值条：sum 档图标 24×24 + 间隔 4px + 文字 #FFC65F，
 *                                           // 其余档图标 32×32 + 间隔 0 + 白字；缺省隐藏整条
 *     scale: 0.5047                         // 可选，整体缩放（阵容展示5 用 108×120）
 *   });
 *   Petscard2.update(card, { num, stat, dead })  // 就地改序号/种族值/阵亡态（不重建卡片）
 *
 * 资源路径基准：Petscard2.assetBase（默认 'assets'；展示页固定 '/resources'）
 *   {assetBase}/roco-bg/{属性}_T_BackGround_*.png   属性背景纹理（映射来自 Petscard.ATTR_BG）
 *   {assetBase}/attribute/{编号}.png                属性图标（映射来自 Petscard.ATTR_NO）
 * 形状源文件：src/assets/ui/petscard-Rectangle-03.svg（卡面 214×210）、
 *            src/assets/ui/petscard-Rectangle-04.svg（蒙版 202×198）
 */

(function (global) {
  'use strict';

  // ============ 卡面 Rectangle-03 形状（fill 由 CSS 控制） ============
  const FRAME = {
    vb: '0 0 214 210',
    d: 'M0 0H210L214 201L13 210L0 0Z',
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Petscard 未加载时的兜底背景（普通属性配色，与 petscard.js ATTR_BG 普通档一致）
  const FALLBACK_BG = { top: '#438ab2', light: '#6ca3c2', bot: '#346b8a' };

  const state = { assetBase: 'assets' };

  function el(tagName, className) {
    const node = document.createElement(tagName);
    if (className) {
      node.className = className;
    }
    return node;
  }

  function setSvgAttr(node, name, value) {
    node.setAttribute(name, value);
  }

  // 属性名 → 背景映射（复用 petscard 的 ATTR_BG；缺失回落普通档）
  function resolveAttrBg(name) {
    const petscard = global.Petscard;
    if (petscard && petscard.ATTR_BG) {
      return (name && petscard.ATTR_BG[name]) || petscard.ATTR_BG['普通'] || FALLBACK_BG;
    }
    return FALLBACK_BG;
  }

  // 属性名 → 图标 URL（复用 petscard 的 ATTR_NO；未知属性返回空串）
  function attrIconUrl(name) {
    const petscard = global.Petscard;
    const no = petscard && petscard.ATTR_NO ? petscard.ATTR_NO[name] : null;
    return no ? state.assetBase + '/attribute/' + no + '.png' : '';
  }

  // 种族值条内容：stat（图标+数值）齐备才构建，缺省返回 null（整条隐藏）
  function buildStatElement(stat) {
    if (!stat || !stat.icon || stat.text == null || String(stat.text) === '') {
      return null;
    }
    const tag = el('div', 'petscard2-stat' + (stat.highlight ? ' is-highlight' : ''));
    const icon = document.createElement('img');
    icon.src = String(stat.icon);
    icon.alt = '';
    const text = el('span', 'petscard2-stat-text');
    text.textContent = String(stat.text);
    tag.appendChild(icon);
    tag.appendChild(text);
    return tag;
  }

  function setStat(card, stat) {
    const existing = card.querySelector('.petscard2-stat');
    if (existing) {
      existing.remove();
    }
    const next = buildStatElement(stat);
    if (next) {
      card.appendChild(next);
    }
  }

  /**
   * 就地更新一张已渲染卡片的序号 / 种族值条 / 阵亡态（不重建卡片，精灵图不重载）
   * @param {HTMLElement} card .petscard2 根元素
   * @param {{ num?: string|number, stat?: {icon: string, text: string|number, highlight?: boolean}|null, dead?: boolean }} opts
   */
  function update(card, opts) {
    opts = opts || {};
    const numEl = card.querySelector('.petscard2-num');
    if (numEl && opts.num != null) {
      const text = String(opts.num);
      numEl.textContent = text;
      // 双位数序号整体左移 3px（CSS .petscard2-num.is-double）
      numEl.classList.toggle('is-double', text.length > 1);
    }
    if (opts.stat !== undefined) {
      setStat(card, opts.stat);
    }
    if (opts.dead !== undefined) {
      card.classList.toggle('is-dead', !!opts.dead);
    }
  }

  /**
   * 渲染一张精灵卡片
   * @param {HTMLElement|string} target 挂载容器（元素或选择器），卡片 append 进去
   * @param {{
   *   num?: string|number,      // 序号，默认 '1'（双位数自动左移 3px）
   *   name?: string,            // 仅用于精灵图 alt 文案
   *   image?: string,           // 精灵图 URL（立绘或头像），226×226 Y0 水平居中
   *   useIcon?: boolean,        // true = 头像；配合 side:'右' 时水平镜像
   *   side?: '左'|'右',          // 站位，默认 '左'
   *   dead?: boolean,           // 阵亡态（背景/精灵图/序号/属性图/种族值减淡）
   *   attributes?: string[],    // 属性列表：属性1 匹配背景，前 2 个渲染属性圈
   *   stat?: {icon: string, text: string|number, highlight?: boolean}|null,
   *                           // 种族值条（sum 高亮橙 #FFC65F）；缺省或数据为空整条隐藏
   *   scale?: number            // 整体缩放（transform，原点左上），默认 1
   * }} opts
   * @returns {HTMLElement} 卡片根元素（.petscard2）
   */
  function render(target, opts) {
    opts = opts || {};
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) throw new Error('petscard2: 挂载容器不存在');

    const num = (opts.num != null && String(opts.num).trim() !== '') ? String(opts.num) : '1';
    const useIcon = !!opts.useIcon;
    const mirror = useIcon && opts.side === '右';
    const dead = !!opts.dead;
    const attrs = (opts.attributes || []).slice(0, 2);
    const bg = resolveAttrBg(attrs[0]);

    const card = el('div', 'petscard2' + (dead ? ' is-dead' : ''));
    if (opts.scale != null && Number(opts.scale) !== 1) {
      card.style.setProperty('--pc2-scale', String(Number(opts.scale)));
    }

    // 卡面 Rectangle-03
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'petscard2-frame');
    setSvgAttr(svg, 'viewBox', FRAME.vb);
    const framePath = document.createElementNS(SVG_NS, 'path');
    setSvgAttr(framePath, 'd', FRAME.d);
    svg.appendChild(framePath);
    card.appendChild(svg);

    // 序号
    const numEl = el('div', 'petscard2-num' + (num.length > 1 ? ' is-double' : ''));
    numEl.textContent = num;
    card.appendChild(numEl);

    // 蒙版 Rectangle-04（clip-path 裁切，嵌套内容不超出）
    const mask = el('div', 'petscard2-mask');
    mask.style.setProperty('--pc2-top', bg.top);
    mask.style.setProperty('--pc2-light', bg.light);
    mask.style.setProperty('--pc2-bot', bg.bot);
    mask.style.setProperty('--pc2-pattern', `url('${state.assetBase}/roco-bg/${bg.file}')`);
    const bgEl = el('div', 'petscard2-bg');
    bgEl.appendChild(el('div', 'petscard2-bg-pattern'));
    bgEl.appendChild(el('div', 'petscard2-bg-fade'));
    mask.appendChild(bgEl);
    if (opts.image) {
      const pet = document.createElement('img');
      pet.className = 'petscard2-pet' + (mirror ? ' is-flip' : '');
      pet.src = String(opts.image);
      pet.alt = String(opts.name || '精灵');
      mask.appendChild(pet);
    }
    card.appendChild(mask);

    // 属性圈（a1 x0 / a2 x34，y182）
    attrs.forEach((name, index) => {
      const circle = el('div', 'petscard2-attr a' + (index + 1));
      const url = attrIconUrl(name);
      if (url) {
        const icon = document.createElement('img');
        icon.src = url;
        icon.alt = String(name);
        circle.appendChild(icon);
      }
      card.appendChild(circle);
    });

    // 种族值条
    const stat = buildStatElement(opts.stat);
    if (stat) {
      card.appendChild(stat);
    }

    host.appendChild(card);
    return card;
  }

  global.Petscard2 = {
    render,
    update,
    get assetBase() { return state.assetBase; },
    set assetBase(v) { state.assetBase = String(v || 'assets'); },
  };
})(typeof window !== 'undefined' ? window : this);
