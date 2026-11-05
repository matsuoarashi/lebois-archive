-- 2026-11-06 アプリの表示名を下の名前から苗字に変える（スタッフからの依頼）。
-- 名前を目印にしている記録（シフト・希望・引き継ぎ・定期の仕事・聞く）も同じ対応で書き換える。
-- チェックの済み記録（lb_check_runs.done の by）は過去の記録なので触らない。
do $$
declare
  m text[][] := array[
    ['柚那','堀江'],['愛','田中'],['由希子','星野'],['葵','岡田'],['亜妃','藤江'],['琉月','鈴木'],
    ['弘樹','菅谷'],['菜々','小棚木'],['初凪','池尾'],['花連','ブレイケリー'],['絵梨','福永'],
    ['香織','佐野'],['智尋','畑崎'],['和実','平井'],['唯','菅原'],['新史','松尾'],['佳奈','古川']
  ];
  r text[];
begin
  foreach r slice 1 in array m loop
    update lb_staff            set name = r[2]        where store_id = 'lebois' and name = r[1];
    update lb_notes            set staff = r[2]       where store_id = 'lebois' and staff = r[1];
    update lb_notes            set resolved_by = r[2] where store_id = 'lebois' and resolved_by = r[1];
    update lb_check_runs       set updated_by = r[2]  where store_id = 'lebois' and updated_by = r[1];
    update lb_routine          set updated_by = r[2]  where updated_by = r[1];
    update lb_routine_done     set staff = r[2]       where staff = r[1];
    update lb_knowledge        set updated_by = r[2]  where updated_by = r[1];
    update lb_questions        set staff = r[2]       where staff = r[1];
    update lb_questions        set answered_by = r[2] where answered_by = r[1];
    update lb_shift_month      set published_by = r[2] where published_by = r[1];
    update lb_shift_wish       set staff = r[2]       where staff = r[1];
    update lb_shift_wish_note  set staff = r[2]       where staff = r[1];
    update lb_shift_plan       set staff = r[2]       where staff = r[1];
    update lb_shift_plan       set updated_by = r[2]  where updated_by = r[1];
  end loop;
end $$;

select name, role from lb_staff where store_id = 'lebois' order by sort, name;
