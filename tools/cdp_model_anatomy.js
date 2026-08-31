// cdp_model_anatomy.js — 检查模型关键骨头的局部坐标（判断朝向/锚点）
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const wsModule = await import(pathToFileURL('D:/OpenClaw/workplace/ar_forearm/node_modules/ws/index.js').href);
const WebSocket = wsModule.default;

const URL = 'http://127.0.0.1:8765/index.html?demo=1';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9394;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ud = mkdtempSync(join(tmpdir(), 'bonex-anat-'));
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
    if (s >= 3) break;
  }
  /* 附身后 skeleton 有 scale/位置。为看原始朝向，先临时把 skeleton 重置为单位变换读局部坐标，再还原。 */
  const info = await ev(`(() => {
    const { skeleton } = window.__dbg;
    const keys = ['frontal_bone','mandible','atlas','body_of_sternum','left_clavicle','left_scapula','left_humerus','left_hip_bone','left_femur','left_patella','left_tibia','left_calcaneus','right_calcaneus','left_radius','left_ulna'];
    const out = {};
    for (const k of keys) {
      const m = skeleton.getObjectByName(k);
      if (m) {
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox;
        out[k] = { cx: +((b.min.x+b.max.x)/2).toFixed(3), cy: +((b.min.y+b.max.y)/2).toFixed(3), cz: +((b.min.z+b.max.z)/2).toFixed(3), minY: +b.min.y.toFixed(3), maxY: +b.max.y.toFixed(3) };
      } else out[k] = null;
    }
    return JSON.stringify({ bones: out });
  })()`);
  console.log(info);
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(ud, { recursive: true, force: true }), 1500); });
