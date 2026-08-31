/* ═══════════════════════════════════════════════════════════════
   骨灵驱魔 AR · 主逻辑 game.js
   玩法：AR 摄像头 + MediaPipe Pose 识别人体 → 骷髅覆盖 → 
   黑雾吞噬 5 块骨头 → 查看手中骨 → 宝可梦GO式抛掷归位 → 驱魔成功
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

/* ─────────── 配置 ─────────── */
const GAME_TIME = 300;            // 一轮 300 秒
const GAME_VERSION = 'v2.0';     // 版本号（封面显示，更新时改这里）
const BONE_COUNT = 5;             // 每局缺失骨数量
const HIT_RADIUS = 0.14;          // 抛掷命中判定半径（NDC）
const PLANE_Z = -1.0;             // 游戏物体所在深度平面
const CAM_FOV = 62;               // 相机垂直视场（度）
const DEMO = new URLSearchParams(location.search).has('demo');
const MODEL_PATH = 'models/skeleton_draco.glb';
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 0;

/* ⚠️ 崩溃日志：页面被杀/报错前记录，便于诊断自动重载 */
try {
  window.addEventListener('error', e => {
    localStorage.setItem('bone_exorcism_err', JSON.stringify({ t: Date.now(), msg: String(e.message).slice(0, 200), src: (e.filename || '').slice(-60) }));
  });
  window.addEventListener('unhandledrejection', e => {
    localStorage.setItem('bone_exorcism_err', JSON.stringify({ t: Date.now(), msg: 'rejection: ' + String(e.reason).slice(0, 200) }));
  });
} catch (e) { /* ignore */ }

/* 缺失骨池：en=模型网格名, cn=中文名, hint=教学提示, c=目标色 */
const BONE_POOL = [
  { en: 'frontal_bone',        cn: '额骨',         hint: '构成颅前部，参与形成眶上缘与额窦' },
  { en: 'mandible',            cn: '下颌骨',       hint: '面部唯一能活动的骨，参与咀嚼运动' },
  { en: 'atlas',               cn: '寰椎(第1颈椎)', hint: '无椎体、无棘突，呈环形承托颅骨' },
  { en: 'axis',                cn: '枢椎(第2颈椎)', hint: '有齿突，与寰椎构成寰枢关节' },
  { en: 'body_of_sternum',     cn: '胸骨体',       hint: '胸骨中部长方形骨板，接第2~7肋软骨' },
  { en: 'xiphoid_process',     cn: '剑突',         hint: '胸骨下端薄而尖的小骨片' },
  { en: 'left_clavicle',       cn: '锁骨',         hint: '唯一直接与躯干骨构成关节的上肢骨' },
  { en: 'left_scapula',        cn: '肩胛骨',       hint: '贴于胸廓后外侧，参与肩关节构成' },
  { en: 'left_humerus',        cn: '肱骨',         hint: '上臂骨，上端有半球形肱骨头' },
  { en: 'left_radius',         cn: '桡骨',         hint: '前臂外侧骨，与拇指同侧' },
  { en: 'left_ulna',           cn: '尺骨',         hint: '前臂内侧骨，上端鹰嘴构成肘尖' },
  { en: 'left_hip_bone',       cn: '髋骨',         hint: '由髂骨、坐骨、耻骨融合而成' },
  { en: 'left_femur',          cn: '股骨',         hint: '人体最长最结实的长骨' },
  { en: 'left_tibia',          cn: '胫骨',         hint: '小腿内侧粗大的承重骨' },
  { en: 'left_fibula',         cn: '腓骨',         hint: '小腿外侧细长骨，不参与承重' },
  { en: 'left_patella',        cn: '髌骨',         hint: '人体最大的籽骨，位于膝关节前方' },
  { en: 'left_calcaneus',      cn: '跟骨',         hint: '足部最大最结实的跗骨，形成足跟' },
  { en: 'fourth_lumbar_vertebra', cn: '第4腰椎',   hint: '腰椎椎体粗大，负重最大' },
];
const POOL_COLORS = [0xff5d8f, 0xffb84d, 0x4dd4ff, 0xb48cff, 0x6bff9e, 0xff7de0, 0xffe14d];

/* ─────────── DOM ─────────── */
const $ = id => document.getElementById(id);
const video = $('video');
const poseCanvas = $('pose-canvas');
const pctx = poseCanvas.getContext('2d');

/* ─────────── 状态 ─────────── */
const ST = { IDLE: 0, SCANNING: 1, LOCKED: 2, POSSESSED: 3, INSPECTING: 4, THROWING: 5, WIN: 6, LOSE: 7 };
let state = ST.IDLE;
let poseLib = null;        // {Pose, base}
let pose = null;           // MediaPipe Pose 实例
let videoMirrored = false; // 前置摄像头 → CSS 镜像
let lastLandmarks = null;  // 最近一帧 Pose 关键点（原始归一化坐标）
let lockedLandmarks = null;// 扫描锁定的人
let skeleton = null;       // 骨骼模型组
let boneMeshes = {};       // 骨名 → Mesh
let modelHeight = 1, modelMinY = 0;
let missingBones = [];     // 本局缺失骨 [{en, cn, hint, color, mesh, fog}]
let currentBone = null;    // 正在抛掷的骨
let timeLeft = GAME_TIME;
let gameRunning = false;
let lastTs = 0;
let launchCount = 0;       // 调试：拖放次数
let lastThrowResult = null; // 调试：最近一次结果
let rigSmooth = { x: 0, y: 0, footY: -0.5, s: 1 };
let modelRotY = parseFloat(localStorage.getItem('bone_exorcism_roty') || 0);
let muted = false;
let sfx = null;

