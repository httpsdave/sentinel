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
    'republicans','geopolitics','uspolitics','ukpolitics','europe','law',
    'CredibleDefense'],
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
    'india','china','japan','korea','ukraine','europe'],
  community: ['askreddit','todayilearned','explainlikeimfive','amitheasshole',
    'showerthoughts','unpopularopinion','changemyview','nostupidquestions',
    'tooafraidtoask','tifu','confessions','relationship_advice','trueoffmychest']
};

const CAT_KEYWORDS = {
  technology: /\b(tech|software|app|ai |robot|cyber|hack|code|program|chip|gpu|startup|openai|google|apple|microsoft|amazon|meta )\b/i,
  politics: /\b(politi|elect|president|congress|senat|govern|vote|democrat|republican|trump|biden|parliament|minister|law|court|judge|ruling)\b/i,
  science: /\b(scien|study|research|discover|space|nasa|climate|species|fossil|quantum|telescope|mars|moon)\b/i,
  business: /\b(market|stock|econom|financ|bank|crypto|bitcoin|invest|billion|million|ceo|company|revenue|profit|trade|tariff)\b/i,
  entertainment: /\b(movie|film|music|game|tv show|actor|actress|album|song|stream|netflix|disney|concert|award|grammy|oscar)\b/i,
  sports: /\b(team|player|game|score|champion|league|cup|match|season|coach|nba|nfl|fifa|goal|win |lost )\b/i,
  world: /\b(war|conflict|bomb|missile|military|troops|refugee|humanitarian|sanction|treaty|border|crisis)\b/i,
  community: /\b(AITA|YTA|NTA|ELI5|TIL |ask reddit|what is|how do|why do|what would|does anyone|am i the|today i learned|explain like)\b/i
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
   LOCAL NEWS COUNTRY SUBREDDITS — country-specific subs
   ═══════════════════════════════════════════════════ */
const COUNTRY_SUBS = {
  us: ['news','politics','usa'],
  gb: ['ukpolitics','unitedkingdom','CasualUK'],
  ca: ['canada','canadapolitics','onguardforthee'],
  au: ['australia','AustralianPolitics'],
  de: ['de','germany'],
  fr: ['france','French'],
  in: ['india','IndiaSpeaks','indianews'],
  jp: ['japan','newsokur'],
  br: ['brasil','BrazilNews'],
  za: ['southafrica'],
  ng: ['Nigeria'],
  ae: ['dubai','UAE'],
  sg: ['singapore'],
  kr: ['korea'],
  mx: ['mexico'],
  it: ['italy'],
  es: ['spain','es'],
  nl: ['thenetherlands'],
  se: ['sweden'],
  pl: ['Polska','poland'],
  ph: ['Philippines','phinvest','CasualPH','PHClassifieds']
};

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
   THE GUARDIAN — Open Platform API (free, no key required
   for basic access — uses 'test' key)
   ═══════════════════════════════════════════════════ */
async function _fetchGuardian(section = '', limit = 25) {
  const ck = `guardian:${section}:${limit}`;
  const hit = cached(ck);
  if (hit) return hit;

  try {
    let url = `https://content.guardianapis.com/search?api-key=test&page-size=${limit}&show-fields=thumbnail,trailText&order-by=newest`;
    if (section) url += `&section=${encodeURIComponent(section)}`;

    const data = await httpGet(url);
    if (!data || !data.response || !data.response.results) return [];

    const items = data.response.results.map(a => ({
      id: 'guardian_' + (a.id || '').replace(/[^a-z0-9]/gi, '_'),
      title: a.webTitle || '',
      url: a.webUrl || '',
      permalink: a.webUrl || '',
      source: 'guardian',
      sourceDetail: 'The Guardian',
      score: 0,
      comments: 0,
      thumbnail: a.fields?.thumbnail || null,
      created: a.webPublicationDate ? new Date(a.webPublicationDate).getTime() : Date.now(),
      author: '',
      snippet: (a.fields?.trailText || '').replace(/<[^>]+>/g, '').substring(0, 250),
      domain: 'theguardian.com',
      category: guessCategory(a.sectionId || '', a.webTitle || '')
    }));

    setCache(ck, items);
    return items;
  } catch (err) {
    console.error('[GUARDIAN]', err.message);
    return [];
  }
}

/* ═══════════════════════════════════════════════════
   WIKINEWS — Free RSS feed
   ═══════════════════════════════════════════════════ */
async function _fetchWikinews() {
  const ck = 'wikinews';
  const hit = cached(ck);
  if (hit) return hit;

  try {
    const feed = await rssParser.parseURL('https://en.wikinews.org/w/index.php?title=Special:NewsFeed&feed=rss');
    const items = (feed.items || []).slice(0, 20).map(item => ({
      id: 'wiki_' + (item.guid || item.link || item.title || '').replace(/[^a-z0-9]/gi, '_').substring(0, 80),
      title: item.title || '',
      url: item.link || '',
      permalink: item.link || '',
      source: 'wikinews',
      sourceDetail: 'WikiNews',
      score: 0,
      comments: 0,
      thumbnail: null,
      created: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
      author: item.creator || '',
      snippet: (item.contentSnippet || '').substring(0, 250).replace(/<[^>]+>/g, ''),
      domain: 'en.wikinews.org',
      category: guessCategory('world', item.title || '')
    }));

    setCache(ck, items);
    return items;
  } catch (err) {
    console.error('[WIKINEWS]', err.message);
    return [];
  }
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
   COMMENTS — Fetch discussion threads from source
   Reddit: top-level comments from permalink
   HN: recursive kid fetch (depth 2)
   ═══════════════════════════════════════════════════ */
app.get('/api/comments', async (req, res) => {
  try {
    const { source, permalink, id } = req.query;

    if (source === 'reddit' && permalink) {
      // permalink should be path like /r/technology/comments/abc/title/
      const url = `https://www.reddit.com${permalink}.json?limit=15&depth=2&sort=top`;
      const data = await httpGet(url, { 'User-Agent': 'Sentinel/1.0 (news aggregator; compatible)' });
      const comments = [];
      if (Array.isArray(data) && data[1]?.data?.children) {
        for (const c of data[1].data.children.slice(0, 15)) {
          if (c.kind !== 't1') continue;
          const d = c.data;
          const replies = [];
          if (d.replies?.data?.children) {
            for (const r of d.replies.data.children.slice(0, 3)) {
              if (r.kind !== 't1') continue;
              replies.push({
                author: r.data.author || '[deleted]',
                text: (r.data.body || '').substring(0, 500),
                score: r.data.score || 0,
                time: (r.data.created_utc || 0) * 1000
              });
            }
          }
          comments.push({
            author: d.author || '[deleted]',
            text: (d.body || '').substring(0, 800),
            score: d.score || 0,
            time: (d.created_utc || 0) * 1000,
            replies
          });
        }
      }
      return res.json({ source: 'reddit', comments });
    }

    if (source === 'hackernews' && id) {
      const item = await httpGet(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      const comments = [];
      const kids = (item.kids || []).slice(0, 12);

      for (const kidId of kids) {
        try {
          const kid = await httpGet(`https://hacker-news.firebaseio.com/v0/item/${kidId}.json`);
          if (!kid || kid.deleted || kid.dead) continue;
          const replies = [];
          for (const replyId of (kid.kids || []).slice(0, 3)) {
            try {
              const reply = await httpGet(`https://hacker-news.firebaseio.com/v0/item/${replyId}.json`);
              if (reply && !reply.deleted && !reply.dead) {
                replies.push({
                  author: reply.by || 'anon',
                  text: (reply.text || '').replace(/<[^>]+>/g, '').substring(0, 500),
                  score: reply.score || 0,
                  time: (reply.time || 0) * 1000
                });
              }
            } catch {}
          }
          comments.push({
            author: kid.by || 'anon',
            text: (kid.text || '').replace(/<[^>]+>/g, '').substring(0, 800),
            score: kid.score || 0,
            time: (kid.time || 0) * 1000,
            replies
          });
        } catch {}
      }
      return res.json({ source: 'hackernews', comments });
    }

    res.json({ source: source || 'unknown', comments: [] });
  } catch (e) {
    console.error('[COMMENTS]', e.message);
    res.json({ source: req.query.source || 'unknown', comments: [] });
  }
});

/* ═══════════════════════════════════════════════════
   AGGREGATED FEED
   Reddit fetched SEQUENTIALLY with delays to avoid
   rate-limiting. Never returns 500 — always returns [].
   ═══════════════════════════════════════════════════ */
app.get('/api/feed', async (req, res) => {
  try {
    const { category, search, subs, country } = req.query;

    // Non-Reddit sources in parallel
    const [hn, rss, news, guardian, wikinews] = await Promise.all([
      _fetchHN('top', 30).catch(e => { console.error('[FEED/HN]', e.message); return []; }),
      _fetchRSS().catch(e => { console.error('[FEED/RSS]', e.message); return []; }),
      _fetchNews('', category || 'general').catch(e => { console.error('[FEED/NEWS]', e.message); return []; }),
      _fetchGuardian('', 25).catch(e => { console.error('[FEED/GUARDIAN]', e.message); return []; }),
      _fetchWikinews().catch(e => { console.error('[FEED/WIKINEWS]', e.message); return []; }),
    ]);

    // Reddit — accept custom list from frontend, or use defaults
    // Fetched sequentially with delays to dodge rate-limits
    const DEFAULT_REDDIT_SUBS = ['popular','worldnews','technology','science','news','business',
      'artificial','MachineLearning','ChatGPT','interestingasfuck',
      'UpliftingNews','nottheonion','geopolitics','economics','Futurology',
      'space','movies','gaming','programming','CredibleDefense'];
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

    // Local news: add country-specific Reddit subs
    const localPosts = [];
    if (country && country !== 'auto' && COUNTRY_SUBS[country]) {
      const localSubs = COUNTRY_SUBS[country].filter(s => !requestedSubs.includes(s));
      for (let i = 0; i < localSubs.length; i += BATCH_SIZE) {
        const batch = localSubs.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(sub => _fetchReddit(sub, 'hot', 10))
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) localPosts.push(...r.value);
        }
        if (i + BATCH_SIZE < localSubs.length) await sleep(200);
      }
    }

    let items = [...hn, ...rss, ...news, ...guardian, ...wikinews, ...redditPosts, ...localPosts];
    console.log(`[FEED] HN=${hn.length} RSS=${rss.length} News=${news.length} Guardian=${guardian.length} WikiNews=${wikinews.length} Reddit=${redditPosts.length} Local=${localPosts.length} Total=${items.length}`);

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
      newsapi: !!process.env.NEWSAPI_KEY,
      guardian: true,
      wikinews: true
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
