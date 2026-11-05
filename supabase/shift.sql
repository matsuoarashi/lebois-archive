-- シフト：希望の提出（スタッフ）→ シフト作成（管理者）→ 公開（アプリの「今日のシフト」に出る）
-- 枠は今までどおり 早番 10:30–14:30／中番 13:30–16:30／遅番 14:30–18:30／終日 10:30–18:30（＋時間指定）
-- Supabase の SQL Editor で schema.sql のあとに実行する。何度流しても壊れない。

-- 月ごとの状態（締切・公開）
create table if not exists lb_shift_month (
  store_id     text not null default 'lebois',
  month        text not null check (month ~ '^\d{4}-\d{2}$'),   -- 2026-12
  deadline     date,                                            -- 希望の締切（なければ表示しない）
  published    boolean not null default false,
  published_at timestamptz,
  published_by text not null default '',
  updated_at   timestamptz not null default now(),
  primary key (store_id, month)
);

-- 希望（1人1日1行）。kinds：早番・中番・遅番・終日・時間 のいずれか（複数可）。行がない日＝入れない
create table if not exists lb_shift_wish (
  id         uuid primary key default gen_random_uuid(),
  store_id   text not null default 'lebois',
  month      text not null,
  staff_id   uuid not null references lb_staff(id) on delete cascade,
  staff      text not null,
  day        date not null,
  kinds      text[] not null default '{}',
  t_start    text not null default '',    -- 時間指定のとき 11:00
  t_end      text not null default '',
  comment    text not null default '' check (char_length(comment) <= 200),
  updated_at timestamptz not null default now(),
  unique (staff_id, day)
);
create index if not exists lb_shift_wish_month on lb_shift_wish (store_id, month);

-- 月ごとのひとこと（何日くらい入りたいか、など）
create table if not exists lb_shift_wish_note (
  store_id   text not null default 'lebois',
  month      text not null,
  staff_id   uuid not null references lb_staff(id) on delete cascade,
  staff      text not null,
  want_days  int,
  note       text not null default '' check (char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (staff_id, month)
);

-- 作ったシフト（下書き。公開すると全員に見える）
create table if not exists lb_shift_plan (
  id         uuid primary key default gen_random_uuid(),
  store_id   text not null default 'lebois',
  month      text not null,
  day        date not null,
  slot       text not null,                -- 早番・中番・遅番・終日・時間
  t_start    text not null,
  t_end      text not null,
  staff      text not null default '',     -- 空＝人が足りない枠
  sort       int  not null default 0,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists lb_shift_plan_month on lb_shift_plan (store_id, month, day);

-- 時間帯ごとの来店の目安（Square の集計から。管理者だけが読む）
create table if not exists lb_demand (
  store_id text not null default 'lebois',
  weekday  int  not null check (weekday between 0 and 6),   -- 0=日
  hour     int  not null check (hour between 0 and 23),
  orders   numeric not null,                                -- 1日あたりの注文件数
  sales    int  not null,                                   -- 1日あたりの売上（円）
  source   text not null default '',
  primary key (store_id, weekday, hour)
);

alter table lb_shift_month enable row level security;
alter table lb_shift_wish enable row level security;
alter table lb_shift_wish_note enable row level security;
alter table lb_shift_plan enable row level security;
alter table lb_demand enable row level security;
revoke all on lb_shift_month, lb_shift_wish, lb_shift_wish_note, lb_shift_plan, lb_demand from anon, authenticated;

-- ---------- 希望 ----------
-- 自分の希望（その月）
create or replace function lb_wish_mine(p_token uuid, p_month text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  return jsonb_build_object(
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(day,'YYYY-MM-DD'), 'kinds', kinds, 't_start', t_start, 't_end', t_end, 'comment', comment) order by day)
                        from lb_shift_wish where staff_id = s.id and month = p_month), '[]'::jsonb),
    'note', (select jsonb_build_object('want_days', want_days, 'note', note, 'updated_at', updated_at) from lb_shift_wish_note where staff_id = s.id and month = p_month),
    'month', (select jsonb_build_object('deadline', deadline, 'published', published) from lb_shift_month where store_id = s.store_id and month = p_month));
end $$;

