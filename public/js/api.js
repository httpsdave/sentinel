/* ═══════════════════════════════════════════════════
   API — Frontend fetch client
   ═══════════════════════════════════════════════════ */
const API = (() => {

  async function _json(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function getFeed(opts = {}) {
    const p = new URLSearchParams();
    if (opts.category && opts.category !== 'all') p.set('category', opts.category);
    if (opts.search) p.set('search', opts.search);
    if (opts.country && opts.country !== 'auto') p.set('country', opts.country);
    // Send user's selected subreddits
    const subs = Store.getSubreddits();
    if (subs && subs.length) p.set('subs', subs.join(','));
    return _json('/api/feed?' + p);
  }

  async function getReddit(subreddit = 'popular', limit = 25) {
    return _json(`/api/reddit?subreddit=${encodeURIComponent(subreddit)}&limit=${limit}`);
  }

  async function getHackerNews(type = 'top', limit = 30) {
    return _json(`/api/hackernews?type=${type}&limit=${limit}`);
  }

  async function getNews(query = '', category = 'general') {
    return _json(`/api/news?q=${encodeURIComponent(query)}&category=${category}`);
  }

  async function getRSS() {
    return _json('/api/rss');
  }

  async function getStatus() {
    return _json('/api/status');
  }

  async function getComments(source, params = {}) {
    const qs = new URLSearchParams({ source, ...params });
    return _json('/api/comments?' + qs);
  }

  return { getFeed, getReddit, getHackerNews, getNews, getRSS, getStatus, getComments };
})();
