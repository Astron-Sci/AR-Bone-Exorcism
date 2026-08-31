// cdp_flight_verify.js — 飞行骨头位置数值验证
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const wsModule = await import(pathToFileURL('D:/OpenClaw/workplace/ar_forearm/node_modules/ws/index.js').href);
const WebSocket = wsModule.default;

const URL = 'http://127.0.0.1:8765/index.html?demo=1';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9409;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ud = mkdtempSync(join(tmpdir(), 'bonex-fv-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--user-data-dir=' + ud, '--no-first-run', '--window-size=420,840', 'about:blank'], { stdio: 'ignore' });

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
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const s = await ev(`window.__boneGame ? window.__boneGame.state : -1`);
    if (s === 5) break;
  }
  await sleep(500);
  await ev(`window.__boneGame.throwNow({x:0.1,y:0.15}); true`);
  await sleep(550);
  /* 读 flying 克隆的世界位置（scene 直接子节点的 mesh，非骨架内） */
  const out = await ev(`(() => {
    const { scene } = window.__dbg;
    const flyingMesh = scene.children.find(o => o.isMesh && o !== window.__dbg.skeleton && o.name && o.name !== 'aimRing' && o !== window.__dbg.rig && o.geometry && o.geometry.attributes.position.count > 100);
    const f = window.__boneGame.flying;
    return JSON.stringify({
      flying: f,
      cloneFound: !!flyingMesh,
      cloneName: flyingMesh ? flyingMesh.name : null,
      cloneWorld: flyingMesh ? [flyingMesh.position.x.toFixed(3), flyingMesh.position.y.toFixed(3), flyingMesh.position.z.toFixed(3)] : null,
      sceneMeshCount: scene.children.filter(o => o.isMesh).length,
    });
  })()`);
  console.log(out);
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(ud, { recursive: true, force: true }), 1500); });
