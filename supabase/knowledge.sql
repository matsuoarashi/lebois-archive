-- ルボアに聞く：店の決まりごと・置き場・手順を1か所に集め、答えられなかった質問から育てる
-- （オリオンOSの Knowledge / Canonical Facts と同じ形：approved → superseded で履歴を残す）
-- Supabase の SQL Editor で schema.sql のあとに実行する。何度流しても壊れない。

create table if not exists lb_knowledge (
  id          uuid primary key default gen_random_uuid(),
  store_id    text not null default 'lebois',
  category    text not null check (category in ('場所','決まり','手順','設備','ギャラリー','レジ','その他')),
  q           text not null check (char_length(q) between 1 and 200),      -- 見出し（質問の形）
  a           text not null check (char_length(a) between 1 and 2000),     -- 答え
  keywords    text not null default '',                                     -- 検索用の言い換え（空白区切り）
  status      text not null default 'approved' check (status in ('approved','superseded')),
  supersedes  uuid,                                                         -- 置き換えた古い行
  updated_by  text not null default '',
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists lb_knowledge_store on lb_knowledge (store_id, status, updated_at desc);

create table if not exists lb_questions (
  id          uuid primary key default gen_random_uuid(),
  store_id    text not null default 'lebois',
  body        text not null check (char_length(body) between 1 and 500),
  staff       text not null,
  created_at  timestamptz not null default now(),
  answered_at timestamptz,
  answered_by text,
  knowledge_id uuid
);
create index if not exists lb_questions_store on lb_questions (store_id, created_at desc);

alter table lb_knowledge enable row level security;
alter table lb_questions enable row level security;

-- 読む：承認済み＋最近90日の置き換え済み（更新日の表示用）
create or replace function lb_kb_list(p_token uuid) returns setof lb_knowledge
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  return query select * from lb_knowledge where store_id = s.store_id
    and (status = 'approved' or updated_at > now() - interval '90 days')
    order by updated_at desc limit 500;
end $$;

-- 足す／直す（管理者だけ）。p_old を渡すと古い行を superseded にして新しい行を作る
create or replace function lb_kb_put(p_token uuid, p_category text, p_q text, p_a text, p_keywords text, p_old uuid default null)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); nid uuid;
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  insert into lb_knowledge (store_id, category, q, a, keywords, supersedes, updated_by)
    values (s.store_id, p_category, p_q, p_a, coalesce(p_keywords,''), p_old, s.name) returning id into nid;
  if p_old is not null then
    update lb_knowledge set status = 'superseded', updated_at = now() where id = p_old and store_id = s.store_id;
  end if;
  return nid;
end $$;