/* ─────────── 音频（WebAudio 合成）─────────── */
function initAudio() {
  if (sfx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  sfx = {
    ctx: new AC(),
    tone(freq, dur, type = 'sine', vol = 0.18, slide = 0) {
      if (muted) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    whoosh() { this.tone(300, 0.35, 'sawtooth', 0.07, 500); },
    ding()   { this.tone(880, 0.14, 'sine', 0.22); setTimeout(() => this.tone(1320, 0.22, 'sine', 0.2), 90); },
    buzz()   { this.tone(160, 0.25, 'square', 0.1, -60); },
    hit()    { this.tone(620, 0.1, 'triangle', 0.2); setTimeout(() => this.tone(930, 0.18, 'triangle', 0.18), 70); },
    fanfare() {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.28, 'triangle', 0.2), i * 130));
      setTimeout(() => this.tone(1568, 0.5, 'triangle', 0.16), 560);
    },
    lose() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'sine', 0.16), i * 160)); },
  };
}

/* ─────────── Three.js 主场景 ─────────── */
const renderer = new THREE.WebGLRenderer({ antialias: !IS_MOBILE, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_MOBILE ? 1 : 2)); // 手机降分辨率省内存
renderer.setSize(innerWidth, innerHeight);
$('three-container').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAM_FOV, innerWidth / innerHeight, 0.01, 10);
camera.position.set(0, 0, 0);
camera.lookAt(0, 0, -1);

/* 灯光（骨骼材质需要） */
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(0.6, 0.8, 1);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x8899ff, 1.1);
fillLight.position.set(-0.8, -0.3, 1);
scene.add(fillLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));

/* 坐标换算：NDC ↔ 世界（z=PLANE_Z 平面） */
const halfH = Math.tan((CAM_FOV * Math.PI) / 360);
const halfW = halfH * camera.aspect;
function ndcToWorld(x, y) {
  return new THREE.Vector3(x * halfW, y * halfH, PLANE_Z);
}
function worldToNdc(v) {
  return { x: v.x / halfW, y: v.y / halfH };
}

/* MediaPipe 归一化坐标 → 屏幕 NDC（cover 裁剪修正 + 镜像） */
function mpToNdc(x, y) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const cw = innerWidth, ch = innerHeight;
  const scale = Math.max(cw / vw, ch / vh);
  const dispW = vw * scale, dispH = vh * scale;
  const offX = (cw - dispW) / 2, offY = (ch - dispH) / 2;
  let dx = (x * dispW + offX) / cw;
  let dy = (y * dispH + offY) / ch;
  if (videoMirrored) dx = 1 - dx;
  return { x: dx * 2 - 1, y: -(dy * 2 - 1) };
}

/* 校准用外层组：绕世界 Y 轴旋转模型朝向 */
const rig = new THREE.Group();
scene.add(rig);

/* ─────────── 模型加载 ─────────── */
function loadModel() {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    /* Draco 解码器本地化（不走 CDN，手机加载快） */
    const draco = new DRACOLoader();
    draco.setDecoderPath('lib/draco/');
    loader.setDRACOLoader(draco);
    loader.load(MODEL_PATH, gltf => {
      skeleton = gltf.scene;
      rig.add(skeleton);
      skeleton.traverse(o => { if (o.isMesh) boneMeshes[o.name] = o; });
      /* BodyParts3D 坐标：X=左右、Y=前后（-Y=面部朝向）、Z=上下。
         XZY 顺序：先绕 Z 转 180°（前后翻转），再绕 X -90°（Z→Y 站直）。
         结果：肩宽水平、面部朝镜头、左右不镜像 */
      skeleton.rotation.order = 'XZY';
      skeleton.rotation.x = -Math.PI / 2;
      skeleton.rotation.z = Math.PI;
      rig.rotation.y = modelRotY;
      const box = new THREE.Box3().setFromObject(skeleton);
      modelHeight = box.getSize(new THREE.Vector3()).y;
      modelMinY = box.min.y;
      resolve();
    }, undefined, reject);
  });
}

/* ─────────── 摄像头 ─────────── */
async function startCamera() {
  if (DEMO) return; // 演示模式不请求摄像头
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: IS_MOBILE ? 640 : 1280 }, height: { ideal: IS_MOBILE ? 480 : 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  const track = stream.getVideoTracks()[0];
  const fm = track.getSettings().facingMode;
  videoMirrored = fm === 'user'; // 前置 → 镜像显示
  if (videoMirrored) video.style.transform = 'scaleX(-1)';
}

