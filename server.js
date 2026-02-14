require('dotenv').config();
const express = require('express');
const RSSParser = require('rss-parser');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const rssParser = new RSSParser({ timeout: 10000 });
const PORT = process.env.PORT || 3000;

/* ═══════════════════════════════════════════════════
   CACHE — 5 min TTL to stay under rate limits
   ═══════════════════════════════════════════════════ */
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function cached(key) {
  const e = cache.get(key);
  if (e && Date.now() - e.t < CACHE_TTL) return e.d;
  return null;
}
function setCache(key, d) { cache.set(key, { d, t: Date.now() }); }

/* ═══════════════════════════════════════════════════
   HTTP GET — uses native https, follows redirects,
   works on ALL Node.js versions
   ═══════════════════════════════════════════════════ */
function httpGet(url, headers = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    const mod = url.startsWith('https') ? https : http;
    const opts = {
      headers: { 'Accept': 'application/json', ...headers },
      timeout: 15000
    };

    const req = mod.get(url, opts, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redir = res.headers.location;
        if (redir.startsWith('/')) {
          const u = new URL(url);
          redir = u.origin + redir;
        }
        res.resume();
        return httpGet(redir, headers, maxRedirects - 1).then(resolve, reject);
      }

      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url.split('?')[0]}`));
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`JSON parse failed (status ${res.statusCode}) from ${url.split('?')[0]}`)); }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout: ' + url.split('?')[0])); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ═══════════════════════════════════════════════════
   CATEGORY GUESSER
   ═══════════════════════════════════════════════════ */
const CAT_SUBS = {
  technology: ['technology','programming','javascript','python','webdev','coding',
    'linux','apple','android','tech','gadgets','software','hardware',
    'machinelearning','artificial','cybersecurity','netsec','hacking',
    'devops','gamedev','compsci','datascience','ChatGPT','openai','singularity'],
  politics: ['politics','worldnews','news','conservative','liberal','democrats',
    'republicans','geopolitics','uspolitics','ukpolitics','europe','law'],
  science: ['science','space','physics','biology','chemistry','astronomy',
    'environment','climate','nature','earthscience','futurology'],
  business: ['business','economics','finance','stocks','investing',
    'wallstreetbets','cryptocurrency','bitcoin','entrepreneur','startups',
    'personalfinance','economy'],
  entertainment: ['movies','television','music','gaming','books','anime',
    'comics','entertainment','celebs','popculture','netflix','marvel',
    'starwars','hiphopheads','indieheads'],
  sports: ['sports','nba','nfl','soccer','football','baseball','hockey',
    'mma','formula1','tennis','olympics','running','golf'],
  world: ['worldnews','internationalnews','middleeast','asia','africa',
    'india','china','japan','korea','ukraine','europe']
};

const CAT_KEYWORDS = {
  technology: /\b(tech|software|app|ai |robot|cyber|hack|code|program|chip|gpu|startup|openai|google|apple|microsoft|amazon|meta )\b/i,
  politics: /\b(politi|elect|president|congress|senat|govern|vote|democrat|republican|trump|biden|parliament|minister|law|court|judge|ruling)\b/i,
  science: /\b(scien|study|research|discover|space|nasa|climate|species|fossil|quantum|telescope|mars|moon)\b/i,
  business: /\b(market|stock|econom|financ|bank|crypto|bitcoin|invest|billion|million|ceo|company|revenue|profit|trade|tariff)\b/i,
  entertainment: /\b(movie|film|music|game|tv show|actor|actress|album|song|stream|netflix|disney|concert|award|grammy|oscar)\b/i,
  sports: /\b(team|player|game|score|champion|league|cup|match|season|coach|nba|nfl|fifa|goal|win |lost )\b/i,
  world: /\b(war|conflict|bomb|missile|military|troops|refugee|humanitarian|sanction|treaty|border|crisis)\b/i
};

function guessCategory(subreddit, title) {
  const sub = (subreddit || '').toLowerCase();
  for (const [cat, subs] of Object.entries(CAT_SUBS)) {
    if (subs.some(s => sub.includes(s))) return cat;
  }
  const t = title || '';
  for (const [cat, rx] of Object.entries(CAT_KEYWORDS)) {
    if (rx.test(t)) return cat;
  }
  return 'general';
}

/* ═══════════════════════════════════════════════════
   MIDDLEWARE
   ═══════════════════════════════════════════════════ */
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/* ═══════════════════════════════════════════════════
   RSS FEEDS  (no auth required)
   ═══════════════════════════════════════════════════ */
const DEFAULT_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/rss.xml', name: 'BBC News', cat: 'world' },
  { url: 'https://rss.cnn.com/rss/edition.rss', name: 'CNN', cat: 'world' },
  { url: 'https://techcrunch.com/feed/', name: 'TechCrunch', cat: 'technology' },
  { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge', cat: 'technology' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica', cat: 'technology' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', name: 'NY Times', cat: 'world' }
];

/* ═══════════════════════════════════════════════════
   INTERNAL DATA FETCHERS
   ═══════════════════════════════════════════════════ */
async function _fetchReddit(subreddit = 'popular', sort = 'hot', limit = 25, t = 'day') {
  const ck = `reddit:${subreddit}:${sort}:${limit}:${t}`;
  const hit = cached(ck);
  if (hit) return hit;

  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=${t}&raw_json=1`;
  const json = await httpGet(url, { 'User-Agent': 'Sentinel/1.0 (news aggregator; compatible)' });

  if (!json || !json.data || !json.data.children) {
    console.warn(`[REDDIT] Unexpected response shape for r/${subreddit}`);
    return [];
  }

  const posts = json.data.children
    .filter(c => c && c.data && !c.data.over_18 && !c.data.stickied)
    .map(c => ({
      id: 'r_' + c.data.id,
      title: c.data.title || '',
      url: c.data.url || '',
      permalink: 'https://reddit.com' + (c.data.permalink || ''),
      source: 'reddit',
      sourceDetail: 'r/' + c.data.subreddit,
      score: c.data.score || 0,
      comments: c.data.num_comments || 0,
      thumbnail: c.data.thumbnail &&
        !['self','default','nsfw','spoiler','image',''].includes(c.data.thumbnail)
        ? c.data.thumbnail : null,
      created: (c.data.created_utc || 0) * 1000,
      author: c.data.author || '',
      snippet: (c.data.selftext || '').substring(0, 250),
      domain: c.data.domain || '',
      category: guessCategory(c.data.subreddit, c.data.title)
    }));

  setCache(ck, posts);
  return posts;
}

