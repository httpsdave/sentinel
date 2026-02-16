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
  esports: ['esports','leagueoflegends','competitiveoverwatch','valorant',
    'globaloffensive','dota2','rocketleagueesports','r6proleague',
    'competitiveapex','smashbros','fgc','competitivetft',
    'codzombies','codcompetitive','competitivehalo','starcraft',
    'competitivefortnite','mlbbprofessional'],
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
  esports: /\b(esport|e-sport|league of legends|valorant|counter.strike|dota ?2|overwatch.league|rocket.league.champ|LoL|CSGO|CS2|LCS|LEC|LCK|LPL|worlds 20|major 20|VCT|CDL|OWL|RLCS|smash|tekken|street fighter|EVO |FGC|pro player|pro team|tournament|grand final|playoff|scrims|bootcamp|fnatic|t1 |g2 |cloud9|team liquid|100 thieves|sentinels|navi|faze |gen\.?g|drx |loud )\b/i,
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
  /* ── World / General ─────────────────────────── */
  { url: 'https://feeds.bbci.co.uk/news/rss.xml', name: 'BBC News', cat: 'world' },
  { url: 'https://rss.cnn.com/rss/edition_world.rss', name: 'CNN World', cat: 'world' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', name: 'NY Times', cat: 'world' },
  { url: 'https://feeds.npr.org/1001/rss.xml', name: 'NPR News', cat: 'world' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', name: 'Al Jazeera', cat: 'world' },
  { url: 'https://moxie.foxnews.com/google-publisher/world.xml', name: 'Fox News World', cat: 'world' },
  { url: 'https://abcnews.go.com/abcnews/topstories', name: 'ABC News', cat: 'world' },
  { url: 'https://www.independent.co.uk/news/world/rss', name: 'The Independent', cat: 'world' },
  { url: 'https://www.latimes.com/world-nation/rss2.0.xml', name: 'LA Times', cat: 'world' },
  { url: 'https://feeds.skynews.com/feeds/rss/world.xml', name: 'Sky News', cat: 'world' },
  { url: 'https://www.cbsnews.com/latest/rss/main', name: 'CBS News', cat: 'world' },
  { url: 'https://rss.dw.com/rdf/rss-en-all', name: 'DW News', cat: 'world' },
  { url: 'https://www.france24.com/en/rss', name: 'France 24', cat: 'world' },
  /* ── Technology ──────────────────────────────── */
  { url: 'https://techcrunch.com/feed/', name: 'TechCrunch', cat: 'technology' },
  { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge', cat: 'technology' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica', cat: 'technology' },
  { url: 'https://www.wired.com/feed/rss', name: 'Wired', cat: 'technology' },
  { url: 'https://www.techradar.com/rss', name: 'TechRadar', cat: 'technology' },
  { url: 'https://www.zdnet.com/news/rss.xml', name: 'ZDNet', cat: 'technology' },
  { url: 'https://9to5google.com/feed/', name: '9to5Google', cat: 'technology' },
  { url: 'https://9to5mac.com/feed/', name: '9to5Mac', cat: 'technology' },
  { url: 'https://www.engadget.com/rss.xml', name: 'Engadget', cat: 'technology' },
  { url: 'https://feeds.feedburner.com/venturebeat/SZYF', name: 'VentureBeat', cat: 'technology' },
  /* ── Science ─────────────────────────────────── */
  { url: 'https://www.sciencedaily.com/rss/all.xml', name: 'Science Daily', cat: 'science' },
  { url: 'https://www.newscientist.com/section/news/feed/', name: 'New Scientist', cat: 'science' },
  { url: 'https://phys.org/rss-feed/', name: 'Phys.org', cat: 'science' },
  { url: 'https://www.space.com/feeds/all', name: 'Space.com', cat: 'science' },
  /* ── Business / Economy ─────────────────────── */
  { url: 'https://feeds.bloomberg.com/markets/news.rss', name: 'Bloomberg', cat: 'business' },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', name: 'CNBC', cat: 'business' },
  { url: 'https://fortune.com/feed', name: 'Fortune', cat: 'business' },
  /* ── Politics ────────────────────────────────── */
  { url: 'https://thehill.com/feed/', name: 'The Hill', cat: 'politics' },
  { url: 'https://feeds.feedburner.com/realclearpolitics/qlMj', name: 'RealClearPolitics', cat: 'politics' },
  /* ── Entertainment / Sports ──────────────────── */
  { url: 'https://www.cbssports.com/rss/headlines/', name: 'CBS Sports', cat: 'sports' },
  { url: 'https://variety.com/feed/', name: 'Variety', cat: 'entertainment' },
  { url: 'https://www.rollingstone.com/feed/', name: 'Rolling Stone', cat: 'entertainment' },
  /* ── Esports ─────────────────────────────────── */
  { url: 'https://www.hltv.org/rss/news', name: 'HLTV', cat: 'esports' },
  { url: 'https://dotesports.com/feed', name: 'Dot Esports', cat: 'esports' },
  { url: 'https://www.dexerto.com/feed/', name: 'Dexerto', cat: 'esports' },
  { url: 'https://esportsinsider.com/feed', name: 'Esports Insider', cat: 'esports' },
  { url: 'https://www.invenglobal.com/rss', name: 'Inven Global', cat: 'esports' },
  { url: 'https://www.vpesports.com/feed', name: 'VP Esports', cat: 'esports' },
  /* ── Health ─────────────────────────────────── */
  { url: 'https://www.livescience.com/feeds/all', name: 'Live Science', cat: 'science' },
  { url: 'https://www.statnews.com/feed/', name: 'STAT News', cat: 'science' },
  /* ── World Extra ─────────────────────────────── */
  { url: 'https://www.cbc.ca/webfeed/rss/rss-topstories', name: 'CBC Canada', cat: 'world' },
  { url: 'https://feeds.nbcnews.com/nbcnews/public/news', name: 'NBC News', cat: 'world' },
  { url: 'https://www.theguardian.com/world/rss', name: 'Guardian World RSS', cat: 'world' },
  { url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', name: 'Times of India', cat: 'world' },
];

/* ═══════════════════════════════════════════════════
   REGION RSS FEEDS — country-specific news sources
   ═══════════════════════════════════════════════════ */
const REGION_FEEDS = {
  ph: [
    { url: 'https://www.gmanetwork.com/news/rss/news/nation/feed.xml', name: 'GMA News', cat: 'world' },
    { url: 'https://www.gmanetwork.com/news/rss/news/world/feed.xml', name: 'GMA World', cat: 'world' },
    { url: 'https://mb.com.ph/rss', name: 'Manila Bulletin', cat: 'world' },
    { url: 'https://www.philstar.com/rss/nation', name: 'PhilStar', cat: 'world' },
    { url: 'https://www.philstar.com/rss/headlines', name: 'PhilStar Headlines', cat: 'world' },
    { url: 'https://www.manilatimes.net/feed/', name: 'Manila Times', cat: 'world' },
  ]
};

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
  
  try {
    const json = await httpGet(url, { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    });

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
  } catch (err) {
    console.error(`[REDDIT] Error fetching r/${subreddit}:`, err.message);
    // Cache empty result to avoid hammering Reddit
    setCache(ck, []);
    return [];
  }
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
        return (feed.items || []).slice(0, 15).map((item, i) => ({
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
   SPACEFLIGHT NEWS API — Free, no key required
   https://api.spaceflightnewsapi.net/v4/
   ═══════════════════════════════════════════════════ */
async function _fetchSpaceflightNews(limit = 20) {
  const ck = `snapi:${limit}`;
  const hit = cached(ck);
  if (hit) return hit;

  try {
    const json = await httpGet(`https://api.spaceflightnewsapi.net/v4/articles/?limit=${limit}&ordering=-published_at`);
    if (!json || !json.results) return [];

    const items = json.results.map(a => ({
      id: 'snapi_' + a.id,
      title: a.title || '',
      url: a.url || '',
      permalink: a.url || '',
      source: 'spaceflightnews',
      sourceDetail: a.news_site || 'Spaceflight News',
      score: 0,
      comments: 0,
      thumbnail: a.image_url || null,
      created: a.published_at ? new Date(a.published_at).getTime() : Date.now(),
      author: '',
      snippet: (a.summary || '').substring(0, 250),
      domain: a.news_site || 'spaceflightnewsapi.net',
      category: guessCategory('science', a.title || '')
    }));

    setCache(ck, items);
    return items;
  } catch (err) {
    console.error('[SNAPI]', err.message);
    return [];
  }
}

/* ═══════════════════════════════════════════════════
   MEDIASTACK — Free tier: 100 req/month
   https://mediastack.com
   ═══════════════════════════════════════════════════ */
async function _fetchMediastack(countries = 'us', limit = 25) {
  const key = process.env.MEDIASTACK_KEY;
  if (!key) return [];

  const ck = `mediastack:${countries}:${limit}`;
  const hit = cached(ck);
  if (hit) return hit;

  try {
    // Mediastack free tier only supports HTTP
    const url = `http://api.mediastack.com/v1/news?access_key=${key}&countries=${countries}&limit=${limit}&languages=en&sort=published_desc`;
    const json = await httpGet(url);
    if (!json || !json.data) return [];

    const items = json.data.map((a, i) => ({
      id: 'ms_' + Date.now() + '_' + i,
      title: a.title || '',
      url: a.url || '',
      permalink: a.url || '',
      source: 'mediastack',
      sourceDetail: a.source || 'Mediastack',
      score: 0,
      comments: 0,
      thumbnail: a.image || null,
      created: a.published_at ? new Date(a.published_at).getTime() : Date.now(),
      author: a.author || '',
      snippet: (a.description || '').substring(0, 250),
      domain: a.source || '',
      category: guessCategory(a.category || '', a.title || '')
    }));

    setCache(ck, items);
    return items;
  } catch (err) {
    console.error('[MEDIASTACK]', err.message);
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
   THE NEWS API — Headlines with category grouping
   https://www.thenewsapi.com
   ═══════════════════════════════════════════════════ */
async function _fetchTheNewsAPI(locale = '', language = 'en', perCat = 5) {
  const key = process.env.THENEWSAPI_KEY;
  if (!key) return [];

  const ck = `thenewsapi:${locale || 'global'}:${language}:${perCat}`;
  const hit = cached(ck);
  if (hit) return hit;

  try {
    let url = `https://api.thenewsapi.com/v1/news/headlines?language=${language}&headlines_per_category=${perCat}&include_similar=true&api_token=${key}`;
    if (locale) url += `&locale=${locale}`;

    const json = await httpGet(url);
    if (!json || !json.data) return [];

    const catMap = {
      general: 'general', business: 'business', sports: 'sports',
      tech: 'technology', science: 'science', health: 'science',
      entertainment: 'entertainment', politics: 'politics'
    };

    const posts = [];
    for (const [section, articles] of Object.entries(json.data)) {
      if (!Array.isArray(articles)) continue;
      for (const a of articles) {
        posts.push({
          id: 'tna_' + a.uuid,
          title: a.title || '',
          url: a.url || '',
          permalink: a.url || '',
          source: 'thenewsapi',
          sourceDetail: a.source || 'TheNewsAPI',
          score: 0,
          comments: 0,
          thumbnail: a.image_url || null,
          created: a.published_at ? new Date(a.published_at).getTime() : Date.now(),
          author: '',
          snippet: (a.description || a.snippet || '').substring(0, 250),
          domain: a.source || '',
          category: catMap[section] || guessCategory('', a.title)
        });
        // Include similar articles for broader coverage
        if (Array.isArray(a.similar)) {
          for (const s of a.similar) {
            posts.push({
              id: 'tna_' + s.uuid,
              title: s.title || '',
              url: s.url || '',
              permalink: s.url || '',
              source: 'thenewsapi',
              sourceDetail: s.source || 'TheNewsAPI',
              score: 0,
              comments: 0,
              thumbnail: s.image_url || null,
              created: s.published_at ? new Date(s.published_at).getTime() : Date.now(),
              author: '',
              snippet: (s.description || s.snippet || '').substring(0, 250),
              domain: s.source || '',
              category: catMap[section] || guessCategory('', s.title)
            });
          }
        }
      }
    }

    setCache(ck, posts);
    return posts;
  } catch (err) {
    console.error('[THENEWSAPI]', err.message);
    return [];
  }
}

/* ═══════════════════════════════════════════════════
   GNEWS — gnews.io API for regional headlines
   Free tier: 100 req/day, 10 articles per request
   ═══════════════════════════════════════════════════ */
async function _fetchGNews(country = 'us', category = 'general', limit = 10) {
  const key = process.env.GNEWS_KEY;
  if (!key) return [];

  const ck = `gnews:${country}:${category}:${limit}`;
  const hit = cached(ck);
  if (hit) return hit;

  try {
    const url = `https://gnews.io/api/v4/top-headlines?country=${country}&category=${category}&max=${limit}&apikey=${key}`;
    const json = await httpGet(url);
    if (!json || !json.articles) return [];

    const posts = json.articles.map((a, i) => ({
      id: 'gn_' + (a.id || Date.now() + '_' + i),
      title: a.title || '',
      url: a.url || '',
      permalink: a.url || '',
      source: 'gnews',
      sourceDetail: (a.source && a.source.name) || 'GNews',
      score: 0,
      comments: 0,
      thumbnail: a.image || null,
      created: a.publishedAt ? new Date(a.publishedAt).getTime() : Date.now(),
      author: '',
      snippet: (a.description || '').substring(0, 250),
      domain: (a.source && a.source.name) || '',
      category: guessCategory('', a.title)
    }));

    setCache(ck, posts);
    return posts;
  } catch (err) {
    console.error('[GNEWS]', err.message);
    return [];
  }
}

/* ═══════════════════════════════════════════════════
   REGION RSS — fetch country-specific RSS feeds
   ═══════════════════════════════════════════════════ */
async function _fetchRegionRSS(country) {
  if (!country || country === 'auto' || !REGION_FEEDS[country]) return [];

  const ck = `regionrss:${country}`;
  const hit = cached(ck);
  if (hit) return hit;

  const feeds = REGION_FEEDS[country];
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      try {
        const feed = await rssParser.parseURL(f.url);
        return (feed.items || []).slice(0, 15).map((item, i) => ({
          id: 'regrss_' + Buffer.from(item.link || f.url + i).toString('base64').substring(0, 16),
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
        console.error(`[REGION-RSS] ${f.name}: ${err.message}`);
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
      const data = await httpGet(url, { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive'
      });
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
    const theNewsLocale = (country && country !== 'auto') ? country : '';
    const newsCountry = (country && country !== 'auto') ? country : 'us';
    const [hn, rss, news, guardian, wikinews, thenewsapi, gnews, regionRss, snapi, mediastack] = await Promise.all([
      _fetchHN('top', 30).catch(e => { console.error('[FEED/HN]', e.message); return []; }),
      _fetchRSS().catch(e => { console.error('[FEED/RSS]', e.message); return []; }),
      _fetchNews('', category || 'general', newsCountry).catch(e => { console.error('[FEED/NEWS]', e.message); return []; }),
      _fetchGuardian('', 40).catch(e => { console.error('[FEED/GUARDIAN]', e.message); return []; }),
      _fetchWikinews().catch(e => { console.error('[FEED/WIKINEWS]', e.message); return []; }),
      _fetchTheNewsAPI(theNewsLocale, 'en', 5).catch(e => { console.error('[FEED/THENEWSAPI]', e.message); return []; }),
      _fetchGNews(newsCountry, 'general', 10).catch(e => { console.error('[FEED/GNEWS]', e.message); return []; }),
      _fetchRegionRSS(country).catch(e => { console.error('[FEED/REGIONRSS]', e.message); return []; }),
      _fetchSpaceflightNews(20).catch(e => { console.error('[FEED/SNAPI]', e.message); return []; }),
      _fetchMediastack(newsCountry !== 'us' ? newsCountry : 'us', 25).catch(e => { console.error('[FEED/MEDIASTACK]', e.message); return []; }),
    ]);

    // Reddit — accept custom list from frontend, or use defaults
    // Fetched sequentially with delays to dodge rate-limits
    const DEFAULT_REDDIT_SUBS = ['popular','worldnews','technology','science','news','business',
      'artificial','MachineLearning','ChatGPT','interestingasfuck',
      'UpliftingNews','nottheonion','geopolitics','economics','Futurology',
      'space','movies','gaming','programming','CredibleDefense',
      'environment','energy','healthcare','education','law',
      'datascience','cybersecurity','singularity','collapse',
      'anime','television','books','music','nba','soccer','formula1',
      'esports','leagueoflegends','valorant','globaloffensive'];
    const requestedSubs = subs
      ? subs.split(',').map(s => s.trim()).filter(Boolean).slice(0, 40)
      : DEFAULT_REDDIT_SUBS;

    // Fetch Reddit in sequential batches of 2 (more conservative for Vercel)
    // Increase delay to 1 second between batches
    const BATCH_SIZE = 2;
    const BATCH_DELAY = 1000; // 1 second delay
    const redditPosts = [];
    for (let i = 0; i < requestedSubs.length; i += BATCH_SIZE) {
      const batch = requestedSubs.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(sub => _fetchReddit(sub, 'hot', 20))
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) redditPosts.push(...r.value);
        else if (r.status === 'rejected') console.error('[FEED/R]', r.reason?.message);
      }
      if (i + BATCH_SIZE < requestedSubs.length) await sleep(BATCH_DELAY);
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
        if (i + BATCH_SIZE < localSubs.length) await sleep(800);
      }
    }

    const newsIsLocal = newsCountry !== 'us';
    let items = [...hn, ...rss,
      ...news.map(i => newsIsLocal ? { ...i, local: true } : i),
      ...guardian, ...wikinews, ...thenewsapi,
      ...gnews.map(i => ({ ...i, local: true })),
      ...regionRss.map(i => ({ ...i, local: true })),
      ...snapi, ...mediastack,
      ...redditPosts,
      ...localPosts.map(i => ({ ...i, local: true }))
    ];
    console.log(`[FEED] HN=${hn.length} RSS=${rss.length} News=${news.length} Guardian=${guardian.length} WikiNews=${wikinews.length} TheNewsAPI=${thenewsapi.length} GNews=${gnews.length} SNAPI=${snapi.length} Mediastack=${mediastack.length} RegionRSS=${regionRss.length} Reddit=${redditPosts.length} Local=${localPosts.length} Total=${items.length}`);

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

    // Normalize engagement so Reddit doesn't dominate with raw upvotes
    // Reddit scores can be 1000s; other sources have 0. Cap & normalize.
    const now = Date.now();
    function normalizedScore(item) {
      const raw = (item.score || 0) + (item.comments || 0) * 2;
      let engagement;
      if (item.source === 'reddit') {
        // Log-scale Reddit engagement to compress 10k upvotes vs 100 upvotes
        engagement = Math.log10(raw + 1) * 15;
      } else if (item.source === 'hackernews') {
        engagement = Math.log10(raw + 1) * 18;
      } else {
        // Non-social sources get a solid baseline (equivalent to ~100 reddit score)
        engagement = 30;
      }
      const ageHours = (now - (item.created || 0)) / 3600000;
      return (engagement + 1) / Math.pow(ageHours + 2, 1.2);
    }
    items.sort((a, b) => normalizedScore(b) - normalizedScore(a));

    res.json(items.slice(0, 500));
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
   SUPABASE PROXY — all Supabase calls go through
   the server to avoid browser CORS issues
   ═══════════════════════════════════════════════════ */
const SUPA_URL = process.env.SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || '';

function _supaHeaders(authToken) {
  const h = {
    'apikey': SUPA_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };
  if (authToken) h['Authorization'] = 'Bearer ' + authToken;
  return h;
}

function _supaPost(path, body, token) {
  return new Promise((resolve, reject) => {
    const url = SUPA_URL + path;
    const data = JSON.stringify(body);
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { ..._supaHeaders(token), 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Supabase ${res.statusCode}: ${body}`));
        try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/* ── Auth: Sign Up ── */
app.post('/api/auth/signup', async (req, res) => {
  if (!SUPA_URL || !SUPA_KEY) return res.status(503).json({ error: 'Auth not configured' });
  try {
    const { email, password } = req.body;
    const result = await _supaPost('/auth/v1/signup', { email, password });
    res.json(result);
  } catch (e) {
    console.error('[AUTH/SIGNUP]', e.message);
    res.status(400).json({ error: e.message });
  }
});

/* ── Auth: Sign In ── */
app.post('/api/auth/signin', async (req, res) => {
  if (!SUPA_URL || !SUPA_KEY) return res.status(503).json({ error: 'Auth not configured' });
  try {
    const { email, password } = req.body;
    const result = await _supaPost('/auth/v1/token?grant_type=password', { email, password });
    res.json(result);
  } catch (e) {
    console.error('[AUTH/SIGNIN]', e.message);
    res.status(400).json({ error: e.message });
  }
});

/* ── Auth: Sign Out ── */
app.post('/api/auth/signout', async (req, res) => {
  // Client-side token invalidation is sufficient; just acknowledge
  res.json({ ok: true });
});

/* ── Auth: Change Password ── */
app.post('/api/auth/change-password', async (req, res) => {
  if (!SUPA_URL || !SUPA_KEY) return res.status(503).json({ error: 'Auth not configured' });
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    // Supabase: PUT /auth/v1/user with { password }
    const url = SUPA_URL + '/auth/v1/user';
    const data = JSON.stringify({ password });
    const u = new URL(url);
    const result = await new Promise((resolve, reject) => {
      const opts = {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        method: 'PUT',
        headers: {
          ..._supaHeaders(token),
          'Content-Length': Buffer.byteLength(data)
        }
      };
      const req = https.request(opts, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`Supabase ${res.statusCode}: ${body}`));
          try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[AUTH/CHANGE-PW]', e.message);
    res.status(400).json({ error: e.message });
  }
});

/* ── Auth: Get Session (verify token) ── */
app.get('/api/auth/user', async (req, res) => {
  if (!SUPA_URL || !SUPA_KEY) return res.json({ user: null });
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.json({ user: null });
  try {
    const user = await httpGet(SUPA_URL + '/auth/v1/user', {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + token
    });
    res.json({ user: user || null });
  } catch {
    res.json({ user: null });
  }
});

/* ── Sync: Pull preferences from cloud ── */
app.get('/api/sync/pull', async (req, res) => {
  if (!SUPA_URL || !SUPA_KEY) return res.json({ prefs: null, bookmarks: [] });
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No auth token' });
  try {
    // Get user ID from token
    const user = await httpGet(SUPA_URL + '/auth/v1/user', {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + token
    });
    if (!user || !user.id) return res.status(401).json({ error: 'Invalid token' });

    // Fetch prefs
    const prefs = await httpGet(
      SUPA_URL + `/rest/v1/user_prefs?select=*&user_id=eq.${user.id}`,
      { ..._supaHeaders(token), 'Accept': 'application/json' }
    );

    // Fetch bookmarks
    const bookmarks = await httpGet(
      SUPA_URL + `/rest/v1/user_bookmarks?select=item_data&user_id=eq.${user.id}&order=created_at.desc`,
      { ..._supaHeaders(token), 'Accept': 'application/json' }
    );

    res.json({
      prefs: Array.isArray(prefs) && prefs.length ? prefs[0] : null,
      bookmarks: Array.isArray(bookmarks) ? bookmarks.map(b => b.item_data) : []
    });
  } catch (e) {
    console.error('[SYNC/PULL]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── Sync: Push preferences to cloud ── */
app.post('/api/sync/push', async (req, res) => {
  if (!SUPA_URL || !SUPA_KEY) return res.status(503).json({ error: 'Not configured' });
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No auth token' });
  try {
    // Get user ID from token
    const user = await httpGet(SUPA_URL + '/auth/v1/user', {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + token
    });
    if (!user || !user.id) return res.status(401).json({ error: 'Invalid token' });

    const { subreddits, customSubs, interests, settings, bookmarks } = req.body;

    // Upsert preferences — try PATCH first, then INSERT if no row exists
    const prefsPayload = {
      subreddits: subreddits || [],
      custom_subs: customSubs || [],
      interests: interests || {},
      settings: settings || {},
      updated_at: new Date().toISOString()
    };

    // Try UPDATE first
    const patchData = JSON.stringify(prefsPayload);
    const patchUrl = new URL(SUPA_URL + `/rest/v1/user_prefs?user_id=eq.${user.id}`);
    const patchResult = await new Promise((resolve, reject) => {
      const opts = {
        hostname: patchUrl.hostname,
        port: 443,
        path: patchUrl.pathname + patchUrl.search,
        method: 'PATCH',
        headers: {
          ..._supaHeaders(token),
          'Prefer': 'return=headers-only',
          'Content-Length': Buffer.byteLength(patchData)
        }
      };
      const r = https.request(opts, resp => {
        let b = '';
        resp.on('data', c => b += c);
        resp.on('end', () => {
          const contentRange = resp.headers['content-range'] || '';
          resolve({ status: resp.statusCode, body: b, contentRange });
        });
      });
      r.on('error', reject);
      r.write(patchData);
      r.end();
    });

    // If PATCH matched 0 rows, do INSERT
    const patchedZero = patchResult.contentRange === '*/0' || (patchResult.status >= 200 && patchResult.status < 300 && patchResult.contentRange.includes('/0'));
    if (patchResult.status >= 400 || patchedZero) {
      const insertData = JSON.stringify({ user_id: user.id, ...prefsPayload });
      const insertUrl = new URL(SUPA_URL + '/rest/v1/user_prefs');
      await new Promise((resolve, reject) => {
        const opts = {
          hostname: insertUrl.hostname,
          port: 443,
          path: insertUrl.pathname,
          method: 'POST',
          headers: {
            ..._supaHeaders(token),
            'Prefer': 'return=minimal',
            'Content-Length': Buffer.byteLength(insertData)
          }
        };
        const r = https.request(opts, resp => {
          let b = '';
          resp.on('data', c => b += c);
          resp.on('end', () => resp.statusCode < 400 ? resolve() : reject(new Error(`Prefs INSERT ${resp.statusCode}: ${b}`)));
        });
        r.on('error', reject);
        r.write(insertData);
        r.end();
      });
    }

    // Delete existing bookmarks
    await new Promise((resolve, reject) => {
      const delUrl = new URL(SUPA_URL + `/rest/v1/user_bookmarks?user_id=eq.${user.id}`);
      const opts = {
        hostname: delUrl.hostname,
        port: 443,
        path: delUrl.pathname + delUrl.search,
        method: 'DELETE',
        headers: _supaHeaders(token)
      };
      const r = https.request(opts, resp => {
        let b = '';
        resp.on('data', c => b += c);
        resp.on('end', () => resolve());
      });
      r.on('error', reject);
      r.end();
    });

    // Insert bookmarks
    if (bookmarks && bookmarks.length) {
      const bmData = JSON.stringify(bookmarks.map(b => ({
        user_id: user.id,
        item_id: b.id,
        item_data: b
      })));
      const bmUrl = new URL(SUPA_URL + '/rest/v1/user_bookmarks');
      await new Promise((resolve, reject) => {
        const opts = {
          hostname: bmUrl.hostname,
          port: 443,
          path: bmUrl.pathname,
          method: 'POST',
          headers: { ..._supaHeaders(token), 'Content-Length': Buffer.byteLength(bmData) }
        };
        const r = https.request(opts, resp => {
          let b = '';
          resp.on('data', c => b += c);
          resp.on('end', () => resp.statusCode < 400 ? resolve() : reject(new Error(`BM ${resp.statusCode}: ${b}`)));
        });
        r.on('error', reject);
        r.write(bmData);
        r.end();
      });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[SYNC/PUSH]', e.message);
    res.status(500).json({ error: e.message });
  }
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
      wikinews: true,
      thenewsapi: !!process.env.THENEWSAPI_KEY
    },
    cacheEntries: cache.size,
    uptime: Math.floor(process.uptime())
  });
});

/* ═══════════════════════════════════════════════════
   EVENTS / CALENDAR — Nager.Date public holidays API
   + curated major world events (elections, religious,
   cultural, sports, political)
   ═══════════════════════════════════════════════════ */

/* ── Confirmed World Events ─────────────────────── */
/* ── Confirmed World Events — comprehensive list ── */
/* Covers: observances, religious, cultural, political,
   elections, sports, awareness days, and more.
   Fixed-date events use static entries; lunar/variable
   dates are fetched from APIs or computed. */

const WORLD_EVENTS = [
  // ═══════════════════════════════════════════════════
  //  2024 — RECENT / HISTORICAL
  // ═══════════════════════════════════════════════════
  { date: '2024-02-14', name: 'Valentine\'s Day', type: 'observance', description: 'Day of love celebrated worldwide' },
  { date: '2024-03-08', name: 'International Women\'s Day', type: 'observance', description: 'UN-recognized day celebrating women\'s achievements' },
  { date: '2024-03-31', name: 'Easter Sunday', type: 'religious', description: 'Christian celebration worldwide' },
  { date: '2024-04-22', name: 'Earth Day', type: 'observance', description: 'Global environmental awareness day' },
  { date: '2024-05-12', name: 'Mother\'s Day (US/CA/AU)', type: 'observance', description: 'Celebration of mothers — 2nd Sunday of May' },
  { date: '2024-06-16', name: 'Father\'s Day (US/CA/UK)', type: 'observance', description: 'Celebration of fathers — 3rd Sunday of June' },
  { date: '2024-06-28', name: 'Pride Month Ends', type: 'observance', description: 'LGBTQ+ Pride Month celebrated throughout June' },
  { date: '2024-07-26', name: 'Paris 2024 Olympics Opening', type: 'sports', description: 'XXXIII Olympic Games opened in Paris, France', country: 'FR' },
  { date: '2024-08-11', name: 'Paris 2024 Olympics Closing', type: 'sports', description: 'XXXIII Olympic Games closing ceremony', country: 'FR' },
  { date: '2024-10-31', name: 'Halloween', type: 'observance', description: 'Celebrated in US, Canada, UK, Ireland, and more' },
  { date: '2024-11-05', name: 'US Presidential Election 2024', type: 'election', description: 'Donald Trump elected as 47th President of the United States', country: 'US' },
  { date: '2024-11-28', name: 'Thanksgiving (US)', type: 'holiday', description: 'American Thanksgiving — 4th Thursday of November', country: 'US' },
  { date: '2024-12-25', name: 'Christmas Day', type: 'religious', description: 'Christian celebration worldwide' },
  { date: '2024-12-26', name: 'Hanukkah Begins', type: 'religious', description: 'Jewish Festival of Lights (8 days)' },
  { date: '2024-12-31', name: 'New Year\'s Eve', type: 'holiday', description: 'Worldwide celebration' },

  // ═══════════════════════════════════════════════════
  //  2025
  // ═══════════════════════════════════════════════════
  // ── January ──
  { date: '2025-01-01', name: 'New Year\'s Day', type: 'holiday', description: 'Worldwide celebration' },
  { date: '2025-01-20', name: 'US Presidential Inauguration', type: 'political', description: 'Inauguration of the 47th President of the United States', country: 'US' },
  { date: '2025-01-26', name: 'Republic Day (India)', type: 'holiday', description: 'Indian national day celebrating the constitution', country: 'IN' },
  { date: '2025-01-27', name: 'Holocaust Remembrance Day', type: 'observance', description: 'International Day of Commemoration (UN)' },
  { date: '2025-01-29', name: 'Chinese New Year (Year of the Snake)', type: 'cultural', description: 'Lunar New Year celebrated across East & Southeast Asia' },

  // ── February ──
  { date: '2025-02-01', name: 'Black History Month Begins (US/CA)', type: 'observance', description: 'Month honoring African American history and achievements' },
  { date: '2025-02-02', name: 'Groundhog Day', type: 'observance', description: 'North American tradition', country: 'US' },
  { date: '2025-02-12', name: 'Germany Federal Election', type: 'election', description: 'German federal parliamentary election (Bundestag)', country: 'DE' },
  { date: '2025-02-14', name: 'Valentine\'s Day', type: 'observance', description: 'Day of love celebrated worldwide' },

  // ── March ──
  { date: '2025-02-28', name: 'Ramadan Begins', type: 'religious', description: 'Islamic holy month of fasting' },
  { date: '2025-03-08', name: 'International Women\'s Day', type: 'observance', description: 'UN-recognized day celebrating women\'s achievements' },
  { date: '2025-03-14', name: 'Pi Day', type: 'observance', description: 'Mathematics celebration (3.14)' },
  { date: '2025-03-17', name: 'St. Patrick\'s Day', type: 'observance', description: 'Irish cultural & religious celebration, celebrated worldwide' },
  { date: '2025-03-20', name: 'Spring Equinox', type: 'observance', description: 'First day of spring in Northern Hemisphere' },
  { date: '2025-03-30', name: 'Eid al-Fitr', type: 'religious', description: 'End of Ramadan celebrations' },

  // ── April ──
  { date: '2025-04-01', name: 'April Fools\' Day', type: 'observance', description: 'Day of practical jokes celebrated worldwide' },
  { date: '2025-04-13', name: 'Songkran (Thai New Year)', type: 'cultural', description: 'Thai water festival and New Year celebration' },
  { date: '2025-04-20', name: 'Easter Sunday', type: 'religious', description: 'Christian celebration worldwide' },
  { date: '2025-04-22', name: 'Earth Day', type: 'observance', description: 'Global environmental awareness day' },
  { date: '2025-04-25', name: 'ANZAC Day', type: 'holiday', description: 'Remembrance day in Australia and New Zealand', country: 'AU' },

  // ── May ──
  { date: '2025-05-01', name: 'International Workers\' Day', type: 'observance', description: 'Labour Day celebrated in most countries worldwide' },
  { date: '2025-05-04', name: 'Star Wars Day', type: 'observance', description: 'May the 4th be with you — pop culture celebration' },
  { date: '2025-05-05', name: 'Cinco de Mayo', type: 'cultural', description: 'Mexican heritage celebration', country: 'MX' },
  { date: '2025-05-05', name: 'Canada Federal Election', type: 'election', description: 'Canadian federal general election', country: 'CA' },
  { date: '2025-05-11', name: 'Mother\'s Day (US/CA/AU)', type: 'observance', description: 'Celebration of mothers — 2nd Sunday of May' },
  { date: '2025-05-12', name: 'Philippines Mid-term Elections', type: 'election', description: 'Senatorial and local elections in the Philippines', country: 'PH' },
  { date: '2025-05-25', name: 'Africa Day', type: 'observance', description: 'Anniversary of founding of Organisation of African Unity' },

  // ── June ──
  { date: '2025-06-01', name: 'Pride Month Begins', type: 'observance', description: 'LGBTQ+ Pride celebrated throughout June worldwide' },
  { date: '2025-06-05', name: 'World Environment Day', type: 'observance', description: 'UN day for environmental awareness' },
  { date: '2025-06-06', name: 'Eid al-Adha', type: 'religious', description: 'Islamic Festival of Sacrifice' },
  { date: '2025-06-15', name: 'Father\'s Day (US/CA/UK)', type: 'observance', description: 'Celebration of fathers — 3rd Sunday of June' },
  { date: '2025-06-19', name: 'Juneteenth', type: 'holiday', description: 'US federal holiday commemorating emancipation', country: 'US' },
  { date: '2025-06-20', name: 'World Refugee Day', type: 'observance', description: 'UN day honouring refugees worldwide' },
  { date: '2025-06-21', name: 'Summer Solstice', type: 'observance', description: 'Longest day of the year in Northern Hemisphere' },
  { date: '2025-06-26', name: 'Islamic New Year', type: 'religious', description: 'Start of new Islamic calendar year (1447 AH)' },

  // ── July ──
  { date: '2025-07-01', name: 'Canada Day', type: 'holiday', description: 'Canadian national holiday', country: 'CA' },
  { date: '2025-07-04', name: 'US Independence Day', type: 'holiday', description: 'American national holiday', country: 'US' },
  { date: '2025-07-04', name: 'UK General Election Expected', type: 'election', description: 'Expected date for next UK general election', country: 'GB' },
  { date: '2025-07-14', name: 'Bastille Day', type: 'holiday', description: 'French national holiday', country: 'FR' },

  // ── August ──
  { date: '2025-08-09', name: 'International Day of Indigenous Peoples', type: 'observance', description: 'UN observance day' },
  { date: '2025-08-15', name: 'Indian Independence Day', type: 'holiday', description: 'India\'s national day', country: 'IN' },
  { date: '2025-08-15', name: 'Assumption of Mary', type: 'religious', description: 'Catholic feast day, public holiday in many countries' },

  // ── September ──
  { date: '2025-09-01', name: 'Labor Day (US/CA)', type: 'holiday', description: '1st Monday of September', country: 'US' },
  { date: '2025-09-05', name: 'Prophet\'s Birthday (Mawlid)', type: 'religious', description: 'Celebration of Prophet Muhammad\'s birth' },
  { date: '2025-09-16', name: 'Mexican Independence Day', type: 'holiday', description: 'Mexico\'s national day', country: 'MX' },
  { date: '2025-09-21', name: 'International Day of Peace', type: 'observance', description: 'UN day dedicated to world peace' },
  { date: '2025-09-22', name: 'Rosh Hashanah (Jewish New Year)', type: 'religious', description: 'Jewish New Year celebration — begins at sundown' },
  { date: '2025-09-22', name: 'Autumn Equinox', type: 'observance', description: 'First day of fall in Northern Hemisphere' },

  // ── October ──
  { date: '2025-10-01', name: 'Yom Kippur', type: 'religious', description: 'Jewish Day of Atonement — holiest day of the year' },
  { date: '2025-10-01', name: 'China National Day', type: 'holiday', description: 'PRC founding anniversary — Golden Week begins', country: 'CN' },
  { date: '2025-10-06', name: 'Sukkot Begins', type: 'religious', description: 'Jewish Feast of Tabernacles (7 days)' },
  { date: '2025-10-13', name: 'Thanksgiving (Canada)', type: 'holiday', description: '2nd Monday of October', country: 'CA' },
  { date: '2025-10-20', name: 'Diwali', type: 'religious', description: 'Hindu festival of lights celebrated across South Asia' },
  { date: '2025-10-24', name: 'United Nations Day', type: 'observance', description: 'Anniversary of the UN Charter coming into force' },
  { date: '2025-10-31', name: 'Halloween', type: 'observance', description: 'Celebrated in US, Canada, UK, Ireland, and more' },

  // ── November ──
  { date: '2025-11-01', name: 'All Saints\' Day', type: 'religious', description: 'Christian observance, public holiday in many European countries' },
  { date: '2025-11-02', name: 'Day of the Dead (Día de los Muertos)', type: 'cultural', description: 'Mexican tradition honoring deceased loved ones', country: 'MX' },
  { date: '2025-11-11', name: 'Veterans Day / Remembrance Day', type: 'holiday', description: 'Honoring military veterans (US, UK, CA, AU)' },
  { date: '2025-11-27', name: 'Thanksgiving (US)', type: 'holiday', description: '4th Thursday of November', country: 'US' },
  { date: '2025-11-28', name: 'Black Friday', type: 'observance', description: 'Biggest shopping day in the US', country: 'US' },

  // ── December ──
  { date: '2025-12-01', name: 'World AIDS Day', type: 'observance', description: 'Global awareness and remembrance day' },
  { date: '2025-12-10', name: 'Human Rights Day', type: 'observance', description: 'UN day marking Universal Declaration of Human Rights' },
  { date: '2025-12-14', name: 'Hanukkah Begins', type: 'religious', description: 'Jewish Festival of Lights (8 days) — begins at sundown' },
  { date: '2025-12-21', name: 'Winter Solstice', type: 'observance', description: 'Shortest day of the year in Northern Hemisphere' },
  { date: '2025-12-24', name: 'Christmas Eve', type: 'religious', description: 'Celebrated worldwide, main celebration in many countries' },
  { date: '2025-12-25', name: 'Christmas Day', type: 'religious', description: 'Christian celebration worldwide' },
  { date: '2025-12-26', name: 'Boxing Day', type: 'holiday', description: 'Public holiday in UK, Canada, Australia, and more' },
  { date: '2025-12-31', name: 'New Year\'s Eve', type: 'holiday', description: 'Worldwide celebration' },

  // ═══════════════════════════════════════════════════
  //  2026
  // ═══════════════════════════════════════════════════
  // ── January ──
  { date: '2026-01-01', name: 'New Year\'s Day', type: 'holiday', description: 'Worldwide celebration' },
  { date: '2026-01-06', name: 'Epiphany / Three Kings Day', type: 'religious', description: 'Christian observance, public holiday in many European & Latin American countries' },
  { date: '2026-01-26', name: 'Australia Day', type: 'holiday', description: 'Australian national day', country: 'AU' },
  { date: '2026-01-26', name: 'Republic Day (India)', type: 'holiday', description: 'Indian national day celebrating the constitution', country: 'IN' },
  { date: '2026-01-27', name: 'Holocaust Remembrance Day', type: 'observance', description: 'International Day of Commemoration (UN)' },

  // ── February ──
  { date: '2026-02-01', name: 'Black History Month Begins (US/CA)', type: 'observance', description: 'Month honoring African American history and achievements' },
  { date: '2026-02-02', name: 'Groundhog Day', type: 'observance', description: 'North American tradition', country: 'US' },
  { date: '2026-02-14', name: 'Valentine\'s Day', type: 'observance', description: 'Day of love celebrated worldwide' },
  { date: '2026-02-17', name: 'Chinese New Year (Year of the Horse)', type: 'cultural', description: 'Lunar New Year celebrated across East & Southeast Asia' },

  // ── March ──
  { date: '2026-03-01', name: 'St. David\'s Day (Wales)', type: 'observance', description: 'Welsh national day', country: 'GB' },
  { date: '2026-03-03', name: 'Hinamatsuri (Girls\' Day, Japan)', type: 'cultural', description: 'Japanese doll festival', country: 'JP' },
  { date: '2026-03-08', name: 'International Women\'s Day', type: 'observance', description: 'UN-recognized day celebrating women\'s achievements' },
  { date: '2026-03-14', name: 'Pi Day', type: 'observance', description: 'Mathematics celebration (3.14)' },
  { date: '2026-03-17', name: 'St. Patrick\'s Day', type: 'observance', description: 'Irish cultural & religious celebration, celebrated worldwide' },
  { date: '2026-03-20', name: 'Nowruz (Persian New Year)', type: 'cultural', description: 'Spring equinox new year — celebrated in Iran, Afghanistan, Central Asia' },
  { date: '2026-03-20', name: 'Spring Equinox', type: 'observance', description: 'First day of spring in Northern Hemisphere' },
  { date: '2026-03-22', name: 'World Water Day', type: 'observance', description: 'UN day to focus on importance of freshwater' },
  { date: '2026-03-29', name: 'Holi', type: 'religious', description: 'Hindu festival of colors celebrated in India and Nepal' },

  // ── April ──
  { date: '2026-04-01', name: 'April Fools\' Day', type: 'observance', description: 'Day of practical jokes celebrated worldwide' },
  { date: '2026-04-03', name: 'Good Friday', type: 'religious', description: 'Christian observance before Easter' },
  { date: '2026-04-05', name: 'Easter Sunday', type: 'religious', description: 'Christian celebration worldwide' },
  { date: '2026-04-13', name: 'Songkran (Thai New Year)', type: 'cultural', description: 'Thai water festival and New Year celebration (Apr 13–15)' },
  { date: '2026-04-22', name: 'Earth Day', type: 'observance', description: 'Global environmental awareness day' },
  { date: '2026-04-25', name: 'ANZAC Day', type: 'holiday', description: 'Remembrance day in Australia and New Zealand', country: 'AU' },

  // ── May ──
  { date: '2026-05-01', name: 'International Workers\' Day', type: 'observance', description: 'Labour Day celebrated in most countries worldwide' },
  { date: '2026-05-04', name: 'Star Wars Day', type: 'observance', description: 'May the 4th be with you — pop culture celebration' },
  { date: '2026-05-05', name: 'Cinco de Mayo', type: 'cultural', description: 'Mexican heritage celebration', country: 'MX' },
  { date: '2026-05-05', name: 'Buddha\'s Birthday (Vesak)', type: 'religious', description: 'Buddhist celebration of Buddha\'s birth — date varies by tradition' },
  { date: '2026-05-10', name: 'Mother\'s Day (US/CA/AU)', type: 'observance', description: 'Celebration of mothers — 2nd Sunday of May' },
  { date: '2026-05-25', name: 'Africa Day', type: 'observance', description: 'Anniversary of founding of Organisation of African Unity' },

  // ── June ──
  { date: '2026-06-01', name: 'Pride Month Begins', type: 'observance', description: 'LGBTQ+ Pride celebrated throughout June worldwide' },
  { date: '2026-06-05', name: 'World Environment Day', type: 'observance', description: 'UN day for environmental awareness' },
  { date: '2026-06-11', name: 'FIFA World Cup 2026 Begins', type: 'sports', description: 'Hosted by US, Canada, and Mexico — biggest sporting event of the year', country: 'US' },
  { date: '2026-06-19', name: 'Juneteenth', type: 'holiday', description: 'US federal holiday commemorating emancipation', country: 'US' },
  { date: '2026-06-20', name: 'World Refugee Day', type: 'observance', description: 'UN day honouring refugees worldwide' },
  { date: '2026-06-21', name: 'Father\'s Day (US/CA/UK)', type: 'observance', description: 'Celebration of fathers — 3rd Sunday of June' },
  { date: '2026-06-21', name: 'Summer Solstice', type: 'observance', description: 'Longest day of the year in Northern Hemisphere' },

  // ── July ──
  { date: '2026-07-01', name: 'Canada Day', type: 'holiday', description: 'Canadian national holiday', country: 'CA' },
  { date: '2026-07-04', name: 'US Independence Day', type: 'holiday', description: 'American national holiday', country: 'US' },
  { date: '2026-07-14', name: 'Bastille Day', type: 'holiday', description: 'French national holiday', country: 'FR' },
  { date: '2026-07-19', name: 'FIFA World Cup 2026 Final', type: 'sports', description: 'World Cup Final — MetLife Stadium, New Jersey', country: 'US' },

  // ── August ──
  { date: '2026-08-09', name: 'International Day of Indigenous Peoples', type: 'observance', description: 'UN observance day' },
  { date: '2026-08-15', name: 'Indian Independence Day', type: 'holiday', description: 'India\'s national day', country: 'IN' },
  { date: '2026-08-15', name: 'Assumption of Mary', type: 'religious', description: 'Catholic feast day, public holiday in many countries' },

  // ── September ──
  { date: '2026-09-07', name: 'Labor Day (US/CA)', type: 'holiday', description: '1st Monday of September', country: 'US' },
  { date: '2026-09-12', name: 'Rosh Hashanah (Jewish New Year)', type: 'religious', description: 'Jewish New Year celebration — begins at sundown' },
  { date: '2026-09-16', name: 'Mexican Independence Day', type: 'holiday', description: 'Mexico\'s national day', country: 'MX' },
  { date: '2026-09-21', name: 'International Day of Peace', type: 'observance', description: 'UN day dedicated to world peace' },
  { date: '2026-09-21', name: 'Yom Kippur', type: 'religious', description: 'Jewish Day of Atonement — holiest day of the year' },
  { date: '2026-09-22', name: 'Autumn Equinox', type: 'observance', description: 'First day of fall in Northern Hemisphere' },
  { date: '2026-09-26', name: 'Sukkot Begins', type: 'religious', description: 'Jewish Feast of Tabernacles (7 days)' },

  // ── October ──
  { date: '2026-10-01', name: 'China National Day', type: 'holiday', description: 'PRC founding anniversary — Golden Week begins', country: 'CN' },
  { date: '2026-10-09', name: 'Diwali', type: 'religious', description: 'Hindu festival of lights celebrated across South Asia' },
  { date: '2026-10-12', name: 'Thanksgiving (Canada)', type: 'holiday', description: '2nd Monday of October', country: 'CA' },
  { date: '2026-10-24', name: 'United Nations Day', type: 'observance', description: 'Anniversary of the UN Charter coming into force' },
  { date: '2026-10-31', name: 'Halloween', type: 'observance', description: 'Celebrated in US, Canada, UK, Ireland, and more' },

  // ── November ──
  { date: '2026-11-01', name: 'All Saints\' Day', type: 'religious', description: 'Christian observance, public holiday in many European countries' },
  { date: '2026-11-02', name: 'Day of the Dead (Día de los Muertos)', type: 'cultural', description: 'Mexican tradition honoring deceased loved ones', country: 'MX' },
  { date: '2026-11-03', name: 'US Midterm Elections', type: 'election', description: 'Congressional midterm elections across the United States', country: 'US' },
  { date: '2026-11-11', name: 'Veterans Day / Remembrance Day', type: 'holiday', description: 'Honoring military veterans (US, UK, CA, AU)' },
  { date: '2026-11-26', name: 'Thanksgiving (US)', type: 'holiday', description: '4th Thursday of November', country: 'US' },
  { date: '2026-11-27', name: 'Black Friday', type: 'observance', description: 'Biggest shopping day in the US', country: 'US' },

  // ── December ──
  { date: '2026-12-01', name: 'World AIDS Day', type: 'observance', description: 'Global awareness and remembrance day' },
  { date: '2026-12-10', name: 'Human Rights Day', type: 'observance', description: 'UN day marking Universal Declaration of Human Rights' },
  { date: '2026-12-21', name: 'Winter Solstice', type: 'observance', description: 'Shortest day of the year in Northern Hemisphere' },
  { date: '2026-12-24', name: 'Christmas Eve', type: 'religious', description: 'Celebrated worldwide, main celebration in many countries' },
  { date: '2026-12-25', name: 'Christmas Day', type: 'religious', description: 'Christian celebration worldwide' },
  { date: '2026-12-26', name: 'Boxing Day', type: 'holiday', description: 'Public holiday in UK, Canada, Australia, and more' },
  { date: '2026-12-26', name: 'Kwanzaa Begins', type: 'cultural', description: 'African American cultural celebration (Dec 26 – Jan 1)' },
  { date: '2026-12-31', name: 'New Year\'s Eve', type: 'holiday', description: 'Worldwide celebration' },

  // ═══════════════════════════════════════════════════
  //  2027
  // ═══════════════════════════════════════════════════
  { date: '2027-01-01', name: 'New Year\'s Day', type: 'holiday', description: 'Worldwide celebration' },
  { date: '2027-01-26', name: 'Republic Day (India)', type: 'holiday', description: 'Indian national day', country: 'IN' },
  { date: '2027-02-06', name: 'Chinese New Year (Year of the Goat)', type: 'cultural', description: 'Lunar New Year celebrated across East & Southeast Asia' },
  { date: '2027-02-14', name: 'Valentine\'s Day', type: 'observance', description: 'Day of love celebrated worldwide' },
  { date: '2027-03-08', name: 'International Women\'s Day', type: 'observance', description: 'UN-recognized day celebrating women\'s achievements' },
  { date: '2027-03-17', name: 'St. Patrick\'s Day', type: 'observance', description: 'Irish cultural & religious celebration' },
  { date: '2027-03-21', name: 'Nowruz (Persian New Year)', type: 'cultural', description: 'Celebrated in Iran, Afghanistan, Central Asia' },
  { date: '2027-03-28', name: 'Easter Sunday', type: 'religious', description: 'Christian celebration worldwide' },
  { date: '2027-04-22', name: 'Earth Day', type: 'observance', description: 'Global environmental awareness day' },
  { date: '2027-05-01', name: 'International Workers\' Day', type: 'observance', description: 'Labour Day celebrated in most countries worldwide' },
  { date: '2027-05-09', name: 'Philippines Presidential Election', type: 'election', description: 'National elections for president, VP, senators, and local officials', country: 'PH' },
  { date: '2027-05-09', name: 'Mother\'s Day (US/CA/AU)', type: 'observance', description: 'Celebration of mothers' },
  { date: '2027-06-20', name: 'Father\'s Day (US/CA/UK)', type: 'observance', description: 'Celebration of fathers' },
  { date: '2027-07-01', name: 'Canada Day', type: 'holiday', description: 'Canadian national holiday', country: 'CA' },
  { date: '2027-07-04', name: 'US Independence Day', type: 'holiday', description: 'American national holiday', country: 'US' },
  { date: '2027-07-14', name: 'Bastille Day', type: 'holiday', description: 'French national holiday', country: 'FR' },
  { date: '2027-08-15', name: 'Indian Independence Day', type: 'holiday', description: 'India\'s national day', country: 'IN' },
  { date: '2027-10-29', name: 'Diwali', type: 'religious', description: 'Hindu festival of lights celebrated across South Asia' },
  { date: '2027-10-31', name: 'Halloween', type: 'observance', description: 'Celebrated in US, Canada, UK, Ireland, and more' },
  { date: '2027-11-11', name: 'Veterans Day / Remembrance Day', type: 'holiday', description: 'Honoring military veterans' },
  { date: '2027-11-25', name: 'Thanksgiving (US)', type: 'holiday', description: '4th Thursday of November', country: 'US' },
  { date: '2027-12-25', name: 'Christmas Day', type: 'religious', description: 'Christian celebration worldwide' },
  { date: '2027-12-31', name: 'New Year\'s Eve', type: 'holiday', description: 'Worldwide celebration' },
];

async function _fetchHolidays(year, countryCode) {
  const ck = `holidays:${year}:${countryCode}`;
  const hit = cached(ck);
  if (hit) return hit;

  try {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`;
    const data = await httpGet(url);
    if (!Array.isArray(data)) return [];

    const holidays = data.map(h => ({
      date: h.date,
      name: h.name,
      localName: h.localName,
      type: h.types?.includes('Public') ? 'holiday' : 'observance',
      country: h.countryCode,
      description: h.localName !== h.name ? `${h.localName} — ${h.countryCode}` : h.countryCode
    }));

    setCache(ck, holidays);
    return holidays;
  } catch (err) {
    console.error('[HOLIDAYS]', err.message);
    return [];
  }
}

/* ── AlAdhan Islamic Calendar API (free, no auth) ── */
/* Fetches accurate Islamic holidays with Gregorian dates */
async function _fetchIslamicHolidays(gregorianYear) {
  const ck = `islamic:${gregorianYear}`;
  const hit = cached(ck);
  if (hit) return hit;

  // Major Islamic holidays to surface (filter out obscure saints' urs)
  const MAJOR_KEYWORDS = [
    'ramadan', 'eid', 'ashura', 'mawlid', 'isra', 'mi\'raj', 'miraj',
    'laylat', 'shab-e', 'new year', 'muharram', 'rajab', 'shaban',
    'hajj', 'arafa', 'arafat', 'prophet', 'veiling'
  ];

  function isMajor(name) {
    const lower = name.toLowerCase();
    return MAJOR_KEYWORDS.some(kw => lower.includes(kw));
  }

  try {
    // The Hijri year overlapping a Gregorian year — approximate
    const hijriYear = Math.round(gregorianYear - 622 + (gregorianYear - 622) / 33);
    const results = [];

    // Try two Hijri years to cover the full Gregorian year
    for (const hy of [hijriYear, hijriYear + 1]) {
      try {
        const url = `https://api.aladhan.com/v1/islamicHolidaysByHijriYear/${hy}`;
        const resp = await httpGet(url);
        if (resp && resp.data && Array.isArray(resp.data)) {
          for (const entry of resp.data) {
            const greg = entry.gregorian;
            const hijri = entry.hijri;
            if (!greg || !greg.date || !hijri) continue;

            // Parse DD-MM-YYYY → YYYY-MM-DD
            const parts = greg.date.split('-');
            if (parts.length !== 3) continue;
            const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
            if (!isoDate.startsWith(String(gregorianYear))) continue;

            // Get holiday names from the entry
            const holidays = hijri.holidays || [];
            for (const hName of holidays) {
              if (!isMajor(hName)) continue; // Skip obscure entries
              results.push({
                date: isoDate,
                name: hName,
                type: 'religious',
                description: `Islamic calendar — ${hijri.day} ${hijri.month?.en || ''} ${hijri.year} AH`
              });
            }
          }
        }
      } catch (e) {
        // One Hijri year fetch failed, continue with the other
      }
    }

    // Deduplicate by date+name
    const seen = new Set();
    const unique = results.filter(r => {
      const k = r.date + '|' + r.name;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    setCache(ck, unique);
    return unique;
  } catch (err) {
    console.error('[ISLAMIC]', err.message);
    return [];
  }
}

app.get('/api/events', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const country = (req.query.country || 'US').toUpperCase();

    // Fetch from all sources in parallel
    const [holidays, islamicHolidays] = await Promise.all([
      _fetchHolidays(year, country),
      _fetchIslamicHolidays(year)
    ]);

    // Filter world events for the requested year
    const worldFiltered = WORLD_EVENTS.filter(ev => {
      const d = new Date(ev.date);
      return d.getFullYear() === year;
    });

    // Merge all sources — holidays + islamic + world events
    const allEvents = [...holidays, ...islamicHolidays, ...worldFiltered];

    // Deduplicate by date + normalized name
    const seen = new Set();
    const unique = allEvents.filter(ev => {
      const key = ev.date + '|' + ev.name.toLowerCase().replace(/[^a-z]/g, '').substring(0, 30);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by date
    unique.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({ events: unique, year, month, country });
  } catch (err) {
    console.error('[EVENTS]', err.message);
    res.json({ events: [], year: req.query.year, month: req.query.month });
  }
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
