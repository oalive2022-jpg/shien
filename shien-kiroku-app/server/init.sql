-- 支援記録ノート データベーススキーマ
create extension if not exists pgcrypto;

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  display_name text not null,
  role text not null check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

create table if not exists homes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text default '',
  capacity text default '',
  created_at timestamptz not null default now()
);

create table if not exists residents (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references homes(id) on delete restrict,
  name text not null,
  kana text default '',
  birth_date date,
  contact text default '',
  created_at timestamptz not null default now()
);

create table if not exists records (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references residents(id) on delete cascade,
  type text not null check (type in ('support', 'meal', 'stay', 'medication')),
  record_date date not null,
  data jsonb not null default '{}',
  created_by text not null,
  created_at timestamptz not null default now(),
  last_edited_by text,
  last_edited_at timestamptz
);

create table if not exists record_edit_history (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references records(id) on delete cascade,
  edited_by text not null,
  edited_at timestamptz not null default now(),
  previous_data jsonb not null
);

create table if not exists usage_records (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references residents(id) on delete cascade,
  record_date date not null,
  flags jsonb not null default '{}',
  notes text default '',
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (resident_id, record_date)
);

create index if not exists idx_residents_home on residents(home_id);
create index if not exists idx_usage_resident on usage_records(resident_id);
create index if not exists idx_usage_date on usage_records(record_date);
create index if not exists idx_records_resident on records(resident_id);
create index if not exists idx_records_type on records(type);
create index if not exists idx_history_record on record_edit_history(record_id);
