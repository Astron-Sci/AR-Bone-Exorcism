// cdp_render_dbg.js — 渲染状态检查
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const wsModule = await import(pathToFileURL('D:/OpenClaw/workplace/ar_forearm/node_modules/ws/index.js').href);
const WebSocket = wsModule.default;

const URL = 'http://127.0.0.1:8765/index.html?demo=1';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9391;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ud = mkdtempSync(join(tmpdir(), 'bonex-rnd-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--user-data-dir=' + ud, '--no-first-run', '--window-size=420,840', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

(async () => {
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch { await sleep(500); }
  }
  const tab = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?` + encodeURIComponent(URL), { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.method === 'Runtime.consoleAPICalled') console.log('📣', m.params.type, m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') console.log('💥 EXC:', JSON.stringify(m.params.exceptionDetails).slice(0, 400));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const s = await ev(`window.__boneGame ? window.__boneGame.state : -1`);
    if (s === 5 || s === 3) break;
  }
  console.log('state:', await ev(`window.__boneGame.state`));
  /* 从模块外部无法直接访问 skeleton（模块作用域），改用渲染层信息 */
  const info = await ev(`(() => {
    const c = document.querySelector('#three-container canvas');
    if (!c) return 'no canvas';
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'no gl context';
    return JSON.stringify({
      canvasW: c.width, canvasH: c.height, cssW: c.clientWidth, cssH: c.clientHeight,
      alpha: gl.getContextAttributes().alpha,
    });
  })()`);
  console.log('canvas:', info);
  /* 像素采样：three canvas 是否渲染了非透明内容 */
  const px = await ev(`(() => {
    const c = document.querySelector('#three-container canvas');
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return 'no ctx';
    const gl = ctx;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let nonTransparent = 0, nonBlack = 0, sample = [];
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3];
      if (a > 10) nonTransparent++;
      if (a > 10 && (buf[i] + buf[i+1] + buf[i+2]) > 60) nonBlack++;
    }
    const total = w * h;
    // 采样中心区域
    for (const [fx, fy] of [[0.5,0.5],[0.5,0.3],[0.5,0.7],[0.3,0.5],[0.7,0.5]]) {
      const x = Math.floor(fx*w), y = Math.floor(fy*h);
      const idx = (y*w + x) * 4;
      sample.push([fx, fy, buf[idx], buf[idx+1], buf[idx+2], buf[idx+3]]);
    }
    return JSON.stringify({ w, h, nonTransparent, nonBlack, total, sample });
  })()`);
  console.log('pixels:', px);
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(ud, { recursive: true, force: true }), 1500); });
