-- le bois スタッフアプリ — Supabase のテーブル
-- Supabase の SQL Editor に全部貼り付けて Run する。何度実行しても壊れない。
--
-- 方針
--   ・スタッフはログインしない（anon key で読み書き）
--   ・消す操作はアプリからできない（delete 権限を渡さない）
--   ・引き継ぎメモは「解決済みにする」以外は書き換えられない
--   ・store_id を持たせ、店が増えても同じ表で扱える

create extension if not exists pgcrypto;

-- 開店・閉店チェック：1日1リストにつき1行。done はチェック済みの項目の配列
create table if not exists lb_check_runs (
  id           uuid primary key default gen_random_uuid(),
  store_id     text not null default 'lebois',
  list         text not null check (list in ('open','close')),
  biz_date     date not null,
  done         jsonb not null default '[]'::jsonb,   -- [{"id":"o-light","by":"ひろき","at":"2026-11-01T01:02:03Z"}]
  memo         text not null default '',
  updated_by   text not null default '',
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  unique (store_id, list, biz_date)
);

-- 引き継ぎメモと不足リスト
create table if not exists lb_notes (
  id          uuid primary key default gen_random_uuid(),
  store_id    text not null default 'lebois',
  kind        text not null check (kind in ('note','short')),
  body        text not null check (char_length(body) between 1 and 1000),
  staff       text not null check (char_length(staff) between 1 and 40),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);
create index if not exists lb_notes_store_created on lb_notes (store_id, created_at desc);

-- 権限：anon は読む・足す・決まった列だけ直す。消せない
alter table lb_check_runs enable row level security;
alter table lb_notes      enable row level security;

revoke all on lb_check_runs from anon;
revoke all on lb_notes      from anon;
grant select, insert, update on lb_check_runs to anon;
grant select, insert         on lb_notes      to anon;
grant update (resolved_at, resolved_by) on lb_notes to anon;

drop policy if exists lb_check_runs_rw on lb_check_runs;
create policy lb_check_runs_rw on lb_check_runs
  for all to anon using (true) with check (true);

drop policy if exists lb_notes_read on lb_notes;
create policy lb_notes_read on lb_notes for select to anon using (true);
drop policy if exists lb_notes_add on lb_notes;
create policy lb_notes_add on lb_notes for insert to anon with check (resolved_at is null);
drop policy if exists lb_notes_resolve on lb_notes;
create policy lb_notes_resolve on lb_notes for update to anon using (true) with check (true);
