/**
 * le bois 日報システム — サーバー側
 *
 * 既存の「momo発注表」スプレッドシートに紐づけて使います。
 * 拡張機能 → Apps Script に Code.gs と Index.html を貼り付けてください。
 * 手順は SETUP.md を参照。
 */

/* ====================== 設定 ====================== */

var SH_ORDER = '製造品目';     // 既存シート（引取日・発注期限・商品ごとの発注数）
var SH_STOCK = '在庫台帳';     // 自動生成
var SH_LOG   = '日次ログ';     // 自動生成
var SH_MAP   = '商品対応表';   // 自動生成
var SH_CONF  = '設定';         // 自動生成

/** 在庫を持つ品目。per は「1本／1ロールが何個ぶんか」 */
var PRODUCTS = [
  {key:'cheese',  name:'チーズケーキ',     unit:'切れ', bundle:'本',    per:7, orderCol:'チーズケーキ'},
  {key:'gateau',  name:'ガトーショコラ',   unit:'切れ', bundle:'本',    per:9, orderCol:'ガトーショコラ'},
  {key:'chiffon', name:'シフォンケーキ',   unit:'個',   bundle:'ロール', per:8, orderCol:'シフォン'},
  {key:'croque',  name:'クロックムッシュ', unit:'食',   bundle:'',     per:1, orderCol:'クロックムッシュ'}
];

/** Square の商品名 → 在庫の品目。mul は「1つ売れたら在庫が何個減るか」 */
var DEFAULT_MAP = [
  ['チーズケーキ',             'cheese',  1],
  ['チーズケーキ（1本）',       'cheese',  7],
  ['ガトーショコラ',           'gateau',  1],
  ['シフォンケーキ（チョコ）',   'chiffon', 1],
  ['シフォンケーキ（オレンジ）', 'chiffon', 1],
  ['クロックムッシュ',         'croque',  1]
];

var TZ = 'Asia/Tokyo';
var SQUARE_API = 'https://connect.squareup.com';
var SQUARE_VERSION = '2025-01-23';

/* ====================== 画面 ====================== */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('le bois 日報')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('le bois 日報')
    .addItem('初期セットアップ（シートを作る）', 'setup')
    .addItem('Squareの店舗一覧を見る', 'menuLocations')
    .addItem('今日のデータを試しに取る', 'menuToday')
    .addToUi();
}

/* メニューから呼ぶもの（ダイアログを出す）。
   エディタから実行するとダイアログの返事を待って止まらなくなるので、
   エディタでの動作確認には showLocations / showToday（ログに書くだけ）を使う。 */
function menuLocations() { SpreadsheetApp.getUi().alert(locationsText_()); }
function menuToday()     { SpreadsheetApp.getUi().alert(todayText_()); }

/* ====================== セットアップ ====================== */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var stock = sheet_(ss, SH_STOCK, ['品目キー', '商品名', '冷凍', '冷蔵', '単位', '更新日時']);
  if (stock.getLastRow() < 2) {
    PRODUCTS.forEach(function (p) {
      stock.appendRow([p.key, p.name, 0, 0, p.unit, new Date()]);
    });
  }

  var map = sheet_(ss, SH_MAP, ['Square商品名', '品目キー', '倍率']);
  if (map.getLastRow() < 2) map.getRange(2, 1, DEFAULT_MAP.length, 3).setValues(DEFAULT_MAP);

  var head = ['日付', '曜日', '総売上', '現金', '点数', 'レジ実査', 'レジ差異'];
  PRODUCTS.forEach(function (p) {
    head = head.concat([
      p.name + '/冷凍', p.name + '/冷蔵', p.name + '/販売',
      p.name + '/入荷', p.name + '/あるはず', p.name + '/廃棄', p.name + '/差異'
    ]);
  });
  head.push('売れたもの（明細）');
  sheet_(ss, SH_LOG, head);

  var conf = sheet_(ss, SH_CONF, ['項目', '値', 'メモ']);
  if (conf.getLastRow() < 2) {
    conf.getRange(2, 1, 2, 3).setValues([
      ['釣銭準備金', 36740, 'レジに常に入れておく金額'],
      ['店舗名', 'Le Bois', 'Squareの店舗名（この店舗だけを集計します）']
    ]);
  }

  SpreadsheetApp.getUi().alert(
    'シートを作りました。\n\n' +
    '次に「在庫台帳」に今の在庫を入れてください。\n' +
    'Squareと繋ぐには、スクリプトのプロパティに SQUARE_TOKEN を登録します（SETUP.md参照）。');
}

function sheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 || sh.getRange(1, 1).getValue() !== header[0]) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ====================== 画面に渡す状態 ====================== */

function getState() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stock = {}, items = [], log = [];

  var sh = ss.getSheetByName(SH_STOCK);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
      if (r[0]) stock[r[0]] = { fz: Number(r[2]) || 0, ch: Number(r[3]) || 0 };
    });
  }
  PRODUCTS.forEach(function (p) { if (!stock[p.key]) stock[p.key] = { fz: 0, ch: 0 }; });

  var lg = ss.getSheetByName(SH_LOG);
  if (lg && lg.getLastRow() > 1) {
    var n = Math.min(30, lg.getLastRow() - 1);
    var rows = lg.getRange(lg.getLastRow() - n + 1, 1, n, 7).getValues();
    rows.reverse().forEach(function (r) {
      if (!r[0]) return;
      log.push({
        label: Utilities.formatDate(new Date(r[0]), TZ, 'M/d') + '(' + r[1] + ')',
        sales: Number(r[2]) || 0, cash: Number(r[3]) || 0,
        tx: Number(r[4]) || 0, counted: Number(r[5]) || 0, diff: Number(r[6]) || 0
      });
    });
    // 過去に出てきたSquare商品名を拾う（明細列から）
    var seen = {};
    var lastCol = lg.getLastColumn();
    lg.getRange(Math.max(2, lg.getLastRow() - 13), lastCol, Math.min(14, lg.getLastRow() - 1), 1)
      .getValues().forEach(function (r) {
        String(r[0] || '').split(' / ').forEach(function (piece) {
          var nm = piece.replace(/\s+\d+$/, '').trim();
          if (nm) seen[nm] = true;
        });
      });
    var known = {};
    DEFAULT_MAP.forEach(function (m) { known[m[0]] = true; });
    Object.keys(seen).forEach(function (nm) { if (!known[nm]) items.push(nm); });
  }

  return { v: 5, stock: stock, float: getConf_('釣銭準備金', 0), items: items, log: log };
}

function getConf_(key, fallback) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_CONF);
  if (!sh || sh.getLastRow() < 2) return fallback;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) if (rows[i][0] === key) return rows[i][1];
  return fallback;
}

/* ====================== 今日の自動データ ====================== */

/**
 * Squareの当日売上と、発注表の当日引取ぶんを返す。
 * 戻り値: {sales, cash, items:{商品名:個数}, arrivals:{品目キー:本数}, note}
 */
function getToday() {
  var out = { sales: 0, cash: 0, items: {}, arrivals: {}, note: '' };
  var notes = [];

  try {
    var sq = fetchSquareToday_();
    out.sales = sq.sales;
    out.cash = sq.cash;
    out.items = sq.items;
    notes.push('Squareから ' + Object.keys(sq.items).length + '品目を取得しました。');
  } catch (e) {
    notes.push('Squareから取得できませんでした（' + e.message + '）。売上は手で入れてください。');
  }

  try {
    var arr = readArrivals_(new Date());
    out.arrivals = arr.map;
    notes.push(arr.found
      ? '発注表に本日の引取があります。'
      : '発注表に本日の引取はありません。');
  } catch (e) {
    notes.push('発注表を読めませんでした（' + e.message + '）。');
  }

  out.note = notes.join(' ');
  return out;
}

