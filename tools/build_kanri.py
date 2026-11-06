#!/usr/bin/env python3
"""管理者アプリ（/lebois/kanri/）を docs/app/index.html から作る。
中身は同じファイル。入口だけ分ける：説明文・アイコン・ホーム画面の名前・PWA の範囲（scope）が別になる。
docs/app/index.html を直したら、このスクリプトを走らせてから commit する（pre-commit で自動）。"""
import pathlib, re, sys
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "docs/app/index.html").read_text(encoding="utf-8")
i = src.index("<!--APP-->")
head = '''<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<base href="../app/">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#55663A">
<link rel="manifest" href="/lebois/kanri/manifest.webmanifest">
<meta name="description" content="ル・ボワの管理者用アプリ。売上、勤怠、シフト作成、書類。管理者だけが入れます。">
<meta property="og:title" content="le bois 管理">
<meta property="og:description" content="ル・ボワの管理者用アプリ。売上、勤怠、シフト作成、書類。管理者だけが入れます。">
<meta property="og:image" content="https://matsuoarashi.github.io/lebois/app/icon-kanri-512.png">
<meta property="og:url" content="https://matsuoarashi.github.io/lebois/kanri/">
<meta property="og:type" content="website">
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="apple-touch-icon" href="icon-kanri-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="le bois 管理">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<script>/* このファイルは tools/build_kanri.py が docs/app/index.html から作る。直接直さない */
window.LB_KANRI = true;
/* <base> があるので「#…」のリンクはこのページの中で動かす */
document.addEventListener("click", function(e){ var a = e.target.closest && e.target.closest('a[href^="#"]'); if(a){ e.preventDefault(); location.hash = a.getAttribute("href"); } }, true);</script>
'''
body = src[i:].replace("<title>le bois スタッフ</title>", "<title>le bois 管理</title>", 1)
out = head + body
(root / "docs/kanri").mkdir(exist_ok=True)
(root / "docs/kanri/index.html").write_text(out, encoding="utf-8")
(root / "docs/kanri/manifest.webmanifest").write_text('''{
  "id": "/lebois/kanri/",
  "name": "le bois 管理",
  "short_name": "le bois 管理",
  "start_url": "/lebois/kanri/",
  "scope": "/lebois/kanri/",
  "display": "standalone",
  "background_color": "#F4EFE5",
  "theme_color": "#55663A",
  "icons": [
    {"src": "/lebois/app/icon-kanri-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
    {"src": "/lebois/app/icon-kanri-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}
  ]
}
''', encoding="utf-8")
print("docs/kanri/index.html", len(out))
