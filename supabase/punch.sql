-- 2026-11-06 打刻をアプリで（松尾さん 11/6：各自のスマホ、位置情報で店にいるか確かめる、修正は申請→承認、freee へは API で日ごとに書き込む）
-- 1日1行（出勤した日付）。休憩は何回でも。位置は「店の近くだったか」と距離（10m単位）だけ。緯度・経度は残さない。
-- 時給・人件費はここには置かない。

alter table lb_staff add column if not exists punch_app boolean not null default false;  -- アプリで打刻する人（freee へも送る）

create table if not exists lb_store_setting (
  store_id   text primary key,
  lat        double precision,
  lng        double precision,
  radius_m   int not null default 150,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists lb_attend (
  store_id   text not null default 'lebois',
  staff_id   uuid not null references lb_staff(id) on delete cascade,
  ymd        date not null,
  in_at      timestamptz,
  out_at     timestamptz,
  breaks     jsonb not null default '[]',      -- [{"s": timestamptz, "e": timestamptz|null}]
  in_near    boolean,  in_dist  int,           -- null＝位置が取れなかった
  out_near   boolean,  out_dist int,
  edited     boolean not null default false,   -- 修正の承認・管理者の手直しが入った
  note       text not null default '',
  updated_at timestamptz not null default now(),
  synced_at  timestamptz,                      -- freee に書き込めた時刻
  sync_note  text not null default '',         -- 書き込めなかった理由など
  primary key (staff_id, ymd)
);

create table if not exists lb_punch_log (
  id       bigserial primary key,
  store_id text not null default 'lebois',
  staff_id uuid not null references lb_staff(id) on delete cascade,
  ymd      date not null,
  kind     text not null,
  at       timestamptz not null default now(),
  near     boolean,
  dist     int,
  by_name  text not null default ''
);

create table if not exists lb_attend_fix (
  id         uuid primary key default gen_random_uuid(),
  store_id   text not null default 'lebois',
  staff_id   uuid not null references lb_staff(id) on delete cascade,
  ymd        date not null,
  in_hm      text not null default '',
  out_hm     text not null default '',
  brk_s      text not null default '',
  brk_e      text not null default '',
  reason     text not null default '',
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

alter table lb_store_setting enable row level security;
alter table lb_attend enable row level security;
alter table lb_punch_log enable row level security;
alter table lb_attend_fix enable row level security;
revoke all on lb_store_setting, lb_attend, lb_punch_log, lb_attend_fix from anon, authenticated;

insert into lb_secrets (name, value) select 'attend_sync', encode(extensions.gen_random_bytes(24), 'hex')
 where not exists (select 1 from lb_secrets where name = 'attend_sync');

-- 'HH:MM' をその日の東京時刻に。退勤が出勤より前なら翌日扱いは呼ぶ側で
create or replace function lb_hm_at(p_ymd date, p_hm text) returns timestamptz
language sql stable as $$
  select case when p_hm ~ '^\d{1,2}:\d{2}$' then ((p_ymd + p_hm::time)::timestamp at time zone 'Asia/Tokyo') end;
$$;
create or replace function lb_at_hm(p timestamptz) returns text
language sql stable as $$ select to_char(p at time zone 'Asia/Tokyo', 'HH24:MI'); $$;

-- 1日分を画面用に
create or replace function lb_attend_json(a lb_attend) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'ymd', a.ymd, 'in', lb_at_hm(a.in_at), 'out', lb_at_hm(a.out_at),
    'in_next', a.out_at is not null and (a.out_at at time zone 'Asia/Tokyo')::date > a.ymd,
    'breaks', coalesce((select jsonb_agg(jsonb_build_object('s', lb_at_hm((b->>'s')::timestamptz), 'e', lb_at_hm((b->>'e')::timestamptz)))
                          from jsonb_array_elements(a.breaks) b), '[]'::jsonb),
    'break_min', coalesce((select sum(extract(epoch from (coalesce((b->>'e')::timestamptz, now()) - (b->>'s')::timestamptz)) / 60)::int
                          from jsonb_array_elements(a.breaks) b), 0),
    'work_min', case when a.in_at is not null and a.out_at is not null then
                  (extract(epoch from (a.out_at - a.in_at)) / 60)::int - coalesce((select sum(extract(epoch from ((b->>'e')::timestamptz - (b->>'s')::timestamptz)) / 60)::int
                          from jsonb_array_elements(a.breaks) b where b->>'e' is not null), 0) end,
    'in_near', a.in_near, 'in_dist', a.in_dist, 'out_near', a.out_near, 'out_dist', a.out_dist,
    'edited', a.edited, 'note', a.note,
    'synced', a.synced_at is not null and a.synced_at >= a.updated_at, 'sync_note', a.sync_note);
$$;

-- いま開いている勤務（退勤していない・出勤から20時間以内）
create or replace function lb_attend_open(p_staff uuid) returns lb_attend
language sql stable as $$
  select * from lb_attend where staff_id = p_staff and in_at is not null and out_at is null and in_at > now() - interval '20 hours'
   order by in_at desc limit 1;
$$;

-- スタッフ：自分の状態（今日・直近14日・申請中の修正・店の位置）
create or replace function lb_punch_me(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); o lb_attend; t lb_attend; today date := (now() at time zone 'Asia/Tokyo')::date; nx text[]; st lb_store_setting;
begin
  if not s.punch_app then return jsonb_build_object('enabled', false); end if;
  o := lb_attend_open(s.id);
  select * into t from lb_attend where staff_id = s.id and ymd = today;
  if o.staff_id is not null then
    if exists (select 1 from jsonb_array_elements(o.breaks) b where b->>'e' is null) then nx := array['break_end'];
    else nx := array['break_begin', 'clock_out']; end if;
  elsif t.staff_id is not null then nx := array[]::text[];
  else nx := array['clock_in']; end if;
  select * into st from lb_store_setting where store_id = s.store_id;
  return jsonb_build_object('enabled', true, 'today', today, 'next', to_jsonb(nx),
    'cur', case when o.staff_id is not null then lb_attend_json(o) when t.staff_id is not null then lb_attend_json(t) end,
    'recent', coalesce((select jsonb_agg(lb_attend_json(a) order by a.ymd desc) from lb_attend a where a.staff_id = s.id and a.ymd >= today - 14), '[]'::jsonb),
    'fixes', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'ymd', f.ymd, 'in', f.in_hm, 'out', f.out_hm, 'bs', f.brk_s, 'be', f.brk_e, 'reason', f.reason, 'status', f.status) order by f.created_at desc)
                         from lb_attend_fix f where f.staff_id = s.id and (f.status = 'pending' or f.decided_at > now() - interval '3 days')), '[]'::jsonb),
    'store', case when st.lat is not null then jsonb_build_object('lat', st.lat, 'lng', st.lng, 'r', st.radius_m) end);
