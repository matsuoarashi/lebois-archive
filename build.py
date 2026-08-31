#!/usr/bin/env python3
"""共通のUI（src/ui.css, src/ui.js）から2つの成果物を組み立てる。

  docs/index.html  … GitHub Pages で公開するデモ版（保存はブラウザのみ）
  gas/Index.html   … Google Apps Script 用（保存はスプレッドシート）

UIのコードは1か所（src/）にしかない。片方だけ直すことがないようにするための構成。
使い方:  python3 build.py
"""
import pathlib

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"

CSS = (SRC / "ui.css").read_text(encoding="utf-8")
UI = (SRC / "ui.js").read_text(encoding="utf-8")
SEED = (SRC / "seed.json").read_text(encoding="utf-8").strip()

HEAD = """<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>le bois 日報</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style id="app-style">%s</style>""" % CSS

DEMO_BAR = """
<div class="wrap" style="padding-top:0;min-height:0">
  <div class="trial" style="margin-top:0">
    <b>デモ版です。</b>入力した内容はこの端末のブラウザにだけ残ります。ほかの人には共有されません。
    本番はGoogleスプレッドシートに保存され、Squareと発注表から自動でデータが入ります。
    <button id="demoreset" style="margin-top:8px;background:none;border:1px solid var(--hand);
      color:var(--hand);border-radius:100px;font-family:inherit;font-size:11px;
      padding:4px 12px;cursor:pointer">最初の状態にもどす</button>
  </div>
</div>
<script>
document.getElementById('demoreset').addEventListener('click', function(){
  if (window.STORE && STORE.reset) STORE.reset();
});
</script>"""


def build(out_path, store_js_name, extra_body="", title=None):
    store = (SRC / store_js_name).read_text(encoding="utf-8")
    head = HEAD if title is None else HEAD.replace(
        "<title>le bois 日報</title>", "<title>%s</title>" % title)
    doc = (
        "<!doctype html>\n<html lang=\"ja\">\n<head>\n" + head + "\n</head>\n<body>\n"
        "<div class=\"wrap\" id=\"app\"></div>\n"
        + extra_body + "\n"
        "<script type=\"application/json\" id=\"state\">" + SEED + "</script>\n"
        "<script>\n" + store + "\n</script>\n"
        "<script>\n" + UI + "\n</script>\n"
        "</body>\n</html>\n"
    )
    out = ROOT / out_path
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc, encoding="utf-8")
    print("built %-22s %6d bytes" % (out_path, len(doc)))


if __name__ == "__main__":
    build("docs/index.html", "store-local.js", DEMO_BAR, "le bois 日報 デモ")
    build("gas/Index.html", "store-gas.js")
