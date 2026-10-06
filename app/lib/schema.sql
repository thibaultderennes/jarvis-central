-- Jarvis Central schema. Idempotent: safe to run on every deploy (scripts/migrate.mjs).
create extension if not exists pgcrypto;

create table if not exists projects (
  id text primary key,
  name text not null,
  kind text not null default 'checklist' check (kind in ('checklist','running')),
  color text not null default 'other',
  tagline text not null default '',
  state text not null default '',
  status text not null default '',
  dir text not null default '',
  sections jsonb not null default '[]',
  deadlines jsonb not null default '[]',
  links jsonb not null default '[]',
  sort int not null default 100,
  archived boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists items (
  project_id text not null references projects(id) on delete cascade,
  id text not null,
  section text not null,
  title text not null,
  detail text not null default '',
  status text not null default 'todo' check (status in ('todo','doing','done')),
  due date,
  owner text,
  critical boolean not null default false,
  sort real not null default 100,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  primary key (project_id, id)
);
create index if not exists items_due on items (due) where status <> 'done';
create index if not exists items_done_at on items (done_at);

create table if not exists item_events (
  id bigserial primary key,
  project_id text not null,
  item_id text not null,
  field text not null,
  old text,
  new text,
  actor text not null default 'founder',
  at timestamptz not null default now()
);
create index if not exists item_events_at on item_events (at);

create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  date date,
  title text not null,
  kind text not null default 'life' check (kind in ('life','work')),
  project_id text references projects(id) on delete set null,
  item_id text,
  time text,
  sort real not null default 100,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists todos_date on todos (date);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  project_id text,
  text text not null,
  status text not null default 'new',
  reply text not null default '',
  meta jsonb not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  replied_at timestamptz
);
create index if not exists messages_status on messages (status, created_at);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('project','recap','coaching','jarvis','doc','security','screening')),
  project_id text,
  week_start date,
  title text not null,
  verdict text,
  headline text not null default '',
  body_md text not null default '',
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create unique index if not exists reviews_week_unique on reviews (type, coalesce(project_id, ''), week_start) where type <> 'doc';
create index if not exists reviews_week on reviews (week_start desc);

create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists activity (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,
  page text,
  detail jsonb not null default '{}'
);
create index if not exists activity_at on activity (at);

