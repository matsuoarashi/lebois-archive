-- 2026-11-06 管理者アプリのログイン画面には、最初に管理者として設定した人（role = 'manager'）だけを出す（松尾さん 11/6）
create or replace function lb_admin_list(p_store text default 'lebois')
returns table (id uuid, name text, has_pin boolean)
language sql security definer set search_path = public, extensions as $$
  select id, name, pin_hash is not null from lb_staff
   where store_id = p_store and active and role = 'manager' order by sort, name;
$$;
revoke all on function lb_admin_list(text) from public;
grant execute on function lb_admin_list(text) to anon;
select * from lb_admin_list('lebois');
