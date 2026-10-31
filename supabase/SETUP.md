# le bois スタッフアプリ — 構成と運用メモ

アプリ：**https://matsuoarashi.github.io/lebois/app/**
（確認用の見本画面：末尾に `?demo=1`）

| ファイル | 中身 |
|---|---|
| `docs/app/index.html` | 画面とロジック |
| `docs/app/content.js` | マニュアルとチェックリストの中身 |
| `docs/app/config.js` | 接続先（Supabase・シフト・日報のURL） |
| `supabase/schema.sql` | 表と関数（Supabase の SQL Editor で実行済み） |
| `gas/shift/シフト連携.gs` | シフト表を読む Apps Script（ログイン確認つき） |

## ログインのしくみ

- 名前を選んで4桁の番号を入れる。**初めての人はその場で自分の4桁を決める**（2回入力）
- 番号は暗号化（bcrypt）して保存。管理者にも番号そのものは見えない
- 5回間違えると15分ロック
- 180日使わないと自動でログアウト
- 番号を忘れた人は、管理者（role=manager）が `lb_reset_pin` で消す → 次に開いたとき決め直し

## Supabase

- プロジェクト：`lebois`（ref: xqmdgvgiagxsysuzwfhi）
- `config.js` に載っている publishable key は公開用の鍵。表を直接は読めず、
  `schema.sql` の関数（ログイン済みの番号札が必要）経由でしか触れません
- 管理者にする：SQL Editor で
  `update lb_staff set role='manager' where name='（名前）';`
- スタッフを足す：
  `insert into lb_staff(store_id,name,sort) values('lebois','（名前）',99);`
- 辞めた人：`update lb_staff set active=false where name='（名前）';`

## 記録を見る（Table Editor）

- `lb_check_runs`：日付ごとの開店・閉店チェック
- `lb_notes`：引き継ぎ（kind=note）と不足（kind=short）
- `lb_progress`：本人が付けた習熟度（0〜3）

## 載せないもの

時給・人件費・お客さまの名前と連絡先・各種の秘密の鍵は、このアプリにもGitHubにも載せません。
