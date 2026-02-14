/* ═══════════════════════════════════════════════════
   WORLD MAP — Canvas globe with news geo-markers
   Simplified continent polygons + city geocoding
   ═══════════════════════════════════════════════════ */
const WorldMap = (() => {
  let canvas, ctx;
  let items = [];
  let markers = [];          // { item, lng, lat, _x, _y }
  let hoveredItem = null;
  let animId = null;
  let pulse = 0;
  let dpr = 1, W = 0, H = 0;

  /* ── Continent Outlines [lng, lat] ──────────────── */
  const LAND = [
    // North America
    [[-140,60],[-130,66],[-125,72],[-100,73],[-85,73],[-80,68],[-65,60],[-58,48],
     [-66,44],[-70,43],[-75,35],[-82,29],[-88,30],[-96,26],[-105,20],[-100,16],
     [-92,15],[-88,14],[-83,8],[-78,8],[-76,18],[-81,22],[-82,26],[-75,30],
     [-72,35],[-66,44],[-60,47],[-56,52],[-58,55],[-65,58],[-78,62],[-93,65],
     [-108,70],[-125,73],[-140,68],[-140,60]],
    // South America
    [[-82,9],[-77,7],[-72,12],[-64,10],[-58,5],[-52,3],[-44,0],[-35,-4],
     [-35,-12],[-38,-16],[-41,-22],[-48,-28],[-50,-30],[-53,-33],[-56,-36],
     [-58,-40],[-65,-43],[-67,-47],[-68,-50],[-70,-54],[-73,-50],[-75,-45],
     [-73,-35],[-71,-30],[-70,-18],[-75,-14],[-77,-8],[-80,-3],[-80,2],[-77,6],[-82,9]],
    // Europe
    [[-10,36],[-9,38],[-9,43],[-4,44],[-2,47],[0,51],[-5,54],[-6,58],[4,58],
     [5,62],[10,64],[16,68],[20,70],[26,71],[32,70],[33,65],[30,58],[25,55],
     [23,50],[28,46],[26,41],[22,38],[15,38],[12,44],[8,46],[5,44],[3,43],
     [1,38],[-3,36],[-10,36]],
    // Africa
    [[-15,28],[-17,21],[-17,15],[-15,10],[-8,5],[3,5],[8,4],[10,1],[9,-3],
     [12,-6],[15,-11],[18,-16],[22,-22],[26,-26],[29,-31],[31,-34],[34,-34],
     [37,-26],[40,-16],[42,-10],[44,-4],[50,-12],[51,0],[48,5],[45,12],
     [43,12],[40,15],[36,33],[33,36],[28,35],[20,35],[10,37],[5,36],
     [0,35],[-5,35],[-10,33],[-15,28]],
    // Asia
    [[28,42],[30,45],[36,42],[40,40],[44,42],[48,40],[52,38],[55,42],[58,45],
     [60,50],[63,55],[68,58],[72,60],[80,62],[88,58],[95,55],[105,55],[115,52],
     [122,48],[128,42],[130,38],[128,33],[122,25],[118,22],[110,20],[105,15],
     [100,12],[98,8],[95,6],[88,20],[82,22],[78,15],[76,8],[72,18],[68,24],
     [65,26],[60,30],[55,33],[50,30],[48,29],[44,25],[42,14],[36,14],[34,30],
     [30,37],[28,42]],
    // India subcontinent
    [[68,24],[72,18],[76,8],[80,8],[85,15],[88,20],[90,22],[88,24],[82,22],
     [78,28],[72,28],[68,24]],
    // Australia
    [[115,-14],[120,-14],[128,-15],[133,-13],[137,-12],[142,-14],[146,-16],
     [150,-21],[153,-25],[153,-29],[150,-34],[148,-38],[143,-38],[138,-36],
     [132,-33],[128,-30],[125,-28],[120,-25],[116,-21],[114,-26],[115,-31],
     [115,-22],[113,-17],[115,-14]],
    // Greenland
    [[-55,60],[-50,62],[-45,65],[-40,69],[-35,73],[-25,76],[-20,78],[-19,80],
     [-26,82],[-36,83],[-46,82],[-51,80],[-55,78],[-55,75],[-53,72],[-55,68],[-55,60]],
    // UK + Ireland
    [[-10,50],[-6,50],[-5,52],[-3,54],[-5,56],[-3,58],[0,59],[0,61],[-3,59],
     [-6,57],[-8,54],[-10,52],[-10,50]],
    // Japan
    [[130,31],[132,33],[134,35],[137,37],[140,40],[142,43],[145,45],
     [144,43],[141,40],[138,36],[136,34],[133,32],[130,31]],
    // New Zealand
    [[166,-35],[168,-37],[173,-42],[175,-44],[174,-46],[172,-45],[169,-43],
     [167,-38],[166,-35]],
    // Indonesia (rough)
    [[96,5],[100,0],[105,-5],[110,-7],[115,-8],[120,-8],[125,-5],[130,-3],
     [135,-4],[140,-6],[141,-8],[138,-7],[133,-5],[128,-8],[122,-10],[116,-9],
     [110,-8],[106,-6],[100,-2],[96,2],[96,5]],
    // Madagascar
    [[44,-12],[48,-15],[50,-19],[50,-23],[48,-25],[45,-24],[43,-19],[43,-14],[44,-12]],
    // Scandinavia (peninsula)
    [[5,58],[8,58],[12,60],[14,64],[16,68],[20,70],[26,71],[28,69],[20,65],
     [18,63],[15,60],[10,58],[5,58]],
    // Arabian Peninsula
    [[36,14],[40,15],[42,14],[44,12],[48,16],[52,18],[55,22],[56,25],[52,23],
     [48,29],[44,25],[42,14],[36,14]],
    // Sri Lanka
    [[80,6],[81,7],[82,8],[82,6],[80,6]],
    // Taiwan
    [[120,22],[121,25],[122,25],[121,22],[120,22]],
    // Philippines (rough)
    [[117,7],[119,10],[121,14],[122,18],[122,14],[121,10],[119,7],[117,7]],
    // Korea
    [[126,34],[127,35],[129,36],[129,38],[128,40],[126,38],[126,34]],
    // Iceland
    [[-24,64],[-22,65],[-18,66],[-14,65],[-14,64],[-18,63],[-22,63],[-24,64]],
    // Cuba
    [[-85,22],[-82,23],[-78,22],[-75,20],[-78,20],[-82,21],[-85,22]]
  ];

  /* ── City Geocoding Database ────────────────────── */
  const GEO = {
    'new york':[-74,40.7],'washington':[-77,38.9],'los angeles':[-118.2,34],'chicago':[-87.6,41.9],
    'san francisco':[-122.4,37.8],'seattle':[-122.3,47.6],'miami':[-80.2,25.8],'boston':[-71.1,42.4],
    'houston':[-95.4,29.8],'atlanta':[-84.4,33.7],'denver':[-104.9,39.7],'detroit':[-83,42.3],
    'dallas':[-96.8,32.8],'phoenix':[-112,33.4],'philadelphia':[-75.2,40],
    'london':[0,51.5],'paris':[2.3,48.9],'berlin':[13.4,52.5],'madrid':[-3.7,40.4],
    'rome':[12.5,41.9],'moscow':[37.6,55.8],'amsterdam':[4.9,52.4],'brussels':[4.4,50.8],
    'vienna':[16.4,48.2],'warsaw':[21,52.2],'prague':[14.4,50.1],'zurich':[8.5,47.4],
    'stockholm':[18.1,59.3],'oslo':[10.8,59.9],'copenhagen':[12.6,55.7],'helsinki':[24.9,60.2],
    'dublin':[-6.3,53.3],'lisbon':[-9.1,38.7],'athens':[23.7,38],
    'tokyo':[139.7,35.7],'beijing':[116.4,39.9],'shanghai':[121.5,31.2],'hong kong':[114.2,22.3],
    'seoul':[127,37.6],'taipei':[121.5,25],'singapore':[103.8,1.4],'bangkok':[100.5,13.8],
    'mumbai':[72.9,19.1],'new delhi':[77.2,28.6],'jakarta':[106.8,-6.2],
    'sydney':[151.2,-33.9],'melbourne':[145,-37.8],'auckland':[174.8,-36.9],
    'dubai':[55.3,25.3],'istanbul':[29,41],'tel aviv':[34.8,32.1],'riyadh':[46.7,24.7],
    'cairo':[31.2,30],'lagos':[3.4,6.5],'nairobi':[36.8,-1.3],'cape town':[18.4,-34],
    'johannesburg':[28,-26.2],'casablanca':[-7.6,33.6],
    'são paulo':[-46.6,-23.6],'sao paulo':[-46.6,-23.6],'rio':[-43.2,-22.9],
    'buenos aires':[-58.4,-34.6],'mexico city':[-99.1,19.4],'bogota':[-74.1,4.6],
    'lima':[-77,-12],'santiago':[-70.7,-33.4],'toronto':[-79.4,43.7],'vancouver':[-123.1,49.3],
    'montreal':[-73.6,45.5],
    // Country-level fallbacks
    'ukraine':[32,49],'kyiv':[30.5,50.5],'russia':[90,62],'china':[105,35],
    'japan':[138,36],'india':[78,22],'brazil':[-52,-10],'australia':[134,-25],
    'canada':[-106,56],'germany':[10,51],'france':[2,46],'uk':[-2,54],
    'united kingdom':[-2,54],'britain':[-2,54],'england':[-1,52],
    'united states':[-98,38],'america':[-98,38],'usa':[-98,38],'u.s.':[-98,38],
    'europe':[15,50],'africa':[20,5],'asia':[100,35],'middle east':[45,30],
    'south korea':[128,36],'north korea':[127,40],'taiwan':[121,24],
    'pakistan':[70,30],'afghanistan':[67,33],'iran':[53,32],'iraq':[44,33],
    'syria':[38,35],'saudi arabia':[45,24],'turkey':[35,39],
    'israel':[35,31.5],'gaza':[34.5,31.5],'palestine':[35,32],'lebanon':[35.8,33.9],
    'poland':[20,52],'spain':[-4,40],'italy':[12,43],'greece':[22,39],
    'portugal':[-8,39.5],'sweden':[18,62],'norway':[10,62],'finland':[26,64],
    'switzerland':[8,47],'austria':[14,48],'netherlands':[5,52],'belgium':[4.4,50.8],
    'vietnam':[108,16],'philippines':[122,12],'indonesia':[117,-2],
    'malaysia':[102,4],'thailand':[101,14],'myanmar':[96,20],
    'nigeria':[8,10],'kenya':[38,0],'south africa':[25,-29],'ethiopia':[39,9],
    'egypt':[30,27],'morocco':[-6,32],'algeria':[3,28],'tunisia':[10,34],
    'libya':[17,27],'sudan':[30,15],'congo':[24,-3],
    'argentina':[-64,-34],'chile':[-71,-35],'colombia':[-74,4],'peru':[-76,-10],
    'venezuela':[-66,7],'mexico':[-102,23],'cuba':[-79,22],
    'new zealand':[174,-41],'iceland':[-19,65],'greenland':[-42,72],
    'scotland':[-4,57],'wales':[-3.5,52],'northern ireland':[-6,54.6],
    'crimea':[34,45],'donbas':[38,48],'kremlin':[37.6,55.8],
    'pentagon':[-77,38.9],'wall street':[-74,40.7],'silicon valley':[-122,37.4],
    'hollywood':[-118.3,34.1],'brussels':[4.4,50.8],'geneva':[6.1,46.2],
    'the hague':[4.3,52.1]
  };

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
    startAnim();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = canvas.parentElement.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ── Projection ──────────────────────────────────── */
  function proj(lng, lat) {
    const pad = 14;
    const x = pad + ((lng + 180) / 360) * (W - pad * 2);
    const y = pad + ((90 - lat) / 180) * (H - pad * 2);
    return [x, y];
  }

  /* ── Data ────────────────────────────────────────── */
  function setItems(arr) {
    items = arr;
    geocode();
  }

  function geocode() {
    markers = [];
    const used = new Set();
    items.forEach(item => {
      const text = (item.title + ' ' + (item.snippet || '')).toLowerCase();
      // Check longer names first for better matching
      const sortedNames = Object.keys(GEO).sort((a, b) => b.length - a.length);
      for (const name of sortedNames) {
        // Word boundary check - the name should be a standalone word
        const idx = text.indexOf(name);
        if (idx === -1) continue;
        // Ensure it's a word boundary (not middle of another word)
        const before = idx > 0 ? text[idx - 1] : ' ';
        const after = idx + name.length < text.length ? text[idx + name.length] : ' ';
        if (/[a-z]/.test(before) || /[a-z]/.test(after)) continue;

        const [lng, lat] = GEO[name];
        // Jitter to avoid overlap
        const key = item.id;
        if (used.has(key)) break;
        used.add(key);
        const jlng = lng + (Math.random() - 0.5) * 4;
        const jlat = lat + (Math.random() - 0.5) * 3;
        markers.push({ item, lng: jlng, lat: jlat, _x: 0, _y: 0 });
        break;
      }
    });
    document.getElementById('map-count').textContent = markers.length + ' locations tracked';
  }

  /* ── Animation ───────────────────────────────────── */
  function startAnim() {
    if (animId) return;
    const loop = () => { pulse += 0.025; draw(); animId = requestAnimationFrame(loop); };
    loop();
  }

  /* ── Draw ────────────────────────────────────────── */
  function draw() {
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(0,255,65,0.04)';
    ctx.lineWidth = 0.5;
    for (let lng = -180; lng <= 180; lng += 30) {
      const [x] = proj(lng, 0);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let lat = -60; lat <= 90; lat += 30) {
      const [, y] = proj(0, lat);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Equator
    ctx.strokeStyle = 'rgba(0,255,65,0.1)';
    ctx.setLineDash([3, 4]);
    const [, eqY] = proj(0, 0);
    ctx.beginPath(); ctx.moveTo(0, eqY); ctx.lineTo(W, eqY); ctx.stroke();
    ctx.setLineDash([]);

    // Prime meridian
    const [pmX] = proj(0, 0);
    ctx.strokeStyle = 'rgba(0,255,65,0.06)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(pmX, 0); ctx.lineTo(pmX, H); ctx.stroke();
    ctx.setLineDash([]);

    // Continents
    LAND.forEach(poly => {
      ctx.beginPath();
      poly.forEach(([lng, lat], i) => {
        const [x, y] = proj(lng, lat);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,255,65,0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,255,65,0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });

    // Markers
    markers.forEach((m, i) => {
      const [x, y] = proj(m.lng, m.lat);
      m._x = x; m._y = y;
      const p = Math.sin(pulse + i * 0.4) * 0.3 + 0.7;

      // Outer glow
      const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
      g.addColorStop(0, `rgba(0,255,65,${0.35 * p})`);
      g.addColorStop(1, 'rgba(0,255,65,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();

      // Core dot
      ctx.fillStyle = `rgba(0,255,65,${0.75 * p})`;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Hovered highlight
      if (hoveredItem && hoveredItem.id === m.item.id) {
        ctx.strokeStyle = '#00ff41';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(0,255,65,0.8)';
        ctx.font = '9px Courier New';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const lbl = m.item.title.length > 50 ? m.item.title.slice(0, 47) + '...' : m.item.title;
        ctx.fillText(lbl, x + 12, y - 3);
      }
    });

    // Legend
    ctx.fillStyle = 'rgba(0,255,65,0.15)';
    ctx.font = '8px Courier New';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('SENTINEL GLOBAL INTEL MAP', W - 10, H - 6);
  }

  /* ── Hit Testing ─────────────────────────────────── */
  function markerAt(mx, my) {
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      const dx = mx - m._x, dy = my - m._y;
      if (dx * dx + dy * dy < 256) return m;     // 16px radius
    }
    return null;
  }

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const hit = markerAt(mx, my);
    hoveredItem = hit ? hit.item : null;
    canvas.style.cursor = hit ? 'pointer' : 'crosshair';

    const tt = document.getElementById('map-tooltip');
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
    document.getElementById('map-tooltip').classList.add('hidden');
  }

  function onClick(e) {
    const r = canvas.getBoundingClientRect();
    const hit = markerAt(e.clientX - r.left, e.clientY - r.top);
    if (hit) App.showDetail(hit.item);
  }

  function onTouch(e) {
    e.preventDefault();
    const t = e.touches[0], r = canvas.getBoundingClientRect();
    const hit = markerAt(t.clientX - r.left, t.clientY - r.top);
    if (hit) App.showDetail(hit.item);
  }

  function destroy() {
    if (animId) cancelAnimationFrame(animId);
    window.removeEventListener('resize', resize);
  }

  return { init, setItems, resize, destroy };
})();
