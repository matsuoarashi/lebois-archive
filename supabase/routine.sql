-- 定期の仕事：曜日・季節（月）・ギャラリーの入れ替えに合わせて、その日の出勤者に出す仕事
-- 例）水・木の水やり（夏）、冬は水曜だけ、金曜のグリスト清掃、展示の最終日〜次の搬入までにギャラリー清掃
-- Supabase の SQL Editor で schema.sql のあとに実行する。何度流しても壊れない。

create table if not exists lb_routine (
  id          uuid primary key default gen_random_uuid(),
  store_id    text not null default 'lebois',
  title       text not null check (char_length(title) between 1 and 100),
  detail      text not null default '' check (char_length(detail) <= 1000),   -- やり方
  timing      text not null default 'いつでも' check (timing in ('開店前','営業中','閉店時','いつでも')),
  rule        text not null default 'weekly' check (rule in ('weekly','gallery')),
  -- weekly：weekdays（0=日〜6=土）に出す。gallery：展示の最終日から次の搬入（なければ7日後）まで、済むまで出す
  weekdays    int[] not null default '{}',
  months      int[] not null default '{1,2,3,4,5,6,7,8,9,10,11,12}',          -- 季節：出す月
  active      boolean not null default true,
  sort        int not null default 100,
  updated_by  text not null default '',
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists lb_routine_store on lb_routine (store_id, active, sort);

create table if not exists lb_routine_done (
  id          uuid primary key default gen_random_uuid(),
  store_id    text not null default 'lebois',
  routine_id  uuid not null references lb_routine(id) on delete cascade,
  window_key  text not null,          -- weekly：その日（YYYY/MM/DD）／gallery：終わった展示の最終日
  staff       text not null,
  done_at     timestamptz not null default now(),
  unique (routine_id, window_key)
);
create index if not exists lb_routine_done_store on lb_routine_done (store_id, done_at desc);

alter table lb_routine enable row level security;
alter table lb_routine_done enable row level security;

create or replace function lb_routine_list(p_token uuid) returns setof lb_routine
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  return query select * from lb_routine where store_id = s.store_id and active order by sort, created_at;
end $$;

-- 足す／直す（スタッフと管理者）。p_id があれば上書き
create or replace function lb_routine_put(p_token uuid, p_id uuid, p_title text, p_detail text, p_timing text, p_rule text, p_weekdays int[], p_months int[])
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); nid uuid;
begin
  if s.role not in ('manager','staff') then raise exception 'no_edit'; end if;
  if p_id is null then
    insert into lb_routine (store_id, title, detail, timing, rule, weekdays, months, updated_by)
      values (s.store_id, p_title, coalesce(p_detail,''), p_timing, p_rule, coalesce(p_weekdays,'{}'), coalesce(p_months,'{}'), s.name) returning id into nid;
  else
    update lb_routine set title = p_title, detail = coalesce(p_detail,''), timing = p_timing, rule = p_rule,
      weekdays = coalesce(p_weekdays,'{}'), months = coalesce(p_months,'{}'), updated_by = s.name, updated_at = now()
      where id = p_id and store_id = s.store_id returning id into nid;
  end if;
  return nid;
end $$;

