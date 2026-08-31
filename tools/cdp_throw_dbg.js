// cdp_throw_dbg.js — 抛掷命中调试
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const wsModule = await import(pathToFileURL('D:/OpenClaw/workplace/ar_forearm/node_modules/ws/index.js').href);
const WebSocket = wsModule.default;

const URL = 'http://127.0.0.1:8765/index.html?demo=1';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9390;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ud = mkdtempSync(join(tmpdir(), 'bonex-th-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--user-data-dir=' + ud, '--no-first-run', '--window-size=420,840', 'about:blank'], { stdio: 'ignore' });

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
    if (m.method === 'Runtime.exceptionThrown') console.log('💥 EXCEPTION:', JSON.stringify(m.params.exceptionDetails).slice(0, 600));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });

  /* 等附身+抛掷模式 */
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const s = await ev(`window.__boneGame ? window.__boneGame.state : -1`);
    if (s === 5) break;
    if (i > 38) { console.log('❌ 未进入抛掷模式'); process.exit(1); }
  }
  console.log('✅ 抛掷模式，当前骨:', await ev(`window.__boneGame.currentBone`));
  console.log('目标 NDC（第一块骨）:', JSON.stringify(await ev(`(() => { const g = window.__boneGame; return null; })()`)));

  /* 手动抛 3 次，观察结果 */
  for (let i = 0; i < 3; i++) {
    await ev(`window.__boneGame.throwNow({x:0,y:0.12}); true`);
    await sleep(2200);
    const r = await ev(`JSON.stringify(window.__boneGame.lastResult)`);
    const done = await ev(`window.__boneGame.missing[0].done`);
    console.log(`抛 ${i + 1} → lastResult:`, r, '| done:', done);
    if (done) break;
  }
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(ud, { recursive: true, force: true }), 1500); });
