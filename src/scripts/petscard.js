/**
 * petscard 精灵卡片组件 · 独立版（零依赖，浏览器直接引入）
 *
 * 用法：
 *   <link rel="stylesheet" href="petscard.css">
 *   <script src="petscard.js"></script>
 *   Petscard.render(document.body, {
 *     name: '迪莫', num: '1',
 *     image: 'assets/pets/3004_迪莫.png',   // 立绘或头像 URL，108×108 contain
 *     useIcon: false,                       // true = 头像（配合 side:'右' 水平镜像）
 *     side: '左',                            // 站位：'左' | '右'（头像+右 → 镜像）
 *     dead: false,                          // 阵亡态
 *     attributes: ['光'],                    // 属性1 匹配背景，属性2 追加徽章
 *     stat: { icon: 'assets/base-stats/sum.png', text: '582', highlight: true },
 *                                           // 可选：标签条改显 stat 图标+数值（highlight = 橙色），
 *                                           // 缺省回退显示 name；已渲染卡片用 Petscard.update 就地改序号/标签
 *   });
 *
 * 资源路径基准：Petscard.assetBase（默认 'assets'，相对页面；需要时可改为绝对/CDN 路径）
 *   {assetBase}/roco-bg/{属性}_T_BackGround_*.png   18 系属性背景纹理
 *   {assetBase}/attribute/{编号}.png                18 系属性图标
 */