end $$;

-- スタッフ：打刻（clock_in / break_begin / break_end / clock_out）。p_near・p_dist は端末で測った結果（取れなければ null）
create or replace function lb_punch(p_token uuid, p_kind text, p_near boolean, p_dist int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); o lb_attend; today date := (now() at time zone 'Asia/Tokyo')::date; d int := case when p_dist is null then null else least(greatest(round(p_dist / 10.0)::int * 10, 0), 99990) end;
begin
  if not s.punch_app then raise exception 'not_enabled'; end if;
  perform pg_advisory_xact_lock(hashtext(s.id::text));
  o := lb_attend_open(s.id);
  if p_kind = 'clock_in' then
    if o.staff_id is not null then raise exception 'already_in'; end if;
    if exists (select 1 from lb_attend where staff_id = s.id and ymd = today) then raise exception 'already_done'; end if;
    insert into lb_attend (store_id, staff_id, ymd, in_at, in_near, in_dist) values (s.store_id, s.id, today, date_trunc('minute', now()), p_near, d);
    o.ymd := today;
  elsif o.staff_id is null then raise exception 'not_in';
  elsif p_kind = 'break_begin' then
    if exists (select 1 from jsonb_array_elements(o.breaks) b where b->>'e' is null) then raise exception 'on_break'; end if;
    update lb_attend set breaks = breaks || jsonb_build_array(jsonb_build_object('s', date_trunc('minute', now()), 'e', null)), updated_at = now()
     where staff_id = s.id and ymd = o.ymd;
  elsif p_kind = 'break_end' then
    if not exists (select 1 from jsonb_array_elements(o.breaks) b where b->>'e' is null) then raise exception 'not_on_break'; end if;
    update lb_attend set breaks = (select jsonb_agg(case when b->>'e' is null then jsonb_set(b, '{e}', to_jsonb(date_trunc('minute', now()))) else b end) from jsonb_array_elements(breaks) b), updated_at = now()
     where staff_id = s.id and ymd = o.ymd;
  elsif p_kind = 'clock_out' then
    update lb_attend set out_at = date_trunc('minute', now()), out_near = p_near, out_dist = d,
      breaks = coalesce((select jsonb_agg(case when b->>'e' is null then jsonb_set(b, '{e}', to_jsonb(date_trunc('minute', now()))) else b end) from jsonb_array_elements(breaks) b), '[]'::jsonb),
      updated_at = now()
     where staff_id = s.id and ymd = o.ymd;
  else raise exception 'bad_kind'; end if;
  insert into lb_punch_log (store_id, staff_id, ymd, kind, near, dist, by_name) values (s.store_id, s.id, o.ymd, p_kind, p_near, d, s.name);
  return lb_punch_me(p_token);