-- 消す（管理者だけ。superseded にして残す）
create or replace function lb_kb_retire(p_token uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  update lb_knowledge set status = 'superseded', updated_at = now(), updated_by = s.name where id = p_id and store_id = s.store_id;
end $$;

-- 質問を送る（誰でも）
create or replace function lb_ask(p_token uuid, p_body text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin insert into lb_questions (store_id, body, staff) values (s.store_id, p_body, s.name); end $$;

-- 質問の一覧（未回答＋最近30日の回答済み）
create or replace function lb_questions_list(p_token uuid) returns setof lb_questions
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token);
begin
  return query select * from lb_questions where store_id = s.store_id
    and (answered_at is null or answered_at > now() - interval '30 days')
    order by created_at desc limit 200;
end $$;

-- 答える（管理者だけ）：答えを Knowledge に入れて質問を回答済みにする
create or replace function lb_answer(p_token uuid, p_qid uuid, p_category text, p_q text, p_a text, p_keywords text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare s lb_staff := lb_me(p_token); nid uuid;
begin
  if s.role <> 'manager' then raise exception 'manager_only'; end if;
  nid := lb_kb_put(p_token, p_category, p_q, p_a, p_keywords, null);
  update lb_questions set answered_at = now(), answered_by = s.name, knowledge_id = nid where id = p_qid and store_id = s.store_id;
  return nid;
end $$;

grant execute on function lb_kb_list(uuid), lb_kb_put(uuid, text, text, text, text, uuid), lb_kb_retire(uuid, uuid),
  lb_ask(uuid, text), lb_questions_list(uuid), lb_answer(uuid, uuid, text, text, text, text) to anon;

-- ---------- 最初の中身（LINEの3年分の履歴から起こした。店長があとからアプリで直せる） ----------
-- 同じ見出しがあれば入れない
create or replace function lb_kb_seed_(p_cat text, p_q text, p_a text, p_kw text) returns void
language plpgsql as $$
begin
  if not exists (select 1 from lb_knowledge where store_id = 'lebois' and q = p_q) then
    insert into lb_knowledge (store_id, category, q, a, keywords, updated_by) values ('lebois', p_cat, p_q, p_a, p_kw, 'LINE履歴');
  end if;
end $$;

-- 場所
select lb_kb_seed_('場所','レシートロール（レジの紙）はどこ？','パントリーの電気のスイッチのところに箱で置いてあります。上から2段目の右端。','レシート ロール紙 レジ 紙 替え');
select lb_kb_seed_('場所','水切りネットはどこ？','エプロンが入っている引き出しの1番上の段。なければパントリーの冷凍庫の上、ボウルの後ろの透明なケース。それでもなければ100均かOKストアで買い足し。','水切り ネット 三角コーナー');
select lb_kb_seed_('場所','ショップカード（ル・ボア／momo）はどこ？','紅茶の葉を置いている棚。手前の紅茶在庫の後ろにある、持ち手つきの透明ケースの中（忘れ物入れの横）。','ショップカード 名刺 カード');
select lb_kb_seed_('場所','テイクアウトのカップ・蓋・容器はどこ？','階段下。チーズケーキ・ガトーショコラのテイクアウト容器もここ。テイクアウトには木のフォークを必ず付ける。','テイクアウト カップ 蓋 容器 フラペチーノ');
select lb_kb_seed_('場所','クロックムッシュ用のペーパーナプキンはどこ？','パントリー1番上の棚、サラダカップの横の白いケース（か、その隣の白いケース）。なければ階段下の水飲みコップのストックの真ん中あたり。','ナプキン ペーパー クロックムッシュ');
select lb_kb_seed_('場所','ゴミ袋のストックはどこ？','パントリー奥、オレンジワインを置いている棚に段ボールで入っています。','ゴミ袋 袋');
select lb_kb_seed_('場所','生クリームはどこ？','パントリー1番奥の冷凍庫。新品が冷蔵庫の棚に入っていることもあります。','生クリーム ホイップ');
select lb_kb_seed_('場所','チョコクランチはどこ？','パントリー奥、ワインを置いている棚のプラスチックケース。なければAmazonの注文履歴から再注文。','チョコクランチ クランチ');
select lb_kb_seed_('場所','除石灰・バルサミコ酢・キャラメルソースはどこ？','パントリーの同じケースにまとめて入れています（バルサミコ酢とキャラメルソースのケース）。','除石灰 バルサミコ キャラメルソース');
select lb_kb_seed_('場所','開封したコーヒー豆はどこに置く？','クラッシュやシフォンを冷凍している、ホットコーヒー下の冷凍庫の1番下の段。瓶の保管場所の奥に埋もれないように。','コーヒー豆 豆 開封');
select lb_kb_seed_('場所','エスプレッソの豆はどこ？','冷凍庫に入っているのがエスプレッソ用。予備の箱はギャラリー控室の1番奥の段ボール。','エスプレッソ 豆');
select lb_kb_seed_('場所','パルメザンチーズはどこ？','クロワッサンが入っている冷凍庫。削ったものがジップロックに入っています。','パルメザン チーズ');
select lb_kb_seed_('場所','ドライバー（工具）はどこ？','階段下の奥。コースターやストローをしまっている後ろ。','ドライバー 工具');
select lb_kb_seed_('場所','ストローの予備はどこ？','パントリー内。コースターと同じあたり。','ストロー');
select lb_kb_seed_('場所','コーヒー豆の小分け用の袋はどこ？','パントリーの引き出し。入りきらない分は調理器具のあるところ。','小分け 袋 コーヒー豆');
select lb_kb_seed_('場所','マニュアル・黄色いファイル・引き継ぎノートはどこ？','メニュー表・マニュアルと同じ場所にしまう決まり。グルグルさんのメニュー表のところに挟まないこと。','マニュアル 黄色いファイル ノート 引き継ぎノート メニュー表');
select lb_kb_seed_('場所','オレンジワインはどこ？','アップルジュース類が入っている冷蔵庫（キャップがオレンジ）。※2026/10/22から提供停止中。','オレンジワイン ワイン');
select lb_kb_seed_('場所','ギャラリー貸し出しのスピーカーはどこ？','ギャラリーのバックヤード左の棚。丸くて薄い15cmほどのもの。作家さんが別の場所に置くことがあるので、カーテン裏の水道のあたりも確認。','スピーカー ギャラリー');
select lb_kb_seed_('場所','ギャラリーの水平器・プライスプレート・ハンガーラックはどこ？','ギャラリー控室（バックヤード）の白い棚、ハンガーラックはバックヤードの奥。','水平器 プライスプレート ハンガーラック ギャラリー');
select lb_kb_seed_('場所','ギャラリーの掃除用のアルカリ電解水・ペンキはどこ？','ギャラリーの洗面台の下。','アルカリ電解水 スプレー ペンキ 掃除');
select lb_kb_seed_('場所','届いた荷物はどこに置く？','バー（秋吉さん）宛はパントリーか裏に置いてLINEで「@あきよし 裏に置きます」。ギャラリーの作家さん宛はギャラリーへ。冷蔵・冷凍はそれぞれの庫へ。ル・ボアのものは開封して所定の場所へ、置き場をノートに書く。','荷物 宅配 届いた 不在票 置き場');
select lb_kb_seed_('場所','チャッカマン・ライターはどこ？','カトラリー類が入っている茶色の箱。パントリーにもチャッカマンあり。','チャッカマン ライター 火');
select lb_kb_seed_('場所','momo受取に持っていくものは？','グレーのエコバッグ。クロックムッシュなど冷凍のものは保冷リュックで。','momo 受取 エコバッグ');
select lb_kb_seed_('場所','青いモップ・ダスターはどこ？','雨で床が浸水したときは青いモップ。吸わなくなったら青いダスターを巻いて拭く。','モップ ダスター 浸水 水たまり');

-- 決まり
select lb_kb_seed_('決まり','チーズケーキ・ガトーショコラ・シフォンの提供期限は？','シェフの指示どおり。チーズケーキは解凍した日を0日として+3日（ラベルは4日間）。シフォンは解凍から2日。期限を伸ばす判断は現場でしない（2026/10/16に確認）。','期限 賞味期限 日付 解凍 チーズケーキ ガトー シフォン');
select lb_kb_seed_('決まり','ケーキ1本は何切れ？','チーズケーキ1本=7切れ、ガトーショコラ1本=9切れ（2.5cm幅）、シフォン1個=8切れ。在庫は本数ではなく切れ数で書く。','カット 切れ 7切れ 9切れ 8切れ 本数');
select lb_kb_seed_('決まり','ホットコーヒーの作り置きはいつまで？','作ってから1時間半で廃棄（2026/9/20に2時間→1時間半に変更）。','ホットコーヒー 廃棄 作り置き 時間');
select lb_kb_seed_('決まり','開封したワインはいつまで？','空気を抜く器具で保管して2週間が目安（2026/10/20）。酸っぱい匂いがしたら廃棄。※オレンジワインは2026/10/22から提供停止。','ワイン 開封 期限');
select lb_kb_seed_('決まり','食器を洗うときの決まりは？','食べ残し・生クリーム・油は必ず拭き取ってから洗う（グリストラップの汚れがひどいため）。紅茶の処理はレジ側のシンクで。レジ側シンクは三角コーナーと排水口の両方にネット。','食器 洗い グリスト 油 ネット');
select lb_kb_seed_('決まり','給湯ポットの温度は？','夏は95度、冬は98度。ポットは指定の「ポットコンセント」の印がある差し込み口を使う（2026/10/27）。','ポット 温度 95 98 コンセント');
select lb_kb_seed_('決まり','電気を使いすぎるとどうなる？','容量オーバーでブレーカーが落ちる。エスプレッソマシンとポットの同時使用でぎりぎり。ヒーターなど電気を多く使うものを増やさない。閉店時はエアコンと食洗機の電源を全て消してよい。','ブレーカー 電気 容量 ヒーター 節電');
select lb_kb_seed_('決まり','お客さまの自転車・バイクはどこに停める？','隣の駐車場と奥の駐車場は駐輪NG（大家さんより）。ル・ボアのテラス側で、歩道にはみ出さないように案内する。','自転車 バイク 駐輪 大家');
select lb_kb_seed_('決まり','サンシェード（オーニング）は雨の日どうする？','日除けなので雨の日は出しても半分まで（カビるため）。台風や強風のときは必ず閉じる。','サンシェード オーニング 雨');
select lb_kb_seed_('決まり','タッパーのシールは？','洗うときに【日付】【先・後】のシールを必ず剥がして新しいものにする。葉物以外も同じ。','タッパー シール 日付');
select lb_kb_seed_('決まり','盛り付け・提供前の決まりは？','素手で触れず手袋かトングを使う。シフォン・カレーなどは適温か確認してから出す。不備があればその場で謝って作り直す。','衛生 手袋 トング 温度 提供');
select lb_kb_seed_('決まり','チーズケーキのザラメと塩の量は？','砕いたザラメと塩を同量で混ぜたものを0.2g計量して全部のせる。感覚で調整しない。','ザラメ 塩 チーズケーキ 0.2');
select lb_kb_seed_('決まり','ガトーショコラの仕上げは？','粉糖をほんの少し縦にかける（かけすぎ注意）。チーズケーキもガトーも小さいフォークを付ける。','ガトーショコラ 粉糖 フォーク');
select lb_kb_seed_('決まり','シフォンチョコの飾りは？','ホイップを奥までしっかり入れ、チョコは斜めに3個＋横のホイップに2個の計5個。横のホイップは見栄え程度に少量。','シフォン チョコ ホイップ');
select lb_kb_seed_('決まり','クロッシュ（クロワッサン）は温め直す？','必ず一度温め直してから提供する（「冷たくて固かった」という口コミがあったため）。','クロッシュ クロワッサン 温め');
select lb_kb_seed_('決まり','momoの定休日と納品日は？','momoは月・火が定休。納品（受取）は基本水曜と土曜。受取がない日は運営から連絡がある。','momo 定休日 納品 受取 水曜 土曜');
select lb_kb_seed_('決まり','100円玉・50円玉が足りないときは？','アプリの閉店作業で「両替が必要」を押す（管理者が用意する）。その日はお客さまに「現金はちょうどかキャッシュレスで」と案内。','両替 100円 50円 小銭 現金');
select lb_kb_seed_('決まり','お金の立替や預かり金があったら？','日報の差異の欄に理由を書く。預かり金は金庫に分かるようにして入れ、金額をLINEで運営に伝える。','立替 預かり 金庫 差異');
select lb_kb_seed_('決まり','営業の電話（広告・アプリの提案など）が来たら？','「Instagramの公式アカウントのDMへお願いします」と案内し、会社名・名前・電話番号をLINEで運営に伝える。','営業電話 電話 伝言 営業');
select lb_kb_seed_('決まり','テレビ・雑誌の取材で提供した商品の会計は？','運営が事前に決めている。分からなければ出す前にLINEで確認。撮影時は奥の客席を貸切にし、11時台のお客さまには事前にお伝えする。','撮影 取材 テレビ 雑誌 会計');
select lb_kb_seed_('決まり','ことみせクーポン・金券の会計は？','クーポンはSquareのディスカウントに「ことみせクーポン」の欄がある。金券はキーパッドで差額をもらい、金券はレジに入れておく。','ことみせ クーポン 金券 ディスカウント');
select lb_kb_seed_('決まり','商店街のスタンプラリーの割引は？','割引画面を提示されたらSquareのディスカウント「50円引き」で会計。','スタンプラリー 割引 50円');

-- 手順
select lb_kb_seed_('手順','momoから受け取ったケーキはどう保管する？','チーズケーキ→そのまま冷蔵庫。ガトーショコラ→冷凍庫。クロックムッシュ→冷凍庫。シフォン→8等分にカットして1つずつラップ、日付を書いて冷凍庫（前回分の4個を解凍に回す）。','momo 受取 保管 冷凍 冷蔵 シフォン カット');
select lb_kb_seed_('手順','チーズケーキの解凍はいつ？','前日に翌日の分を冷蔵庫に移して解凍し、翌日カット。包丁をお湯で温めると綺麗に切れる。ガトーは在庫が2〜3個になるまで解凍しない。','解凍 チーズケーキ 前日 包丁');
select lb_kb_seed_('手順','ピクニックセットの作り方は？','黄色いファイルと共有の動画のとおり。ドリンクと「チーズケーキ or ガトーショコラ」をお客さまに伺う。クロッシュは1人前を2つに切ってバーガー袋へ。人数分のおしぼりとフォーク、アイスならストロー。バスケットにセットして渡す。基本2時間制、返却時間をお伝えする。','ピクニック バスケット クロッシュ セット');
select lb_kb_seed_('手順','キャラメルソースのボトルの補充は？','キャップはベタつくので外して洗い、ボトルに3分の1ほど入れ、キャップの水分を拭いてから閉める。','キャラメルソース 補充 ボトル');
select lb_kb_seed_('手順','Amazon・ネットスーパーでの注文は？','ル・ボアの携帯からAmazon（シロップ・クランチ・プリンタブレット・バルサミコ・おしぼり）とLIFEネットスーパー菊川店で注文できる。注文履歴から同じものを再注文。テイクアウト容器はシモジマのアプリ。支払いは金庫のクレジットカード。','Amazon ネットスーパー LIFE シモジマ 注文 発注 クレジットカード');
select lb_kb_seed_('手順','閉店時に作家さんがまだギャラリーにいたら？','「カフェは先に閉めますが、ドアは開けておくのでご自由に出入りください」と声をかけ、下の電気はつけたまま、奥の客席は消す。19時前にバーのスタッフが来ることを伝える。LINEで「@あきよし アーティスト様在廊中のため鍵・電気そのまま」と送る。','閉店 作家 在廊 鍵 電気 施錠');
select lb_kb_seed_('手順','ブレーカーが落ちたら？','分電盤の内扉を開けて「②」のスイッチを上げる。一度右（オフ）に倒してから左に倒すとカチッと入る。内部の銀色の金属部分には触れない（感電）。直らなければLINEで運営へ。','ブレーカー 落ちた 分電盤 停電');
select lb_kb_seed_('手順','コーヒーマシンが起動しないときは？','①コンセントを抜いて5分置き、壁のコンセントに直接差す（延長タップは使わない）②背面下のI/Oスイッチを I に③前面の電源ボタンを押す。液晶が一瞬も点かなければ別のコンセントで確認し、運営へ。','コーヒーマシン 起動 デロンギ 電源');
select lb_kb_seed_('手順','ホットのカフェラテでミルクが溢れるときは？','大小のカップがあるので大カップを使う。小カップのときはミルク抽出後にスプーンで調整してからエスプレッソを足す。ミルクのつまみは赤線あたり。チューブがきちんと刺さっているかも確認。','カフェラテ ミルク 溢れる つまみ');
select lb_kb_seed_('手順','コーヒーマシンの小さい部品の保管は？','閉店時に細かいパーツ4点はタッパーに入れて保管（紛失防止）。大きいパーツは通常どおり外に出す。流しの網溝に落ちていることがある。','部品 パーツ つまみ タッパー 紛失');
select lb_kb_seed_('手順','食洗機からピッピッと鳴るのは？','食洗機のお知らせ音。除石灰の表示が出たら除石灰を実施する。','食洗機 音 除石灰');
select lb_kb_seed_('手順','給湯器のお湯が出なくなったら？','タンクのお湯を使い切ると再度沸くまで出ない。少し待つ。漏れている場合はボウルで受けて運営へ連絡。','給湯器 お湯 漏れ');
select lb_kb_seed_('手順','在庫が少ないものに気づいたら？','アプリの「足りないもの」に入れる（クロッシュ・牛乳・ジュース・氷・アイスコーヒー・豆・紅茶・備品など）。ケーキ4品目は日報で自動。','足りない 在庫 発注 不足');
select lb_kb_seed_('手順','日報はどうやって送る？','閉店後にアプリのホーム最下部「日報を送る」から。売上と売れた数は自動で入るので、在庫を数えて入れ、レジ実査を入力。できた報告文をコピーしてLINEに貼る。差異があれば理由を一言添える。','日報 報告 在庫 レジ締め');

-- ギャラリー
select lb_kb_seed_('ギャラリー','ギャラリーの見学の人が来たら？','予約の有無を確認して2階のギャラリーへ案内。作家さん不在なら電気をつけて見てもらう。詳しい質問は無理に答えず「ギャラリーの公式LINEへお問い合わせください」。アポなしの見学も展示がなければ案内してよい。','見学 ギャラリー 案内 公式LINE');
select lb_kb_seed_('ギャラリー','作家さんが不在で物販を買いたい人が来たら？','商品の値段・写真・お客さまの連絡先（InstagramでもOK）を控えて、Squareのキーパッドで会計（商品登録は不要）。大きい作品は配送手配のため連絡先を必ず聞く。岩崎さんに写真と金額を送る。','物販 作家 不在 キーパッド 絵');
select lb_kb_seed_('ギャラリー','ギャラリーのオープン作業を頼まれたら？','扉を開ける・電気をつける・（頼まれていれば）モニターの電源。閉店時はそのまま。詳細はその日のノートと岩崎さんの連絡で。','ギャラリー オープン 扉 電気 モニター');
select lb_kb_seed_('ギャラリー','作家さんのポスター・DMはどこに置ける？','店の外のポスター入れとフライヤースタンド（2つ）。カフェのドアには貼れない（ギャラリーのドアはOK）。DMは次のDMが来るまでレジ横に置き、各テーブルには置かない。','ポスター DM フライヤー 貼る');
select lb_kb_seed_('ギャラリー','ギャラリーでの火・匂い・音は？','お香など火を使うもの、匂いの強いものはNG（大家さんより）。設営の音出しは平日18〜19時のみなど時間を区切る。ライブ等は事前に岩崎さんから案内がある。','お香 火 匂い 騒音 音出し');
select lb_kb_seed_('ギャラリー','ギャラリーの冷蔵庫は使える？','あれはワインクーラーなので使えない。','冷蔵庫 ワインクーラー ギャラリー');
select lb_kb_seed_('ギャラリー','展示の動画・写真を頼まれたら？','設営が終わったらカフェの手が空いたときに撮って岩崎さんに送る。設営中なら翌日でよい。','動画 写真 撮影 展示');

-- レジ
select lb_kb_seed_('レジ','Squareでレシート印刷がフリーズしたら？','端末を再起動すると直る。続くようなら運営へ。','Square フリーズ レシート 再起動');
select lb_kb_seed_('レジ','ピクニックセットの1人分の料金は？','3,500円の半額1,750円。キーパッド入力で最後の会計のときにまとめて。','ピクニック 料金 半額 キーパッド');

drop function if exists lb_kb_seed_(text, text, text, text);
