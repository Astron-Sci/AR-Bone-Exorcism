// analyze_png.js — 像素统计：骨骼（白）、紫色、黑雾等
// 用法: node tools/analyze_png.js <file.png>
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.log('usage: node analyze_png.js <file>'); process.exit(1); }
const png = PNG.sync.read(readFileSync(file));
const { width: w, height: h, data } = png;
let white = 0, purple = 0, dark = 0, bone = 0, fog = 0, ring = 0;
const counts = {};
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
  // 白色/浅色骨骼
  if (r > 200 && g > 200 && b > 200) white++;
  // 紫色系（黑雾粒子 0x7a4ae0 / 爆散 0x7a3aff）
  if (r > 70 && r < 200 && b > 100 && g < 130 && Math.abs(r - b) < 90) purple++;
  // 环色（POOL_COLORS 亮色系）
  if (r > 150 || g > 150 || b > 150) {
    if (!(r > 200 && g > 200 && b > 200)) {
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
}
const total = w * h;
console.log(file);
console.log(`  尺寸 ${w}x${h}，白色像素 ${(white / total * 100).toFixed(2)}%（骨骼）`);
console.log(`  紫色像素 ${(purple / total * 100).toFixed(2)}%（黑雾/爆散）`);
const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log('  亮色簇:', top.map(([k, v]) => `${k}×${Math.round(v / total * 1000) / 10}%`).join(' '));