-- 自分の希望を出し直す（その月の分をまるごと入れ替え）。p_days：[{day, kinds, t_start, t_end, comment}]
create or replace function lb_wish_put(p_token uuid, p_month text, p_days jsonb, p_want int, p_note text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); d jsonb;
begin
  if s.role not in ('manager','staff') then raise exception 'no_edit'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_month'; end if;
  if exists (select 1 from lb_shift_month where store_id = s.store_id and month = p_month and published) then raise exception 'published'; end if;
  delete from lb_shift_wish where staff_id = s.id and month = p_month;
  for d in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) loop
    if to_char((d->>'day')::date, 'YYYY-MM') <> p_month then continue; end if;
    if jsonb_array_length(coalesce(d->'kinds','[]'::jsonb)) = 0 then continue; end if;
    insert into lb_shift_wish (store_id, month, staff_id, staff, day, kinds, t_start, t_end, comment)
      values (s.store_id, p_month, s.id, s.name, (d->>'day')::date,
              array(select jsonb_array_elements_text(d->'kinds')), coalesce(d->>'t_start',''), coalesce(d->>'t_end',''), left(coalesce(d->>'comment',''), 200));
  end loop;
  insert into lb_shift_wish_note (store_id, month, staff_id, staff, want_days, note, updated_at)
    values (s.store_id, p_month, s.id, s.name, p_want, left(coalesce(p_note,''), 500), now())
    on conflict (staff_id, month) do update set want_days = excluded.want_days, note = excluded.note, staff = excluded.staff, updated_at = now();
end $$;

-- 全員の希望（管理者だけ）
create or replace function lb_wish_all(p_token uuid, p_month text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  return jsonb_build_object(
    'days', coalesce((select jsonb_agg(jsonb_build_object('staff', staff, 'day', to_char(day,'YYYY-MM-DD'), 'kinds', kinds, 't_start', t_start, 't_end', t_end, 'comment', comment) order by day, staff)
                        from lb_shift_wish where store_id = s.store_id and month = p_month), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('staff', staff, 'want_days', want_days, 'note', note, 'updated_at', updated_at) order by staff)
                        from lb_shift_wish_note where store_id = s.store_id and month = p_month), '[]'::jsonb));
end $$;

-- ---------- 月の状態 ----------
create or replace function lb_month_get(p_token uuid, p_month text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  return coalesce((select jsonb_build_object('deadline', deadline, 'published', published, 'published_at', published_at, 'published_by', published_by)
                     from lb_shift_month where store_id = s.store_id and month = p_month), '{"published":false}'::jsonb);
end $$;

create or replace function lb_month_set(p_token uuid, p_month text, p_deadline date, p_published boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  insert into lb_shift_month (store_id, month, deadline, published, published_at, published_by)
    values (s.store_id, p_month, p_deadline, coalesce(p_published,false), case when p_published then now() end, case when p_published then s.name else '' end)
  on conflict (store_id, month) do update set deadline = excluded.deadline, published = excluded.published,
    published_at = case when excluded.published and not lb_shift_month.published then now() else lb_shift_month.published_at end,
    published_by = case when excluded.published and not lb_shift_month.published then s.name else lb_shift_month.published_by end,
    updated_at = now();
end $$;

-- ---------- 作ったシフト ----------
-- 管理者はいつでも、ほかの人は公開された月だけ
create or replace function lb_plan_list(p_token uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  return jsonb_build_object(
    'months', coalesce((select jsonb_agg(m.month) from lb_shift_month m where m.store_id = s.store_id and m.published
                          and m.month between to_char(p_from,'YYYY-MM') and to_char(p_to,'YYYY-MM')), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(p.day,'YYYY-MM-DD'), 'slot', p.slot, 't_start', p.t_start, 't_end', p.t_end, 'staff', p.staff, 'sort', p.sort) order by p.day, p.t_start, p.sort)
       from lb_shift_plan p where p.store_id = s.store_id and p.day between p_from and p_to
        and (s.role = 'manager' or exists (select 1 from lb_shift_month m where m.store_id = p.store_id and m.month = p.month and m.published))), '[]'::jsonb));
end $$;

-- その月の分をまるごと入れ替え（管理者だけ）。p_rows：[{day, slot, t_start, t_end, staff}]
create or replace function lb_plan_put(p_token uuid, p_month text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); d jsonb; i int := 0;
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_month'; end if;
  delete from lb_shift_plan where store_id = s.store_id and month = p_month;
  for d in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if to_char((d->>'day')::date, 'YYYY-MM') <> p_month then continue; end if;
    i := i + 1;
    insert into lb_shift_plan (store_id, month, day, slot, t_start, t_end, staff, sort, updated_by)
      values (s.store_id, p_month, (d->>'day')::date, left(d->>'slot', 20), left(d->>'t_start', 5), left(d->>'t_end', 5), left(coalesce(d->>'staff',''), 20), i, s.name);
  end loop;
