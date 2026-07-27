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
  medications jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- 既存環境向け：以前のバージョンで作成されたテーブルに服薬情報カラムを追加
alter table residents add column if not exists medications jsonb not null default '[]';

create table if not exists medication_checks (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references residents(id) on delete cascade,
  record_date date not null,
  checks jsonb not null default '{}',
  notes text default '',
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (resident_id, record_date)
);

create table if not exists records (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references residents(id) on delete cascade,
  type text not null check (type in ('support', 'health', 'meal', 'stay', 'medication')),
  record_date date not null,
  data jsonb not null default '{}',
  field_authors jsonb not null default '{}',
  created_by text not null,
  created_at timestamptz not null default now(),
  last_edited_by text,
  last_edited_at timestamptz
);

-- 既存環境向け：項目ごとの記入者カラムを追加
alter table records add column if not exists field_authors jsonb not null default '{}';

-- 既存環境向け：以前のバージョンで作成されたテーブルのCHECK制約を更新する
do $$
begin
  if exists (select 1 from information_schema.table_constraints where constraint_name = 'records_type_check') then
    alter table records drop constraint records_type_check;
  end if;
  alter table records add constraint records_type_check check (type in ('support', 'health', 'meal', 'stay', 'medication'));
end $$;

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
create index if not exists idx_medcheck_resident on medication_checks(resident_id);
create index if not exists idx_medcheck_date on medication_checks(record_date);
create index if not exists idx_records_resident on records(resident_id);
create index if not exists idx_records_type on records(type);
create index if not exists idx_history_record on record_edit_history(record_id);