/** 発注表から、指定日の引取ぶんを読む */
function readArrivals_(date) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH_ORDER);
  var res = { found: false, map: {} };
  if (!sh || sh.getLastRow() < 2) return res;

  var values = sh.getDataRange().getValues();
  var header = values[0].map(function (v) { return String(v).trim(); });
  var colOf = {};
  header.forEach(function (h, i) { colOf[h] = i; });
  var dateCol = colOf['引取日'];
  if (dateCol === undefined) return res;

  var target = Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
  for (var r = 1; r < values.length; r++) {
    var cell = values[r][dateCol];
    if (!cell) continue;
    var d = (cell instanceof Date) ? cell : new Date(cell);
    if (isNaN(d.getTime())) continue;
    if (Utilities.formatDate(d, TZ, 'yyyy-MM-dd') !== target) continue;
    res.found = true;
    PRODUCTS.forEach(function (p) {
      var c = colOf[p.orderCol];
      if (c === undefined) return;
      var v = Number(values[r][c]) || 0;
      res.map[p.key] = (res.map[p.key] || 0) + v;   // 同じ日に複数行あれば合算
    });
  }
  return res;
}

/* ====================== Square ====================== */

function squareToken_() {
  var t = PropertiesService.getScriptProperties().getProperty('SQUARE_TOKEN');
  if (!t) throw new Error('SQUARE_TOKEN が未設定です');
  return t;
}

function squareCall_(path, method, payload) {
  var res = UrlFetchApp.fetch(SQUARE_API + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + squareToken_(),
      'Square-Version': SQUARE_VERSION
    },
    payload: payload ? JSON.stringify(payload) : null,
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText() || '{}');
  if (code >= 300) {
    var msg = (body.errors && body.errors[0] && body.errors[0].detail) || ('HTTP ' + code);
    throw new Error(msg);
  }
  return body;
}

/** 設定シートの店舗名から location_id を引く（結果はキャッシュ） */
function squareLocationId_() {
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty('SQUARE_LOCATION_ID');
  if (cached) return cached;

  var want = String(getConf_('店舗名', 'Le Bois')).trim();
  var body = squareCall_('/v2/locations', 'get');
  var hit = (body.locations || []).filter(function (l) {
    return String(l.name).trim() === want;
  })[0];
  if (!hit) throw new Error('店舗「' + want + '」が見つかりません');
  props.setProperty('SQUARE_LOCATION_ID', hit.id);
  return hit.id;
}

function locationsText_() {
  var body = squareCall_('/v2/locations', 'get');
  var lines = (body.locations || []).map(function (l) {
    return l.name + '  →  ' + l.id + '  (' + l.status + ')';
  });
  return 'Squareの店舗一覧\n\n' + lines.join('\n');
}

/** エディタから実行して実行ログで確かめる用 */
function showLocations() { Logger.log(locationsText_()); }

/**
 * 当日（3:00〜翌2:59 JST、Squareのレポート日に合わせる）の
 * 商品別販売数・売上・現金を集計する。
 */