/* ─────────── MediaPipe Pose ─────────── */
async function initPose() {
  if (DEMO) return;
  const lib = await window.MPPoseLoader;
  if (!lib || !lib.Pose) throw new Error('Pose 库加载失败（网络问题）');
  poseLib = lib;
  pose = new lib.Pose({ locateFile: f => lib.base + f });
  pose.setOptions({
    modelComplexity: IS_MOBILE ? 0 : 1,   // 手机用 lite 模型省内存
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  pose.onResults(onPoseResults);
}

let frameCnt = 0;
function poseLoop() {
  if (DEMO) return;
  if (pose && video.readyState >= 2 && (state === ST.SCANNING || state === ST.POSSESSED)) {
    frameCnt++;
    if (frameCnt % 2 === 0) pose.send({ image: video }).catch(() => {});
  }
  requestAnimationFrame(poseLoop);
}

function onPoseResults(results) {
  if (!results.poseLandmarks || results.poseLandmarks.length === 0) {
    if (state === ST.POSSESSED) lastLandmarks = null;
    return;
  }
  lastLandmarks = results.poseLandmarks;
  if (state === ST.SCANNING) drawScan(results.poseLandmarks);
  if (state === ST.LOCKED && !lockedLandmarks) { /* 等确认 */ }
}

/* ─────────── 扫描绘制（火柴人轮廓）─────────── */
const POSE_BONES = [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[12,14],[14,16],[16,18],[16,20],[16,22],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[27,31],[24,26],[26,28],[28,30],[28,32]];
function drawScan(lm) {
  pctx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
  const pts = lm.map(p => {
    const n = mpToNdc(p.x, p.y);
    return { x: (n.x + 1) / 2 * poseCanvas.width, y: (1 - n.y) / 2 * poseCanvas.height };
  });
  pctx.strokeStyle = 'rgba(95,208,255,0.9)';
  pctx.lineWidth = 3;
  for (const [a, b] of POSE_BONES) {
    if (pts[a] && pts[b]) {
      pctx.beginPath(); pctx.moveTo(pts[a].x, pts[a].y); pctx.lineTo(pts[b].x, pts[b].y); pctx.stroke();
    }
  }
  /* 锁定光圈：标记躯干中心 */
  const sh = midPt(pts[11], pts[12]), hp = midPt(pts[23], pts[24]);
  const c = midPt(sh, hp);
  pctx.strokeStyle = '#ff5d8f';
  pctx.lineWidth = 2;
  pctx.setLineDash([8, 6]);
  pctx.beginPath(); pctx.arc(c.x, c.y, 34, 0, Math.PI * 2); pctx.stroke();
  pctx.setLineDash([]);
}
function midPt(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

/* ─────────── 骨骼对齐（跟随人体）─────────── */
function updateRig(dt) {
  if (!skeleton) return;
  const lm = state === ST.POSSESSED ? lastLandmarks : (state === ST.LOCKED ? lockedLandmarks : null);
  if (!lm) return;
  const n = i => mpToNdc(lm[i].x, lm[i].y);
  const sh = { x: (n(11).x + n(12).x) / 2, y: (n(11).y + n(12).y) / 2 };
  const hp = { x: (n(23).x + n(24).x) / 2, y: (n(23).y + n(24).y) / 2 };
  const ank = { x: (n(27).x + n(28).x) / 2, y: (n(27).y + n(28).y) / 2 };
  const hNdc = Math.hypot(sh.x - hp.x, sh.y - hp.y) * 3.6;   // 身高 ≈ 躯干×3.6
  const footY = ank.y - (ank.y - hp.y) * 0.1;
  const cx = (sh.x + hp.x) / 2;
  const cy = footY + hNdc / 2;
  const s = (hNdc * halfH) / modelHeight;                    // 世界缩放
  const k = Math.min(1, dt * 6);
  rigSmooth.x += (cx - rigSmooth.x) * k;
  rigSmooth.y += (cy - rigSmooth.y) * k;
  rigSmooth.footY += (footY - rigSmooth.footY) * k;
  rigSmooth.s += (s - rigSmooth.s) * k;
  rig.position.set(rigSmooth.x * halfW, rigSmooth.footY * halfH - modelMinY * rigSmooth.s, PLANE_Z);
  rig.scale.setScalar(rigSmooth.s);
}

/* ─────────── 附身：生成缺失骨 + 黑雾 ─────────── */
function possess() {
  state = ST.POSSESSED;
  gameRunning = true;
  timeLeft = GAME_TIME;
  /* 随机选 BONE_COUNT 块缺失骨 */
  const pool = [...BONE_POOL].sort(() => Math.random() - 0.5).slice(0, BONE_COUNT);
  missingBones = pool.map((b, i) => {
    const mesh = boneMeshes[b.en];
    const color = POOL_COLORS[i % POOL_COLORS.length];
    mesh.visible = false;
    const fog = createFog(mesh, color);
    skeleton.add(fog);
    return { ...b, color, mesh, fog, done: false };
  });
  buildPouch();
  updateRig(1); // 立即收敛对齐（避免首帧模型以原始尺寸闪现）
  $('scan-overlay').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('bone-pouch').classList.remove('hidden');
  $('btn-mute').classList.remove('hidden');
  updateTargets();
  sfx && sfx.whoosh();
  /* 演示模式直接进入第一块骨的抛掷；正常模式提示玩家查看骨袋 */
  if (DEMO) startThrow(missingBones[0]);
  else toast('👻 恶灵附身！5 块骨头被黑雾吞噬，点击下方骨袋查看');
}

/* 黑雾：黑球 + 粒子 + 光环（位置用网格局部包围盒中心，随 skeleton 一起变换） */
function createFog(mesh, color) {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const g = new THREE.Group();
  g.position.copy(center);
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(size * 0.5, 18, 14),
    new THREE.MeshBasicMaterial({ color: 0x120b22, transparent: true, opacity: 0.72, depthWrite: false })
  );
  const N = 110;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = size * (0.18 + Math.random() * 0.75);
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph) * 0.6;
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(pgeo, new THREE.PointsMaterial({
    color: 0x7a4ae0, size: 0.022, transparent: true, opacity: 0.9, depthWrite: false,
  }));
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(size * 0.45, size * 0.035, 8, 36),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false })
  );
  ring.rotation.x = Math.PI / 2.3;
  g.add(sphere, pts, ring);
  g.userData = { sphere, pts, ring, t: Math.random() * 10 };
  return g;
}

/* ─────────── 命中：黑雾消散 + 骨归位 ─────────── */
function exorcise(bone) {
  bone.done = true;
  bone.mesh.visible = true;
  hideGhost();
  const fog = bone.fog;
  const wp = fog.getWorldPosition(new THREE.Vector3());
  skeleton.remove(fog);
  explodeFog(fog, wp);           // 粒子爆散特效（在主场景）
  /* 金色归位闪光 */
  flashBone(bone.mesh, bone.color);
  sfx && sfx.hit();
  toast(`✅ ${bone.cn} 归位！`);
  addFloatText(`✨ ${bone.cn}`, bone.mesh.getWorldPosition(new THREE.Vector3()));
  updateTargets();
  updatePouch();
  /* 清除抛掷状态 */
  if (currentBone && currentBone.en === bone.en) {
    currentBone = null;
    exitThrowMode();
  }
  if (missingBones.every(b => b.done)) win();
}

