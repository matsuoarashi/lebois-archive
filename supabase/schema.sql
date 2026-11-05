-- le bois スタッフアプリ — Supabase（v2：名前＋4桁の番号でログイン）
-- SQL Editor に全部貼り付けて Run する。何度実行しても壊れない。
--
-- 方針
--   ・スタッフは「名前を選ぶ＋4桁の番号」で入る。番号は最初の1回だけ本人が決める
--   ・番号は bcrypt で暗号化して保存。画面にも外にも出さない
--   ・表には直接さわらせない（anon は表の権限なし）。すべて下の関数（rpc）経由で、
--     関数の中でログインの証（token）を確かめる
--   ・消す操作はアプリからできない
--   ・番号を5回まちがえると15分止まる
--   ・番号の消去（忘れたとき）は店長（role=manager）だけ

create extension if not exists pgcrypto with schema extensions;

-- スタッフ
create table if not exists lb_staff (
  id           uuid primary key default gen_random_uuid(),
  store_id     text not null default 'lebois',
  name         text not null check (char_length(name) between 1 and 20),  -- アプリでの表示名（下の名前など）
  role         text not null default 'staff' check (role in ('staff','manager','viewer')),  -- viewer＝閲覧のみ（ギャラリー担当など。シフトと予定だけ見える）
  pin_hash     text,
  fails        int  not null default 0,
  locked_until timestamptz,
  active       boolean not null default true,
  sort         int  not null default 100,
  created_at   timestamptz not null default now(),
  unique (store_id, name)
);

