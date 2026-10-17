import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src/admin-antd');
const mapping = {
  420: 'sm',
  460: 'sm',
  520: 'sm',
  560: 'sm',
  600: 'md',
  640: 'md',
  720: 'md',
  760: 'md',
  860: 'lg',
  880: 'lg',
  900: 'lg',
  960: 'lg',
  980: 'lg',
  1080: 'xl',
  1120: 'xl',
  1400: 'xl',
};

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.tsx')) files.push(full);
  }
})(root);

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let changed = 0;
  for (const [px, key] of Object.entries(mapping)) {
    const needle = `width={${px}}`;
    if (!src.includes(needle)) continue;
    const count = src.split(needle).length - 1;
    src = src.split(needle).join(`width={MODAL_WIDTH.${key}}`);
    changed += count;
  }
  if (!changed) continue;

  let rel = path.relative(path.dirname(file), path.join(root, 'ui', 'modal')).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  if (!src.includes(`from '${rel}'`)) {
    const eol = src.includes('\r\n') ? '\r\n' : '\n';
    const lines = src.split(/\r?\n/);
    let insertAt = 0;
    lines.forEach((line, idx) => {
      if (/from\s+'[^']*';\s*$/.test(line)) insertAt = idx + 1;
    });
    lines.splice(insertAt, 0, `import { MODAL_WIDTH } from '${rel}';`);
    src = lines.join(eol);
  }
  fs.writeFileSync(file, src, 'utf8');
  console.log(`${path.relative(root, file)}: ${changed}`);
}