function explodeFog(fog, worldPos) {
  const pos = worldPos || fog.position.clone();
  const N = 60;
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3);
  const v = [];
  for (let i = 0; i < N; i++) {
    const r = 0.06 + Math.random() * 0.14;
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
    v.push(new THREE.Vector3(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({ color: 0x7a3aff, size: 0.022, transparent: true, opacity: 0.95, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  const t0 = performance.now();
  const anim = () => {
    const t = (performance.now() - t0) / 1000;
    const arr = geo.attributes.position.array;
    for (let i = 0; i < N; i++) {
      arr[i * 3] = pos.x + v[i].x * t;
      arr[i * 3 + 1] = pos.y + v[i].y * t;
      arr[i * 3 + 2] = pos.z + v[i].z * t;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = Math.max(0, 0.95 - t * 1.2);
    if (t < 1) requestAnimationFrame(anim);
    else scene.remove(pts);
  };
  anim();
}

function flashBone(mesh, color) {
  const orig = mesh.material;
  const flash = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
  mesh.material = flash;
  const t0 = performance.now();
  const anim = () => {
    const t = (performance.now() - t0) / 1000;
    flash.opacity = 0.9 * Math.max(0, 1 - t * 1.4);
    if (t < 0.8) requestAnimationFrame(anim);
    else { mesh.material = orig; }
  };
  anim();
  /* 光环 */
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const c = box.getCenter(new THREE.Vector3());
  const sz = box.getSize(new THREE.Vector3()).length();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(sz * 0.6, sz * 0.04, 8, 36),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.position.copy(c);
  skeleton.add(ring);
  const a = () => {
    ring.rotation.z += 0.12;
    ring.scale.multiplyScalar(1.035);
    ring.material.opacity *= 0.94;
    if (ring.material.opacity > 0.05) requestAnimationFrame(a);
    else skeleton.remove(ring);
  };
  a();
}

/* ─────────── 拖放系统（按住骨头拖动到目标位置，松手归位）─────────── */
let targetMarker = null, dragGuide = null, dragBone = null, dragActive = false, ghostBone = null;

/* 目标虚影：在缺失骨头原位置显示半透明轮廓（拼图式引导） */
function showGhost(bone) {
  hideGhost();
  const src = bone.mesh;
  const clone = src.clone();
  clone.visible = true;
  clone.traverse(o => {
    if (o.isMesh) {
      o.visible = true;
      o.material = new THREE.MeshBasicMaterial({ color: 0xdbe6ff, transparent: true, opacity: 0.28, depthWrite: false });
    }
  });
  skeleton.add(clone);
  ghostBone = clone;
}
function hideGhost() {
  if (ghostBone) { skeleton.remove(ghostBone); ghostBone = null; }
}
function initDrag() {
  if (targetMarker) return;
  /* 目标标记：粉色脉冲圈（提示拖到哪） */
  targetMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.11, 32),
    new THREE.MeshBasicMaterial({ color: 0xff5d8f, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, depthTest: false })
  );
  targetMarker.rotation.x = -Math.PI / 2;
  targetMarker.frustumCulled = false;
  targetMarker.renderOrder = 999;
  scene.add(targetMarker);
  /* 引导线：拖动时从手指位置指向目标，靠近变绿 */
  dragGuide = new Line2(
    new LineGeometry(),
    new LineMaterial({
      color: 0x00e5ff, linewidth: 6, transparent: true, opacity: 1.0,
      dashed: true, dashSize: 0.06, gapSize: 0.04,
      resolution: new THREE.Vector2(innerWidth, innerHeight),
      depthTest: false,
    })
  );
  dragGuide.frustumCulled = false;
  dragGuide.renderOrder = 999;
  dragGuide.visible = false;
  scene.add(dragGuide);
}

function updateTargetMarker() {
  if (!targetMarker) return;
  if (state !== ST.THROWING || !currentBone) { targetMarker.visible = false; return; }
  const w = currentBone.mesh.getWorldPosition(new THREE.Vector3());
  const n = worldToNdc(w);
  if (Math.abs(n.x) < 0.92 && Math.abs(n.y) < 0.85) {
    targetMarker.position.set(w.x, w.y, w.z);
    targetMarker.visible = true;
    const s = 1 + Math.sin(performance.now() / 300) * 0.15;
    targetMarker.scale.setScalar(s);
  } else {
    targetMarker.visible = false;   // 目标出屏时由边缘箭头提示
  }
}

function startThrow(bone) {
  currentBone = bone;
  state = ST.THROWING;
  $('bone-pouch').classList.add('hidden');
  $('throw-mode').classList.remove('hidden');
  $('throw-ball-name').textContent = bone.cn;
  $('throw-ball-icon').textContent = '🦴';
  initDrag();
  showGhost(bone);
  updateTargets();
}

function exitThrowMode() {
  $('throw-mode').classList.add('hidden');
  $('bone-pouch').classList.remove('hidden');
  cancelDrag();
  hideGhost();
  if (state === ST.THROWING) state = ST.POSSESSED;
}

/* 开始拖动：半透明骨头跟随手指 */
function startDrag(ndc) {
  if (state !== ST.THROWING || !currentBone || dragActive) return;
  dragActive = true;
  sfx && sfx.whoosh();
  const src = currentBone.mesh;
  const clone = src.clone();
  clone.visible = true;
  clone.traverse(o => {
    if (o.isMesh) {
      o.visible = true;
      o.material = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.75, depthWrite: false, depthTest: false });
    }
  });
  /* 居中 + 缩放到手指可操控大小 */
  const boneWrap = new THREE.Group();
  clone.geometry.computeBoundingBox();
  const box = clone.geometry.boundingBox;
  const c = box.getCenter(new THREE.Vector3());
  clone.position.sub(c);
  boneWrap.add(clone);
  boneWrap.scale.setScalar(0.32 / Math.max(box.getSize(new THREE.Vector3()).length(), 0.01));
  scene.add(boneWrap);
  dragBone = boneWrap;
  moveDrag(ndc);
}

function moveDrag(ndc) {
  if (!dragActive || !dragBone) return;
  dragBone.position.copy(ndcToWorld(ndc.x, ndc.y));
  updateDragGuide(ndc);
}

function updateDragGuide(ndc) {
  if (!dragGuide || !currentBone) return;
  const w = currentBone.mesh.getWorldPosition(new THREE.Vector3());
  const tgt = worldToNdc(w);
  const dist = Math.hypot(ndc.x - tgt.x, ndc.y - tgt.y);
  const p0 = ndcToWorld(ndc.x, ndc.y);
  const p1 = ndcToWorld(Math.max(-0.95, Math.min(0.95, tgt.x)), Math.max(-0.95, Math.min(0.95, tgt.y)));
  dragGuide.geometry.setPositions([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z]);
  dragGuide.computeLineDistances();
  dragGuide.visible = true;
  dragGuide.material.color.set(dist < HIT_RADIUS * 1.6 ? 0x4dffa6 : 0x00e5ff);
}

/* 松手判定：位置在目标骨头附近 → 归位 */
function endDrag(ndc) {
  if (!dragActive) return;
  dragActive = false;
  const bone = currentBone;
  const w = bone.mesh.getWorldPosition(new THREE.Vector3());
  const tgt = worldToNdc(w);
  const dist = Math.hypot(ndc.x - tgt.x, ndc.y - tgt.y);
  const vis = Math.hypot(tgt.x, tgt.y) < 1.0;
  scene.remove(dragBone); dragBone = null;
  if (dragGuide) dragGuide.visible = false;
  if (vis && dist < HIT_RADIUS) {
    lastThrowResult = { hit: true, dist, bone: bone.cn };
    exorcise(bone);
  } else {
    lastThrowResult = { hit: false, dist, vis, bone: bone.cn };
    sfx && sfx.buzz();
    const diff = Math.round(dist * 100);
    addFloatText(`偏了 ${diff}%`, ndcToWorld(ndc.x, ndc.y), true);
    toast(`💨 没对准（差 ${diff}%），骨头回到骨袋`);
    currentBone = null;
    exitThrowMode();
    if (DEMO) startThrow(bone); else selectPouchBone(bone.en);
  }
}

function cancelDrag() {
  dragActive = false;
  if (dragBone) { scene.remove(dragBone); dragBone = null; }
  if (dragGuide) dragGuide.visible = false;
}

/* 屏幕浮动文字 */
function addFloatText(text, worldPos, isMiss = false) {
  const el = document.createElement('div');
  el.className = isMiss ? 'miss-float' : 'hit-float';
  el.textContent = text;
  document.body.appendChild(el);
  const pos = worldToNdc(worldPos);
  el.style.left = `${((pos.x + 1) / 2) * 100}%`;
  el.style.top = `${((1 - pos.y) / 2) * 100}%`;
  setTimeout(() => el.remove(), 1200);
}

/* ─────────── UI：骨袋 / 目标面板 ─────────── */
function buildPouch() {
  const wrap = $('pouch-slots');
  wrap.innerHTML = '';
  missingBones.forEach(b => {
    const d = document.createElement('div');
    d.className = 'pouch-slot';
    d.id = 'slot-' + b.en;
    d.innerHTML = `<div class="p-icon">🦴</div><div class="p-name">${b.cn}</div>`;
    d.onclick = () => selectPouchBone(b.en);
    wrap.appendChild(d);
  });
}
function selectPouchBone(en) {
  const b = missingBones.find(x => x.en === en);
  if (!b || b.done) return;
  openInspect(b);
}
function updatePouch() {
  missingBones.forEach(b => {
    const el = $('slot-' + b.en);
    if (el) el.classList.toggle('done', b.done);
  });
}
function updateTargets() {
  const list = $('target-list');
  list.innerHTML = '';
  const undone = missingBones.filter(b => !b.done);
  /* 当前目标：离屏幕中心最近的未完成骨 */
  let cur = null, bestD = 1e9;
  undone.forEach(b => {
    const w = b.mesh.getWorldPosition(new THREE.Vector3());
    const n = worldToNdc(w);
    const d = Math.hypot(n.x, n.y);
    if (d < bestD) { bestD = d; cur = b; }
  });
  missingBones.forEach(b => {
    const d = document.createElement('div');
    d.className = 'tgt-item' + (b.done ? ' done' : '') + (cur === b ? ' current' : '');
    d.innerHTML = `<span class="dot" style="background:#${b.color.toString(16).padStart(6,'0')}"></span><span class="nm">${b.cn}</span>`;
    list.appendChild(d);
  });
  updateDirHint(cur);
}
function updateDirHint(cur) {
  const hint = $('dir-hint');
  if (!cur) { hint.classList.add('hidden'); return; }
  const w = cur.mesh.getWorldPosition(new THREE.Vector3());
  const n = worldToNdc(w);
  hint.classList.remove('hidden');
  const inView = Math.abs(n.x) < 0.9 && Math.abs(n.y) < 0.85;
  if (inView) {
    $('dir-text').textContent = `目标在视野内：${cur.cn}`;
    $('dir-arrow').style.transform = 'scale(1)';
    $('dir-arrow').textContent = '👁';
  } else {
    const ang = Math.atan2(n.y, n.x);
    const r = 0.42;
    $('dir-arrow').textContent = '➤';
    $('dir-arrow').style.transform = `rotate(${(ang * 180) / Math.PI + 90}deg)`;
    const dir = ang < -Math.PI / 4 ? '左上方' : ang < Math.PI / 4 ? '右方' : ang < (3 * Math.PI) / 4 ? '下方' : '左方';
    const dirY = ang > -Math.PI / 4 && ang < Math.PI / 4 ? '右' : ang > Math.PI / 4 && ang < (3 * Math.PI) / 4 ? '下' : '左';
    const dirX = ang < -Math.PI / 4 && ang > (-3 * Math.PI) / 4 ? '上' : '';
    $('dir-text').textContent = `黑雾在${dirY}${dirX}方 → ${cur.cn}`;
  }
}

/* ─────────── 骨头查看层（3D 旋转确认）─────────── */
let inspectRenderer = null, inspectScene = null, inspectCamera = null, inspectControls = null, inspectBone = null, inspLight = null, inspectAutoRotate = false;
function openInspect(bone) {
  state = ST.INSPECTING;
  currentBone = bone;
  $('inspect-overlay').classList.remove('hidden');
  $('insp-cn').textContent = bone.cn;
  $('insp-en').textContent = bone.en;
  $('insp-desc').textContent = `💡 ${bone.hint}`;
  if (!inspectRenderer) {
    inspectRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    inspectRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    $('insp-canvas').appendChild(inspectRenderer.domElement);
    inspectScene = new THREE.Scene();
    inspectCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 10);
    inspectCamera.position.set(1.4, 0.9, 1.6);
    inspLight = new THREE.DirectionalLight(0xffffff, 1.8);
    inspLight.position.set(1, 1.5, 1.5);
    inspectScene.add(inspLight, new THREE.AmbientLight(0xffffff, 0.55));
  }
  const wrap = $('insp-canvas');
  inspectRenderer.setSize(wrap.clientWidth, wrap.clientHeight);
  inspectCamera.aspect = wrap.clientWidth / wrap.clientHeight;
  inspectCamera.updateProjectionMatrix();
  if (inspectControls) inspectControls.dispose();
  inspectControls = new OrbitControls(inspectCamera, inspectRenderer.domElement);
  inspectControls.enableDamping = true;
  inspectControls.enablePan = false;
  inspectControls.addEventListener('start', () => { inspectAutoRotate = false; });
  /* 克隆骨头（含子网格） */
  if (inspectBone) { inspectScene.remove(inspectBone); }
  const src = bone.mesh;
  const clone = src.clone();
  clone.visible = true;  // ⚠️ 缺失骨网格被隐藏，clone 会继承 visible=false，必须恢复
  clone.traverse(o => { if (o.isMesh) { o.visible = true; o.material = (o.material.clone ? o.material.clone() : o.material); } });
  /* ⚠️ clone() 会继承原网格的 matrixWorld（rig 缩放/平移后的世界矩阵），必须重置 */
  clone.position.set(0, 0, 0);
  clone.quaternion.identity();
  clone.scale.setScalar(1);
  clone.updateMatrix();
  /* 居中：Group 内先做局部居中（减几何中心），再整体缩放（避免 position 大数×小数不匹配） */
  const boneWrap = new THREE.Group();
  clone.geometry.computeBoundingBox();
  const box = clone.geometry.boundingBox;
  const c = box.getCenter(new THREE.Vector3());
  const sz = box.getSize(new THREE.Vector3()).length();
  clone.position.sub(c);
  boneWrap.add(clone);
  boneWrap.scale.setScalar(1.15 / Math.max(sz, 0.01));
  inspectScene.add(boneWrap);
  inspectBone = boneWrap;
  /* 自动旋转展示：无交互时骨头缓慢自转，方便看清全貌 */
  inspectAutoRotate = true;
  if (!inspRenderLoopRunning) inspRenderLoop();
}
let inspRenderLoopRunning = false;
function inspRenderLoop() {
  inspRenderLoopRunning = true;
  const loop = () => {
    if (!$('inspect-overlay').classList.contains('hidden')) {
      if (inspectControls) inspectControls.update();
      /* 无交互时自动旋转展示 */
      if (inspectAutoRotate && inspectBone) {
        inspectBone.rotation.y += 0.012;
        inspectBone.rotation.x = Math.sin(Date.now() / 4000) * 0.25;
      }
      if (inspectRenderer && inspectScene) inspectRenderer.render(inspectScene, inspectCamera);
      requestAnimationFrame(loop);
    } else { inspRenderLoopRunning = false; }
  };
  loop();
}

