/* ═══════════════════════════════════════════════════
   TIMELINE — Reddit-style scrollable feed
   ═══════════════════════════════════════════════════ */
const Timeline = (() => {
  let container;
  let items = [];
  let showCount = 35;

  function init(el) { container = el; }

  function setItems(arr) {
    items = arr;
    showCount = 35;
    render();
  }

  /* ── Helpers ─────────────────────────────────────── */
  function timeAgo(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return Math.floor(s) + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  function fmtScore(n) {
    if (n == null) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  /* ── Render ──────────────────────────────────────── */
  function render() {
    const slice = items.slice(0, showCount);

    container.innerHTML = slice.map((item, idx) => `
      <article class="feed-item" data-idx="${idx}">
        <div class="feed-score">
          ${fmtScore(item.score)}
          <small>▲ pts</small>
        </div>
        <div class="feed-body">
          <div class="feed-title">${esc(item.title)}</div>
          <div class="feed-meta">
            <span class="feed-source">${esc(item.sourceDetail || item.source)}</span>
            <span class="feed-category">${item.category || ''}</span>
            <span>${timeAgo(item.created)} ago</span>
            <span>💬 ${item.comments ?? 0}</span>
            <span>${esc(item.domain || '')}</span>
            ${Store.isBookmarked(item.id) ? '<span class="feed-bookmark">★</span>' : ''}
          </div>
        </div>
        ${item.thumbnail
          ? `<img class="feed-thumb" src="${esc(item.thumbnail)}" loading="lazy" onerror="this.style.display='none'" alt="">`
          : ''}
      </article>
    `).join('');

    // Click handlers
    container.querySelectorAll('.feed-item').forEach(el => {
      el.addEventListener('click', () => {
        const i = parseInt(el.dataset.idx);
        if (items[i]) App.showDetail(items[i]);
      });
    });

    // Load-more button
    const btn = document.getElementById('feed-load-more');
    const loading = document.getElementById('feed-loading');
    if (loading) loading.classList.add('hidden');

    if (showCount < items.length) {
      btn.classList.remove('hidden');
      btn.onclick = () => { showCount += 35; render(); };
    } else {
      btn.classList.add('hidden');
    }
  }

  return { init, setItems };
})();