end $$;

-- スタッフ：修正の申請（打刻忘れ・押し間違い）。時刻は 'HH:MM'、空なら直さない
create or replace function lb_fix_request(p_token uuid, p_ymd date, p_in text, p_out text, p_bs text, p_be text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if not s.punch_app then raise exception 'not_enabled'; end if;
  if p_ymd > today or p_ymd < today - 45 then raise exception 'bad_date'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'need_reason'; end if;
  update lb_attend_fix set status = 'rejected', decided_by = s.name || '（出し直し）', decided_at = now()
   where staff_id = s.id and ymd = p_ymd and status = 'pending';
  insert into lb_attend_fix (store_id, staff_id, ymd, in_hm, out_hm, brk_s, brk_e, reason)
  values (s.store_id, s.id, p_ymd, coalesce(trim(p_in), ''), coalesce(trim(p_out), ''), coalesce(trim(p_bs), ''), coalesce(trim(p_be), ''), left(trim(p_reason), 200));
  return lb_punch_me(p_token);
end $$;

-- 1日分を時刻で書き換える（承認・管理者の手直しで共通）。空の項目はそのまま
create or replace function lb_attend_apply(p_store text, p_staff uuid, p_ymd date, p_in text, p_out text, p_bs text, p_be text, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a lb_attend; vin timestamptz; vout timestamptz; bs timestamptz; be timestamptz;
begin
  insert into lb_attend (store_id, staff_id, ymd) values (p_store, p_staff, p_ymd) on conflict (staff_id, ymd) do nothing;
  select * into a from lb_attend where staff_id = p_staff and ymd = p_ymd;
  vin := coalesce(lb_hm_at(p_ymd, p_in), a.in_at);
  vout := coalesce(lb_hm_at(p_ymd, p_out), a.out_at);
  if vin is not null and vout is not null and vout <= vin then vout := vout + interval '1 day'; end if;
  if p_bs = '-' then a.breaks := '[]'::jsonb;  -- 休憩なし
  elsif lb_hm_at(p_ymd, p_bs) is not null and lb_hm_at(p_ymd, p_be) is not null then
    bs := lb_hm_at(p_ymd, p_bs); be := lb_hm_at(p_ymd, p_be);
    if vin is not null and bs < vin then bs := bs + interval '1 day'; end if;
    if be <= bs then be := be + interval '1 day'; end if;
    a.breaks := jsonb_build_array(jsonb_build_object('s', bs, 'e', be));
  end if;
  update lb_attend set in_at = vin, out_at = vout, breaks = a.breaks, edited = true,
    note = case when coalesce(p_note, '') <> '' then left(p_note, 200) else note end, updated_at = now()
   where staff_id = p_staff and ymd = p_ymd;
end $$;

-- 管理者：期間の勤怠・修正の申請・打刻する人・店の位置
create or replace function lb_attend_admin(p_token uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); st lb_store_setting;
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  select * into st from lb_store_setting where store_id = s.store_id;
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(lb_attend_json(a) || jsonb_build_object('staff_id', a.staff_id, 'name', p.name) order by a.ymd desc, p.sort)
                        from lb_attend a join lb_staff p on p.id = a.staff_id where a.store_id = s.store_id and a.ymd between p_from and p_to), '[]'::jsonb),
    'fixes', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'staff_id', f.staff_id, 'name', p.name, 'ymd', f.ymd, 'in', f.in_hm, 'out', f.out_hm, 'bs', f.brk_s, 'be', f.brk_e,
                          'reason', f.reason, 'status', f.status, 'decided_by', f.decided_by, 'at', f.created_at) order by f.created_at desc)
                        from lb_attend_fix f join lb_staff p on p.id = f.staff_id where f.store_id = s.store_id and (f.status = 'pending' or f.decided_at > now() - interval '7 days')), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'punch_app', p.punch_app) order by p.sort)
                        from lb_staff p where p.store_id = s.store_id and p.active and p.role <> 'viewer'), '[]'::jsonb),
    'store', case when st.lat is not null then jsonb_build_object('lat', st.lat, 'lng', st.lng, 'r', st.radius_m, 'by', st.updated_by, 'at', st.updated_at) end);
end $$;