(function (global) {
  'use strict';

  // ============ 卡面 Rectangle-01 形状（fill/stroke 由 CSS 控制） ============
  const FRAME = {
    vb: '0 0 122 150',
    d: 'M44.8438 0.500488L111.414 0.878418C116.776 0.90889 121.05 5.36784 120.854 10.7261L116.531 128.555C116.107 140.115 106.613 149.267 95.0459 149.267H10.001C4.65558 149.267 0.362138 144.859 0.503906 139.515L3.12305 40.8979C3.72266 18.3238 22.262 0.372379 44.8438 0.500488Z',
  };

  // ============ roco-bg 属性背景：属性名 → 纹理文件 + 三段渐变色（来源 wiki roco-bg） ============
  const ATTR_BG = {
    '普通': { file: '普通_T_BackGround_pu.png',    top: '#438ab2', light: '#6ca3c2', bot: '#346b8a' },
    '草':   { file: '草_T_BackGround_cao.png',    top: '#53bb76', light: '#78c994', bot: '#40915c' },
    '火':   { file: '火_T_BackGround_huo.png',    top: '#dd572a', light: '#e47b58', bot: '#ac4320' },
    '水':   { file: '水_T_BackGround_shui.png',   top: '#65aaff', light: '#86bcff', bot: '#4e84c6' },
    '光':   { file: '光_T_BackGround_guang.png',  top: '#4fc0ff', light: '#75cdff', bot: '#3d95c6' },
    '地':   { file: '地_T_BackGround_yan.png',    top: '#977c48', light: '#ad9870', bot: '#756038' },
    '冰':   { file: '冰_T_BackGround_bing.png',   top: '#66afd8', light: '#87c0e0', bot: '#4f88a8' },
    '龙':   { file: '龙_T_BackGround_long.png',   top: '#e64c62', light: '#eb7384', bot: '#b33b4c' },
    '电':   { file: '电_T_BackGround_dian.png',   top: '#e4c800', light: '#e9d438', bot: '#b19c00' },
    '毒':   { file: '毒_T_BackGround_du.png',     top: '#b967dd', light: '#c888e4', bot: '#9050ac' },
    '虫':   { file: '虫_T_BackGround_chong.png',  top: '#9fcc35', light: '#b4d761', bot: '#7c9f29' },
    '武':   { file: '武_T_BackGround_wu.png',     top: '#ff953f', light: '#ffac69', bot: '#c67431' },
    '翼':   { file: '翼_T_BackGround_yi.png',     top: '#46c7c9', light: '#6ed3d4', bot: '#369b9c' },
    '萌':   { file: '萌_T_BackGround_meng.png',   top: '#ff7eb1', light: '#ff9ac2', bot: '#c6628a' },
    '幽':   { file: '幽_T_BackGround_you.png',    top: '#934ee9', light: '#aa74ed', bot: '#723cb5' },
    '恶':   { file: '恶_T_BackGround_e.png',      top: '#cd497a', light: '#d87197', bot: '#9f385f' },
    '机械': { file: '机械_T_BackGround_jixie.png', top: '#30b8a3', light: '#5dc7b7', bot: '#258f7f' },
    '幻':   { file: '幻_T_BackGround_huan.png',   top: '#9dabff', light: '#b2bdff', bot: '#7a85c6' },
  };
  // 别名（与 wiki roco-bg-full.css 同款），缺省回落普通
  ATTR_BG['岩'] = ATTR_BG['未知'] = ATTR_BG['无'] = ATTR_BG['空'] = ATTR_BG['地'] || ATTR_BG['普通'];
  ATTR_BG['恶魔'] = ATTR_BG['恶'];
  const ATTR_BG_FALLBACK = ATTR_BG['普通'];

  // ============ 属性名 → 图标编号（assets/attribute/{编号}.png） ============
  const ATTR_NO = {
    '普通': '02', '草': '03', '火': '04', '水': '05', '光': '06', '地': '08',
    '冰': '09', '龙': '10', '电': '11', '毒': '12', '虫': '13', '武': '14',
    '翼': '15', '萌': '16', '幽': '17', '恶': '18', '机械': '19', '幻': '20',
  };

  const state = { assetBase: 'assets' };

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function attrIconUrl(name) {
    const no = ATTR_NO[name];
    return no ? state.assetBase + '/attribute/' + no + '.png' : '';
  }

  // 标签条内容：stat（图标+数值）优先，否则精灵名；超 6 字名字降为 10px
  function buildLabelElement(opts) {
    if (opts.stat && opts.stat.icon && opts.stat.text != null && String(opts.stat.text) !== '') {
      const tag = document.createElement('div');
      tag.className = 'petscard-tag' + (opts.stat.highlight ? ' is-highlight' : '');
      tag.innerHTML = `<img src="${esc(opts.stat.icon)}" alt=""><span class="petscard-tag-text">${esc(opts.stat.text)}</span>`;
      return tag;
    }
    const name = opts.name != null ? String(opts.name) : '';
    if (name === '') {
      return null;
    }
    const label = document.createElement('div');
    label.className = 'petscard-name';
    label.style.fontSize = (name.length > 6 ? 10 : 14) + 'px';
    label.textContent = name;
    return label;
  }

  /**
   * 就地更新一张已渲染卡片的序号与标签条（不重建卡片，精灵图不重载；
   * 供排名重排/标签切换时平移过渡使用）
   * @param {HTMLElement} card .petscard 根元素
   * @param {{ num?: string|number, name?: string, stat?: {icon: string, text: string|number, highlight?: boolean}|null }} opts
   */
  function update(card, opts) {
    opts = opts || {};
    const numEl = card.querySelector('.petscard-num');
    if (numEl && opts.num != null) {
      numEl.textContent = String(opts.num);
    }
    const mask = card.querySelector('.petscard-mask');
    if (!mask) {
      return;
    }
    const existing = mask.querySelector('.petscard-name, .petscard-tag');
    const next = buildLabelElement(opts);
    if (existing) {
      existing.remove();
    }
    if (next) {
      mask.appendChild(next);
    }
  }

  /**
   * 渲染一张精灵卡片
   * @param {HTMLElement|string} target 挂载容器（元素或选择器），卡片 append 进去
   * @param {{
   *   name?: string,            // 名字（超 6 字自动降为 10px）
   *   num?: string|number,      // 序号，默认 '1'
   *   image?: string,           // 精灵图 URL（立绘或头像），108×108 object-fit:contain
   *   useIcon?: boolean,        // true = 头像；配合 side:'右' 时水平镜像
   *   side?: '左'|'右',          // 站位，默认 '左'
   *   dead?: boolean,           // 阵亡态（卡面置灰/背景与图片减淡/名字变灰）
   *   attributes?: string[],    // 属性列表：属性1 匹配背景，前 2 个渲染徽章
   *   stat?: {icon: string, text: string|number, highlight?: boolean}|null,
   *                           // 标签条显示 stat 图标+数值（替代名字）；highlight = sum 橙色 #FFC65F，
   *                           // 缺省或数据为空回退显示名字
   * }} opts
   * @returns {HTMLElement} 卡片根元素（.petscard）
   */
  function render(target, opts) {
    opts = opts || {};
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) throw new Error('petscard: 挂载容器不存在');

    const name = opts.name != null ? String(opts.name) : '';
    const num = (opts.num != null && String(opts.num).trim() !== '') ? String(opts.num) : '1';
    const useIcon = !!opts.useIcon;
    const mirror = useIcon && opts.side === '右';
    const dead = !!opts.dead;
    const attrs = (opts.attributes || []).slice(0, 2);
    const bg = (attrs[0] && ATTR_BG[attrs[0]]) || ATTR_BG_FALLBACK;

    const card = document.createElement('div');
    card.className = 'petscard' + (dead ? ' is-dead' : '');

    const attrHtml = attrs.map((el, i) => {
      const url = attrIconUrl(el);
      return `<div class="petscard-attr a${i + 1}">${url ? `<img src="${esc(url)}" alt="${esc(el)}">` : ''}</div>`;
    }).join('');

    card.innerHTML = `
      <svg class="petscard-frame" viewBox="${FRAME.vb}"><path d="${FRAME.d}"/></svg>
      <div class="petscard-num">${esc(num)}</div>
      <div class="petscard-mask" style="--pc-top:${bg.top};--pc-light:${bg.light};--pc-bot:${bg.bot};--pc-pattern:url('${esc(state.assetBase + '/roco-bg/' + bg.file)}')">
        <div class="petscard-bg"><div class="petscard-bg-pattern"></div><div class="petscard-bg-fade"></div></div>
        ${opts.image ? `<img class="petscard-pet${mirror ? ' is-flip' : ''}" src="${esc(opts.image)}" alt="${esc(name || '精灵')}">` : ''}
        ${attrHtml}
      </div>`;
    const mask = card.querySelector('.petscard-mask');
    const label = buildLabelElement(opts);
    if (label) {
      mask.appendChild(label);
    }

    host.appendChild(card);
    return card;
  }

  global.Petscard = { render, update, ATTR_BG, ATTR_NO, get assetBase() { return state.assetBase; }, set assetBase(v) { state.assetBase = String(v || 'assets'); } };
})(typeof window !== 'undefined' ? window : this);
