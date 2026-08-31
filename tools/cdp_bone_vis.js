// cdp_bone_vis.js — 骨骼可见性实验：改成红色发光后截图分析
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const wsModule = await import(pathToFileURL('D:/OpenClaw/workplace/ar_forearm/node_modules/ws/index.js').href);
const WebSocket = wsModule.default;

const URL = 'http://127.0.0.1:8765/index.html?demo=1';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9396;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ud = mkdtempSync(join(tmpdir(), 'bonex-vis-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--user-data-dir=' + ud, '--no-first-run', '--window-size=420,840', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

(async () => {
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch { await sleep(500); }
  }
  const tab = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?` + encodeURIComponent(URL), { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
  const shot = async name => {
    await sleep(500);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.cwd(), name), Buffer.from(s.result.data, 'base64'));
    console.log('📸', name);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const s = await ev(`window.__boneGame ? window.__boneGame.state : -1`);
    if (s === 5 || s === 3) break;
  }
  await sleep(2500);
  const info = await ev(`(() => {
    const { skeleton } = window.__dbg;
    const mat = skeleton.children[0] && skeleton.children[0].material;
    let colorHex = null, matType = null;
    skeleton.traverse(o => { if (o.isMesh && !matType) { matType = o.material.type; colorHex = o.material.color ? o.material.color.getHexString() : null; } });
    return JSON.stringify({ pos: skeleton.position.toArray().map(v => +v.toFixed(4)), scale: +skeleton.scale.x.toFixed(6), matType, colorHex });
  })()`);
  console.log('骨骼状态:', info);
  /* 全部改为红色发光 */
  await ev(`(() => {
    const { skeleton } = window.__dbg;
    skeleton.traverse(o => {
      if (o.isMesh) {
        o.material.color.set(0xff0000);
        if (o.material.emissive) o.material.emissive.set(0xff0000);
        if ('emissiveIntensity' in o.material) o.material.emissiveIntensity = 0.9;
      }
    });
    return true;
  })()`);
  await shot('dbg_red.png');
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(ud, { recursive: true, force: true }), 1500); });
