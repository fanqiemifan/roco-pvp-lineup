#!/usr/bin/env node
/**
 * 后台设计契约体检（DS-lite）。
 *
 * 用法：npm run audit:ui
 *
 * 只做统计，不阻断构建：输出「现状 / 目标」，用来观察熵增有没有停下来。
 * 目标值来自设计契约评审（桌面《DS-lite设计契约-前后对比》），不是硬性门槛。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminDir = path.join(root, 'src', 'admin-antd');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(adminDir);
const read = (file) => fs.readFileSync(file, 'utf8');
const count = (text, re) => (text.match(re) ?? []).length;
const uniq = (list) => [...new Set(list)];

const cssFiles = files.filter((f) => f.endsWith('.css'));
const tsFiles = files.filter((f) => /\.tsx?$/.test(f));
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// tokens.css 是契约本身（系统层），不算存量债务；只统计仍在手写取值的样式
const systemCss = new Set([
  path.join(adminDir, 'tokens.css'),
  path.join(adminDir, 'ui', 'ui.css'),
]);
const debtCssFiles = cssFiles.filter((f) => !systemCss.has(f));
const css = stripComments(debtCssFiles.map(read).join('\n'));
const tsx = stripComments(tsFiles.map(read).join('\n'));
const notVar = (value) => !value.startsWith('var(');

const colors = uniq((css + tsx).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((c) => c.toLowerCase());
const fontSizes = uniq(css.match(/font-size:\s*([^;]+);/g)?.map((s) => s.replace(/font-size:\s*|;/g, '').trim()) ?? []);
const inlineFontSizes = uniq(tsx.match(/fontSize:\s*(\d+(?:\.\d+)?)/g)?.map((s) => s.replace(/fontSize:\s*/, '')) ?? []);
const radii = uniq((css.match(/border-radius:\s*([^;]+);/g)?.map((s) => s.replace(/border-radius:\s*|;/g, '').trim()) ?? []).filter(notVar));
const shadows = uniq((css.match(/box-shadow:\s*([^;]+);/g) ?? []).filter((s) => notVar(s.replace(/box-shadow:\s*|;/g, '').trim())));
const inlineStyles = count(tsx, /style=\{\{/g);
const inlineFontSizeHits = count(tsx, /fontSize:\s*12\b/g);
const cssLines = css.split('\n').length;
const decls = css.match(/[a-z-]+:\s*[^;{}]+;/g) ?? [];
const uniqueDecls = uniq(decls);
const antSelectors = count(css, /\.ant-/g);
const important = count(css, /!important/g);

// 无引用类名：模板字符串的动态前缀（如 `bracket-stage-group-${n}`）要保留，避免误报
const dynamicPrefixes = new Set(
  [...tsx.matchAll(/`([^`]*?)\$\{/g)]
    .map((m) => (m[1].split(/[\s"'`>]/).filter(Boolean).pop() ?? ''))
    .filter((p) => /^[a-zA-Z][\w-]*$/.test(p) && p.length >= 2),
);
const cssClassNames = uniq([...css.matchAll(/\.((?!ant-)[a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const deadClasses = cssClassNames.filter(
  (cls) => !tsx.includes(cls) && ![...dynamicPrefixes].some((p) => cls.startsWith(p)),
);

// 弹窗宽度：契约后只统计 MODAL_WIDTH.* 的档位；残留的裸数字额外计入，方便发现回潮
const widthKeys = new Set((tsx.match(/MODAL_WIDTH\.(\w+)/g) ?? []).map((s) => s.split('.')[1]));
const rawWidths = new Set(
  (tsx.match(/<Modal\b[\s\S]{0,400}?\bwidth=\{(\d+)\}/g) ?? []).map((s) => s.match(/width=\{(\d+)\}/)[1]),
);
const modalWidths = widthKeys.size + rawWidths.size;

// 自定义卡片容器：带 padding 的 border + 圆角 + 背景规则（chip / tile / 媒体框不算，它们本来就不该用 Surface）
const surfaceRules = (css.match(/(?:^|\n)([^{}]+)\{([^{}]+)\}/g) ?? []).filter((block) => {
  if (!/border-radius/.test(block) || !/background/.test(block) || !/(^|[;{\s])border[:\s]/.test(block)) return false;
  if (!/padding/.test(block)) return false;
  const selector = block.split('{')[0];
  return !/(chip|pill|tag|dot|badge|thumb|avatar|nav|item|row|slot|code|checkbox|button|stage-group|selected|hint)/.test(selector);
});

const rows = [
  ['唯一色值', colors.length, 24],
  ['CSS 字号档位', fontSizes.length, 8],
  ['内联字号档位', inlineFontSizes.length, 6],
  ['圆角档位', radii.length, 4],
  ['阴影档位', shadows.length, 3],
  ['内联 style 对象', inlineStyles, 60],
  ['内联 fontSize: 12', inlineFontSizeHits, 0],
  ['CSS 行数', cssLines, 2400],
  ['CSS 声明重复率', `${Math.round((1 - uniqueDecls.length / Math.max(decls.length, 1)) * 100)}%`, '≤ 40%'],
  ['无引用类名', deadClasses.length, 0],
  ['自定义卡片容器', surfaceRules.length, 6],
  ['antd 内部类引用', antSelectors, 15],
  ['!important', important, 0],
  ['Modal 宽度档位', modalWidths, 4],
];

const pad = (value, width) => {
  const s = String(value);
  const visual = [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, width - visual));
};

console.log('\n后台设计契约体检 · src/admin-antd\n');
console.log(`${pad('指标', 22)}${pad('现状', 10)}${pad('目标', 10)}`);
console.log('-'.repeat(46));
for (const [name, now, target] of rows) {
  console.log(`${pad(name, 22)}${pad(now, 10)}${pad(target, 10)}`);
}
console.log('\n提示：目标不是硬门槛，只用来判断趋势；新代码请走 src/theme.ts 与 tokens.css。\n');