end $$;

-- 来店の目安（管理者だけ）
create or replace function lb_demand_list(p_token uuid) returns setof lb_demand
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  return query select * from lb_demand where store_id = s.store_id order by weekday, hour;
end $$;

grant execute on function lb_wish_mine(uuid, text), lb_wish_put(uuid, text, jsonb, int, text), lb_wish_all(uuid, text),
  lb_month_get(uuid, text), lb_month_set(uuid, text, date, boolean),
  lb_plan_list(uuid, date, date), lb_plan_put(uuid, text, jsonb), lb_demand_list(uuid) to anon;

-- ---------- 来店の目安の初期値（Square 2026/5/7〜11/5、注文4,028件・営業158日の平均） ----------
insert into lb_demand (store_id, weekday, hour, orders, sales, source) values
  ('lebois',2,10,0.2,183,'square 2026-05-07..11-05'),('lebois',2,11,2.3,3218,'square 2026-05-07..11-05'),('lebois',2,12,2.5,3294,'square 2026-05-07..11-05'),('lebois',2,13,3.6,4858,'square 2026-05-07..11-05'),('lebois',2,14,3.4,4133,'square 2026-05-07..11-05'),('lebois',2,15,3.3,3794,'square 2026-05-07..11-05'),('lebois',2,16,3.5,4194,'square 2026-05-07..11-05'),('lebois',2,17,0.6,784,'square 2026-05-07..11-05'),
  ('lebois',3,11,1.7,2625,'square 2026-05-07..11-05'),('lebois',3,12,3.0,4296,'square 2026-05-07..11-05'),('lebois',3,13,2.7,3492,'square 2026-05-07..11-05'),('lebois',3,14,3.3,4621,'square 2026-05-07..11-05'),('lebois',3,15,3.9,4996,'square 2026-05-07..11-05'),('lebois',3,16,2.5,3559,'square 2026-05-07..11-05'),('lebois',3,17,0.7,1039,'square 2026-05-07..11-05'),
  ('lebois',4,11,1.6,2053,'square 2026-05-07..11-05'),('lebois',4,12,2.0,2782,'square 2026-05-07..11-05'),('lebois',4,13,1.7,2154,'square 2026-05-07..11-05'),('lebois',4,14,2.7,3182,'square 2026-05-07..11-05'),('lebois',4,15,2.8,3416,'square 2026-05-07..11-05'),('lebois',4,16,2.0,3384,'square 2026-05-07..11-05'),('lebois',4,17,0.7,726,'square 2026-05-07..11-05'),
  ('lebois',5,11,1.7,2333,'square 2026-05-07..11-05'),('lebois',5,12,2.3,3510,'square 2026-05-07..11-05'),('lebois',5,13,2.5,3639,'square 2026-05-07..11-05'),('lebois',5,14,3.0,3467,'square 2026-05-07..11-05'),('lebois',5,15,3.0,3626,'square 2026-05-07..11-05'),('lebois',5,16,2.0,2224,'square 2026-05-07..11-05'),('lebois',5,17,0.9,861,'square 2026-05-07..11-05'),
  ('lebois',6,11,5.0,7815,'square 2026-05-07..11-05'),('lebois',6,12,4.5,7243,'square 2026-05-07..11-05'),('lebois',6,13,6.2,8419,'square 2026-05-07..11-05'),('lebois',6,14,8.2,12346,'square 2026-05-07..11-05'),('lebois',6,15,8.2,11266,'square 2026-05-07..11-05'),('lebois',6,16,7.0,10056,'square 2026-05-07..11-05'),('lebois',6,17,1.5,1773,'square 2026-05-07..11-05'),
  ('lebois',0,10,0.7,732,'square 2026-05-07..11-05'),('lebois',0,11,5.3,8324,'square 2026-05-07..11-05'),('lebois',0,12,6.4,11441,'square 2026-05-07..11-05'),('lebois',0,13,6.9,10256,'square 2026-05-07..11-05'),('lebois',0,14,9.1,13618,'square 2026-05-07..11-05'),('lebois',0,15,8.3,11519,'square 2026-05-07..11-05'),('lebois',0,16,6.8,9457,'square 2026-05-07..11-05'),('lebois',0,17,1.7,3245,'square 2026-05-07..11-05')
on conflict (store_id, weekday, hour) do update set orders = excluded.orders, sales = excluded.sales, source = excluded.source;
