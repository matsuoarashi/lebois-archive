/**
 * le bois シフト連携（スタッフアプリ用）
 *
 * 「シフト登録 - le bois kiyosumi」を読むだけの、独立した小さなプログラム。
 * 元のシフト表とカレンダー登録の仕組みには一切書き込まない。
 *
 * やっていること
 *   1. 15分ごとに元の表の「（データ処理用）」「③カレンダー登録(個別入力)」を読み、
 *      このプログラム専用の表「le bois シフト連携（アプリ用）」の「シフト記録」に写す。
 *      元の表は1か月分しか持たないので、月が替わっても過去・当月の分が消えないよう写しておく
 *   2. スタッフアプリから呼ばれたら、今日から14日分を「表示名」で返す（フルネームは外に出さない）
 *
 * 時刻はセルの見た目（getDisplayValues）で読む。Date のまま読むと1899年基準のずれが出るため
 *
 * 初回だけ：エディタで setup を実行 → ウェブアプリとしてデプロイ（実行：自分／アクセス：全員）
 */

const SRC_ID = '1hjiN79jB6DCzA0exQks3ybbX-Qpawh6OM51Aw8JnIA8';
const SRC_GRID = '（データ処理用）';
const SRC_EXTRA = '③カレンダー登録(個別入力) ';
const SRC_MASTER = 'マスタ';
const TZ = 'Asia/Tokyo';
const DAYS = 14;

/* 表示名の初期値（店長があとから「表示名」シートで直せる） */
const DISPLAY_SEED = {
  '堀江柚那': '柚那', '田中愛': '愛', '星野由希子': '由希子', '岡田葵': '葵', '藤江亜妃': '亜妃',
  '鈴木琉月': '琉月', '菅谷弘樹': '弘樹', '小棚木菜々': '菜々', '池尾初凪': '初凪', 'ブレイケリー花連': '花連',
  '福永絵梨': '絵梨', '佐野香織': '香織', '畑崎智尋': '智尋', '平井和実': '和実', '菅原唯': '唯'
};

/* ---------- 初回設定 ---------- */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let ss;
  if (props.getProperty('STORE_ID')) {
    ss = SpreadsheetApp.openById(props.getProperty('STORE_ID'));
  } else {
    ss = SpreadsheetApp.create('le bois シフト連携（アプリ用）');
    props.setProperty('STORE_ID', ss.getId());
  }
  const rec = sheet_(ss, 'シフト記録', ['日付', '枠', '開始', '終了', '名前', 'メモ', '取込元', '更新']);
  const names = sheet_(ss, '表示名', ['名前（シフト表のまま）', 'アプリでの表示名']);
  if (names.getLastRow() < 2) {
    const rows = Object.keys(DISPLAY_SEED).map(k => [k, DISPLAY_SEED[k]]);
    names.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  const def = ss.getSheetByName('シート1');
  if (def && ss.getSheets().length > 2) ss.deleteSheet(def);

  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncShifts').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncShifts').timeBased().everyMinutes(15).create();

  const n = syncShifts();
  Logger.log('準備完了。保存先: ' + ss.getUrl() + ' ／ 取り込んだ枠: ' + n);
}

function sheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}

/* ---------- 取り込み（15分ごと） ---------- */
function syncShifts() {
  const src = SpreadsheetApp.openById(SRC_ID);
  const store = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('STORE_ID'));
  const rec = store.getSheetByName('シフト記録');
  const times = slotTimes_(src);
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm');

  // 元の表の枠（1か月分）。名前が空の枠は「人がいない」ではなく「その枠は使わない」なので取らない
  const grid = src.getSheetByName(SRC_GRID).getDataRange().getDisplayValues();
  const fresh = [];
  const months = {};
  grid.forEach(r => {
    const d = ymd_(r[1]), slot = String(r[2] || '').trim(), name = String(r[3] || '').trim();
    if (!d || !slot) return;
    months[d.slice(0, 7)] = true;
    if (!name) return;
    const t = times[slot] || ['', ''];
    fresh.push([d, slot, t[0], t[1], name, '', '既定', now]);
  });

  // 個別入力（枠外の時間）
  const ex = src.getSheetByName(SRC_EXTRA);
  if (ex) {
    ex.getDataRange().getDisplayValues().slice(1).forEach(r => {
      const d = ymd_(r[1]), name = String(r[3] || '').trim();
      if (!d || !name) return;
      fresh.push([d, String(r[2] || '').trim(), hm_(r[4]), hm_(r[5]), name, String(r[6] || ''), '個別', now]);
    });
  }

  if (!Object.keys(months).length) return 0; // 元の表が空のときは何も消さない

  // 取り込んだ月の「既定」行だけ入れ替える。個別入力は日付+名前+開始で重複を避けて足す
  const old = rec.getLastRow() > 1 ? rec.getRange(2, 1, rec.getLastRow() - 1, 8).getDisplayValues() : [];
  const keyEx = r => [ymd_(r[0]), r[4], hm_(r[2])].join('|');
  const freshEx = {};
  fresh.filter(r => r[6] === '個別').forEach(r => { freshEx[keyEx(r)] = true; });
  const kept = old.filter(r => {
    const d = ymd_(r[0]);
    if (r[6] === '既定') return !months[d.slice(0, 7)];
    return !freshEx[keyEx(r)];
  }).map(r => [ymd_(r[0]), r[1], hm_(r[2]), hm_(r[3]), r[4], r[5], r[6], r[7]]);
  const all = kept.concat(fresh).sort((a, b) => (a[0] + a[2] + a[1]).localeCompare(b[0] + b[2] + b[1]));

  if (old.length) rec.getRange(2, 1, old.length, 8).clearContent();
  if (all.length) {
    rec.getRange(2, 1, all.length, 8).setNumberFormat('@').setValues(all);
  }
  return fresh.length;
}