-- ログイン中の端末
create table if not exists lb_sessions (
  token      uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references lb_staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

-- 開店・閉店チェック：1日1リストにつき1行
create table if not exists lb_check_runs (
  id           uuid primary key default gen_random_uuid(),
  store_id     text not null default 'lebois',
  list         text not null check (list in ('open','close')),
  biz_date     date not null,
  done         jsonb not null default '[]'::jsonb,
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
  kind        text not null check (kind in ('note','short','task','cash')),  -- note=引き継ぎ short=足りないもの task=明日の人へ cash=両替
  body        text not null check (char_length(body) between 1 and 1000),
  staff       text not null check (char_length(staff) between 1 and 40),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);
create index if not exists lb_notes_store_created on lb_notes (store_id, created_at desc);

-- 習熟度（自己申告）：1=読んだ 2=先輩と一緒にできた 3=一人でできた
create table if not exists lb_progress (
  staff_id   uuid not null references lb_staff(id) on delete cascade,
  item       text not null check (char_length(item) between 1 and 60),
  level      int  not null check (level between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key (staff_id, item)
);

-- シフト（シフト連携の Apps Script が押し込む。今日から14日分の表示用）
create table if not exists lb_shift_cache (
  store_id   text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- 合鍵（Apps Script がシフトを押し込むときの鍵。値は Supabase と Apps Script のスクリプト プロパティにだけ置く）
create table if not exists lb_secrets (
  name  text primary key,
  value text not null
);

-- 表には anon から直接さわらせない
alter table lb_staff       enable row level security;
alter table lb_sessions    enable row level security;
alter table lb_check_runs  enable row level security;
alter table lb_notes       enable row level security;
alter table lb_progress    enable row level security;
alter table lb_shift_cache enable row level security;
alter table lb_secrets     enable row level security;
revoke all on lb_staff, lb_sessions, lb_check_runs, lb_notes, lb_progress, lb_shift_cache, lb_secrets from anon, authenticated;
drop policy if exists lb_check_runs_rw on lb_check_runs;
drop policy if exists lb_notes_read on lb_notes;
drop policy if exists lb_notes_add on lb_notes;
drop policy if exists lb_notes_resolve on lb_notes;

-- ---------- 関数 ----------

-- token → スタッフ（なければエラー）。180日使わなければ無効
create or replace function lb_me(p_token uuid) returns lb_staff
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff;
begin
  select st.* into s from lb_sessions se join lb_staff st on st.id = se.staff_id
   where se.token = p_token and se.last_seen > now() - interval '180 days' and st.active;
  if s.id is null then raise exception 'login_required'; end if;
  update lb_sessions set last_seen = now() where token = p_token and last_seen < now() - interval '1 hour';
  return s;
end $$;

-- 名前の一覧（番号を決めたかどうかだけ返す）
create or replace function lb_staff_list(p_store text default 'lebois')
returns table (id uuid, name text, has_pin boolean)
language sql security definer set search_path = public, extensions as $$
  select id, name, pin_hash is not null from lb_staff
   where store_id = p_store and active order by sort, name;
$$;

-- ログイン（番号がまだなら、この番号で決める）
create or replace function lb_login(p_staff uuid, p_pin text)
returns table (token uuid, name text, role text, first_time boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff; t uuid; first boolean := false;
begin
  if p_pin !~ '^[0-9]{4}$' then raise exception 'pin_format'; end if;
  select * into s from lb_staff where id = p_staff and active for update;
  if s.id is null then raise exception 'no_staff'; end if;
  if s.locked_until is not null and s.locked_until > now() then raise exception 'locked'; end if;
  if s.pin_hash is null then
    update lb_staff set pin_hash = crypt(p_pin, gen_salt('bf')), fails = 0, locked_until = null where id = s.id;
    first := true;
  elsif s.pin_hash = crypt(p_pin, s.pin_hash) then
    update lb_staff set fails = 0, locked_until = null where id = s.id;
  else
    update lb_staff set
      locked_until = case when s.fails + 1 >= 5 then now() + interval '15 minutes' else null end,
      fails = case when s.fails + 1 >= 5 then 0 else s.fails + 1 end
     where id = s.id;
    return query select null::uuid, null::text, 'pin_wrong'::text, false;  -- 失敗回数を残すため例外にしない
    return;
  end if;
  insert into lb_sessions (staff_id) values (s.id) returning lb_sessions.token into t;
  return query select t, s.name, s.role, first;
end $$;

create or replace function lb_logout(p_token uuid) returns void
language sql security definer set search_path = public, extensions as $$
  delete from lb_sessions where token = p_token;
$$;

-- 自分
create or replace function lb_whoami(p_token uuid) returns table (id uuid, name text, role text)
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin return query select s.id, s.name, s.role; end $$;

-- チェック
create or replace function lb_get_runs(p_token uuid, p_date date) returns setof lb_check_runs
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin return query select * from lb_check_runs where store_id = s.store_id and biz_date = p_date; end $$;

create or replace function lb_put_run(p_token uuid, p_list text, p_date date, p_done jsonb, p_completed boolean)
returns lb_check_runs
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); r lb_check_runs;
begin
  insert into lb_check_runs (store_id, list, biz_date, done, updated_by, updated_at, completed_at)
  values (s.store_id, p_list, p_date, p_done, s.name, now(), case when p_completed then now() end)
  on conflict (store_id, list, biz_date) do update set
    done = excluded.done, updated_by = excluded.updated_by, updated_at = now(),
    completed_at = case when p_completed then coalesce(lb_check_runs.completed_at, now()) else null end
  returning * into r;
  return r;
end $$;

-- 引き継ぎ・不足
create or replace function lb_get_notes(p_token uuid) returns setof lb_notes
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  return query select * from lb_notes where store_id = s.store_id
    and (resolved_at is null or created_at > now() - interval '14 days')
    order by created_at desc limit 200;
end $$;

create or replace function lb_add_note(p_token uuid, p_kind text, p_body text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin insert into lb_notes (store_id, kind, body, staff) values (s.store_id, p_kind, p_body, s.name); end $$;

create or replace function lb_resolve(p_token uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin update lb_notes set resolved_at = now(), resolved_by = s.name where id = p_id and store_id = s.store_id and resolved_at is null; end $$;

-- 習熟度（自分の分）
create or replace function lb_my_progress(p_token uuid) returns table (item text, level int, updated_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin return query select p.item, p.level, p.updated_at from lb_progress p where p.staff_id = s.id; end $$;

create or replace function lb_set_progress(p_token uuid, p_item text, p_level int) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  insert into lb_progress (staff_id, item, level) values (s.id, p_item, p_level)
  on conflict (staff_id, item) do update set level = excluded.level, updated_at = now();
end $$;

-- 習熟度（全員分・店長のみ）
create or replace function lb_all_progress(p_token uuid) returns table (name text, item text, level int, updated_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  return query select st.name, p.item, p.level, p.updated_at from lb_progress p join lb_staff st on st.id = p.staff_id
   where st.store_id = s.store_id order by st.sort, st.name, p.item;
end $$;

-- 番号を消す（忘れたとき・店長のみ）。消された人は次に入ったときに番号を決め直す
create or replace function lb_reset_pin(p_token uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  update lb_staff set pin_hash = null, fails = 0, locked_until = null where id = p_staff and store_id = s.store_id;
  delete from lb_sessions where staff_id = p_staff;
end $$;

-- シフト：Apps Script が押し込む（合鍵が必要）／スタッフが読む（ログインが必要）
create or replace function lb_push_shifts(p_key text, p_store text, p_data jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from lb_secrets where name = 'shift_push' and value = p_key) then raise exception 'bad_key'; end if;
  insert into lb_shift_cache (store_id, data, updated_at) values (p_store, p_data, now())
  on conflict (store_id) do update set data = excluded.data, updated_at = now();
end $$;

create or replace function lb_get_shifts(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); d jsonb;
begin
  select data into d from lb_shift_cache where store_id = s.store_id;
  return coalesce(d, '{"ok":true,"days":[]}'::jsonb);
end $$;

-- 関数だけ anon に開ける（lb_me は内部用なので開けない）
revoke all on function lb_me(uuid) from public, anon, authenticated;
grant execute on function lb_staff_list(text), lb_login(uuid, text), lb_logout(uuid), lb_whoami(uuid),
  lb_get_runs(uuid, date), lb_put_run(uuid, text, date, jsonb, boolean),
  lb_get_notes(uuid), lb_add_note(uuid, text, text), lb_resolve(uuid, uuid),
  lb_my_progress(uuid), lb_set_progress(uuid, text, int), lb_all_progress(uuid), lb_reset_pin(uuid, uuid),
  lb_push_shifts(text, text, jsonb), lb_get_shifts(uuid)
  to anon;

-- 最初のスタッフ（シフト連携の「表示名」と同じ。足すときは同じ形で1行ずつ）
insert into lb_staff (name, sort) values
  ('堀江',10),('田中',20),('星野',30),('岡田',40),('藤江',50),('鈴木',60),('菅谷',70),('小棚木',80),
  ('池尾',90),('ブレイケリー',100),('福永',110),('佐野',120),('畑崎',130),('平井',140),('菅原',150),
  ('古川',160),('松尾',170),('岩崎',180)
on conflict (store_id, name) do nothing;

-- 管理者（番号の消去・習熟度一覧）：岡田葵・古川佳奈・松尾新史
update lb_staff set role = 'manager' where store_id = 'lebois' and name in ('葵','佳奈','新史');
-- 閲覧のみ：岩崎さん（ギャラリー担当。誰が出勤かを見るため）
update lb_staff set role = 'viewer' where store_id = 'lebois' and name = '岩崎';

-- シフト押し込み用の合鍵（初回だけランダムに作る）
insert into lb_secrets (name, value) values ('shift_push', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;
