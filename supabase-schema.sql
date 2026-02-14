-- ═══════════════════════════════════════════════════
-- SENTINEL — Supabase Database Schema
-- Run this in your Supabase SQL Editor (supabase.com → project → SQL Editor)
-- ═══════════════════════════════════════════════════

-- ── User Preferences ──────────────────────────────
-- Stores subreddit selections, interests, settings per user
create table public.user_prefs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null unique,
  subreddits text[] default '{}',
  custom_subs text[] default '{}',
  interests  jsonb default '{}',
  settings   jsonb default '{}',
  updated_at timestamptz default now()
);

-- ── User Bookmarks ────────────────────────────────
-- Stores saved articles per user
create table public.user_bookmarks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  item_id    text not null,
  item_data  jsonb not null,
  created_at timestamptz default now(),
  unique(user_id, item_id)
);

-- ── Row Level Security ────────────────────────────
-- Users can only access their own data

alter table public.user_prefs enable row level security;
alter table public.user_bookmarks enable row level security;

-- user_prefs policies
create policy "Users can view own prefs"
  on public.user_prefs for select
  using (auth.uid() = user_id);

create policy "Users can insert own prefs"
  on public.user_prefs for insert
  with check (auth.uid() = user_id);

create policy "Users can update own prefs"
  on public.user_prefs for update
  using (auth.uid() = user_id);

-- user_bookmarks policies
create policy "Users can view own bookmarks"
  on public.user_bookmarks for select
  using (auth.uid() = user_id);

create policy "Users can insert own bookmarks"
  on public.user_bookmarks for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own bookmarks"
  on public.user_bookmarks for delete
  using (auth.uid() = user_id);

-- ── Indexes ───────────────────────────────────────
create index idx_user_prefs_user_id on public.user_prefs(user_id);
create index idx_user_bookmarks_user_id on public.user_bookmarks(user_id);
