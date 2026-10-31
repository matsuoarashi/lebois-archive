# le bois スタッフアプリ — 公開の手順

アプリは `docs/app/` の3ファイルだけで動きます。

| ファイル | 中身 | 直すとき |
|---|---|---|
| `docs/app/index.html` | 画面とロジック | 機能を変えるとき |
| `docs/app/content.js` | マニュアルとチェックリストの中身 | レシピや手順が変わったとき |
| `docs/app/config.js` | 接続先（Supabase・日報URL） | 最初の1回 |

## 1. まずお試しで公開する（5分）

1. GitHub の `matsuoarashi/lebois` に、`docs/app/` フォルダごとアップロードする
   （Add file → Upload files に、`app` フォルダをドラッグ）
2. 1〜2分待つと次のURLで開けます
   **https://matsuoarashi.github.io/lebois/app/**

この時点では `config.js` が空なので「お試しモード」です。記録はその端末にだけ残ります。

## 2. Supabase をつなぐ（10分）

le bois 用に新しいプロジェクトを作ります（オリオンとは別の会社の店なので分けます）。

1. https://supabase.com/dashboard → **New project**
   - Name: `lebois`
   - Region: **Northeast Asia (Tokyo)**
   - Database Password: 長いものを生成して控える（アプリでは使いません）
2. 左の **SQL Editor** → New query → `supabase/schema.sql` を全部貼り付けて **Run**
   「Success. No rows returned」と出ればOK
3. 左の **Project Settings → API** で次の2つをコピー
   - Project URL（`https://xxxx.supabase.co`）
   - Project API keys の **anon public**
4. `docs/app/config.js` の `supabaseUrl` と `anonKey` に貼り付けて、GitHub にアップロード
5. アプリを開き直し、上の「お試しモード」の帯が消えていれば本番です

anon key はページに載る公開用の鍵です。この鍵でできることは `schema.sql` で
「チェックの記録」「引き継ぎ・不足の追加」「不足を解決済みにする」だけに絞っています。
削除はできません。

## 3. スタッフに配る

LINEグループに次のURLを送ります。ログインは不要です。初めて開いた人は
チェックやメモのときに名前を1回入れるだけです。

**https://matsuoarashi.github.io/lebois/app/**

スマホのホーム画面に追加してもらうと、アプリのように開けます
（iPhone：Safariの共有→ホーム画面に追加／Android：Chromeのメニュー→ホーム画面に追加）。

## 記録を見る

Supabase の **Table Editor** で見られます。

- `lb_check_runs`：日付ごとの開店・閉店チェック。`done` に誰が何時に押したかが入る
- `lb_notes`：引き継ぎ（kind=note）と不足（kind=short）。`resolved_by` が補充した人
