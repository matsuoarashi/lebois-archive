-- 2026-11-05 平日（火〜木）の掃除の割り当て。金曜はグリストラップ清掃（routine.sql で登録済み）
-- 平日は手が空く時間が多いので、営業中のすき間でやる。済まなければ次の営業日にも出る（アプリ側で繰り越し）
-- 何度流しても壊れない（同じ名前があれば足さない）

do $$
declare
  items text[][] := array[
    -- 火曜
    array['冷蔵庫の拭き掃除', '中の棚・壁・扉のパッキン・取っ手を拭く。こぼれや汁の跡、賞味期限切れがないかも見る。', '2', '40'],
    array['トイレの念入り掃除', '毎朝の掃除で届かないところ。便座の裏とふた・便器のふち・床の隅・壁の下のほう。', '2', '41'],
    -- 水曜
    array['ホットコーヒーマシン・オーブンの上の埃', 'マシンとオーブンの上、まわりの棚の埃を拭く。上に物が載っていたら一度おろして。', '3', '42'],
    array['コーヒー・ミルクのはね跡', 'カウンター・壁・マシンの前・床に残った、はねた跡を拭き取る。乾いた跡は濡らして少し置いてから。', '3', '43'],
    -- 木曜
    array['シンクの漂白（茶渋）', 'シンクの中全体に漂白剤をかけて少し置き、こすって流す。排水口のまわりも。', '4', '44'],
    array['IHのまわりの油汚れ', 'IHの天板・ふち・まわりの壁と台を拭く。こびりつきは洗剤をつけて少し置いてから。', '4', '45']
  ];
  r text[];
begin
  foreach r slice 1 in array items loop
    if not exists (select 1 from lb_routine where store_id = 'lebois' and title = r[1]) then
      insert into lb_routine (store_id, title, detail, timing, rule, weekdays, months, sort, updated_by)
        values ('lebois', r[1], r[2], '営業中', 'weekly', array[r[3]::int], '{1,2,3,4,5,6,7,8,9,10,11,12}', r[4]::int, '松尾さん 11/5');
    end if;
  end loop;
  -- 金曜のグリストラップ清掃は止まっていたら戻す
  update lb_routine set active = true, weekdays = '{5}' where store_id = 'lebois' and title = 'グリストラップ清掃';
end $$;

select title, timing, weekdays, active from lb_routine where store_id = 'lebois' order by sort;
