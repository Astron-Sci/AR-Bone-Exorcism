// cdp_matrix_dbg.js — 完整矩阵诊断
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const wsModule = await import(pathToFileURL('D:/OpenClaw/workplace/ar_forearm/node_modules/ws/index.js').href);
const WebSocket = wsModule.default;

const URL = 'http://127.0.0.1:8765/index.html?demo=1';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9399;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ud = mkdtempSync(join(tmpdir(), 'bonex-mx-'));
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
    if (s === 5 || s === 3) break;
  }
  await sleep(1500);
  const out = await ev(`(() => {
    const { skeleton } = window.__dbg;
    const ls = skeleton.getObjectByName('left_scapula');
    const rs = skeleton.getObjectByName('right_scapula');
    skeleton.updateMatrixWorld(true);
    return JSON.stringify({
      skeletonPos: skeleton.position.toArray().map(v=>+v.toFixed(3)),
      skeletonRot: { order: skeleton.rotation.order, x:+skeleton.rotation.x.toFixed(3), y:+skeleton.rotation.y.toFixed(3), z:+skeleton.rotation.z.toFixed(3) },
      skeletonScale: skeleton.scale.toArray().map(v=>+v.toFixed(6)),
      skeletonWorld: Array.from(skeleton.matrixWorld.elements).map(v=>+v.toFixed(3)),
      lsLocal: ls ? ls.position.toArray().map(v=>+v.toFixed(1)) : null,
      lsWorld: ls ? Array.from(ls.matrixWorld.elements).map(v=>+v.toFixed(3)) : null,
      rsWorld: rs ? Array.from(rs.matrixWorld.elements).map(v=>+v.toFixed(3)) : null,
      lsParent: ls ? ls.parent.name : null,
    });
  })()`);
  console.log(out);
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(ud, { recursive: true, force: true }), 1500); });
