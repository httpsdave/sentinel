/* ═══════════════════════════════════════════════════
   STORE — Local state, bookmarks, interests, settings,
   subreddit management, personalisation algorithm
   ═══════════════════════════════════════════════════ */
const Store = (() => {
  const PREFIX = 'sentinel_';

  /* ── Cloud Sync Hook ────────────────────────────── */
  let _syncCallback = null;
  let _syncTimer = null;
  let _importing = false;

  function onSync(cb) { _syncCallback = cb; }
  function _triggerSync() {
    if (_importing || !_syncCallback) return;
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => _syncCallback(), 2000);
  }

  function _get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(PREFIX + key)) || fallback; }
    catch { return fallback; }
  }
  function _set(key, val) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch {}
    _triggerSync();
  }

  /* ═══════════════════════════════════════════════════
     SUBREDDIT CATALOG — master list of available subs
     grouped by category. `on` = enabled by default
     ═══════════════════════════════════════════════════ */
  const SUBREDDIT_CATALOG = [
    // ── Trending / General ──
    { name: 'popular',                cat: 'trending',      on: true,  desc: 'Reddit front page' },
    { name: 'all',                    cat: 'trending',      on: false, desc: 'Everything on Reddit' },
    { name: 'interestingasfuck',     cat: 'trending',      on: true,  desc: 'Fascinating content' },
    { name: 'Damnthatsinteresting',  cat: 'trending',      on: false, desc: 'Amazing discoveries' },
    { name: 'OutOfTheLoop',          cat: 'trending',      on: false, desc: 'What you missed' },
    { name: 'bestof',               cat: 'trending',      on: false, desc: 'Best Reddit comments' },

    // ── News / World ──
    { name: 'worldnews',            cat: 'news',          on: true,  desc: 'International news' },
    { name: 'news',                  cat: 'news',          on: true,  desc: 'US & general news' },
    { name: 'UpliftingNews',        cat: 'news',          on: true,  desc: 'Positive stories' },
    { name: 'nottheonion',          cat: 'news',          on: true,  desc: 'Absurd real headlines' },
    { name: 'TrueReddit',           cat: 'news',          on: false, desc: 'Long-form journalism' },
    { name: 'inthenews',            cat: 'news',          on: false, desc: 'News discussion' },
    { name: 'anime_titties',        cat: 'news',          on: false, desc: 'World politics (real)' },
    { name: 'CredibleDefense',      cat: 'news',          on: false, desc: 'Military & conflict analysis' },
    { name: 'qualitynews',          cat: 'news',          on: false, desc: 'Curated journalism' },

    // ── Technology ──
    { name: 'technology',            cat: 'technology',    on: true,  desc: 'Tech news' },
    { name: 'programming',           cat: 'technology',    on: true,  desc: 'Coding & dev' },
    { name: 'webdev',               cat: 'technology',    on: false, desc: 'Web development' },
    { name: 'javascript',           cat: 'technology',    on: false, desc: 'JavaScript' },
    { name: 'python',               cat: 'technology',    on: false, desc: 'Python' },
    { name: 'linux',                cat: 'technology',    on: false, desc: 'Linux' },
    { name: 'apple',                cat: 'technology',    on: false, desc: 'Apple ecosystem' },
    { name: 'Android',              cat: 'technology',    on: false, desc: 'Android' },
    { name: 'gadgets',              cat: 'technology',    on: false, desc: 'Tech gadgets' },
    { name: 'hardware',             cat: 'technology',    on: false, desc: 'PC hardware' },
    { name: 'sysadmin',             cat: 'technology',    on: false, desc: 'System admin' },
    { name: 'netsec',               cat: 'technology',    on: false, desc: 'Network security' },
    { name: 'hacking',              cat: 'technology',    on: false, desc: 'Hacking & security' },
    { name: 'cybersecurity',        cat: 'technology',    on: false, desc: 'Cybersecurity' },

    // ── AI / Machine Learning ──
    { name: 'artificial',           cat: 'ai',            on: true,  desc: 'AI news' },
    { name: 'MachineLearning',      cat: 'ai',            on: true,  desc: 'ML research' },
    { name: 'ChatGPT',              cat: 'ai',            on: true,  desc: 'ChatGPT discussions' },
    { name: 'OpenAI',               cat: 'ai',            on: false, desc: 'OpenAI updates' },
    { name: 'LocalLLaMA',           cat: 'ai',            on: false, desc: 'Local AI models' },
    { name: 'singularity',          cat: 'ai',            on: false, desc: 'AGI & singularity' },
    { name: 'StableDiffusion',      cat: 'ai',            on: false, desc: 'AI image generation' },
    { name: 'datascience',          cat: 'ai',            on: false, desc: 'Data science' },

    // ── Science ──
    { name: 'science',              cat: 'science',       on: true,  desc: 'Scientific studies' },
    { name: 'space',                cat: 'science',       on: true,  desc: 'Space & astronomy' },
    { name: 'Futurology',           cat: 'science',       on: true,  desc: 'Future tech & society' },
    { name: 'physics',              cat: 'science',       on: false, desc: 'Physics' },
    { name: 'biology',              cat: 'science',       on: false, desc: 'Biology' },
    { name: 'chemistry',            cat: 'science',       on: false, desc: 'Chemistry' },
    { name: 'environment',          cat: 'science',       on: false, desc: 'Environment & climate' },
    { name: 'EverythingScience',    cat: 'science',       on: false, desc: 'All sciences' },

    // ── Politics ──
    { name: 'politics',             cat: 'politics',      on: false, desc: 'US politics' },
    { name: 'geopolitics',          cat: 'politics',      on: true,  desc: 'Global geopolitics' },
    { name: 'NeutralPolitics',      cat: 'politics',      on: false, desc: 'Balanced politics' },
    { name: 'PoliticalDiscussion',  cat: 'politics',      on: false, desc: 'Political debate' },
    { name: 'europe',               cat: 'politics',      on: false, desc: 'European news' },
    { name: 'ukpolitics',           cat: 'politics',      on: false, desc: 'UK politics' },

    // ── Business / Finance ──
    { name: 'business',             cat: 'finance',       on: true,  desc: 'Business news' },
    { name: 'economics',            cat: 'finance',       on: true,  desc: 'Economics' },
    { name: 'finance',              cat: 'finance',       on: false, desc: 'Finance' },
    { name: 'stocks',               cat: 'finance',       on: false, desc: 'Stock market' },
    { name: 'investing',            cat: 'finance',       on: false, desc: 'Investing' },
    { name: 'wallstreetbets',       cat: 'finance',       on: false, desc: 'WSB memes & plays' },
    { name: 'cryptocurrency',       cat: 'finance',       on: false, desc: 'Crypto news' },
    { name: 'bitcoin',              cat: 'finance',       on: false, desc: 'Bitcoin' },
    { name: 'ethereum',             cat: 'finance',       on: false, desc: 'Ethereum' },
    { name: 'personalfinance',      cat: 'finance',       on: false, desc: 'Personal finance' },
    { name: 'entrepreneur',         cat: 'finance',       on: false, desc: 'Entrepreneurship' },
    { name: 'startups',             cat: 'finance',       on: false, desc: 'Startups' },

    // ── Entertainment ──
    { name: 'movies',               cat: 'entertainment', on: true,  desc: 'Movies' },
    { name: 'television',           cat: 'entertainment', on: false, desc: 'TV shows' },
    { name: 'music',                cat: 'entertainment', on: false, desc: 'Music' },
    { name: 'gaming',               cat: 'entertainment', on: true,  desc: 'Gaming' },
    { name: 'books',                cat: 'entertainment', on: false, desc: 'Books & reading' },
    { name: 'anime',                cat: 'entertainment', on: false, desc: 'Anime' },
    { name: 'netflix',              cat: 'entertainment', on: false, desc: 'Netflix' },
    { name: 'marvel',               cat: 'entertainment', on: false, desc: 'Marvel' },
    { name: 'Games',                cat: 'entertainment', on: false, desc: 'Tabletop & video games' },
    { name: 'pcgaming',             cat: 'entertainment', on: false, desc: 'PC Gaming' },
    { name: 'PS5',                  cat: 'entertainment', on: false, desc: 'PlayStation 5' },

    // ── Sports ──
    { name: 'sports',               cat: 'sports',        on: false, desc: 'General sports' },
    { name: 'nba',                  cat: 'sports',        on: false, desc: 'Basketball' },
    { name: 'nfl',                  cat: 'sports',        on: false, desc: 'American football' },
    { name: 'soccer',               cat: 'sports',        on: false, desc: 'Football/Soccer' },
    { name: 'formula1',             cat: 'sports',        on: false, desc: 'Formula 1' },
    { name: 'MMA',                  cat: 'sports',        on: false, desc: 'MMA / UFC' },
    { name: 'tennis',               cat: 'sports',        on: false, desc: 'Tennis' },
    { name: 'baseball',             cat: 'sports',        on: false, desc: 'Baseball' },

    // ── Community / Discussion ──
    { name: 'AskReddit',             cat: 'community',     on: false, desc: 'Trending questions & discussions' },
    { name: 'todayilearned',         cat: 'community',     on: false, desc: 'Interesting random facts' },
    { name: 'explainlikeimfive',     cat: 'community',     on: false, desc: 'Simple explanations' },
    { name: 'AmItheAsshole',         cat: 'community',     on: false, desc: 'Moral judgement stories' },
    { name: 'Showerthoughts',        cat: 'community',     on: false, desc: 'Random insights' },
    { name: 'unpopularopinion',      cat: 'community',     on: false, desc: 'Hot takes & debates' },
    { name: 'changemyview',          cat: 'community',     on: false, desc: 'Challenge your views' },
    { name: 'NoStupidQuestions',     cat: 'community',     on: false, desc: 'Ask anything' },
    { name: 'TooAfraidToAsk',        cat: 'community',     on: false, desc: 'Taboo & awkward questions' },
    { name: 'tifu',                  cat: 'community',     on: false, desc: 'Today I messed up' },
    { name: 'confessions',           cat: 'community',     on: false, desc: 'Anonymous confessions' },
    { name: 'relationship_advice',   cat: 'community',     on: false, desc: 'Relationship advice' },
    { name: 'TrueOffMyChest',        cat: 'community',     on: false, desc: 'Vent & share stories' },

    // ── Country / Regional News ──
    { name: 'unitedkingdom',          cat: 'countries', on: false, desc: '🇬🇧 UK community & news' },
    { name: 'canada',                 cat: 'countries', on: false, desc: '🇨🇦 Canada news & community' },
    { name: 'australia',              cat: 'countries', on: false, desc: '🇦🇺 Australia news & community' },
    { name: 'de',                     cat: 'countries', on: false, desc: '🇩🇪 Germany (German-language)' },
    { name: 'france',                 cat: 'countries', on: false, desc: '🇫🇷 France community & news' },
    { name: 'india',                  cat: 'countries', on: false, desc: '🇮🇳 India news & discussion' },
    { name: 'japan',                  cat: 'countries', on: false, desc: '🇯🇵 Japan community & news' },
    { name: 'brasil',                 cat: 'countries', on: false, desc: '🇧🇷 Brazil (Portuguese)' },
    { name: 'southafrica',            cat: 'countries', on: false, desc: '🇿🇦 South Africa news' },
    { name: 'Nigeria',                cat: 'countries', on: false, desc: '🇳🇬 Nigeria community' },
    { name: 'dubai',                  cat: 'countries', on: false, desc: '🇦🇪 UAE / Dubai community' },
    { name: 'singapore',              cat: 'countries', on: false, desc: '🇸🇬 Singapore news & community' },
    { name: 'korea',                  cat: 'countries', on: false, desc: '🇰🇷 South Korea community' },
    { name: 'mexico',                 cat: 'countries', on: false, desc: '🇲🇽 Mexico community & news' },
    { name: 'italy',                  cat: 'countries', on: false, desc: '🇮🇹 Italy community' },
    { name: 'spain',                  cat: 'countries', on: false, desc: '🇪🇸 Spain community' },
    { name: 'thenetherlands',         cat: 'countries', on: false, desc: '🇳🇱 Netherlands community' },
    { name: 'sweden',                 cat: 'countries', on: false, desc: '🇸🇪 Sweden community' },
    { name: 'Polska',                 cat: 'countries', on: false, desc: '🇵🇱 Poland (Polish)' },
    { name: 'Philippines',            cat: 'countries', on: false, desc: '🇵🇭 Philippines news & community' },
    { name: 'ukraine',                cat: 'countries', on: false, desc: '🇺🇦 Ukraine news & community' },
    { name: 'China_irl',              cat: 'countries', on: false, desc: '🇨🇳 China discussion (Chinese)' },
    { name: 'Turkey',                 cat: 'countries', on: false, desc: '🇹🇷 Turkey community' },
    { name: 'Egypt',                  cat: 'countries', on: false, desc: '🇪🇬 Egypt community' },
    { name: 'Thailand',               cat: 'countries', on: false, desc: '🇹🇭 Thailand community' },
    { name: 'indonesia',              cat: 'countries', on: false, desc: '🇮🇩 Indonesia community' },
    { name: 'malaysia',               cat: 'countries', on: false, desc: '🇲🇾 Malaysia community' },
    { name: 'pakistan',                cat: 'countries', on: false, desc: '🇵🇰 Pakistan news & community' },
    { name: 'argentina',              cat: 'countries', on: false, desc: '🇦🇷 Argentina community' },
    { name: 'chile',                  cat: 'countries', on: false, desc: '🇨🇱 Chile community' },
    { name: 'colombia',               cat: 'countries', on: false, desc: '🇨🇴 Colombia community' },
    { name: 'ireland',                cat: 'countries', on: false, desc: '🇮🇪 Ireland community & news' },
    { name: 'newzealand',             cat: 'countries', on: false, desc: '🇳🇿 New Zealand community' },
    { name: 'Switzerland',            cat: 'countries', on: false, desc: '🇨🇭 Switzerland community' },
    { name: 'Austria',                cat: 'countries', on: false, desc: '🇦🇹 Austria community' },
    { name: 'portugal',               cat: 'countries', on: false, desc: '🇵🇹 Portugal community' },
    { name: 'greece',                 cat: 'countries', on: false, desc: '🇬🇷 Greece community' },
    { name: 'Romania',                cat: 'countries', on: false, desc: '🇷🇴 Romania community' },
    { name: 'czech',                  cat: 'countries', on: false, desc: '🇨🇿 Czech Republic community' },
    { name: 'hungary',                cat: 'countries', on: false, desc: '🇭🇺 Hungary community' },
    { name: 'Finland',                cat: 'countries', on: false, desc: '🇫🇮 Finland community' },
    { name: 'Norway',                 cat: 'countries', on: false, desc: '🇳🇴 Norway community' },
    { name: 'Denmark',                cat: 'countries', on: false, desc: '🇩🇰 Denmark community' },
    { name: 'Belgium',                cat: 'countries', on: false, desc: '🇧🇪 Belgium community' },
    { name: 'Israel',                 cat: 'countries', on: false, desc: '🇮🇱 Israel community' },
    { name: 'kenya',                  cat: 'countries', on: false, desc: '🇰🇪 Kenya community' },
    { name: 'ethiopia',               cat: 'countries', on: false, desc: '🇪🇹 Ethiopia community' },
    { name: 'iraq',                   cat: 'countries', on: false, desc: '🇮🇶 Iraq community' },
    { name: 'saudiarabia',            cat: 'countries', on: false, desc: '🇸🇦 Saudi Arabia community' },
    { name: 'bangladesh',             cat: 'countries', on: false, desc: '🇧🇩 Bangladesh community' },
    { name: 'vietnam',                cat: 'countries', on: false, desc: '🇻🇳 Vietnam community' },
    { name: 'Peru',                   cat: 'countries', on: false, desc: '🇵🇪 Peru community' },
    { name: 'venezuela',              cat: 'countries', on: false, desc: '🇻🇪 Venezuela community' },
    { name: 'Morocco',                cat: 'countries', on: false, desc: '🇲🇦 Morocco community' },
    { name: 'Ghana',                  cat: 'countries', on: false, desc: '🇬🇭 Ghana community' },
    { name: 'taiwan',                 cat: 'countries', on: false, desc: '🇹🇼 Taiwan community' },

    // ── Daily Dose / Cool Stuff ──
    { name: 'Damnthatsinteresting',   cat: 'dailydose', on: false, desc: 'Amazing discoveries & stories' },
    { name: 'BeAmazed',               cat: 'dailydose', on: false, desc: 'Jaw-dropping content' },
    { name: 'NatureIsFuckingLit',     cat: 'dailydose', on: false, desc: 'Mind-blowing nature' },
    { name: 'HumansAreMetal',         cat: 'dailydose', on: false, desc: 'Incredible human feats' },
    { name: 'nextfuckinglevel',       cat: 'dailydose', on: false, desc: 'Next level achievements' },
    { name: 'ThatsInsane',            cat: 'dailydose', on: false, desc: 'Insane real-world moments' },
    { name: 'MadeMeSmile',            cat: 'dailydose', on: false, desc: 'Wholesome daily dose' },
    { name: 'OldSchoolCool',          cat: 'dailydose', on: false, desc: 'Cool history moments' },
    { name: 'woahdude',               cat: 'dailydose', on: false, desc: 'Mind-bending content' },
    { name: 'AbsoluteUnits',          cat: 'dailydose', on: false, desc: 'Impressively sized things' },

    // ── Lifestyle / Misc ──
    { name: 'LifeProTips',          cat: 'misc',          on: false, desc: 'Life hacks' },
    { name: 'mildlyinteresting',    cat: 'misc',          on: false, desc: 'Mildly interesting' },
    { name: 'YouShouldKnow',       cat: 'misc',          on: false, desc: 'Useful knowledge' },
    { name: 'coolguides',           cat: 'misc',          on: false, desc: 'Infographics' },
    { name: 'dataisbeautiful',      cat: 'misc',          on: false, desc: 'Data visualisation' }
  ];

  const CATALOG_CATEGORIES = [
    { id: 'trending',      label: '🔥 TRENDING' },
    { id: 'news',           label: '📰 NEWS / WORLD' },
    { id: 'technology',     label: '💻 TECHNOLOGY' },
    { id: 'ai',             label: '🤖 AI / ML' },
    { id: 'science',        label: '🔬 SCIENCE' },
    { id: 'politics',       label: '🏛️ POLITICS' },
    { id: 'finance',        label: '📈 BUSINESS / FINANCE' },
    { id: 'entertainment',  label: '🎬 ENTERTAINMENT' },
    { id: 'sports',         label: '⚽ SPORTS' },
    { id: 'community',      label: '💬 COMMUNITY' },
    { id: 'countries',      label: '🌍 COUNTRIES' },
    { id: 'dailydose',      label: '✨ DAILY DOSE' },
    { id: 'misc',           label: '💡 MISC' }
  ];

  /* ── Subreddit Selection ────────────────────────── */
  function _defaultSubs() {
    return SUBREDDIT_CATALOG.filter(s => s.on).map(s => s.name);
  }

  function getSubreddits() {
    return _get('subreddits', null) || _defaultSubs();
  }

  function setSubreddits(list) {
    _set('subreddits', list);
  }

  function toggleSubreddit(name) {
    const current = getSubreddits();
    const idx = current.indexOf(name);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(name);
    }
    _set('subreddits', current);
    return current;
  }

  function addCustomSubreddit(name) {
    const clean = name.replace(/^r\//, '').replace(/[^a-zA-Z0-9_]/g, '').trim();
    if (!clean) return null;
    // Add to catalog if not already there
    if (!SUBREDDIT_CATALOG.find(s => s.name.toLowerCase() === clean.toLowerCase())) {
      SUBREDDIT_CATALOG.push({ name: clean, cat: 'custom', desc: 'Custom', on: false });
    }
    // Enable it
    const current = getSubreddits();
    if (!current.find(s => s.toLowerCase() === clean.toLowerCase())) {
      current.push(clean);
      _set('subreddits', current);
    }
    // Persist custom subs separately
    const custom = _get('customSubs', []);
    if (!custom.find(s => s.toLowerCase() === clean.toLowerCase())) {
      custom.push(clean);
      _set('customSubs', custom);
    }
    return clean;
  }

  function removeCustomSubreddit(name) {
    const custom = _get('customSubs', []);
    _set('customSubs', custom.filter(s => s.toLowerCase() !== name.toLowerCase()));
    const current = getSubreddits();
    _set('subreddits', current.filter(s => s.toLowerCase() !== name.toLowerCase()));
  }

  function getCustomSubreddits() { return _get('customSubs', []); }

  function getCatalog() { return SUBREDDIT_CATALOG; }
  function getCatalogCategories() { return CATALOG_CATEGORIES; }

  /* ── Bookmarks ──────────────────────────────────── */
  function getBookmarks() { return _get('bookmarks', []); }

  function addBookmark(item) {
    const bm = getBookmarks();
    if (!bm.find(b => b.id === item.id)) {
      bm.unshift(item);
      _set('bookmarks', bm);
    }
  }

  function removeBookmark(id) {
    _set('bookmarks', getBookmarks().filter(b => b.id !== id));
  }

  function isBookmarked(id) {
    return getBookmarks().some(b => b.id === id);
  }

  function clearBookmarks() { _set('bookmarks', []); }

  /* ── Reactions (Like / Dislike / Block / Show Less) ─ */
  function getReactions() { return _get('reactions', {}); }

  function likeItem(id, category, sourceDetail) {
    const r = getReactions();
    r[id] = { type: 'like', category: category || 'general', source: sourceDetail || '' };
    _set('reactions', r);
  }

  function dislikeItem(id, category, sourceDetail) {
    const r = getReactions();
    r[id] = { type: 'dislike', category: category || 'general', source: sourceDetail || '' };
    _set('reactions', r);
  }

  function removeReaction(id) {
    const r = getReactions();
    delete r[id];
    _set('reactions', r);
  }

  function getReaction(id) {
    return (getReactions()[id] || {}).type || null;
  }

  function getBlocked() { return _get('blocked', []); }

  function blockItem(id) {
    const b = getBlocked();
    if (!b.includes(id)) { b.push(id); _set('blocked', b); }
  }

  function unblockItem(id) {
    _set('blocked', getBlocked().filter(x => x !== id));
  }

  function isBlocked(id) { return getBlocked().includes(id); }

  function getShowLess() { return _get('showLess', []); }

  function showLessSource(sourceDetail) {
    const sl = getShowLess();
    if (!sl.includes(sourceDetail)) { sl.push(sourceDetail); _set('showLess', sl); }
  }

  function removeShowLess(sourceDetail) {
    _set('showLess', getShowLess().filter(x => x !== sourceDetail));
  }

  /* ── Interest Tracking ──────────────────────────── */
  function getInterests() { return _get('interests', {}); }

  function trackClick(category) {
    if (!category) return;
    const interests = getInterests();
    interests[category] = (interests[category] || 0) + 1;
    _set('interests', interests);
  }

  function getInterestScore(category) {
    const interests = getInterests();
    const total = Object.values(interests).reduce((s, v) => s + v, 0);
    if (!total) return 0;
    return (interests[category] || 0) / total;
  }

  /* ── Personalised Ranking ───────────────────────── */
  function scoreItem(item) {
    const now = Date.now();
    const ageHours = (now - item.created) / 3600000;

    // Normalize engagement so Reddit doesn't dominate with raw upvotes
    const raw = (item.score || 0) + (item.comments || 0) * 2;
    let engagement;
    if (item.source === 'reddit') {
      // Log-scale: compresses 10k upvotes vs 100, prevents Reddit dominance
      engagement = Math.log10(raw + 1) * 15;
    } else if (item.source === 'hackernews') {
      engagement = Math.log10(raw + 1) * 18;
    } else {
      // Non-social sources (RSS, NewsAPI, Guardian, GNews, etc.) get a solid baseline
      engagement = 30;
    }

    const interestBoost = 1 + getInterestScore(item.category) * 4;

    // Boost items from subreddits the user has explicitly selected
    const selectedSubs = getSubreddits();
    const subDetail = (item.sourceDetail || '').replace('r/', '');
    const subBoost = selectedSubs.some(s => s.toLowerCase() === subDetail.toLowerCase()) ? 1.3 : 1.0;

    // Reaction-based category boost/penalty
    const reactions = getReactions();
    let catLikes = 0, catDislikes = 0;
    for (const r of Object.values(reactions)) {
      if (r.category === item.category) {
        if (r.type === 'like') catLikes++;
        else if (r.type === 'dislike') catDislikes++;
      }
    }
    const reactionMul = Math.max(0.1, 1 + (catLikes * 0.15) - (catDislikes * 0.25));

    // Show-less source penalty
    const showLessMul = getShowLess().includes(item.sourceDetail) ? 0.2 : 1.0;

    const recencyDecay = Math.pow(ageHours + 2, 1.3);
    return (engagement * interestBoost * subBoost * reactionMul * showLessMul + 1) / recencyDecay;
  }

  function rankItems(items, sortMode = 'ranked') {
    const blockedIds = getBlocked();
    const filtered = items.filter(i => !blockedIds.includes(i.id));
    if (sortMode === 'newest') {
      return filtered.sort((a, b) => (b.created || 0) - (a.created || 0));
    }
    if (sortMode === 'oldest') {
      return filtered.sort((a, b) => (a.created || 0) - (b.created || 0));
    }
    // Default: ranked
    return filtered
      .map(i => ({ ...i, _rank: scoreItem(i) }))
      .sort((a, b) => b._rank - a._rank);
  }

  /* ── Settings ───────────────────────────────────── */
  const DEFAULT_SETTINGS = {
    refreshInterval: 120,
    crtEffect: true,
    radarSpeed: 'normal',
    sound: false,
    country: 'auto'
  };

  function getSettings() { return { ...DEFAULT_SETTINGS, ..._get('settings', {}) }; }

  function saveSetting(key, val) {
    const s = getSettings();
    s[key] = val;
    _set('settings', s);
  }

  /* ── Cloud Sync Helpers ─────────────────────────── */
  function exportAll() {
    return {
      subreddits: getSubreddits(),
      customSubs: getCustomSubreddits(),
      interests: getInterests(),
      settings: _get('settings', {}),
      bookmarks: getBookmarks(),
      reactions: getReactions(),
      blocked: getBlocked(),
      showLess: getShowLess()
    };
  }

  function importAll(data) {
    _importing = true;
    if (data.subreddits !== undefined) _set('subreddits', data.subreddits);
    if (data.customSubs !== undefined) _set('customSubs', data.customSubs);
    if (data.interests !== undefined) _set('interests', data.interests);
    if (data.settings !== undefined) _set('settings', data.settings);
    if (data.bookmarks !== undefined) _set('bookmarks', data.bookmarks);
    if (data.reactions !== undefined) _set('reactions', data.reactions);
    if (data.blocked !== undefined) _set('blocked', data.blocked);
    if (data.showLess !== undefined) _set('showLess', data.showLess);
    _importing = false;
  }

  /* ── Reset ──────────────────────────────────────── */
  function clearAll() {
    ['bookmarks', 'interests', 'settings', 'subreddits', 'customSubs', 'reactions', 'blocked', 'showLess'].forEach(k =>
      localStorage.removeItem(PREFIX + k)
    );
  }

  return {
    getBookmarks, addBookmark, removeBookmark, isBookmarked, clearBookmarks,
    getReactions, likeItem, dislikeItem, removeReaction, getReaction,
    getBlocked, blockItem, unblockItem, isBlocked,
    getShowLess, showLessSource, removeShowLess,
    getInterests, trackClick, getInterestScore,
    scoreItem, rankItems,
    getSettings, saveSetting,
    getSubreddits, setSubreddits, toggleSubreddit,
    addCustomSubreddit, removeCustomSubreddit, getCustomSubreddits,
    getCatalog, getCatalogCategories,
    exportAll, importAll, onSync,
    clearAll
  };
})();
