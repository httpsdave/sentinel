/* ═══════════════════════════════════════════════════
   RADAR — Animated radar sweep with news blips
   ═══════════════════════════════════════════════════ */
const Radar = (() => {
  let canvas, ctx;
  let items = [];
  let blips = [];
  let angle = 0;
  let animId = null;
  let hoveredItem = null;
  let speedMul = 1;
  let dpr = 1;
  let W = 0, H = 0;                    // CSS dimensions

  /* ── Init ────────────────────────────────────────── */
  function init(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('touchstart', onTouch, { passive: false });
    start();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = canvas.parentElement.getBoundingClientRect();
    W = r.width;
    H = r.height;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function setSpeed(s) { speedMul = s === 'slow' ? 0.4 : s === 'fast' ? 2.2 : 1; }

  /* ── Data ────────────────────────────────────────── */
  function setItems(arr) {
    items = arr;
    rebuildBlips();
  }

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }

  function rebuildBlips() {
    blips = [];
    const now = Date.now();
    items.forEach(item => {
      const h = hash(item.id);
      const a = (h % 3600) / 3600 * Math.PI * 2;
      // radius: newer → center, older → edge
      const ageH = Math.max(0, (now - item.created) / 3600000);
      const r = Math.min(0.88, 0.08 + (ageH / 72) * 0.8);
      // size: engagement
      const eng = (item.score || 0) + (item.comments || 0);
      const size = Math.max(2.5, Math.min(10, 2.5 + Math.log10(eng + 1) * 2.5));
      blips.push({
        item, a, r, size,
        alpha: 0.25,
        lit: false,
        litAt: 0,
        _x: 0, _y: 0
      });
    });
  }

  /* ── Animation Loop ──────────────────────────────── */
  function start() { if (!animId) loop(); }
  function stop()  { if (animId) { cancelAnimationFrame(animId); animId = null; } }

  function loop() {
    update();
    draw();
    animId = requestAnimationFrame(loop);
  }

  function update() {
    angle += 0.007 * speedMul;
    if (angle > Math.PI * 2) angle -= Math.PI * 2;

    const now = Date.now();
    blips.forEach(b => {
      let diff = angle - b.a;
      if (diff < 0) diff += Math.PI * 2;
      if (diff < 0.12) {
        b.lit = true;
        b.litAt = now;
        b.alpha = 1;
      } else if (b.lit) {
        const fade = (now - b.litAt) / 4000;
        b.alpha = Math.max(0.2, 1 - fade);
        if (fade >= 1) b.lit = false;
      }
    });
  }

  function draw() {
    if (!W || !H) return;
    const cx = W / 2, cy = H / 2;
    const maxR = Math.min(cx, cy) - 16;
    ctx.clearRect(0, 0, W, H);

    // BG
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Concentric rings
    for (let i = 1; i <= 4; i++) {
      ctx.strokeStyle = `rgba(0,255,65,${0.06 + i * 0.01})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * i / 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cross hairs
    ctx.strokeStyle = 'rgba(0,255,65,0.07)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy);
    ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR);
    ctx.stroke();

    // Diagonal cross
    ctx.strokeStyle = 'rgba(0,255,65,0.04)';
    ctx.beginPath();
    const d = maxR * 0.707;
    ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d);
    ctx.stroke();

    // Range labels
    ctx.fillStyle = 'rgba(0,255,65,0.18)';
    ctx.font = '8px Courier New';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ['6h', '18h', '36h', '72h'].forEach((lbl, i) => {
      ctx.fillText(lbl, cx + maxR * (i + 1) / 4 + 3, cy - 2);
    });

    // Cardinals
    ctx.fillStyle = 'rgba(0,255,65,0.22)';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('N', cx, cy - maxR - 12);
    ctx.textBaseline = 'bottom';
    ctx.fillText('S', cx, cy + maxR + 12);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('E', cx + maxR + 6, cy);
    ctx.textAlign = 'right';
    ctx.fillText('W', cx - maxR - 6, cy);

    // Sweep trail
    for (let i = 0; i < 40; i++) {
      const sa = angle - (i / 40) * 0.55;
      const alpha = (1 - i / 40) * 0.12;
      ctx.strokeStyle = `rgba(0,255,65,${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sa) * maxR, cy + Math.sin(sa) * maxR);
      ctx.stroke();
    }

    // Sweep line
    ctx.strokeStyle = 'rgba(0,255,65,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
    ctx.stroke();

    // Blips
    blips.forEach(b => {
      const x = cx + Math.cos(b.a) * (b.r * maxR);
      const y = cy + Math.sin(b.a) * (b.r * maxR);
      b._x = x; b._y = y;

      // Glow
      if (b.alpha > 0.35) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, b.size * 3);
        g.addColorStop(0, `rgba(0,255,65,${b.alpha * 0.25})`);
        g.addColorStop(1, 'rgba(0,255,65,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, b.size * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Dot
      ctx.fillStyle = `rgba(0,255,65,${b.alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, b.size, 0, Math.PI * 2);
      ctx.fill();

      // Hover ring
      if (hoveredItem && hoveredItem.id === b.item.id) {
        ctx.strokeStyle = '#00ff41';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, b.size + 5, 0, Math.PI * 2);
        ctx.stroke();
        // Label
        ctx.fillStyle = 'rgba(0,255,65,0.85)';
        ctx.font = '9px Courier New';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const lbl = b.item.title.length > 45 ? b.item.title.slice(0, 42) + '...' : b.item.title;
        ctx.fillText(lbl, x + b.size + 8, y - 2);
      }
    });

    // Center dot
    ctx.fillStyle = '#00ff41';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,255,65,0.3)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  /* ── Hit Testing ─────────────────────────────────── */
  function blipAt(mx, my) {
    for (let i = blips.length - 1; i >= 0; i--) {
      const b = blips[i];
      const dx = mx - b._x, dy = my - b._y;
      if (dx * dx + dy * dy < (b.size + 8) * (b.size + 8)) return b;
    }
    return null;
  }

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const hit = blipAt(mx, my);
    hoveredItem = hit ? hit.item : null;
    canvas.style.cursor = hit ? 'pointer' : 'crosshair';

    const tt = document.getElementById('radar-tooltip');
    if (hit) {
      tt.innerHTML = `<div>${hit.item.title}</div>
        <div class="tt-source">${hit.item.sourceDetail || hit.item.source}</div>
        <div class="tt-score">▲ ${hit.item.score || 0} · 💬 ${hit.item.comments || 0}</div>`;
      tt.classList.remove('hidden');
      let tx = mx + 14, ty = my - 10;
      if (tx + 280 > W) tx = mx - 290;
      if (ty + 60 > H) ty = my - 60;
      tt.style.left = tx + 'px';
      tt.style.top  = ty + 'px';
    } else {
      tt.classList.add('hidden');
    }
  }

  function onLeave() {
    hoveredItem = null;
    document.getElementById('radar-tooltip').classList.add('hidden');
  }

  function onClick(e) {
    const r = canvas.getBoundingClientRect();
    const hit = blipAt(e.clientX - r.left, e.clientY - r.top);
    if (hit) App.showDetail(hit.item);
  }

  function onTouch(e) {
    e.preventDefault();
    const t = e.touches[0], r = canvas.getBoundingClientRect();
    const hit = blipAt(t.clientX - r.left, t.clientY - r.top);
    if (hit) App.showDetail(hit.item);
  }

  function destroy() { stop(); window.removeEventListener('resize', resize); }

  return { init, setItems, setSpeed, start, stop, resize, destroy };
})();
