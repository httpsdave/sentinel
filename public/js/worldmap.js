/* ═══════════════════════════════════════════════════
   WORLD MAP — Leaflet interactive map with dark tiles
   Real geography, zoom/pan, country names, timezone lines
   CartoDB Dark Matter tiles for terminal aesthetic
   ═══════════════════════════════════════════════════ */
const WorldMap = (() => {
  let map = null;
  let markerLayer = null;
  let items = [];
  let container = null;

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
    'hollywood':[-118.3,34.1],'geneva':[6.1,46.2],
    'the hague':[4.3,52.1]
  };

  /* ── Init ────────────────────────────────────────── */
  function init(el) {
    container = el;

    map = L.map(el, {
      center: [25, 10],
      zoom: 3,
      minZoom: 2,
      maxZoom: 14,
      zoomControl: true,
      attributionControl: false,
      worldCopyJump: false,
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1.0
    });

    // CartoDB Dark Matter — dark tiles with city/country labels
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
      noWrap: true,
      bounds: [[-90, -180], [90, 180]],
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
    }).addTo(map);

    // Attribution control
    L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(map);

    // Timezone lines overlay
    drawTimezoneLines();

    // Marker layer
    markerLayer = L.layerGroup().addTo(map);

    // Zoom control position
    map.zoomControl.setPosition('topright');

    // Legend
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<span class="legend-dot"></span> NEWS SIGNAL &nbsp; <span class="legend-line"></span> TIMEZONE';
      return div;
    };
    legend.addTo(map);
  }

  /* ── Timezone Lines ──────────────────────────────── */
  function drawTimezoneLines() {
    const tzGroup = L.layerGroup().addTo(map);

    for (let offset = -180; offset <= 165; offset += 15) {
      L.polyline(
        [[-80, offset], [80, offset]],
        { color: '#00ff41', weight: 0.4, opacity: 0.15, dashArray: '4,8', interactive: false }
      ).addTo(tzGroup);

      const hours = offset / 15;
      const label = hours === 0 ? 'UTC' : (hours > 0 ? `+${hours}` : `${hours}`);
      const icon = L.divIcon({
        className: 'tz-label',
        html: `<span>${label}</span>`,
        iconSize: [36, 14],
        iconAnchor: [18, 14]
      });
      L.marker([78, offset], { icon, interactive: false }).addTo(tzGroup);
    }
  }

  /* ── Data ────────────────────────────────────────── */
  function setItems(arr) {
    items = arr;
    plotMarkers();
  }

  function plotMarkers() {
    if (!markerLayer) return;
    markerLayer.clearLayers();
    const used = new Set();
    let placedCount = 0;

    items.forEach(item => {
      const text = (item.title + ' ' + (item.snippet || '')).toLowerCase();
      const sortedNames = Object.keys(GEO).sort((a, b) => b.length - a.length);

      for (const name of sortedNames) {
        const idx = text.indexOf(name);
        if (idx === -1) continue;
        const before = idx > 0 ? text[idx - 1] : ' ';
        const after = idx + name.length < text.length ? text[idx + name.length] : ' ';
        if (/[a-z]/.test(before) || /[a-z]/.test(after)) continue;

        const key = item.id;
        if (used.has(key)) break;
        used.add(key);

        const [lng, lat] = GEO[name];
        const jlng = lng + (Math.random() - 0.5) * 2;
        const jlat = lat + (Math.random() - 0.5) * 1.5;

        const size = Math.min(14, 4 + Math.log2((item.score || 1) + 1));

        const marker = L.circleMarker([jlat, jlng], {
          radius: size,
          fillColor: '#00ff41',
          fillOpacity: 0.4,
          color: '#00ff41',
          weight: 1.2,
          opacity: 0.7
        });

        const title = escHtml(item.title);
        const src = escHtml(item.sourceDetail || item.source);
        marker.bindPopup(
          `<div class="map-popup">
            <div class="map-popup-title">${title}</div>
            <div class="map-popup-meta">
              <span>${src}</span>
              <span>▲ ${item.score || 0} · 💬 ${item.comments || 0}</span>
            </div>
            <div class="map-popup-action">Click to view details ↗</div>
          </div>`,
          { className: 'sentinel-popup', maxWidth: 300, closeButton: false, autoPan: true }
        );

        marker.on('mouseover', function () { this.openPopup(); });
        marker.on('mouseout', function () { this.closePopup(); });
        marker.on('click', () => { App.showDetail(item); });

        markerLayer.addLayer(marker);
        placedCount++;
        break;
      }
    });

    const countEl = document.getElementById('map-count');
    if (countEl) countEl.textContent = placedCount + ' locations tracked';
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function resize() {
    if (map) setTimeout(() => map.invalidateSize(), 120);
  }

  function destroy() {
    if (map) { map.remove(); map = null; }
  }

  return { init, setItems, resize, destroy };
})();
