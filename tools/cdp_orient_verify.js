// cdp_orient_verify.js — 用矩阵乘局部顶点验证朝向（正确方法）
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const wsModule = await import(pathToFileURL('D:/OpenClaw/workplace/ar_forearm/node_modules/ws/index.js').href);
const WebSocket = wsModule.default;

const URL = 'http://127.0.0.1:8765/index.html?demo=1';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9403;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ud = mkdtempSync(join(tmpdir(), 'bonex-ov-'));
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
  /* 矩阵乘局部顶点：m4x4 列主序，局部点 (px,py,pz,1) */
  const out = await ev(`(() => {
    const s = window.__dbg.skeleton;
    s.updateMatrixWorld(true);
    const e = s.matrixWorld.elements;
    const xform = (px, py, pz) => {
      const x = e[0]*px + e[4]*py + e[8]*pz + e[12];
      const y = e[1]*px + e[5]*py + e[9]*pz + e[13];
      const z = e[2]*px + e[6]*py + e[10]*pz + e[14];
      return { x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3) };
    };
    const wpt = name => {
      const m = s.getObjectByName(name);
      if (!m) return null;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      return xform((b.min.x+b.max.x)/2, (b.min.y+b.max.y)/2, (b.min.z+b.max.z)/2);
    };
    const ls = wpt('left_scapula'), rs = wpt('right_scapula');
    const lz = wpt('left_zygomatic_bone'), rz = wpt('right_zygomatic_bone');
    const fr = wpt('frontal_bone'), oc = wpt('occipital_bone'), na = wpt('left_nasal_bone');
    return JSON.stringify({
      shoulders: { left: ls, right: rs, widthX: ls&&rs ? Math.abs(ls.x-rs.x).toFixed(3) : null, depthZ: ls&&rs ? Math.abs(ls.z-rs.z).toFixed(3) : null },
      zygomaZ: { left: lz && lz.z, right: rz && rz.z },
      frontalZ: fr && fr.z, occipitalZ: oc && oc.z, nasalZ: na && na.z,
    });
  })()`);
  console.log(out);
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(ud, { recursive: true, force: true }), 1500); });
