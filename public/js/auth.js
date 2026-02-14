/* ═══════════════════════════════════════════════════
   AUTH — Supabase authentication + cloud sync
   Falls back gracefully to guest mode if not configured
   ═══════════════════════════════════════════════════ */
const Auth = (() => {
  let supabase = null;
  let currentUser = null;
  let _syncing = false;

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

      supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

      // Check existing session
      const { data: { session } } = await supabase.auth.getSession();
      currentUser = session?.user || null;
      _updateHeaderUI(currentUser);
      if (currentUser) await pullFromCloud();

      // Listen for auth state changes
      supabase.auth.onAuthStateChange(async (event, session) => {
        const prev = currentUser;
        currentUser = session?.user || null;
        _updateHeaderUI(currentUser);
        if (event === 'SIGNED_IN' && !prev) {
          await pullFromCloud();
        }
      });

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
    if (!supabase) throw new Error('Auth not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    if (!supabase) throw new Error('Auth not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    currentUser = null;
    _updateHeaderUI(null);
  }

  /* ═══ CLOUD SYNC ═════════════════════════════════ */
  async function pushToCloud() {
    if (!supabase || !currentUser) return;
    _syncing = true;
    try {
      const data = Store.exportAll();

      // Upsert preferences
      await supabase.from('user_prefs').upsert({
        user_id: currentUser.id,
        subreddits: data.subreddits,
        custom_subs: data.customSubs,
        interests: data.interests,
        settings: data.settings,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

      // Replace bookmarks — delete then insert
      await supabase.from('user_bookmarks')
        .delete()
        .eq('user_id', currentUser.id);

      if (data.bookmarks.length) {
        await supabase.from('user_bookmarks').insert(
          data.bookmarks.map(b => ({
            user_id: currentUser.id,
            item_id: b.id,
            item_data: b
          }))
        );
      }

      _setSyncStatus('synced');
    } catch (e) {
      console.error('[AUTH] Push failed:', e.message);
      _setSyncStatus('error');
    }
    _syncing = false;
  }

  async function pullFromCloud() {
    if (!supabase || !currentUser) return;
    _syncing = true;
    try {
      // Load preferences
      const { data: prefs } = await supabase
        .from('user_prefs')
        .select('*')
        .eq('user_id', currentUser.id)
        .single();

      if (prefs) {
        Store.importAll({
          subreddits: prefs.subreddits || [],
          customSubs: prefs.custom_subs || [],
          interests: prefs.interests || {},
          settings: prefs.settings || {}
        });
      } else {
        // First login — push current local state to cloud
        _syncing = false;
        await pushToCloud();
        _syncing = true;
      }

      // Load bookmarks
      const { data: bookmarks } = await supabase
        .from('user_bookmarks')
        .select('item_data')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (bookmarks && bookmarks.length) {
        Store.importAll({ bookmarks: bookmarks.map(b => b.item_data) });
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
