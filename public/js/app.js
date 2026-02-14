/* ═══════════════════════════════════════════════════
   APP — Main controller: views, data, detail, settings
   ═══════════════════════════════════════════════════ */
const App = (() => {
  let currentView = 'radar';
  let allItems = [];
  let filteredItems = [];
  let currentCategory = 'all';
  let activeSources = new Set(['reddit', 'hackernews', 'rss', 'newsapi', 'guardian', 'wikinews']);
  let refreshTimer = null;
  let searchDebounce = null;
  let nextRefresh = 0;
  let refreshCountdown = null;

  /* ═══ INIT ═══════════════════════════════════════ */
  async function init() {
    // Modules
    Radar.init(document.getElementById('radar-canvas'));
    WorldMap.init(document.getElementById('map-container'));
    Timeline.init(document.getElementById('feed-list'));

    // Apply saved settings
    const cfg = Store.getSettings();
    if (!cfg.crtEffect) document.getElementById('crt-overlay').classList.add('off');
    document.getElementById('setting-crt').checked = cfg.crtEffect;
    document.getElementById('setting-refresh').value = cfg.refreshInterval;
    document.getElementById('setting-radar-speed').value = cfg.radarSpeed;
    Radar.setSpeed(cfg.radarSpeed);

    // Sound & country settings
    Radar.setSound(cfg.sound);
    document.getElementById('setting-sound').checked = cfg.sound;
    const muteBtn = document.getElementById('mute-btn');
    muteBtn.textContent = cfg.sound ? '🔊' : '🔇';
    document.getElementById('setting-country').value = cfg.country || 'auto';

    // ── Nav (desktop + mobile) ──
    document.querySelectorAll('.nav-btn, .mobile-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // ── Category filters ──
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCategory = btn.dataset.category;
        applyFilters();
      });
    });

    // ── Source toggles ──
    document.querySelectorAll('.source-toggle input').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.checked ? activeSources.add(cb.dataset.source) : activeSources.delete(cb.dataset.source);
        applyFilters();
      });
    });

    // ── Search ──
    document.getElementById('search-input').addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(applyFilters, 250);
    });

    // ── Refresh button ──
    document.getElementById('refresh-btn')?.addEventListener('click', loadFeed);

    // ── Settings panel ──
    document.getElementById('settings-btn')?.addEventListener('click', () => togglePanel('settings'));
    document.getElementById('settings-close')?.addEventListener('click', () => togglePanel('settings'));
    document.getElementById('settings-overlay')?.addEventListener('click', () => togglePanel('settings'));

    document.getElementById('setting-crt')?.addEventListener('change', e => {
      Store.saveSetting('crtEffect', e.target.checked);
      document.getElementById('crt-overlay').classList.toggle('off', !e.target.checked);
    });
    document.getElementById('setting-radar-speed')?.addEventListener('change', e => {
      Store.saveSetting('radarSpeed', e.target.value);
      Radar.setSpeed(e.target.value);
    });
    document.getElementById('setting-refresh')?.addEventListener('change', e => {
      Store.saveSetting('refreshInterval', parseInt(e.target.value) || 120);
      scheduleRefresh();
    });

    // ── Mute button (header) ──
    document.getElementById('mute-btn')?.addEventListener('click', () => {
      const current = Store.getSettings().sound;
      const next = !current;
      Store.saveSetting('sound', next);
      Radar.setSound(next);
      document.getElementById('mute-btn').textContent = next ? '🔊' : '🔇';
      document.getElementById('setting-sound').checked = next;
    });

    // ── Sound toggle (settings panel) ──
    document.getElementById('setting-sound')?.addEventListener('change', e => {
      Store.saveSetting('sound', e.target.checked);
      Radar.setSound(e.target.checked);
      document.getElementById('mute-btn').textContent = e.target.checked ? '🔊' : '🔇';
    });

    // ── Country / Local News selector ──
    document.getElementById('setting-country')?.addEventListener('change', e => {
      Store.saveSetting('country', e.target.value);
      loadFeed();   // reload with new country context
    });

    // ── Share button (detail panel) ──
    document.getElementById('detail-share')?.addEventListener('click', async () => {
      const url = document.getElementById('detail-link').href;
      const title = document.getElementById('detail-title').textContent;
      const btn = document.getElementById('detail-share');

      if (navigator.share) {
        try {
          await navigator.share({ title, url });
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;  // user cancelled
        }
      }
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = '✓ COPIED';
        btn.classList.add('share-copied');
        setTimeout(() => {
          btn.textContent = '⎘ SHARE';
          btn.classList.remove('share-copied');
        }, 2000);
      } catch {
        // Final fallback: select text
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = '✓ COPIED';
        btn.classList.add('share-copied');
        setTimeout(() => {
          btn.textContent = '⎘ SHARE';
          btn.classList.remove('share-copied');
        }, 2000);
      }
    });
    document.getElementById('setting-clear-data')?.addEventListener('click', () => {
      if (confirm('Wipe all local data and preferences?')) {
        Store.clearAll();
        renderSaved();
        renderInterests();
        renderSubManager();
      }
    });

    // ── Subreddit manager ──
    document.getElementById('sub-custom-btn')?.addEventListener('click', addCustomSub);
    document.getElementById('sub-custom-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') addCustomSub();
    });

    // ── Detail panel ──
    document.getElementById('detail-close')?.addEventListener('click', hideDetail);
    document.getElementById('detail-overlay')?.addEventListener('click', hideDetail);

    // ── Auth modal ──
    document.getElementById('auth-btn')?.addEventListener('click', openAuthModal);
    document.getElementById('auth-modal-close')?.addEventListener('click', closeAuthModal);
    document.getElementById('auth-overlay')?.addEventListener('click', closeAuthModal);
    document.getElementById('auth-signout')?.addEventListener('click', handleSignOut);
    document.getElementById('auth-form')?.addEventListener('submit', handleAuthSubmit);
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
    });

    // ── Saved view ──
    document.getElementById('clear-saved')?.addEventListener('click', () => {
      if (confirm('Purge all saved items?')) {
        Store.clearBookmarks();
        renderSaved();
      }
    });

    // ── Keyboard shortcuts ──
    document.addEventListener('keydown', onKey);

    // ── Boot ──
    updateClock();
    setInterval(updateClock, 1000);
    await loadFeed();
    scheduleRefresh();
    updateSourceStatus();

    // Init auth (must come after Store is loaded)
    await Auth.init();
  }

  /* ═══ VIEW SWITCHING ═════════════════════════════ */
  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById('view-' + view);
    if (el) el.classList.add('active');

    document.querySelectorAll('.nav-btn, .mobile-nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });

    if (view === 'radar') requestAnimationFrame(() => Radar.resize());
    if (view === 'map') requestAnimationFrame(() => WorldMap.resize());
    if (view === 'saved') renderSaved();
  }

  /* ═══ DATA LOADING ═══════════════════════════════ */
  async function loadFeed() {
    setConnectionStatus('scanning');
    try {
      const country = Store.getSettings().country || 'auto';
      allItems = await API.getFeed({ country });
      applyFilters();
      setConnectionStatus('online');
      document.getElementById('status-items').textContent = 'Signals: ' + allItems.length;
      // Reset countdown
      nextRefresh = Date.now() + (Store.getSettings().refreshInterval || 120) * 1000;
    } catch (err) {
      console.error('Feed error:', err);
      setConnectionStatus('error');
    }
  }

  function applyFilters() {
    let pool = [...allItems];

    // Source filter
    pool = pool.filter(i => activeSources.has(i.source));

    // Category filter
    if (currentCategory !== 'all') {
      pool = pool.filter(i => i.category === currentCategory);
    }

    // Search
    const q = (document.getElementById('search-input').value || '').trim().toLowerCase();
    if (q) {
      pool = pool.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.snippet || '').toLowerCase().includes(q) ||
        (i.sourceDetail || '').toLowerCase().includes(q)
      );
    }

    // Rank
    filteredItems = Store.rankItems(pool);

    // Push to all views
    Radar.setItems(filteredItems);
    WorldMap.setItems(filteredItems);
    Timeline.setItems(filteredItems);
    document.getElementById('radar-count').textContent = filteredItems.length + ' signals detected';
  }

  /* ═══ DETAIL PANEL ═══════════════════════════════ */
  function showDetail(item) {
    Store.trackClick(item.category);

    document.getElementById('detail-title').textContent = item.title;
    document.getElementById('detail-source').textContent = item.sourceDetail || item.source;
    document.getElementById('detail-category').textContent = item.category || 'general';
    document.getElementById('detail-author').textContent = item.author ? '⟫ ' + item.author : '';
    document.getElementById('detail-time').textContent = '⟫ ' + timeAgo(item.created);
    document.getElementById('detail-score').textContent = `▲ ${item.score || 0} · 💬 ${item.comments || 0}`;
    document.getElementById('detail-snippet').textContent = item.snippet || 'No preview available.';
    document.getElementById('detail-link').href = item.url || '#';
    document.getElementById('detail-comments-link').href = item.permalink || item.url || '#';

    const img = document.getElementById('detail-image');
    if (item.thumbnail) {
      img.src = item.thumbnail;
      img.classList.remove('hidden');
      img.onerror = () => img.classList.add('hidden');
    } else {
      img.classList.add('hidden');
    }

    // Bookmark button
    const saveBtn = document.getElementById('detail-save');
    updateSaveBtn(saveBtn, item);
    saveBtn.onclick = () => {
      if (Store.isBookmarked(item.id)) {
        Store.removeBookmark(item.id);
      } else {
        Store.addBookmark(item);
      }
      updateSaveBtn(saveBtn, item);
    };

    // ── Reaction buttons ──
    updateReactionButtons(item);

    document.getElementById('detail-like').onclick = () => {
      const cur = Store.getReaction(item.id);
      if (cur === 'like') Store.removeReaction(item.id);
      else Store.likeItem(item.id, item.category, item.sourceDetail);
      updateReactionButtons(item);
    };

    document.getElementById('detail-dislike').onclick = () => {
      const cur = Store.getReaction(item.id);
      if (cur === 'dislike') Store.removeReaction(item.id);
      else Store.dislikeItem(item.id, item.category, item.sourceDetail);
      updateReactionButtons(item);
    };

    document.getElementById('detail-showless').onclick = () => {
      const src = item.sourceDetail || item.source;
      if (Store.getShowLess().includes(src)) {
        Store.removeShowLess(src);
      } else {
        Store.showLessSource(src);
      }
      updateReactionButtons(item);
      applyFilters();
    };

    document.getElementById('detail-block').onclick = () => {
      Store.blockItem(item.id);
      hideDetail();
      applyFilters();
    };

    // ── Load discussion / comments ──
    loadComments(item);

    document.getElementById('detail-panel').classList.remove('hidden');
    document.getElementById('detail-overlay').classList.remove('hidden');
  }

  function updateReactionButtons(item) {
    const reaction = Store.getReaction(item.id);
    const likeBtn = document.getElementById('detail-like');
    const dislikeBtn = document.getElementById('detail-dislike');
    const showLessBtn = document.getElementById('detail-showless');

    likeBtn.textContent = reaction === 'like' ? '👍 LIKED' : '👍 LIKE';
    likeBtn.classList.toggle('active', reaction === 'like');

    dislikeBtn.textContent = reaction === 'dislike' ? '👎 DISLIKED' : '👎 DISLIKE';
    dislikeBtn.classList.toggle('active', reaction === 'dislike');

    const src = item.sourceDetail || item.source;
    const isMuted = Store.getShowLess().includes(src);
    showLessBtn.textContent = isMuted ? '📉 MUTED' : '📉 SHOW LESS';
    showLessBtn.classList.toggle('active', isMuted);
  }

  /* ═══ COMMENTS / DISCUSSION ═════════════════════ */
  async function loadComments(item) {
    const listEl = document.getElementById('discussion-list');
    const loadingEl = document.getElementById('discussion-loading');
    const emptyEl = document.getElementById('discussion-empty');

    listEl.innerHTML = '';
    emptyEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    try {
      let url = '';

      if (item.source === 'reddit' && item.permalink) {
        // Extract path from full permalink URL
        const path = item.permalink.replace('https://reddit.com', '').replace('https://www.reddit.com', '');
        url = `/api/comments?source=reddit&permalink=${encodeURIComponent(path)}`;
      } else if (item.source === 'hackernews' && item.id) {
        const hnId = item.id.replace('hn_', '');
        url = `/api/comments?source=hackernews&id=${hnId}`;
      } else {
        loadingEl.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        return;
      }

      const data = await fetch(url).then(r => r.json());
      loadingEl.classList.add('hidden');

      if (!data.comments || data.comments.length === 0) {
        emptyEl.classList.remove('hidden');
        return;
      }

      listEl.innerHTML = data.comments.map(c => renderComment(c)).join('');
    } catch (err) {
      console.error('Comments error:', err);
      loadingEl.classList.add('hidden');
      emptyEl.textContent = 'Failed to load discussion.';
      emptyEl.classList.remove('hidden');
    }
  }

  function renderComment(c) {
    const replies = (c.replies || []).map(r =>
      `<div class="comment reply">
        <div class="comment-header">
          <span class="comment-author">${esc(r.author)}</span>
          <span class="comment-score">▲ ${r.score || 0}</span>
          <span class="comment-time">${timeAgo(r.time)}</span>
        </div>
        <div class="comment-text">${esc(r.text)}</div>
      </div>`
    ).join('');

    return `<div class="comment">
      <div class="comment-header">
        <span class="comment-author">${esc(c.author)}</span>
        <span class="comment-score">▲ ${c.score || 0}</span>
        <span class="comment-time">${timeAgo(c.time)}</span>
      </div>
      <div class="comment-text">${esc(c.text)}</div>
      ${replies ? `<div class="comment-replies">${replies}</div>` : ''}
    </div>`;
  }

  function hideDetail() {
    document.getElementById('detail-panel').classList.add('hidden');
    document.getElementById('detail-overlay').classList.add('hidden');
  }

  function updateSaveBtn(btn, item) {
    const saved = Store.isBookmarked(item.id);
    btn.textContent = saved ? '★ SAVED' : '☆ SAVE';
    btn.style.color = saved ? 'var(--green)' : '';
  }

  /* ═══ SAVED VIEW ═════════════════════════════════ */
  function renderSaved() {
    const bm = Store.getBookmarks();
    const list = document.getElementById('saved-list');
    const empty = document.getElementById('saved-empty');

    if (!bm.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    list.innerHTML = bm.map((item, idx) => `
      <article class="feed-item" data-idx="${idx}">
        <div class="feed-score" style="color:var(--green)">★</div>
        <div class="feed-body">
          <div class="feed-title">${esc(item.title)}</div>
          <div class="feed-meta">
            <span class="feed-source">${esc(item.sourceDetail || item.source)}</span>
            <span>${timeAgo(item.created)}</span>
          </div>
        </div>
      </article>
    `).join('');

    list.querySelectorAll('.feed-item').forEach(el => {
      el.addEventListener('click', () => {
        const i = parseInt(el.dataset.idx);
        if (bm[i]) showDetail(bm[i]);
      });
    });
  }

  /* ═══ SETTINGS ═══════════════════════════════════ */
  function togglePanel(name) {
    const panel = document.getElementById(name + '-panel');
    const overlay = document.getElementById(name + '-overlay');
    if (!panel) return;
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    overlay?.classList.toggle('hidden');
    if (opening && name === 'settings') {
      renderInterests();
      renderSubManager();
    }
  }

  function renderInterests() {
    const data = Store.getInterests();
    const el = document.getElementById('interest-chart');
    if (!el) return;
    const total = Object.values(data).reduce((s, v) => s + v, 0) || 1;
    const cats = ['technology','politics','science','business','entertainment','sports','world','general'];

    el.innerHTML = cats.map(cat => {
      const pct = Math.round((data[cat] || 0) / total * 100);
      return `<div class="interest-row">
        <span class="interest-label">${cat}</span>
        <div class="interest-bar"><div class="interest-fill" style="width:${pct}%"></div></div>
        <span class="interest-pct">${pct}%</span>
      </div>`;
    }).join('');
  }
  /* ═══ AUTH MODAL ═════════════════════════════════ */
  let authMode = 'signin';

  function openAuthModal() {
    const user = Auth.getUser();
    if (user) {
      // Show signed-in view
      document.getElementById('auth-form').classList.add('hidden');
      document.getElementById('auth-tabs')?.classList.add('hidden');
      document.getElementById('auth-user-info').classList.remove('hidden');
      document.getElementById('auth-user-email').textContent = user.email;
    } else {
      // Show sign-in form
      document.getElementById('auth-form').classList.remove('hidden');
      document.getElementById('auth-tabs')?.classList.remove('hidden');
      document.getElementById('auth-user-info').classList.add('hidden');
      document.getElementById('auth-status').textContent = '> Awaiting credentials...';
      document.getElementById('auth-status').className = 'auth-status';
    }
    document.getElementById('auth-modal').classList.remove('hidden');
    document.getElementById('auth-overlay').classList.remove('hidden');
  }

  function closeAuthModal() {
    document.getElementById('auth-modal')?.classList.add('hidden');
    document.getElementById('auth-overlay')?.classList.add('hidden');
  }

  function switchAuthTab(tab) {
    authMode = tab;
    document.querySelectorAll('.auth-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab)
    );
    document.getElementById('auth-status').textContent = '> Awaiting credentials...';
    document.getElementById('auth-status').className = 'auth-status';
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const status = document.getElementById('auth-status');

    status.textContent = '> Processing...';
    status.className = 'auth-status';

    try {
      if (authMode === 'signup') {
        await Auth.signUp(email, password);
        status.textContent = '> Account created! Check your email to confirm.';
        status.className = 'auth-status success';
      } else {
        await Auth.signIn(email, password);
        status.textContent = '> Authenticated. Syncing data...';
        status.className = 'auth-status success';
        setTimeout(() => {
          closeAuthModal();
          loadFeed(); // Reload with synced preferences
        }, 1200);
      }
    } catch (err) {
      status.textContent = '> ERROR: ' + (err.message || 'Authentication failed');
      status.className = 'auth-status error';
    }
  }

  async function handleSignOut() {
    await Auth.signOut();
    closeAuthModal();
  }
  /* ═══ SUBREDDIT MANAGER ═══════════════════════════ */
  function renderSubManager() {
    const container = document.getElementById('sub-manager');
    if (!container) return;

    const selected = Store.getSubreddits();
    const catalog = Store.getCatalog();
    const categories = Store.getCatalogCategories();
    const customSubs = Store.getCustomSubreddits();

    // Add custom subs to the categories
    const customCat = customSubs.length
      ? [{ id: 'custom', label: '✦ CUSTOM' }]
      : [];

    let html = '';
    const allCats = [...categories, ...customCat];

    for (const cat of allCats) {
      const subs = catalog.filter(s => s.cat === cat.id);
      if (!subs.length) continue;
      const isActive = selected.filter(s => subs.some(sub => sub.name === s)).length;
      html += `<div class="sub-cat-group">
        <div class="sub-cat-header">${cat.label} <span class="sub-cat-count">${isActive}/${subs.length}</span></div>
        <div class="sub-grid">`;
      for (const sub of subs) {
        const on = selected.includes(sub.name);
        const isCustom = customSubs.includes(sub.name);
        html += `<button class="sub-chip ${on ? 'active' : ''}" data-sub="${sub.name}" title="${sub.desc}">
          r/${sub.name}${isCustom ? '<span class="sub-remove" data-remove="' + sub.name + '">✕</span>' : ''}
        </button>`;
      }
      html += `</div></div>`;
    }

    container.innerHTML = html;
    document.getElementById('sub-count').textContent = selected.length;

    // Bind click events
    container.querySelectorAll('.sub-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        // Don't toggle if removing
        if (e.target.classList.contains('sub-remove')) return;
        const name = chip.dataset.sub;
        Store.toggleSubreddit(name);
        chip.classList.toggle('active');
        document.getElementById('sub-count').textContent = Store.getSubreddits().length;
        // Update category counts
        updateCatCounts();
      });
    });

    // Bind remove buttons for custom subs
    container.querySelectorAll('.sub-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Store.removeCustomSubreddit(btn.dataset.remove);
        renderSubManager();
      });
    });
  }

  function updateCatCounts() {
    const selected = Store.getSubreddits();
    const catalog = Store.getCatalog();
    document.querySelectorAll('.sub-cat-group').forEach(group => {
      const chips = group.querySelectorAll('.sub-chip');
      const active = [...chips].filter(c => selected.includes(c.dataset.sub)).length;
      const counter = group.querySelector('.sub-cat-count');
      if (counter) counter.textContent = `${active}/${chips.length}`;
    });
  }

  function addCustomSub() {
    const input = document.getElementById('sub-custom-input');
    if (!input) return;
    const name = Store.addCustomSubreddit(input.value);
    if (name) {
      input.value = '';
      renderSubManager();
    }
  }

  /* ═══ STATUS BAR ═════════════════════════════════ */
  function setConnectionStatus(state) {
    const el = document.getElementById('status-connection');
    if (state === 'online')   { el.textContent = '● ONLINE';     el.style.color = 'var(--green-dim)'; }
    if (state === 'scanning') { el.textContent = '◌ SCANNING...'; el.style.color = 'var(--text-muted)'; }
    if (state === 'error')    { el.textContent = '✕ ERROR';       el.style.color = 'var(--danger)'; }
  }

  async function updateSourceStatus() {
    try {
      const s = await API.getStatus();
      const n = Object.values(s.sources).filter(Boolean).length;
      document.getElementById('status-sources').textContent = 'Sources: ' + n;
    } catch {}
  }

  function scheduleRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (refreshCountdown) clearInterval(refreshCountdown);
    const sec = Store.getSettings().refreshInterval || 120;
    nextRefresh = Date.now() + sec * 1000;
    refreshTimer = setInterval(loadFeed, sec * 1000);
    refreshCountdown = setInterval(() => {
      const left = Math.max(0, Math.round((nextRefresh - Date.now()) / 1000));
      document.getElementById('status-refresh').textContent = 'Next scan: ' + left + 's';
    }, 1000);
  }

  function updateClock() {
    const el = document.getElementById('status-time');
    if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
  }

  /* ═══ KEYBOARD ═══════════════════════════════════ */
  function onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key.toLowerCase()) {
      case 'r': switchView('radar'); break;
      case 'f': switchView('feed'); break;
      case 'm': switchView('map'); break;
      case 's': switchView('saved'); break;
      case '/': e.preventDefault(); document.getElementById('search-input').focus(); break;
      case 'escape':
        hideDetail();
        closeAuthModal();
        if (!document.getElementById('settings-panel').classList.contains('hidden')) togglePanel('settings');
        document.getElementById('search-input').blur();
        break;
    }
  }

  /* ═══ UTILS ══════════════════════════════════════ */
  function timeAgo(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return Math.floor(s) + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  /* ═══ BOOT ═══════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', init);

  return { showDetail, hideDetail };
})();
