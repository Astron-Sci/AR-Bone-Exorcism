// cdp_test.js — 骨灵驱魔 AR 全流程验证（demo 模式）+ 截图
// 用法：先起服务器 python -m http.server 8765，再 node tools/cdp_test.js
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const wsModule = await import(pathToFileURL('D:/OpenClaw/workplace/ar_forearm/node_modules/ws/index.js').href);
const WebSocket = wsModule.default;

const BASE = 'http://127.0.0.1:8765';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9388;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ud = mkdtempSync(join(tmpdir(), 'bonex-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--user-data-dir=' + ud, '--no-first-run', '--window-size=420,840', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

(async () => {
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch { await sleep(500); }
  }

  /* ═══ 1. 封面（非 demo）═══ */
  let tab = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?` + encodeURIComponent(BASE + '/index.html'), { method: 'PUT' })).json();
  let ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const shot = async (name) => {
    await sleep(500);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.cwd(), name), Buffer.from(s.result.data, 'base64'));
    console.log('📸', name);
  };
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  const waitState = async (pred, timeout = 30000, desc = '') => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await evalJs(pred);
      if (v) return v;
      await sleep(500);
    }
    throw new Error('超时等待: ' + desc);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/index.html' });
  await waitState(`document.getElementById('start-overlay') && !document.getElementById('start-overlay').classList.contains('hidden')`, 15000, '封面');
  await shot('shot_00_cover.png');
  ws.close();

  /* ═══ 2. 演示模式全流程 ═══ */
  tab = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?` + encodeURIComponent(BASE + '/index.html?demo=1'), { method: 'PUT' })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  id = 0; pend.clear();
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send2 = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs2 = async (expr) => {
    const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  const shot2 = async (name) => {
    await sleep(500);
    const s = await send2('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.cwd(), name), Buffer.from(s.result.data, 'base64'));
    console.log('📸', name);
  };
  const wait2 = async (pred, timeout = 30000, desc = '') => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await evalJs2(pred);
      if (v) return v;
      await sleep(500);
    }
    throw new Error('超时等待: ' + desc);
  };
  await send2('Runtime.enable');
  await send2('Page.enable');
  await send2('Page.navigate', { url: BASE + '/index.html?demo=1' });

  /* 等模型加载 + 附身 */
  await wait2(`window.__boneGame && window.__boneGame.modelLoaded`, 30000, '模型加载');
  console.log('✅ 模型加载完成');
  await wait2(`window.__boneGame && window.__boneGame.missing.length === 5 && (window.__boneGame.state === 3 || window.__boneGame.state === 5)`, 30000, '附身');
  const miss = await evalJs2(`JSON.stringify(window.__boneGame.missing.map(m=>m.cn))`);
  console.log('👻 缺失骨:', miss);
  await shot2('shot_01_possessed.png');

  /* 打开骨头查看层 */
  await evalJs2(`window.__boneGame.clickPouch(window.__boneGame.missing[0].en); true`);
  await wait2(`window.__boneGame.state === 4`, 10000, '查看层');
  await shot2('shot_02_inspect.png');

  /* 确认 → 抛掷模式 */
  await evalJs2(`window.__boneGame.confirmInspect(); true`);
  await wait2(`window.__boneGame.state === 5`, 10000, '抛掷模式');
  await shot2('shot_03_throw.png');

  /* 等待自动抛掷命中第 1 块（demo 每 4.5s 抛） */
  await wait2(`window.__boneGame.missing[0].done === true`, 25000, '自动抛掷命中');
  console.log('🎯 自动抛掷命中第 1 块');
  await shot2('shot_04_first_hit.png');

  /* 手动快速通关剩余骨头 */
  for (let i = 1; i < 5; i++) {
    const en = await evalJs2(`window.__boneGame.missing[${i}].en`);
    await evalJs2(`window.__boneGame.clickPouch('${en}'); true`);
    await sleep(600);
    await evalJs2(`if (window.__boneGame.state===4) window.__boneGame.confirmInspect(); true`);
    await wait2(`window.__boneGame.state === 5 || window.__boneGame.state === 6`, 10000, `进入抛掷 ${i}`);
    if (await evalJs2(`window.__boneGame.state`) === 6) break;
    await evalJs2(`window.__boneGame.throwNow({x:0,y:0.12}); true`);
    await wait2(`window.__boneGame.missing[${i}].done === true`, 10000, `命中 ${i}`);
    console.log(`🎯 命中第 ${i + 1} 块`);
  }

  /* 胜利 */
  await wait2(`window.__boneGame.state === 6`, 15000, '胜利');
  console.log('🏆 驱魔成功！通关用时：', await evalJs2(`window.__boneGame.timeLeft`), '剩余秒');
  await shot2('shot_05_win.png');

  /* 检查 localStorage 记录 */
  const recs = await evalJs2(`localStorage.getItem('bone_exorcism_records')`);
  console.log('📜 记录:', recs);
  ws.close();
})().catch(e => { console.error('❌ ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(ud, { recursive: true, force: true }), 1500); });
