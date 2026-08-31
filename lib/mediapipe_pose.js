/* ═══════════ MediaPipe Pose 加载器（unpkg 优先，jsdelivr 兜底）═══════════ */
window.MPPoseLoader = (async function () {
  const sources = [
    { js: 'https://unpkg.com/@mediapipe/pose/pose.js', base: 'https://unpkg.com/@mediapipe/pose/' },
    { js: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js', base: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' },
  ];
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('load fail: ' + src));
      document.head.appendChild(s);
    });
  }
  for (const src of sources) {
    try {
      await loadScript(src.js);
      return { Pose: window.Pose, base: src.base };
    } catch (e) { /* 试下一个 */ }
  }
  return null;
})();
