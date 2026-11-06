-- 2026-11-06 オーナーの区別。役割（staff/manager/viewer）はそのままにして、manager のうちオーナーだけ印を付ける。
-- 時給・人件費の明細はオーナーだけ（ル・ボアでは店長に見せない。松尾さん 11/6）
alter table lb_staff add column if not exists owner boolean not null default false;
update lb_staff set owner = true where store_id = 'lebois' and name = '松尾';

create or replace function lb_me_info(p_token uuid) returns table (name text, role text, owner boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin return query select s.name, s.role, s.owner; end $$;
revoke all on function lb_me_info(uuid) from public;
grant execute on function lb_me_info(uuid) to anon;

select name, role, owner from lb_staff where store_id = 'lebois' and role = 'manager';
