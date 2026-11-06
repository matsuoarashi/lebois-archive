-- 2026-11-06 書類の受け取り状況（松尾さん 11/6）。中身（番号・口座など）は持たない。状態だけ。
-- 状態：none＝まだ頼んでいない／asked＝頼んだ／received＝受け取った／na＝この人には不要
create table if not exists lb_doc_type (
  id      uuid primary key default gen_random_uuid(),
  store_id text not null default 'lebois',
  name    text not null,
  note    text not null default '',
  sort    int  not null default 100,
  active  boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists lb_doc_status (
  store_id    text not null default 'lebois',
  staff_id    uuid not null references lb_staff(id) on delete cascade,
  type_id     uuid not null references lb_doc_type(id) on delete cascade,
  status      text not null default 'none' check (status in ('none','asked','received','na')),
  asked_at    timestamptz,
  received_at timestamptz,
  updated_by  text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (staff_id, type_id)
);
alter table lb_doc_type enable row level security;
alter table lb_doc_status enable row level security;

-- 管理者：書類の種類と、全員の状態
create or replace function lb_docs_admin(p_token uuid)
returns table (kind text, id uuid, name text, note text, sort int, staff_id uuid, staff text, status text, asked_at timestamptz, received_at timestamptz, updated_by text)
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  return query
    select 'type'::text, t.id, t.name, t.note, t.sort, null::uuid, null::text, null::text, null::timestamptz, null::timestamptz, null::text
      from lb_doc_type t where t.store_id = s.store_id and t.active
    union all
    select 'staff'::text, st.id, st.name, ''::text, st.sort, null::uuid, null::text, null::text, null::timestamptz, null::timestamptz, null::text
      from lb_staff st where st.store_id = s.store_id and st.active and st.role <> 'viewer'
    union all
    select 'status'::text, d.type_id, ''::text, ''::text, 0, d.staff_id, ''::text, d.status, d.asked_at, d.received_at, d.updated_by
      from lb_doc_status d join lb_doc_type t on t.id = d.type_id where d.store_id = s.store_id and t.active;
end $$;

-- 管理者：状態を変える
create or replace function lb_doc_set(p_token uuid, p_staff uuid, p_type uuid, p_status text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  insert into lb_doc_status (store_id, staff_id, type_id, status, asked_at, received_at, updated_by, updated_at)
    values (s.store_id, p_staff, p_type, p_status,
            case when p_status = 'asked' then now() end, case when p_status = 'received' then now() end, s.name, now())
  on conflict (staff_id, type_id) do update set
    status = excluded.status,
    asked_at = case when excluded.status = 'asked' then coalesce(lb_doc_status.asked_at, now()) when excluded.status = 'none' then null else lb_doc_status.asked_at end,
    received_at = case when excluded.status = 'received' then now() else null end,
    updated_by = excluded.updated_by, updated_at = now();
end $$;

-- 管理者：書類の種類を足す・直す・やめる
create or replace function lb_doc_type_put(p_token uuid, p_id uuid, p_name text, p_note text, p_sort int, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); v uuid;
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  if p_id is null then
    insert into lb_doc_type (store_id, name, note, sort, active) values (s.store_id, trim(p_name), coalesce(p_note, ''), coalesce(p_sort, 100), coalesce(p_active, true)) returning id into v;
  else
    update lb_doc_type set name = trim(p_name), note = coalesce(p_note, ''), sort = coalesce(p_sort, sort), active = coalesce(p_active, active), updated_at = now()
      where id = p_id and store_id = s.store_id returning id into v;
  end if;
  return v;
end $$;

-- スタッフ：自分が頼まれている書類（受け取り済み・不要は出さない）
create or replace function lb_docs_mine(p_token uuid)
returns table (name text, note text, asked_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  return query select t.name, t.note, d.asked_at from lb_doc_status d join lb_doc_type t on t.id = d.type_id
    where d.staff_id = s.id and t.active and d.status = 'asked' order by t.sort, t.name;
end $$;

revoke all on function lb_docs_admin(uuid), lb_doc_set(uuid, uuid, uuid, text), lb_doc_type_put(uuid, uuid, text, text, int, boolean), lb_docs_mine(uuid) from public;
grant execute on function lb_docs_admin(uuid), lb_doc_set(uuid, uuid, uuid, text), lb_doc_type_put(uuid, uuid, text, text, int, boolean), lb_docs_mine(uuid) to anon;

-- 最初の書類（あとから管理者アプリで直せる）
insert into lb_doc_type (store_id, name, note, sort)
select 'lebois', v.name, v.note, v.sort from (values
  ('雇用契約書（労働条件通知書）の控え', '署名した控えを1部', 10),
  ('扶養控除等申告書（2027年分）', '年末までに。来年の給与の源泉に使う', 20),
  ('基礎控除・配偶者控除等の申告書（2026年分）', '年末調整に使う', 30),
  ('保険料控除申告書（2026年分）', '生命保険・地震保険などに入っている人だけ。控除証明書も一緒に', 40),
  ('前の勤め先の源泉徴収票', '今年、ル・ボアより前に別の会社で給与をもらっていた人だけ', 50),
  ('通勤経路と交通費の申請', '経路と1日の交通費', 60),
  ('給与の振込口座の届け', '口座の内容はアプリには入れない', 70),
  ('マイナンバーの提出', '番号はアプリには入れない。提出の有無だけ記録', 80)
) as v(name, note, sort)
where not exists (select 1 from lb_doc_type where store_id = 'lebois');

select name, sort from lb_doc_type where store_id = 'lebois' order by sort;
