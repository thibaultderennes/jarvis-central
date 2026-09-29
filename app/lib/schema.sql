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
  type text not null check (type in ('project','recap','coaching','jarvis','doc')),
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
