/* ═══════════════════════════════════════════════════
   APP — Main controller: views, data, detail, settings
   ═══════════════════════════════════════════════════ */
const App = (() => {
  let currentView = 'radar';
  let allItems = [];
  let filteredItems = [];
  let currentCategory = 'all';
  let activeSources = new Set(['reddit', 'hackernews', 'rss', 'newsapi', 'guardian', 'wikinews', 'thenewsapi', 'gnews']);
  let sortMode = 'ranked';
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
    Calendar.init(document.getElementById('calendar-container'));

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

    // ── Source toggles (dropdown) ──
    document.querySelectorAll('.source-option input').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.checked ? activeSources.add(cb.dataset.source) : activeSources.delete(cb.dataset.source);
        const cnt = document.getElementById('source-count');
        if (cnt) cnt.textContent = activeSources.size;
        applyFilters();
      });
    });

    // ── Source dropdown toggle ──
    const srcDropBtn = document.getElementById('source-dropdown-btn');
    const srcDropMenu = document.getElementById('source-dropdown-menu');
    if (srcDropBtn && srcDropMenu) {
      srcDropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        srcDropMenu.classList.toggle('hidden');
        srcDropBtn.classList.toggle('open');
        // Close sort dropdown if open
        document.getElementById('sort-dropdown-menu')?.classList.add('hidden');
        document.getElementById('sort-dropdown-btn')?.classList.remove('open');
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.source-dropdown')) {
          srcDropMenu.classList.add('hidden');
          srcDropBtn.classList.remove('open');
        }
      });
    }

    // ── Sort mode (dropdown) ──
    const sortDropBtn = document.getElementById('sort-dropdown-btn');
    const sortDropMenu = document.getElementById('sort-dropdown-menu');
    if (sortDropBtn && sortDropMenu) {
      sortDropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sortDropMenu.classList.toggle('hidden');
        sortDropBtn.classList.toggle('open');
        // Close source dropdown if open
        document.getElementById('source-dropdown-menu')?.classList.add('hidden');
        document.getElementById('source-dropdown-btn')?.classList.remove('open');
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.sort-dropdown')) {
          sortDropMenu.classList.add('hidden');
          sortDropBtn.classList.remove('open');
        }
      });
    }
    document.querySelectorAll('.sort-option').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        sortMode = opt.dataset.sort;
        // Update trigger button label & icon
        const label = document.getElementById('sort-label');
        const icon = document.getElementById('sort-icon-active');
        if (label) label.textContent = opt.querySelector('span').textContent;
        if (icon) icon.innerHTML = opt.querySelector('svg').innerHTML;
        // Close menu
        sortDropMenu?.classList.add('hidden');
        sortDropBtn?.classList.remove('open');
        applyFilters();
      });
    });

    // Show/hide LOCAL button based on region setting
    updateLocalButton();

    // ── Search ──
    document.getElementById('search-input').addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        showSearchSuggestions(e.target.value);
        applyFilters();
      }, 200);
    });
    document.getElementById('search-input').addEventListener('focus', (e) => {
      if (e.target.value.trim()) showSearchSuggestions(e.target.value);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) {
        document.getElementById('search-suggestions')?.classList.add('hidden');
      }
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
      updateRegionStatus();
      updateLocalButton();
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

    // ── Account button in settings ──
    document.getElementById('setting-auth-btn')?.addEventListener('click', () => {
      togglePanel('settings');
      setTimeout(openAuthModal, 150);
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
    document.getElementById('pw-change-btn')?.addEventListener('click', handleChangePassword);

    // ── Saved items (in settings panel) ──
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
    updateRegionStatus();

    // Init auth (must come after Store is loaded)
    await Auth.init();

    // Apply saved profile icon if authenticated
    if (Auth.isAuthenticated()) {
      _updateHeaderAvatar(getSelectedAvatar());
    }
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
    if (view === 'calendar') requestAnimationFrame(() => Calendar.resize());
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

  /* ═══ LOCAL BUTTON ══════════════════════════════ */
  function updateLocalButton() {
    const country = Store.getSettings().country || 'auto';
    const btn = document.getElementById('filter-local');
    if (!btn) return;
    if (country && country !== 'auto') {
      btn.classList.remove('hidden');
      // Show the country code in the button
      const sel = document.getElementById('setting-country');
      const label = sel ? sel.options[sel.selectedIndex]?.text || country.toUpperCase() : country.toUpperCase();
      btn.textContent = '📍 ' + label;
    } else {
      btn.classList.add('hidden');
      // If local was active, switch back to world
      if (currentCategory === 'local') {
        currentCategory = 'all';
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-btn[data-category="all"]')?.classList.add('active');
      }
    }
  }

  function applyFilters() {
    let pool = [...allItems];

    // Source filter
    pool = pool.filter(i => activeSources.has(i.source));

    // Category filter
    if (currentCategory === 'local') {
      pool = pool.filter(i => i.local);
    } else if (currentCategory === 'all') {
      pool = pool.filter(i => i.category !== 'community');
    } else {
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

    // Rank / Sort
    filteredItems = Store.rankItems(pool, sortMode);

    // Push to all views
    Radar.setItems(filteredItems);
    WorldMap.setItems(filteredItems);
    Timeline.setItems(filteredItems);

    // Update count displays — always use filteredItems.length for accuracy
    const catLabel = currentCategory === 'all' ? 'WORLD' : currentCategory.toUpperCase();
    document.getElementById('radar-count').textContent = filteredItems.length + ' signals detected · ' + catLabel;
    const mapCount = document.getElementById('map-count');
    if (mapCount) mapCount.textContent = filteredItems.length + ' signals · ' + catLabel;
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
    const countLabel = document.getElementById('saved-count-label');

    if (countLabel) countLabel.textContent = bm.length + ' saved item' + (bm.length !== 1 ? 's' : '');

    if (!bm.length) {
      if (list) list.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');

    if (list) {
      list.innerHTML = bm.map((item, idx) => `
        <article class="feed-item" data-idx="${idx}" style="padding:10px 14px;">
          <div class="feed-score" style="color:var(--green);min-width:40px;font-size:16px;">★</div>
          <div class="feed-body">
            <div class="feed-title" style="font-size:15px;">${esc(item.title)}</div>
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
      renderSaved();
      // Update auth button label
      const user = Auth.getUser();
      const authBtn = document.getElementById('setting-auth-btn');
      const authHint = document.getElementById('setting-auth-hint');
      if (authBtn) {
        if (user) {
          authBtn.textContent = '◉ SIGNED IN: ' + user.email;
          authBtn.style.borderColor = 'var(--green-dark)';
          authBtn.style.color = 'var(--green-dim)';
          if (authHint) authHint.textContent = 'Syncing preferences to cloud.';
        } else {
          authBtn.textContent = '▸ SIGN IN / SIGN UP';
          authBtn.style.borderColor = '';
          authBtn.style.color = '';
          if (authHint) authHint.textContent = 'Sign in to sync preferences across devices.';
        }
      }
    }
  }

  function renderInterests() {
    const data = Store.getInterests();
    const el = document.getElementById('interest-chart');
    if (!el) return;
    const total = Object.values(data).reduce((s, v) => s + v, 0) || 1;
    const cats = ['technology','politics','science','business','entertainment','sports','esports','world','general'];

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

  /* ── Profile Icons (hacker/anonymous themed, rendered as SVG) ── */
  const PROFILE_ICONS = [
    { id: 'skull',    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00ff41" stroke-width="1.5"><circle cx="12" cy="10" r="7"/><circle cx="9" cy="9" r="1.5" fill="#00ff41"/><circle cx="15" cy="9" r="1.5" fill="#00ff41"/><path d="M9 17v3M12 17v3M15 17v3"/><path d="M8 14c1.3 1 2.5 1.3 4 1.3s2.7-.3 4-1.3"/></svg>' },
    { id: 'ghost',    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00ff41" stroke-width="1.5"><path d="M12 2C7 2 4 6 4 10v10l2.5-2 2.5 2 2.5-2L14 20l2.5-2L19 20V10c0-4-3-8-8-8z"/><circle cx="9" cy="10" r="1.5" fill="#00ff41"/><circle cx="15" cy="10" r="1.5" fill="#00ff41"/></svg>' },
    { id: 'mask',     svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00ff41" stroke-width="1.5"><path d="M12 3C6 3 2 8 2 12c0 2 1 4 3 5l2-1 2.5 1L12 16l2.5 1L17 16l2 1c2-1 3-3 3-5 0-4-4-9-10-9z"/><path d="M7 10h3v2H7zM14 10h3v2h-3z"/></svg>' },
    { id: 'terminal', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00ff41" stroke-width="1.5"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M6 8l4 4-4 4M12 16h6"/></svg>' },
    { id: 'eye',      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00ff41" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3" fill="#00ff41"/></svg>' },
    { id: 'lock',     svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00ff41" stroke-width="1.5"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 118 0v4"/><circle cx="12" cy="16" r="1.5" fill="#00ff41"/></svg>' },
    { id: 'radar',    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00ff41" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="#00ff41"/><line x1="12" y1="2" x2="12" y2="12"/></svg>' },
    { id: 'shield',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00ff41" stroke-width="1.5"><path d="M12 2L3 7v5c0 5.5 3.8 10.3 9 12 5.2-1.7 9-6.5 9-12V7l-9-5z"/><path d="M9 12l2 2 4-4"/></svg>' },
    { id: 'anon',     svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00ff41" stroke-width="1.5"><path d="M12 2a9 9 0 00-9 9v2h2l1.5 6h11L19 13h2v-2a9 9 0 00-9-9z"/><path d="M7 10h4M13 10h4"/><path d="M10 14c.6.6 1.3 1 2 1s1.4-.4 2-1"/></svg>' },
    { id: 'glitch',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00ff41" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M3 15h18"/><path d="M7 3v6M12 9v6M17 15v6" stroke-dasharray="2 2"/><text x="7" y="13" font-size="5" fill="#00ff41" font-family="monospace">0x</text></svg>' },
  ];

  function getSelectedAvatar() {
    return Store.getSettings().avatar || 'skull';
  }

  function setSelectedAvatar(id) {
    Store.saveSetting('avatar', id);
    _updateHeaderAvatar(id);
  }

  function _updateHeaderAvatar(avatarId) {
    const btn = document.getElementById('auth-btn');
    if (!btn || !Auth.isAuthenticated()) return;
    const icon = PROFILE_ICONS.find(i => i.id === avatarId) || PROFILE_ICONS[0];
    btn.innerHTML = `<span class="auth-avatar-icon">${icon.svg}</span>`;
  }

  function renderAvatarChooser() {
    const container = document.getElementById('avatar-chooser');
    if (!container) return;
    const current = getSelectedAvatar();
    container.innerHTML = PROFILE_ICONS.map(icon => `
      <div class="avatar-option ${icon.id === current ? 'selected' : ''}" data-avatar="${icon.id}" title="${icon.id}">
        ${icon.svg}
      </div>
    `).join('');
    container.querySelectorAll('.avatar-option').forEach(opt => {
      opt.addEventListener('click', () => {
        setSelectedAvatar(opt.dataset.avatar);
        renderAvatarChooser();
        // Update the large avatar display
        const display = document.getElementById('auth-user-avatar');
        const icon = PROFILE_ICONS.find(i => i.id === opt.dataset.avatar) || PROFILE_ICONS[0];
        if (display) display.innerHTML = icon.svg;
      });
    });
  }

  function openAuthModal() {
    const user = Auth.getUser();
    if (user) {
      // Show signed-in view
      document.getElementById('auth-form').classList.add('hidden');
      document.getElementById('auth-tabs')?.classList.add('hidden');
      document.getElementById('auth-user-info').classList.remove('hidden');
      document.getElementById('auth-user-email').textContent = user.email;
      // Show current avatar
      const avatarId = getSelectedAvatar();
      const icon = PROFILE_ICONS.find(i => i.id === avatarId) || PROFILE_ICONS[0];
      const avatarEl = document.getElementById('auth-user-avatar');
      if (avatarEl) avatarEl.innerHTML = icon.svg;
      // Render avatar chooser
      renderAvatarChooser();
      // Reset password fields
      const pwNew = document.getElementById('pw-new');
      const pwConfirm = document.getElementById('pw-confirm');
      const pwStatus = document.getElementById('pw-status');
      if (pwNew) pwNew.value = '';
      if (pwConfirm) pwConfirm.value = '';
      if (pwStatus) { pwStatus.textContent = ''; pwStatus.className = 'auth-status'; }
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

  async function handleChangePassword() {
    const pw = document.getElementById('pw-new')?.value;
    const confirm = document.getElementById('pw-confirm')?.value;
    const status = document.getElementById('pw-status');
    if (!status) return;

    if (!pw || pw.length < 6) {
      status.textContent = '> Password must be at least 6 characters';
      status.className = 'auth-status error';
      return;
    }
    if (pw !== confirm) {
      status.textContent = '> Passwords do not match';
      status.className = 'auth-status error';
      return;
    }

    status.textContent = '> Updating...';
    status.className = 'auth-status';

    try {
      await Auth.changePassword(pw);
      status.textContent = '> Password updated successfully';
      status.className = 'auth-status success';
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-confirm').value = '';
    } catch (err) {
      status.textContent = '> ERROR: ' + (err.message || 'Failed to update password');
      status.className = 'auth-status error';
    }
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

  function updateRegionStatus() {
    const country = Store.getSettings().country || 'auto';
    const regionMap = {
      auto: '🌍 AUTO', us: '🇺🇸 US', gb: '🇬🇧 GB', ca: '🇨🇦 CA', au: '🇦🇺 AU',
      de: '🇩🇪 DE', fr: '🇫🇷 FR', in: '🇮🇳 IN', jp: '🇯🇵 JP', br: '🇧🇷 BR',
      za: '🇿🇦 ZA', ng: '🇳🇬 NG', ae: '🇦🇪 AE', sg: '🇸🇬 SG', kr: '🇰🇷 KR',
      mx: '🇲🇽 MX', it: '🇮🇹 IT', es: '🇪🇸 ES', nl: '🇳🇱 NL', se: '🇸🇪 SE',
      pl: '🇵🇱 PL', ph: '🇵🇭 PH'
    };
    const el = document.getElementById('status-region');
    if (el) el.textContent = 'Region: ' + (regionMap[country] || country.toUpperCase());
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
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
    }
  }

  /* ═══ SEARCH SUGGESTIONS (Settings + Navigation) ═══ */
  const settingsMap = [
    { label: 'Auto-refresh interval', icon: '⟳', target: 'setting-refresh', group: 'settings' },
    { label: 'CRT Scanline Effect', icon: '▦', target: 'setting-crt', group: 'settings' },
    { label: 'Radar Sound', icon: '🔊', target: 'setting-sound', group: 'settings' },
    { label: 'Local News Region', icon: '🌍', target: 'setting-country', group: 'settings' },
    { label: 'Radar Sweep Speed', icon: '◉', target: 'setting-radar-speed', group: 'settings' },
    { label: 'Subreddit Sources', icon: '📡', target: 'sub-manager', group: 'settings' },
    { label: 'Interest Profile', icon: '📊', target: 'interest-chart', group: 'settings' },
    { label: 'Keyboard Shortcuts', icon: '⌨', target: 'shortcuts', group: 'settings' },
    { label: 'Wipe All Local Data', icon: '⚠', target: 'setting-clear-data', group: 'settings' },
    { label: 'Account / Sign In', icon: '👤', target: 'setting-auth-btn', group: 'account' },
    { label: 'Sign Up', icon: '👤', target: 'auth', group: 'account' },
    { label: 'About Sentinel', icon: 'ⓘ', target: 'about', group: 'page' },
    { label: 'Radar View', icon: '◉', target: 'view-radar', group: 'nav' },
    { label: 'Feed View', icon: '≡', target: 'view-feed', group: 'nav' },
    { label: 'Map View', icon: '⊕', target: 'view-map', group: 'nav' },
    { label: 'Events', icon: '▣', target: 'view-calendar', group: 'nav' },
    { label: 'Saved Items', icon: '★', target: 'saved-settings-section', group: 'settings' },
  ];

  function showSearchSuggestions(query) {
    const container = document.getElementById('search-suggestions');
    if (!container) return;
    const q = query.trim().toLowerCase();

    if (!q) {
      container.classList.add('hidden');
      return;
    }

    const matches = settingsMap.filter(s =>
      s.label.toLowerCase().includes(q)
    );

    if (!matches.length) {
      container.classList.add('hidden');
      return;
    }

    container.innerHTML = matches.map((s, i) => `
      <div class="search-suggestion-item" data-idx="${i}">
        <span class="sug-icon">${s.icon}</span>
        <span class="sug-text">${highlightMatch(s.label, q)}</span>
        <span class="sug-badge">${s.group.toUpperCase()}</span>
      </div>
    `).join('');

    container.classList.remove('hidden');

    container.querySelectorAll('.search-suggestion-item').forEach((el, idx) => {
      el.addEventListener('click', () => {
        navigateToSetting(matches[idx]);
        container.classList.add('hidden');
        document.getElementById('search-input').value = '';
      });
    });
  }

  function highlightMatch(text, query) {
    const idx = text.toLowerCase().indexOf(query);
    if (idx === -1) return text;
    return text.slice(0, idx) +
      '<span style="color:var(--green);text-shadow:0 0 4px var(--green-glow)">' +
      text.slice(idx, idx + query.length) + '</span>' +
      text.slice(idx + query.length);
  }

  function navigateToSetting(item) {
    if (item.group === 'nav') {
      switchView(item.target.replace('view-', ''));
      return;
    }
    if (item.group === 'page' && item.target === 'about') {
      window.open('/about.html', '_blank');
      return;
    }
    if (item.group === 'account' && item.target === 'auth') {
      openAuthModal();
      return;
    }

    // Open settings panel
    const panel = document.getElementById('settings-panel');
    if (panel.classList.contains('hidden')) {
      togglePanel('settings');
    }

    // Scroll to the target element
    setTimeout(() => {
      const target = document.getElementById(item.target);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash highlight effect
        target.style.outline = '1px solid var(--green)';
        target.style.outlineOffset = '4px';
        target.style.transition = 'outline-color 1.5s';
        setTimeout(() => {
          target.style.outlineColor = 'transparent';
          setTimeout(() => {
            target.style.outline = '';
            target.style.outlineOffset = '';
          }, 1500);
        }, 800);
      }
    }, 200);
  }

  /* ═══ KEYBOARD ═══════════════════════════════════ */
  function onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key.toLowerCase()) {
      case 'r': switchView('radar'); break;
      case 'f': switchView('feed'); break;
      case 'm': switchView('map'); break;
      case 'c': switchView('calendar'); break;
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