function slotTimes_(src) {
  const out = {};
  src.getSheetByName(SRC_MASTER).getDataRange().getDisplayValues().slice(1).forEach(r => {
    const s = String(r[0] || '').trim();
    if (s) out[s] = [hm_(r[1]), hm_(r[2])];
  });
  return out;
}

/* ---------- スタッフアプリへの返事 ---------- */
function doGet(e) {
  const out = { ok: true, updated: '', days: [] };
  try {
    const store = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('STORE_ID'));
    const rec = store.getSheetByName('シフト記録');
    const dn = displayNames_(store);
    const today = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd');
    const end = Utilities.formatDate(new Date(Date.now() + (DAYS - 1) * 864e5), TZ, 'yyyy/MM/dd');
    const byDay = {};
    const rows = rec.getLastRow() > 1 ? rec.getRange(2, 1, rec.getLastRow() - 1, 8).getDisplayValues() : [];
    rows.forEach(r => {
      const d = ymd_(r[0]);
      if (!d || d < today || d > end) return;
      if (String(r[7]) > out.updated) out.updated = String(r[7]);
      const raw = String(r[4]).trim();
      const item = { slot: label_(r[1]), start: hm_(r[2]), end: hm_(r[3]) };
      if (raw === '※いません') { item.vacant = true; }
      else if (raw.charAt(0) === '※') { item.note = raw.slice(1); }
      else { item.name = dn(raw); }
      if (r[5]) item.memo = String(r[5]);
      (byDay[d] = byDay[d] || []).push(item);
    });
    Object.keys(byDay).sort().forEach(d => {
      byDay[d].sort((a, b) => (a.start + a.slot).localeCompare(b.start + b.slot));
      out.days.push({ date: d, items: byDay[d] });
    });
  } catch (err) {
    out.ok = false; out.error = String(err && err.message || err);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* 表示名：「表示名」シートにあればそれ。なければ姓を除いた推定（空白の後ろ／カタカナの後ろ／先頭2文字を除く） */
function displayNames_(store) {
  const map = {};
  const sh = store.getSheetByName('表示名');
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
      const k = norm_(r[0]); if (k && r[1]) map[k] = String(r[1]).trim();
    });
  }
  return raw => {
    const k = norm_(raw);
    if (map[k]) return map[k];
    const sp = String(raw).trim().split(/[\s　]+/);
    if (sp.length > 1) return sp[sp.length - 1];
    const kata = k.match(/^[ァ-ヶー]+(.+)$/);
    if (kata) return kata[1];
    return k.length > 2 ? k.slice(2) : k;
  };
}

/* ---------- 小さな道具 ---------- */
function norm_(s) { return String(s || '').replace(/[\s　]+/g, ''); }
function label_(slot) { return String(slot || '').replace(/^[^぀-ヿ一-鿿]+/, '').replace(/[AB]$/, '').trim(); }
function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy/MM/dd');
  const m = String(v || '').match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  return m ? m[1] + '/' + ('0' + m[2]).slice(-2) + '/' + ('0' + m[3]).slice(-2) : '';
}
function hm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
  const m = String(v || '').match(/(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

/* エディタから動作確認用：今日から14日分をログに出す */
function showToday() { Logger.log(doGet().getContent()); }
