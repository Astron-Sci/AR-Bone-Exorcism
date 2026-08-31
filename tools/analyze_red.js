// analyze_red.js — 红色像素分布分析（包围盒/分块密度）
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
const png = PNG.sync.read(readFileSync(process.argv[2]));
const { width: w, height: h, data } = png;
let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0;
const grid = 5, gc = Array.from({ length: grid }, () => Array(grid).fill(0));
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 120 && r > g * 1.6 && r > b * 1.4) {
      n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      gc[Math.floor(y / h * grid)][Math.floor(x / w * grid)]++;
    }
  }
}
console.log(`红色像素 ${n} (${(n / (w * h) * 100).toFixed(2)}%)`);
if (n > 0) {
  console.log(`包围盒 x:[${minX},${maxX}] (${((maxX - minX) / w * 100).toFixed(0)}%宽) y:[${minY},${maxY}] (${((maxY - minY) / h * 100).toFixed(0)}%高)`);
  console.log('分块密度(行=上→下, 列=左→右):');
  for (const row of gc) console.log('  ' + row.map(v => String(Math.round(v / (n / 100))).padStart(3)).join(' '));
}