/* ─────────── 计时 / HP ─────────── */
function tick(dt) {
  if (!gameRunning || state === ST.WIN || state === ST.LOSE) return;
  timeLeft = Math.max(0, timeLeft - dt);
  const pct = timeLeft / GAME_TIME;
  const fill = $('hp-fill');
  fill.style.width = `${pct * 100}%`;
  fill.style.background = pct > 0.5 ? 'linear-gradient(90deg,#37e08a,#9be54e)' : pct > 0.25 ? 'linear-gradient(90deg,#f5b83d,#ffd76a)' : 'linear-gradient(90deg,#e05050,#ff7d6a)';
  $('hp-pct').textContent = `${Math.round(pct * 100)}%`;
  const m = Math.floor(timeLeft / 60), s = Math.floor(timeLeft % 60);
  $('timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  $('timer').style.color = timeLeft <= 60 ? '#ff6a6a' : '#fff';
  if (timeLeft <= 0) lose();
}

/* ─────────── 胜负 ─────────── */
function win() {
  gameRunning = false;
  state = ST.WIN;
  const secs = Math.round(GAME_TIME - timeLeft);
  sfx && sfx.fanfare();
  const recs = saveRecord(secs);
  const best = recs.reduce((m, r) => Math.min(m, r.s), 1e9);
  $('result-emoji').textContent = '🎉';
  $('result-title').textContent = '驱魔成功！';
  $('result-detail').textContent = `用时 ${fmtTime(secs)}（${secs} 秒）`;
  $('result-best').textContent = `🏆 历史最佳：${fmtTime(best)}`;
  $('result-history').innerHTML = '📜 驱魔记录：<br>' + recs.slice(-8).reverse().map(r => `${new Date(r.t).toLocaleString('zh-CN')} · ${fmtTime(r.s)} · ${r.bones.join('/')}`).join('<br>');
  $('result-overlay').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('bone-pouch').classList.add('hidden');
  $('throw-mode').classList.add('hidden');
}
function lose() {
  gameRunning = false;
  state = ST.LOSE;
  sfx && sfx.lose();
  $('result-emoji').textContent = '💀';
  $('result-title').textContent = '驱魔失败…';
  $('result-detail').textContent = '肉体被恶灵侵蚀殆尽';
  $('result-best').textContent = '';
  $('result-history').textContent = '提示：先查看骨头形态，再向黑雾方向甩出';
  $('result-overlay').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('bone-pouch').classList.add('hidden');
  $('throw-mode').classList.add('hidden');
}
function fmtTime(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function saveRecord(secs) {
  const recs = JSON.parse(localStorage.getItem('bone_exorcism_records') || '[]');
  recs.push({ t: Date.now(), s: Math.round(secs), bones: missingBones.map(b => b.cn) });
  localStorage.setItem('bone_exorcism_records', JSON.stringify(recs));
  return recs;
}

/* ─────────── 工具 ─────────── */
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}
function errToast(msg) {
  const el = $('err-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

/* ─────────── 主循环 ─────────── */
function animate(ts) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.1, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  /* 黑雾动画 */
  missingBones.forEach(b => {
    if (!b.fog || b.done) return;
    const u = b.fog.userData;
    u.t += dt;
    b.fog.rotation.y += dt * 0.8;
    b.fog.children[1].rotation.y -= dt * 1.6;
    b.fog.children[2].rotation.z += dt * 1.2;
    u.pts.material.opacity = 0.7 + Math.sin(u.t * 3) * 0.2;
  });
  updateRig(dt);
  if (state === ST.THROWING) updateTargetMarker();
  tick(dt);
  renderer.render(scene, camera);
}

/* ─────────── 扫描流程 ─────────── */
async function startScan() {
  state = ST.SCANNING;
  $('start-overlay').classList.add('hidden');
  $('scan-overlay').classList.remove('hidden');
  $('btn-mute').classList.remove('hidden');
  try {
    await startCamera();
  } catch (e) {
    errToast('摄像头不可用：' + (e.message || e));
  }
  try {
    await initPose();
  } catch (e) {
    errToast('Pose 库加载失败，请检查网络后刷新');
  }
  if (!DEMO) poseLoop();
  /* 演示模式：模拟一个人体 */
  if (DEMO) demoScanLoop();
  /* 扫描超时提示：12s 内没检测到人 */
  setTimeout(() => {
    if (state === ST.SCANNING && !lastLandmarks && !DEMO) {
      $('scan-msg').textContent = '😕 没检测到人体… 请调整位置/光线，或确认摄像头已授权';
    }
  }, 12000);
}

function lockTarget() {
  if (!lastLandmarks) return;
  lockedLandmarks = lastLandmarks;
  state = ST.LOCKED;
  pctx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
  $('scan-msg').textContent = '👻 恶灵已锁定此人！';
  /* 自动进入附身（等待 1.2s 让玩家看到锁定） */
  setTimeout(() => possess(), 1200);
}

/* 演示模式：模拟 Pose 结果（固定人形 + 缓慢晃动） */
function demoScanLoop() {
  const t = performance.now() / 1000;
  const sway = Math.sin(t * 0.8) * 0.012;
  const base = {
    0: [0.5 + sway, 0.24], 1: [0.5 + sway, 0.3], 2: [0.5 + sway, 0.35], 3: [0.5 + sway, 0.4],
    4: [0.5 + sway, 0.3], 5: [0.5 + sway, 0.35], 6: [0.5 + sway, 0.4],
    7: [0.5 + sway, 0.41], 8: [0.5 + sway, 0.42],
    9: [0.5 + sway, 0.5], 10: [0.5 + sway, 0.5],
    11: [0.44, 0.44], 12: [0.56, 0.44],
    13: [0.42, 0.52], 14: [0.58, 0.52],
    15: [0.40, 0.62], 16: [0.60, 0.62],
    17: [0.39, 0.72], 18: [0.61, 0.72],
    19: [0.40, 0.68], 20: [0.60, 0.68],
    21: [0.41, 0.66], 22: [0.59, 0.66],
    23: [0.45, 0.63], 24: [0.55, 0.63],
    25: [0.45, 0.78], 26: [0.55, 0.78],
    27: [0.46, 0.92], 28: [0.54, 0.92],
    29: [0.47, 0.94], 30: [0.53, 0.94],
    31: [0.46, 0.93], 32: [0.54, 0.93],
  };
  const lm = Object.entries(base).map(([i, v]) => ({ x: v[0], y: v[1], z: 0, visibility: 1 }));
  lastLandmarks = lm;
  if (state === ST.SCANNING) drawScan(lm);
  setTimeout(demoScanLoop, 120);
}

/* ─────────── 事件绑定 ─────────── */
$('btn-start').onclick = () => { initAudio(); startScan(); };
$('btn-demo').onclick = () => { initAudio(); location.href = location.pathname + '?demo=1'; };
$('btn-again').onclick = () => location.reload();

/* 骨头查看确认 → 抛掷 */
$('insp-close').onclick = closeInspect;
$('insp-confirm').onclick = () => {
  closeInspect();
  startThrow(currentBone);
};
function closeInspect() {
  $('inspect-overlay').classList.add('hidden');
  if (state === ST.INSPECTING) state = ST.POSSESSED;
}
$('throw-cancel').onclick = () => {
  exitThrowMode();
  if (currentBone) selectPouchBone(currentBone.en);
  currentBone = null;
};

/* 抛掷交互：按住骨球拖动甩出 */
const ball = $('throw-ball');
const ptToNdc = e => ({ x: (e.clientX / innerWidth) * 2 - 1, y: -((e.clientY / innerHeight) * 2 - 1) });
ball.addEventListener('pointerdown', e => {
  if (state !== ST.THROWING || dragActive) return;
  sfx && sfx.ensure && sfx.ensure();
  ball.setPointerCapture(e.pointerId);
  startDrag(ptToNdc(e));
  ball.classList.add('grabbed');
});
ball.addEventListener('pointermove', e => {
  if (!dragActive) return;
  moveDrag(ptToNdc(e));
});
ball.addEventListener('pointerup', e => {
  ball.classList.remove('grabbed');
  if (dragActive) endDrag(ptToNdc(e));
});
ball.addEventListener('pointercancel', () => { ball.classList.remove('grabbed'); cancelDrag(); });

/* 校准：旋转模型（每点 45°） */
window.addEventListener('keydown', e => {
  if (e.key === 'r' || e.key === 'R') {
    modelRotY = (modelRotY + Math.PI / 4) % (Math.PI * 2);
    rig.rotation.y = modelRotY;
    localStorage.setItem('bone_exorcism_roty', modelRotY);
    toast(`模型朝向旋转（${Math.round((modelRotY * 180) / Math.PI)}°），按 R 继续调`);
  }
});

/* 静音 */
$('btn-mute').onclick = () => {
  muted = !muted;
  $('btn-mute').textContent = muted ? '🔇' : '🔊';
};

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  poseCanvas.width = innerWidth; poseCanvas.height = innerHeight;
  if (dragGuide && dragGuide.material) dragGuide.material.resolution.set(innerWidth, innerHeight);
});

