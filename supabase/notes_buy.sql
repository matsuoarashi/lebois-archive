-- 2026-11-06 「買い出しに行った」の記録（kind = 'buy'）。記録した時点で対応済みにして、14日間だけ一覧に出す
alter table lb_notes drop constraint if exists lb_notes_kind_check;
alter table lb_notes add constraint lb_notes_kind_check check (kind in ('note','short','task','cash','buy'));

create or replace function lb_add_note(p_token uuid, p_kind text, p_body text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  insert into lb_notes (store_id, kind, body, staff, resolved_at, resolved_by)
    values (s.store_id, p_kind, p_body, s.name,
            case when p_kind = 'buy' then now() end,
            case when p_kind = 'buy' then s.name end);
end $$;

select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'lb_notes'::regclass and contype = 'c';