create table if not exists login_attempts (
  id bigserial primary key,
  ip text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_ip_at on login_attempts (ip, at);

-- Sunday planner: one plan per week; its blocks become work todos (source = 'plan') and Google Calendar events.
alter table todos add column if not exists source text;
create table if not exists week_plans (
  week_start date primary key,
  blocks jsonb not null default '[]',
  unscheduled jsonb not null default '[]',
  notes_md text not null default '',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_version int,
  synced_at timestamptz,
  synced_count int
);
alter table week_plans add column if not exists force_resync boolean not null default false;
-- Messages can belong to a review/strategy discussion, and say what kind of work they ask for.
alter table messages add column if not exists review_id uuid;
alter table messages add column if not exists mode text not null default 'auto';
create index if not exists messages_review on messages (review_id, created_at);
-- Per-project settings you change on the site: top-3 position, calendar planning, weekly time, weekly reviews.
alter table projects add column if not exists featured_rank int;
alter table projects add column if not exists plan_enabled boolean not null default true;
alter table projects add column if not exists weekly_minutes int;
alter table projects add column if not exists reviews_enabled boolean not null default true;
-- New checklist items are refined by Claude (steps, section, priority, estimate, a non-clashing due date).
alter table items add column if not exists estimate_minutes int;
alter table items add column if not exists priority smallint;
alter table items add column if not exists refine text;
alter table items add column if not exists refine_note text not null default '';
-- A comment the owner leaves on an existing item ("Show more" → comment bar); Claude reads it and adjusts the item.
alter table items add column if not exists refine_request text not null default '';
-- Replies in the inbox: a follow-up points at the first message of its conversation.
alter table messages add column if not exists thread_id uuid;
create index if not exists messages_thread on messages (thread_id, created_at);
-- Security audit reports mirrored from each project's folder (agent/audits.mjs): review type 'security', one row per
-- file, keyed by meta.file. The type check is widened in place (drop + add is the only way; every run ends in the
-- same state); the partial unique index turns the re-sync into an upsert.
alter table reviews drop constraint if exists reviews_type_check;
alter table reviews add constraint reviews_type_check check (type in ('project','recap','coaching','jarvis','doc','security','screening'));
create unique index if not exists reviews_file_unique on reviews (type, coalesce(project_id, ''), (meta->>'file')) where meta->>'file' is not null;
-- 0.5.0. Items can be cancelled (kept, but out of every open count) and point at the item they duplicated; a decision
-- typed in the note box is sent to Claude explicitly (note_sent_at); an in-progress item owned by Claude is built by
-- the worker (build_status: working → pr_open → merge_requested → merged | failed | sent_back, pr_url, build_note).
-- The status check is widened in place (drop + add is the only way; every run ends in the same state).
alter table items drop constraint if exists items_status_check;
alter table items add constraint items_status_check check (status in ('todo','doing','done','cancelled'));
alter table items add column if not exists cancel_reason text not null default '';
alter table items add column if not exists duplicate_of text;
alter table items add column if not exists note_sent_at timestamptz;
alter table items add column if not exists build_status text;
alter table items add column if not exists build_note text not null default '';
alter table items add column if not exists pr_url text;
alter table items add column if not exists build_updated_at timestamptz;
create index if not exists items_build on items (build_status) where build_status is not null;
-- Inbox: a reply the owner has opened is "pending" until they mark it treated. A message can be the build run of an item.
alter table messages add column if not exists opened_at timestamptz;
alter table messages add column if not exists treated_at timestamptz;
alter table messages add column if not exists item_id text;
-- Finance: recurring costs (subscriptions, domains, hosting, API spend), per project or independent (project_id null).
create table if not exists recurring_costs (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id) on delete set null,
  name text not null,
  amount numeric(12,2) not null default 0,
  currency text not null default 'USD',
  period text not null default 'month' check (period in ('week','month','year')),
  next_renewal date,
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recurring_costs_project on recurring_costs (project_id);
-- 0.6.0. First-party page views and clicks for the Monday Jarvis review (components/UsageTracker.tsx → POST /api/usage).
-- Only the label the code gives an element and paths are stored, never what you type. session_id = a random id per
-- browser tab (new after 30 idle minutes), not the login cookie. The weekly run prunes rows older than
-- usage.retention_days (default 90); usage.track_clicks: false (env JARVIS_TRACK_CLICKS=off) stops recording.
create table if not exists click_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  session_id text not null default '',
  kind text not null default 'click',
  page text not null,
  label text not null default '',
  target text not null default '',
  section text not null default '',
  href text
);
create index if not exists click_events_at on click_events (at);
-- 0.6.0. Product metrics per project (users, active users, visits, revenue…): one row per project per day, written by
-- agent/metrics.mjs from each project's source in jarvis.config.json, or by hand (`jarvis metrics <project> --set k=v`).
-- POST /api/agent/metrics merges keys into the day's row. Keys are documented in docs/metrics.md; extra keys are kept.
create table if not exists metrics_snapshots (
  project_id text not null,
  date date not null,
  metrics jsonb not null default '{}',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, date)
);
-- 0.7.0. Item dependencies: the codes of items in the same project this one waits on. An item with an open blocker shows
-- a "blocked by" badge; nothing is enforced.
alter table items add column if not exists blocked_by text[] not null default '{}';
-- 0.7.0. Sprints: a dated batch of one project's items (owner decision: sprints never cross projects). Deleting a
-- sprint only detaches its items.
create table if not exists sprints (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists sprints_project on sprints (project_id, start_date);
alter table items add column if not exists sprint_id uuid;
create index if not exists items_sprint on items (sprint_id) where sprint_id is not null;
-- 0.7.2. Screenings (agent/screen.mjs, check lists in screenings/): on-demand reviews of type 'screening',
-- meta.kind = vibecoded | prelaunch | rights. The type check is widened in place (drop + add, same end state every run).
alter table reviews drop constraint if exists reviews_type_check;
alter table reviews add constraint reviews_type_check check (type in ('project','recap','coaching','jarvis','doc','security','screening'));
-- 0.8.0. Website builds (Reviews → Build website / Try a new visual). `site` is what agent/website.mjs detects in the
-- folder on each projects sync; `site_url` is the address the owner types, which always wins over the guess.
alter table projects add column if not exists site jsonb;
alter table projects add column if not exists site_url text not null default '';
