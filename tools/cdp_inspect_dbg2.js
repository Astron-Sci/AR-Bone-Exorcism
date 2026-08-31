// cdp_inspect_dbg2.js — 查看层渲染深查
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const wsModule = await import(pathToFileURL('D:/OpenClaw/workplace/ar_forearm/node_modules/ws/index.js').href);
const WebSocket = wsModule.default;

const URL = 'http://127.0.0.1:8765/index.html?demo=1&dbg=1';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9406;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ud = mkdtempSync(join(tmpdir(), 'bonex-isp2-'));
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
    if (m.method === 'Runtime.consoleAPICalled') console.log('📣', m.params.type, m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 150));
    if (m.method === 'Runtime.exceptionThrown') console.log('💥 EXC:', JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
  const shot = async name => {
    await sleep(500);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.cwd(), name), Buffer.from(s.result.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const s = await ev(`window.__boneGame ? window.__boneGame.state : -1`);
    if (s === 5 || s === 3) break;
  }
  await sleep(800);
  /* 暂停 demo 自动抛掷（避免干扰） */
  await ev(`window.__demoPaused = true; true`);
  await ev(`window.__boneGame.clickPouch(window.__boneGame.missing[0].en); true`);
  await sleep(1200);
  const info = await ev(`(() => {
    const { inspectScene, inspectBone, inspectRenderer, inspectCamera } = window.__dbg;
    if (!inspectScene) return 'no inspectScene';
    let meshCount = 0, matType = null, colorHex = null, geoType = null, posAttr = 0;
    inspectScene.traverse(o => {
      if (o.isMesh) {
        meshCount++;
        if (!matType) { matType = o.material ? o.material.type : 'null'; colorHex = o.material.color ? o.material.color.getHexString() : null; }
        if (!geoType) { geoType = o.geometry ? o.geometry.type : 'null'; posAttr = o.geometry.attributes.position ? o.geometry.attributes.position.count : 0; }
      }
    });
    return JSON.stringify({
      meshCount, matType, colorHex, geoType, posAttr,
      bonePos: inspectBone ? inspectBone.position.toArray().map(v => +v.toFixed(4)) : null,
      boneScale: inspectBone ? inspectBone.scale.toArray().map(v => +v.toFixed(5)) : null,
      renderCalls: inspectRenderer ? inspectRenderer.info.render.calls : 'no-renderer',
      camPos: inspectCamera ? inspectCamera.position.toArray().map(v => +v.toFixed(2)) : null,
    });
  })()`);
  console.log('inspect:', info);
  /* 强制红色发光再截图 */
  await ev(`(() => {
    const { inspectBone } = window.__dbg;
    if (inspectBone) inspectBone.traverse(o => { if (o.isMesh) { o.material.color.set(0xff0000); if (o.material.emissive) o.material.emissive.set(0xff0000); if ('emissiveIntensity' in o.material) o.material.emissiveIntensity = 1; } });
    return true;
  })()`);
  await shot('dbg_inspect_red.png');
  console.log('saved dbg_inspect_red.png');
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(ud, { recursive: true, force: true }), 1500); });