/* ─────────── 调试钩子（headless 测试用）─────────── */
window.__dbg = { get scene() { return scene; }, get skeleton() { return skeleton; }, get rig() { return rig; }, get renderer() { return renderer; }, get camera() { return camera; }, get inspectScene() { return inspectScene; }, get inspectBone() { return inspectBone; }, get inspectRenderer() { return inspectRenderer; }, get inspectCamera() { return inspectCamera; } };
window.__boneGame = {
  get state() { return state; },
  get ST() { return ST; },
  get missing() { return missingBones.map(b => ({ en: b.en, cn: b.cn, done: b.done })); },
  get timeLeft() { return timeLeft; },
  get currentBone() { return currentBone ? currentBone.cn : null; },
  get modelLoaded() { return !!skeleton; },
  get launchCount() { return launchCount; },
  get lastResult() { return lastThrowResult; },
  clickPouch(en) { selectPouchBone(en); },
  confirmInspect() { $('insp-confirm').click(); },
  closeInspect() { closeInspect(); },
  possessNow() { if (state === ST.SCANNING && lastLandmarks) lockTarget(); },
  /* 拖放测试辅助：模拟按住骨球拖到 (nx,ny)（NDC）松手 */
  dragTo(nx, ny) {
    if (state !== ST.THROWING || !currentBone) return false;
    startDrag({ x: 0, y: -0.72 });
    moveDrag({ x: nx, y: ny });
    endDrag({ x: nx, y: ny });
    return true;
  },
  /* 拖放到目标骨头位置（测试/演示辅助） */
  dragToTarget() {
    if (state !== ST.THROWING || !currentBone) return false;
    const w = currentBone.mesh.getWorldPosition(new THREE.Vector3());
    const n = worldToNdc(w);
    return this.dragTo(n.x, n.y);
  },
  get dragging() { return dragActive; },
};

/* ─────────── 启动 ─────────── */
(async function boot() {
  poseCanvas.width = innerWidth; poseCanvas.height = innerHeight;
  /* 封面版本号 */
  const verEl = $('game-version');
  if (verEl) verEl.textContent = GAME_VERSION;
  /* 崩溃诊断：上次页面异常时显示原因 */
  try {
    const lastErr = JSON.parse(localStorage.getItem('bone_exorcism_err') || 'null');
    if (lastErr && Date.now() - lastErr.t < 120000) {
      errToast('⚠️ 检测到上次页面异常：' + lastErr.msg);
    }
  } catch (e) { /* ignore */ }
  try {
    await loadModel();
    animate(0);
    if (DEMO) {
      /* 演示模式：跳过封面直接演示（完全手动操作，无自动抛掷） */
      $('start-overlay').classList.add('hidden');
      startScan();
      /* 2.5s 后自动锁定进入附身 */
      setTimeout(() => { if (state === ST.SCANNING && lastLandmarks) lockTarget(); }, 2500);
    }
  } catch (e) {
    console.error(e);
    errToast('初始化失败：' + (e.message || e));
  }
})();