function fetchSquareToday_() {
  var loc = squareLocationId_();
  var now = new Date();
  var day = new Date(now.getTime());
  if (Number(Utilities.formatDate(now, TZ, 'H')) < 3) day.setDate(day.getDate() - 1);
  var base = Utilities.formatDate(day, TZ, 'yyyy-MM-dd');
  var start = base + 'T03:00:00+09:00';
  var endDate = new Date(day.getTime()); endDate.setDate(endDate.getDate() + 1);
  var end = Utilities.formatDate(endDate, TZ, 'yyyy-MM-dd') + 'T02:59:59+09:00';

  var items = {}, sales = 0, cash = 0, cursor = null, guard = 0;
  do {
    var payload = {
      location_ids: [loc],
      limit: 500,
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: start, end_at: end } },
          state_filter: { states: ['COMPLETED'] }
        },
        sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' }
      }
    };
    if (cursor) payload.cursor = cursor;
    var body = squareCall_('/v2/orders/search', 'post', payload);

    (body.orders || []).forEach(function (o) {
      (o.line_items || []).forEach(function (li) {
        var nm = String(li.name || '').trim();
        if (!nm) return;
        var qty = Number(li.quantity) || 0;
        items[nm] = (items[nm] || 0) + qty;
        if (li.gross_sales_money && li.gross_sales_money.amount)
          sales += Number(li.gross_sales_money.amount);
      });
      (o.tenders || []).forEach(function (t) {
        if (t.type === 'CASH' && t.amount_money && t.amount_money.amount)
          cash += Number(t.amount_money.amount);
      });
    });
    cursor = body.cursor;
  } while (cursor && ++guard < 20);

  return { sales: sales, cash: cash, items: items };
}

function todayText_() {
  var d = getToday();
  var lines = Object.keys(d.items).map(function (k) { return k + ' ' + d.items[k]; });
  return '総売上 ' + d.sales + ' / 現金 ' + d.cash + '\n\n' +
    lines.join('\n') + '\n\n' +
    '入荷: ' + JSON.stringify(d.arrivals) + '\n\n' + d.note;
}

/** エディタから実行して実行ログで確かめる用 */
function showToday() { Logger.log(todayText_()); }

/* ====================== 送信を受ける ====================== */

/**
 * 画面から送られた1日ぶんを保存する。
 * entry: {d, label, sales, cash, tx, counted, diff, detail:{key:{...}}, items:[{n,q}]}
 */
function submitDay(entry) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, message: 'ほかの人が保存中です。少し待ってからもう一度お願いします。' };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var lg = ss.getSheetByName(SH_LOG);
    var st = ss.getSheetByName(SH_STOCK);
    if (!lg || !st) return { ok: false, message: 'シートがありません。メニューから初期セットアップを実行してください。' };

    var d = entry.d ? new Date(entry.d) : new Date();
    var wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];

    var row = [d, wd, entry.sales || 0, entry.cash || 0, entry.tx || 0,
               entry.counted || 0, entry.diff || 0];
    PRODUCTS.forEach(function (p) {
      var x = (entry.detail && entry.detail[p.key]) || {};
      row = row.concat([x.fz || 0, x.ch || 0, x.sold || 0, x.arr || 0,
                        x.expect || 0, x.waste || 0, x.gap || 0]);
    });
    row.push((entry.items || []).map(function (i) { return i.n + ' ' + i.q; }).join(' / '));

    // 同じ日付の行があれば上書き、なければ追加
    var replaced = false;
    if (lg.getLastRow() > 1) {
      var dates = lg.getRange(2, 1, lg.getLastRow() - 1, 1).getValues();
      var key = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
      for (var i = dates.length - 1; i >= 0; i--) {
        if (!dates[i][0]) continue;
        if (Utilities.formatDate(new Date(dates[i][0]), TZ, 'yyyy-MM-dd') === key) {
          lg.getRange(i + 2, 1, 1, row.length).setValues([row]);
          replaced = true;
          break;
        }
      }
    }
    if (!replaced) lg.appendRow(row);

    // 在庫台帳を更新
    var rows = st.getRange(2, 1, Math.max(1, st.getLastRow() - 1), 6).getValues();
    PRODUCTS.forEach(function (p) {
      var x = (entry.detail && entry.detail[p.key]) || {};
      var found = false;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][0] === p.key) {
          st.getRange(i + 2, 3, 1, 4).setValues([[x.fz || 0, x.ch || 0, p.unit, new Date()]]);
          found = true; break;
        }
      }
      if (!found) st.appendRow([p.key, p.name, x.fz || 0, x.ch || 0, p.unit, new Date()]);
    });

    return { ok: true, replaced: replaced };
  } catch (e) {
    return { ok: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}