-- やめる（消さずに止める）
create or replace function lb_routine_stop(p_token uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role not in ('manager','staff') then raise exception 'no_edit'; end if;
  update lb_routine set active = false, updated_by = s.name, updated_at = now() where id = p_id and store_id = s.store_id;
end $$;

-- 済み（最近45日分）
create or replace function lb_routine_done_list(p_token uuid) returns setof lb_routine_done
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  return query select * from lb_routine_done where store_id = s.store_id and done_at > now() - interval '45 days' order by done_at desc;
end $$;

-- 済みにする／戻す
create or replace function lb_routine_check(p_token uuid, p_id uuid, p_key text, p_done boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role not in ('manager','staff') then raise exception 'no_edit'; end if;
  if p_done then
    insert into lb_routine_done (store_id, routine_id, window_key, staff) values (s.store_id, p_id, p_key, s.name)
      on conflict (routine_id, window_key) do nothing;
  else
    delete from lb_routine_done where routine_id = p_id and window_key = p_key and store_id = s.store_id;
  end if;
end $$;

grant execute on function lb_routine_list(uuid), lb_routine_put(uuid, uuid, text, text, text, text, int[], int[]),
  lb_routine_stop(uuid, uuid), lb_routine_done_list(uuid), lb_routine_check(uuid, uuid, text, boolean) to anon;

-- ---------- 最初の中身（LINEの履歴から。季節や曜日は仮。アプリから直せる） ----------
create or replace function lb_routine_seed_(p_title text, p_detail text, p_timing text, p_rule text, p_wd int[], p_m int[], p_sort int) returns void
language plpgsql as $$
begin
  if not exists (select 1 from lb_routine where store_id = 'lebois' and title = p_title) then
    insert into lb_routine (store_id, title, detail, timing, rule, weekdays, months, sort, updated_by)
      values ('lebois', p_title, p_detail, p_timing, p_rule, p_wd, p_m, p_sort, 'LINE履歴');
  end if;
end $$;

select lb_routine_seed_('植物の水やり（店内の前半）',
  '店内の植物の半分。土が乾いていたら、鉢底から水が出るくらい。入口右の大きな鉢・天井から吊るした鉢は週1回以下。アガベは葉にかけない（葉焼けする）。混んでいてできなかったら次の出勤者へ。',
  '営業中', 'weekly', '{3}', '{4,5,6,7,8,9,10}', 10);
select lb_routine_seed_('植物の水やり（店内の後半）',
  '前日に残った半分。やり方は前半と同じ。ミニアガベはバケツに5cmほど水をはって鉢ごと浸すと早い。',
  '営業中', 'weekly', '{4}', '{4,5,6,7,8,9,10}', 11);
select lb_routine_seed_('植物の水やり（冬：土が乾いた鉢だけ）',
  '寒い時期は水を控えめに。土を触って乾いている鉢だけ、鉢底から水が出るくらい。',
  '営業中', 'weekly', '{3}', '{11,12,1,2,3}', 12);
select lb_routine_seed_('外の植物の水やり（暑い時期は毎日）',
  '猛暑の間は外の植物に毎日たっぷり。朝のうちに。',
  '開店前', 'weekly', '{0,2,3,4,5,6}', '{7,8,9}', 13);
select lb_routine_seed_('外の植物の水やり',
  '土が乾いていたら、鉢底から水が出るくらい。',
  '開店前', 'weekly', '{3}', '{4,5,6,10}', 14);
select lb_routine_seed_('エアプランツ・ビカクシダの霧吹き',
  'キセログラフィカ（入って左のエアプランツ）は葉が濡れるくらい霧吹き。ビカクシダも葉に霧吹き。',
  '営業中', 'weekly', '{3,6}', '{1,2,3,4,5,6,7,8,9,10,11,12}', 15);
select lb_routine_seed_('グリストラップ清掃',
  'ゴミをすくって網を替える。ハケ・網の置き場は「聞く」で。終わったらにおいが残っていないか確認。',
  'いつでも', 'weekly', '{5}', '{1,2,3,4,5,6,7,8,9,10,11,12}', 20);
select lb_routine_seed_('ギャラリーの清掃（展示の入れ替え）',
  '前の展示が終わったら、次の搬入までに。掃き掃除・拭き掃除・床。終わったらキャンドルを設置。アルカリ電解水のスプレーの場所は「聞く」で。',
  '開店前', 'gallery', '{}', '{1,2,3,4,5,6,7,8,9,10,11,12}', 30);

drop function lb_routine_seed_(text, text, text, text, int[], int[], int);
