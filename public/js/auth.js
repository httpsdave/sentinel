/* ═══════════════════════════════════════════════════
   AUTH — Proxied through backend (no direct Supabase
   calls from browser — avoids CORS issues)
   Falls back gracefully to guest mode if not configured
   ═══════════════════════════════════════════════════ */
const Auth = (() => {
  let configured = false;
  let currentUser = null;
  let accessToken = null;
  let _syncing = false;

  const TOKEN_KEY = 'sentinel_auth_token';

  /* ═══ INIT ═══════════════════════════════════════ */
  async function init() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();

      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        console.log('[AUTH] Supabase not configured — guest mode only');
        _updateHeaderUI(null);
        return;
      }

      configured = true;

      // Restore saved token
      try { accessToken = localStorage.getItem(TOKEN_KEY) || null; } catch {}

      if (accessToken) {
        // Verify token is still valid
        try {
          const r = await fetch('/api/auth/user', {
            headers: { 'Authorization': 'Bearer ' + accessToken }
          });
          const data = await r.json();
          currentUser = data.user || null;
          if (!currentUser) {
            accessToken = null;
            try { localStorage.removeItem(TOKEN_KEY); } catch {}
          }
        } catch {
          currentUser = null;
          accessToken = null;
        }
      }

      _updateHeaderUI(currentUser);
      if (currentUser) await pullFromCloud();

      // Register store sync — debounced saves to cloud on any local change
      Store.onSync(() => {
        if (currentUser && !_syncing) pushToCloud();
      });

    } catch (e) {
      console.error('[AUTH] Init error:', e.message);
      _updateHeaderUI(null);
    }
  }

  /* ═══ AUTH ACTIONS ═══════════════════════════════ */
  async function signUp(email, password) {
    if (!configured) throw new Error('Auth not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sign up failed');
    return data;
  }

  async function signIn(email, password) {
    if (!configured) throw new Error('Auth not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
    const res = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sign in failed');

    // Supabase token response
    accessToken = data.access_token || null;
    currentUser = data.user || null;
    if (accessToken) {
      try { localStorage.setItem(TOKEN_KEY, accessToken); } catch {}
    }
    _updateHeaderUI(currentUser);
    if (currentUser) await pullFromCloud();
    return data;
  }

  async function signOut() {
    accessToken = null;
    currentUser = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    _updateHeaderUI(null);
    // Notify server (fire-and-forget)
    fetch('/api/auth/signout', { method: 'POST' }).catch(() => {});
  }

  /* ═══ CLOUD SYNC ═════════════════════════════════ */
  async function pushToCloud() {
    if (!configured || !currentUser || !accessToken) return;
    _syncing = true;
    try {
      const data = Store.exportAll();
      const res = await fetch('/api/sync/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + accessToken
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Push failed');
      _setSyncStatus('synced');
    } catch (e) {
      console.error('[AUTH] Push failed:', e.message);
      _setSyncStatus('error');
    }
    _syncing = false;
  }

  async function pullFromCloud() {
    if (!configured || !currentUser || !accessToken) return;
    _syncing = true;
    try {
      const res = await fetch('/api/sync/pull', {
        headers: { 'Authorization': 'Bearer ' + accessToken }
      });
      if (!res.ok) throw new Error('Pull failed');
      const data = await res.json();

      if (data.prefs) {
        Store.importAll({
          subreddits: data.prefs.subreddits || [],
          customSubs: data.prefs.custom_subs || [],
          interests: data.prefs.interests || {},
          settings: data.prefs.settings || {}
        });
      } else {
        // First login — push current local state to cloud
        _syncing = false;
        await pushToCloud();
        _syncing = true;
      }

      if (data.bookmarks && data.bookmarks.length) {
        Store.importAll({ bookmarks: data.bookmarks });
      }

      _setSyncStatus('synced');
    } catch (e) {
      console.error('[AUTH] Pull failed:', e.message);
      _setSyncStatus('error');
    }
    _syncing = false;
  }

  /* ═══ UI HELPERS ═════════════════════════════════ */
  function _updateHeaderUI(user) {
    const btn = document.getElementById('auth-btn');
    if (!btn) return;

    if (user) {
      const initial = (user.email || '?')[0].toUpperCase();
      btn.innerHTML = `<span class="auth-avatar">${initial}</span>`;
      btn.title = user.email;
      btn.classList.add('authenticated');
    } else {
      btn.textContent = '👤';
      btn.title = 'Sign in';
      btn.classList.remove('authenticated');
    }
  }

  function _setSyncStatus(state) {
    const el = document.getElementById('auth-sync-status');
    if (!el) return;
    if (state === 'synced') {
      el.textContent = '☁ Synced to cloud';
      el.style.color = 'var(--green-dim)';
    } else if (state === 'error') {
      el.textContent = '⚠ Sync error';
      el.style.color = 'var(--danger)';
    }
  }

  /* ═══ GETTERS ════════════════════════════════════ */
  function isAuthenticated() { return !!currentUser; }
  function getUser() { return currentUser; }
  function isConfigured() { return !!supabase; }

  return {
    init, signUp, signIn, signOut,
    pushToCloud, pullFromCloud,
    isAuthenticated, getUser, isConfigured
  };
})();
