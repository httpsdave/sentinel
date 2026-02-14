<div align="center">

# ▓ SENTINEL

### Tactical News Intelligence Platform

*Real-time news aggregation with radar visualization, algorithmic ranking, and a terminal-inspired interface.*

![Terminal](https://img.shields.io/badge/aesthetic-terminal-00ff41?style=flat-square&labelColor=000000)
![Node.js](https://img.shields.io/badge/node.js-20+-00ff41?style=flat-square&labelColor=000000)
![License](https://img.shields.io/badge/license-MIT-00ff41?style=flat-square&labelColor=000000)

</div>

---

## What is Sentinel?

Sentinel is a news intelligence platform that aggregates trending content from across the internet — Reddit, Hacker News, RSS feeds, and NewsAPI — and presents it through a dark, terminal-inspired interface. It deduplicates, categorizes, and ranks everything using a personalized algorithm that adapts to your reading habits.

No social media accounts required. No tracking. No ads. Just signal.

---

## Features

### 📡 Radar View
An animated radar sweep that plots news items as blips. Newer stories appear closer to center, high-engagement stories are larger. Click any blip to dive in.

### ≡ Timeline Feed
A clean, scored feed sorted by your personalized algorithm. Scores, comments, sources, and categories at a glance.

### ⊕ World Map
A global view plotting news by geographic location with pulsing markers. See what's happening where.

### 🔧 90+ Subreddit Sources
Browse and toggle from a curated catalog of 90+ subreddits across 10 categories — Trending, News, Technology, AI/ML, Science, Politics, Finance, Entertainment, Sports, and Misc. Add your own custom subreddits too. Your selections shape what appears in every view.

### 🤖 Personalized Algorithm
Sentinel tracks what categories you click on and boosts similar content over time. Items from your explicitly selected subreddits get a ranking boost. The more you use it, the more tailored your feed becomes.

### 👤 User Accounts
Sign up to sync your preferences, subreddit selections, bookmarks, and algorithm profile across devices. Powered by Supabase with Row Level Security. Works without an account too — everything falls back to local storage.

### ★ Bookmarks
Save articles for later from any view. Synced to the cloud when signed in.

### ⚡ Sources

| Source | Auth Required | Notes |
|--------|:---:|-------|
| **Reddit** | No | 90+ configurable subreddits via public JSON API |
| **Hacker News** | No | Top stories via Firebase API |
| **RSS Feeds** | No | BBC, CNN, TechCrunch, The Verge, Ars Technica, NY Times |
| **NewsAPI** | Optional | Free tier at [newsapi.org](https://newsapi.org) for broader headlines |

### 🎨 Terminal Aesthetic

- Pure black & green (`#00ff41`) color scheme
- CRT scanline overlay (toggleable)
- Monospace typography throughout
- Keyboard shortcuts — `R` Radar · `F` Feed · `M` Map · `S` Saved · `/` Search · `Esc` Close
- Fully responsive — works on mobile and desktop

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla HTML, CSS, JavaScript, Canvas API |
| **Backend** | Node.js, Express |
| **Auth & Database** | Supabase (PostgreSQL + Auth + RLS) |
| **Deployment** | Vercel (Serverless) |
| **APIs** | Reddit JSON, HN Firebase, rss-parser, NewsAPI |

---

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `SUPABASE_URL` | For accounts | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | For accounts | Your Supabase anon/public key |
| `NEWSAPI_KEY` | No | [newsapi.org](https://newsapi.org/register) key for extra headlines |
| `PORT` | No | Server port (default: `3000`) |

---

## Database Schema

Run the included `supabase-schema.sql` in your Supabase SQL Editor to create the required tables (`user_prefs`, `user_bookmarks`) with Row Level Security policies.

---

<div align="center">
  <sub>Built with signal, not noise.</sub>
</div>
