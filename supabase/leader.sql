-- 2026-11-06 その日のリーダー。ふだんは出勤者のうち勤務回数が多い人（アプリ側で決める）。
-- 管理者が切り替えた日だけここに入る。staff を空で入れ直すと「自動」に戻る（行を消す）。
create table if not exists lb_leader (
  store_id   text not null default 'lebois',
  day        date not null,
  staff      text not null,
  set_by     text not null default '',
  updated_at timestamptz not null default now(),
  primary key (store_id, day)
);
alter table lb_leader enable row level security;

create or replace function lb_leader_list(p_token uuid, p_from date, p_to date)
returns table (day date, staff text, set_by text)
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  return query select l.day, l.staff, l.set_by from lb_leader l
    where l.store_id = s.store_id and l.day between p_from and p_to order by l.day;
end $$;

create or replace function lb_leader_set(p_token uuid, p_day date, p_staff text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  if coalesce(trim(p_staff), '') = '' then
    delete from lb_leader where store_id = s.store_id and day = p_day;
  else
    insert into lb_leader (store_id, day, staff, set_by, updated_at) values (s.store_id, p_day, trim(p_staff), s.name, now())
      on conflict (store_id, day) do update set staff = excluded.staff, set_by = excluded.set_by, updated_at = now();
  end if;
end $$;

revoke all on function lb_leader_list(uuid, date, date), lb_leader_set(uuid, date, text) from public;
grant execute on function lb_leader_list(uuid, date, date), lb_leader_set(uuid, date, text) to anon;
