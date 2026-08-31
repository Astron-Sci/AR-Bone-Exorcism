// cdp_render_dbg2.js — 检查场景内容与渲染统计
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const wsModule = await import(pathToFileURL('D:/OpenClaw/workplace/ar_forearm/node_modules/ws/index.js').href);
const WebSocket = wsModule.default;

const URL = 'http://127.0.0.1:8765/index.html?demo=1';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9392;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ud = mkdtempSync(join(tmpdir(), 'bonex-r2-'));
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
  await sleep(1500);
  const info = await ev(`(() => {
    const { scene, skeleton, renderer, camera } = window.__dbg;
    if (!skeleton) return 'no skeleton';
    let meshCount = 0, invisible = 0, firstMat = null, firstGeo = null;
    skeleton.traverse(o => {
      if (o.isMesh) {
        meshCount++;
        if (!o.visible) invisible++;
        if (!firstMat) firstMat = o.material ? (o.material.type || o.material.constructor.name) : 'null';
        if (!firstGeo) firstGeo = o.geometry ? o.geometry.type : 'null';
      }
    });
    return JSON.stringify({
      sceneChildren: scene.children.length,
      skeletonVisible: skeleton.visible,
      meshCount, invisible, firstMat, firstGeo,
      pos: { x: +skeleton.position.x.toFixed(3), y: +skeleton.position.y.toFixed(3), z: +skeleton.position.z.toFixed(3) },
      scale: { x: +skeleton.scale.x.toFixed(4), y: +skeleton.scale.y.toFixed(4), z: +skeleton.scale.z.toFixed(4) },
      rotY: +(skeleton.rotation.y).toFixed(3),
      renderCalls: renderer.info.render.calls,
      renderTris: renderer.info.render.triangles,
      camera: { fov: camera.fov, aspect: +camera.aspect.toFixed(3), near: camera.near, far: camera.far },
    });
  })()`);
  console.log('scene info:', info);
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(ud, { recursive: true, force: true }), 1500); });
