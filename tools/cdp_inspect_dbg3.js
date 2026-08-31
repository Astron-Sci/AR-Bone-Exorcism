// cdp_inspect_dbg3.js — 手动 render + overlay 状态
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const wsModule = await import(pathToFileURL('D:/OpenClaw/workplace/ar_forearm/node_modules/ws/index.js').href);
const WebSocket = wsModule.default;

const URL = 'http://127.0.0.1:8765/index.html?demo=1';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9407;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ud = mkdtempSync(join(tmpdir(), 'bonex-isp3-'));
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
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const s = await ev(`window.__boneGame ? window.__boneGame.state : -1`);
    if (s === 5 || s === 3) break;
  }
  await sleep(800);
  await ev(`window.__boneGame.clickPouch(window.__boneGame.missing[0].en); true`);
  await sleep(1500);
  const out = await ev(`(() => {
    const { inspectScene, inspectRenderer, inspectCamera, inspectBone } = window.__dbg;
    const ov = document.getElementById('inspect-overlay');
    const before = inspectRenderer.info.render.calls;
    let err = null;
    try { inspectRenderer.render(inspectScene, inspectCamera); } catch (e) { err = String(e); }
    const after = inspectRenderer.info.render.calls;
    let visibleMesh = null;
    inspectScene.traverse(o => { if (o.isMesh) visibleMesh = { visible: o.visible, frustumCulled: o.frustumCulled, name: o.name }; });
    return JSON.stringify({
      overlayHidden: ov.classList.contains('hidden'),
      callsBefore: before, callsAfter: after, err,
      visibleMesh,
      bonePos: inspectBone ? inspectBone.position.toArray().map(v => +v.toFixed(3)) : null,
    });
  })()`);
  console.log(out);
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(ud, { recursive: true, force: true }), 1500); });