async function _fetchHN(type = 'top', limit = 30) {
  const ck = `hn:${type}:${limit}`;
  const hit = cached(ck);
  if (hit) return hit;

  const allIds = await httpGet(`https://hacker-news.firebaseio.com/v0/${type}stories.json`);
  if (!Array.isArray(allIds)) return [];
  const ids = allIds.slice(0, parseInt(limit));

  const items = await Promise.all(
    ids.map(id =>
      httpGet(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
        .catch(() => null)
    )
  );

  const posts = items.filter(i => i && i.title).map(item => {
    let domain = 'news.ycombinator.com';
    try { if (item.url) domain = new URL(item.url).hostname.replace('www.', ''); } catch {}
    return {
      id: 'hn_' + item.id,
      title: item.title || '',
      url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      permalink: `https://news.ycombinator.com/item?id=${item.id}`,
      source: 'hackernews',
      sourceDetail: 'Hacker News',
      score: item.score || 0,
      comments: item.descendants || 0,
      thumbnail: null,
      created: (item.time || 0) * 1000,
      author: item.by || '',
      snippet: '',
      domain,
      category: guessCategory('technology', item.title)
    };
  });

  setCache(ck, posts);
  return posts;
}

async function _fetchNews(q = '', category = 'general', country = 'us', limit = 20) {
  const key = process.env.NEWSAPI_KEY;
  if (!key) return [];

  const ck = `news:${q}:${category}:${country}:${limit}`;
  const hit = cached(ck);
  if (hit) return hit;

  let url;
  if (q) {
    url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=${limit}&sortBy=popularity&apiKey=${key}`;
  } else {
    url = `https://newsapi.org/v2/top-headlines?category=${category}&country=${country}&pageSize=${limit}&apiKey=${key}`;
  }

  const json = await httpGet(url);
  const posts = (json.articles || [])
    .filter(a => a && a.title && a.title !== '[Removed]')
    .map((a, i) => ({
      id: 'na_' + Date.now() + '_' + i,
      title: a.title || '',
      url: a.url || '',
      permalink: a.url || '',
      source: 'newsapi',
      sourceDetail: (a.source && a.source.name) || 'News',
      score: 0,
      comments: 0,
      thumbnail: a.urlToImage || null,
      created: a.publishedAt ? new Date(a.publishedAt).getTime() : Date.now(),
      author: a.author || '',
      snippet: (a.description || '').substring(0, 250),
      domain: (a.source && a.source.name) || '',
      category: guessCategory('', a.title)
    }));

  setCache(ck, posts);
  return posts;
}

async function _fetchRSS() {
  const ck = 'rss:all';
  const hit = cached(ck);
  if (hit) return hit;

  const results = await Promise.allSettled(
    DEFAULT_FEEDS.map(async (f) => {
      try {
        const feed = await rssParser.parseURL(f.url);
        return (feed.items || []).slice(0, 10).map((item, i) => ({
          id: 'rss_' + Buffer.from(item.link || f.url + i).toString('base64').substring(0, 16),
          title: item.title || '',
          url: item.link || '',
          permalink: item.link || '',
          source: 'rss',
          sourceDetail: f.name,
          score: 0,
          comments: 0,
          thumbnail: (item.enclosure && item.enclosure.url) || null,
          created: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
          author: item.creator || item.author || '',
          snippet: (item.contentSnippet || '').substring(0, 250).replace(/<[^>]+>/g, ''),
          domain: f.name,
          category: guessCategory(f.cat, item.title)
        }));
      } catch (err) {
        console.error(`[RSS] ${f.name}: ${err.message}`);
        return [];
      }
    })
  );

  const posts = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  setCache(ck, posts);
  return posts;
}

/* ═══════════════════════════════════════════════════
   ROUTE HANDLERS
   ═══════════════════════════════════════════════════ */
app.get('/api/reddit', async (req, res) => {
  try {
    res.json(await _fetchReddit(req.query.subreddit, req.query.sort, req.query.limit, req.query.t));
  } catch (e) { console.error('[REDDIT]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/hackernews', async (req, res) => {
  try {
    res.json(await _fetchHN(req.query.type, req.query.limit));
  } catch (e) { console.error('[HN]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/news', async (req, res) => {
  try {
    res.json(await _fetchNews(req.query.q, req.query.category, req.query.country, req.query.limit));
  } catch (e) { console.error('[NEWSAPI]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/rss', async (req, res) => {
  try {
    res.json(await _fetchRSS());
  } catch (e) { console.error('[RSS]', e.message); res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   AGGREGATED FEED
   Reddit fetched SEQUENTIALLY with delays to avoid
   rate-limiting. Never returns 500 — always returns [].
   ═══════════════════════════════════════════════════ */
app.get('/api/feed', async (req, res) => {
  try {
    const { category, search, subs } = req.query;

    // Non-Reddit sources in parallel
    const [hn, rss, news] = await Promise.all([
      _fetchHN('top', 30).catch(e => { console.error('[FEED/HN]', e.message); return []; }),
      _fetchRSS().catch(e => { console.error('[FEED/RSS]', e.message); return []; }),
      _fetchNews('', category || 'general').catch(e => { console.error('[FEED/NEWS]', e.message); return []; }),
    ]);

    // Reddit — accept custom list from frontend, or use defaults
    // Fetched sequentially with delays to dodge rate-limits
    const DEFAULT_REDDIT_SUBS = ['popular','worldnews','technology','science','news','business',
      'artificial','MachineLearning','ChatGPT','todayilearned','interestingasfuck',
      'UpliftingNews','nottheonion','geopolitics','economics','Futurology',
      'space','movies','gaming','programming'];
    const requestedSubs = subs
      ? subs.split(',').map(s => s.trim()).filter(Boolean).slice(0, 25)
      : DEFAULT_REDDIT_SUBS;

    // Fetch Reddit in parallel batches of 4 (balances speed vs rate-limiting)
    const BATCH_SIZE = 4;
    const redditPosts = [];
    for (let i = 0; i < requestedSubs.length; i += BATCH_SIZE) {
      const batch = requestedSubs.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(sub => _fetchReddit(sub, 'hot', 15))
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) redditPosts.push(...r.value);
        else if (r.status === 'rejected') console.error('[FEED/R]', r.reason?.message);
      }
      if (i + BATCH_SIZE < requestedSubs.length) await sleep(200);
    }

    let items = [...hn, ...rss, ...news, ...redditPosts];
    console.log(`[FEED] HN=${hn.length} RSS=${rss.length} News=${news.length} Reddit=${redditPosts.length} Total=${items.length}`);

    // De-duplicate
    const seen = new Set();
    items = items.filter(item => {
      if (!item || !item.title) return false;
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (category && category !== 'all') {
      items = items.filter(i => i.category === category);
    }

    if (search) {
      const s = search.toLowerCase();
      items = items.filter(i =>
        (i.title || '').toLowerCase().includes(s) ||
        (i.snippet || '').toLowerCase().includes(s)
      );
    }

    const now = Date.now();
    items.sort((a, b) => {
      const sa = ((a.score || 0) + (a.comments || 0) * 2 + 1) / Math.pow(((now - (a.created || 0)) / 3600000) + 2, 1.4);
      const sb = ((b.score || 0) + (b.comments || 0) * 2 + 1) / Math.pow(((now - (b.created || 0)) / 3600000) + 2, 1.4);
      return sb - sa;
    });

    res.json(items.slice(0, 150));
  } catch (e) {
    // NEVER 500 — always return empty array as fallback
    console.error('[FEED] CRITICAL:', e);
    res.json([]);
  }
});

/* ═══════════════════════════════════════════════════
   CONFIG — public Supabase keys for frontend auth
   ═══════════════════════════════════════════════════ */
app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

/* ═══════════════════════════════════════════════════
   STATUS
   ═══════════════════════════════════════════════════ */
app.get('/api/status', (_req, res) => {
  res.json({
    sources: {
      reddit: true,
      hackernews: true,
      rss: true,
      newsapi: !!process.env.NEWSAPI_KEY
    },
    cacheEntries: cache.size,
    uptime: Math.floor(process.uptime())
  });
});

/* ═══════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════
   BOOT — conditional for Vercel vs local
   ═══════════════════════════════════════════════════ */
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('');
    console.log('  ███████╗███████╗███╗   ██╗████████╗██╗███╗   ██╗███████╗██║     ');
    console.log('  ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██║████╗  ██║██╔════╝██║     ');
    console.log('  ███████╗█████╗  ██╔██╗ ██║   ██║   ██║██╔██╗ ██║█████╗  ██║     ');
    console.log('  ╚════██║██╔══╝  ██║╚██╗██║   ██║   ██║██║╚██╗██║██╔══╝  ██║     ');
    console.log('  ███████║███████╗██║ ╚████║   ██║   ██║██║ ╚████║███████╗███████╗');
    console.log('  ╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝');
    console.log('');
    console.log('  ▸ Intelligence Platform Online');
    console.log(`  ▸ Port: ${PORT}`);
    console.log(`  ▸ Node: ${process.version}`);
    console.log(`  ▸ Supabase: ${process.env.SUPABASE_URL ? 'CONFIGURED' : 'NOT SET (guest mode)'}`);
    console.log(`  ▸ NewsAPI: ${process.env.NEWSAPI_KEY ? 'CONFIGURED' : 'NOT SET (optional)'}`);
    console.log(`  ▸ Open: http://localhost:${PORT}`);
    console.log('');
  });
}

// Export for Vercel serverless
module.exports = app;