-- 管理者：修正の申請を承認・却下
create or replace function lb_fix_decide(p_token uuid, p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); f lb_attend_fix;
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  select * into f from lb_attend_fix where id = p_id and store_id = s.store_id and status = 'pending' for update;
  if f.id is null then raise exception 'not_found'; end if;
  if p_ok then
    perform lb_attend_apply(s.store_id, f.staff_id, f.ymd, f.in_hm, f.out_hm, f.brk_s, f.brk_e, '修正：' || f.reason || '（' || s.name || '承認）');
  end if;
  update lb_attend_fix set status = case when p_ok then 'approved' else 'rejected' end, decided_by = s.name, decided_at = now() where id = p_id;
end $$;

-- 管理者：直接直す（p_in が 'x' ならその日の記録を消す）
create or replace function lb_attend_put(p_token uuid, p_staff uuid, p_ymd date, p_in text, p_out text, p_bs text, p_be text, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  if not exists (select 1 from lb_staff where id = p_staff and store_id = s.store_id) then raise exception 'not_found'; end if;
  if p_in = 'x' then
    delete from lb_attend where staff_id = p_staff and ymd = p_ymd;  -- freee 側は消さない（並走中は freee で消す）
  else
    perform lb_attend_apply(s.store_id, p_staff, p_ymd, p_in, p_out, p_bs, p_be, coalesce(nullif(p_note, ''), s.name || 'が直した'));
  end if;
end $$;

-- 管理者：アプリで打刻する人の切り替え
create or replace function lb_punch_app_set(p_token uuid, p_staff uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  update lb_staff set punch_app = p_on where id = p_staff and store_id = s.store_id;
end $$;

-- 管理者：店の位置（店で「いまの場所を店の位置にする」）
create or replace function lb_store_loc_set(p_token uuid, p_lat double precision, p_lng double precision, p_r int) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  insert into lb_store_setting (store_id, lat, lng, radius_m, updated_by, updated_at) values (s.store_id, p_lat, p_lng, coalesce(p_r, 150), s.name, now())
  on conflict (store_id) do update set lat = excluded.lat, lng = excluded.lng, radius_m = excluded.radius_m, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- Apps Script（勤怠取込）：freee へ送る分。退勤まで済んで、まだ送っていないか、送ったあとに直った日
create or replace function lb_attend_sync_list(p_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from lb_secrets where name = 'attend_sync' and value = p_key) then raise exception 'bad_key'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('staff_id', a.staff_id, 'name', p.name, 'ymd', a.ymd,
      'in', to_char(a.in_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI:00'),
      'out', to_char(a.out_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI:00'),
      'breaks', coalesce((select jsonb_agg(jsonb_build_object('s', to_char((b->>'s')::timestamptz at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI:00'),
                                                              'e', to_char((b->>'e')::timestamptz at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI:00')))
                          from jsonb_array_elements(a.breaks) b where b->>'e' is not null), '[]'::jsonb)) order by a.ymd)
    from lb_attend a join lb_staff p on p.id = a.staff_id
   where p.punch_app and a.in_at is not null and a.out_at is not null and a.ymd >= current_date - 40
     and (a.synced_at is null or a.synced_at < a.updated_at)), '[]'::jsonb);
end $$;

create or replace function lb_attend_synced(p_key text, p_staff uuid, p_ymd date, p_ok boolean, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from lb_secrets where name = 'attend_sync' and value = p_key) then raise exception 'bad_key'; end if;
  if p_ok then update lb_attend set synced_at = now(), sync_note = '' where staff_id = p_staff and ymd = p_ymd;
  else update lb_attend set sync_note = left(coalesce(p_note, ''), 200) where staff_id = p_staff and ymd = p_ymd; end if;
end $$;

revoke all on function lb_attend_apply(text, uuid, date, text, text, text, text, text), lb_attend_open(uuid), lb_attend_json(lb_attend) from public, anon, authenticated;
revoke all on function lb_punch_me(uuid), lb_punch(uuid, text, boolean, int), lb_fix_request(uuid, date, text, text, text, text, text),
  lb_attend_admin(uuid, date, date), lb_fix_decide(uuid, uuid, boolean), lb_attend_put(uuid, uuid, date, text, text, text, text, text),
  lb_punch_app_set(uuid, uuid, boolean), lb_store_loc_set(uuid, double precision, double precision, int),
  lb_attend_sync_list(text), lb_attend_synced(text, uuid, date, boolean, text) from public;
grant execute on function lb_punch_me(uuid), lb_punch(uuid, text, boolean, int), lb_fix_request(uuid, date, text, text, text, text, text),
  lb_attend_admin(uuid, date, date), lb_fix_decide(uuid, uuid, boolean), lb_attend_put(uuid, uuid, date, text, text, text, text, text),
  lb_punch_app_set(uuid, uuid, boolean), lb_store_loc_set(uuid, double precision, double precision, int),
  lb_attend_sync_list(text), lb_attend_synced(text, uuid, date, boolean, text) to anon;

select 'ok' as punch_sql;
