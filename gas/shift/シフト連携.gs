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

/* ---------- スタッフアプリへの返事 ----------
 * スタッフアプリはログイン後、POST で {token} を送ってくる。
 * token が本物かは Supabase（lb_whoami）に聞く。ログインしていない人にはシフトを返さない。
 * 公開用の鍵（publishable key）はページにも載る公開の値なので、ここに書いてよい */
const SB_URL = 'https://vedljpcvxchneazuoguo.supabase.co';
const SB_KEY = 'sb_publishable_byKaWl2cyzwg1gA-QyfEoQ_mPF9N-1e';

function doGet(e) {
  // 管理用：テストURLに ?run=around を付けて開くと、MOTの表を作りギャラリーの件数だけを返す（中身は返さない）
  if (e && e.parameter && e.parameter.run === 'around') {
    const r = setupMot();
    CacheService.getScriptCache().remove('gallery_v2');
    const g = gallery_();
    return json_({ ok: true, mot: r, gallery: g.error || (g.items.length + '件') });
  }
  return json_({ ok: false, error: 'login_required' });
}

function doPost(e) {
  let token = '';
  try { token = String(JSON.parse(e.postData.contents || '{}').token || ''); } catch (err) {}
  if (!/^[0-9a-f-]{36}$/.test(token)) return json_({ ok: false, error: 'login_required' });
  const cache = CacheService.getScriptCache();
  if (!cache.get('tok:' + token)) {
    const r = UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/lb_whoami', {
      method: 'post', contentType: 'application/json', headers: { apikey: SB_KEY },
      payload: JSON.stringify({ p_token: token }), muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return json_({ ok: false, error: 'login_required' });
    cache.put('tok:' + token, '1', 600); // 10分は聞き直さない
  }
  return json_(payload_());
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function payload_() {
  const out = { ok: true, updated: '', days: [], counts: {} };
  try {
    const store = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('STORE_ID'));
    const rec = store.getSheetByName('シフト記録');
    const dn = displayNames_(store);
    const today = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd');
    const end = Utilities.formatDate(new Date(Date.now() + (DAYS - 1) * 864e5), TZ, 'yyyy/MM/dd');
    const from = Utilities.formatDate(new Date(Date.now() - 120 * 864e5), TZ, 'yyyy/MM/dd');
    const byDay = {};
    const rows = rec.getLastRow() > 1 ? rec.getRange(2, 1, rec.getLastRow() - 1, 8).getDisplayValues() : [];
    rows.forEach(r => {
      const d = ymd_(r[0]);
      // 勤務回数（その日のリーダーの目安。直近120日〜表示の最後の日まで、シフト記録に入っている回数）
      const raw0 = String(r[4]).trim();
      if (d && d >= from && d <= end && raw0 && raw0.charAt(0) !== '※') { const nm = dn(raw0); out.counts[nm] = (out.counts[nm] || 0) + 1; }
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
    // freee の勤務日数（勤怠取込が毎朝書く）のうち、シフト記録より前の月の分を勤務回数に足す（2026-11-06）
    try {
      const fw = store.getSheetByName('勤務日数（freee）');
      if (fw && fw.getLastRow() > 1) {
        const firstRec = rows.reduce((acc, r) => { const d = ymd_(r[0]); return d && (!acc || d < acc) ? d : acc; }, '');
        const recMonth = firstRec ? firstRec.slice(0, 7) : '9999/99';
        const minMonth = from.slice(0, 7);
        fw.getRange(2, 1, fw.getLastRow() - 1, 3).getDisplayValues().forEach(r => {
          const mt = String(r[1]).match(/(\d{4})\D+(\d{1,2})/);
          const ym = mt ? mt[1] + '/' + ('0' + mt[2]).slice(-2) : '';
          const n = Number(r[2]) || 0;
          if (!r[0] || !n || !ym || ym >= recMonth || ym < minMonth) return;
          const nm = dn(r[0]); out.counts[nm] = (out.counts[nm] || 0) + n;
        });
      }
    } catch (e) { out.countsNote = 'freee の勤務日数を読めませんでした'; }
    Object.keys(byDay).sort().forEach(d => {
      byDay[d].sort((a, b) => (a.start + a.slot).localeCompare(b.start + b.slot));
      out.days.push({ date: d, items: byDay[d] });
    });
  } catch (err) {
    out.ok = false; out.error = String(err && err.message || err);
  }
  try { out.gallery = gallery_(); } catch (e) { out.gallery = { items: [], error: 'ギャラリーの予定を読み込めませんでした' }; }
  try { out.mot = mot_(); } catch (e) { out.mot = []; }
  return out;
}

/* ---------- ギャラリー Klyuch（gallery.klyuch@gmail.com のカレンダー） ----------
 * スタッフに出すのは「確定」「開催中」の展示名・会期・搬入日だけ。
 * お客様のお名前・金額・入金状況・仮押さえは出さない。
 * 予約システムが作った予定（説明欄に [klyuch-auto]）は、お客様欄の（ ）内＝展示名・ブランド名を使い、
 * なければ「ギャラリーのご利用」と出す。
 * 手で入れた予定（「三村様(LINE)27日搬入日」のような題名）は、お名前・連絡手段・料金のメモを出さず、
 * 種類（展示・受注会・見学）と日にち・搬入日・時間だけを出す。休館日は出さない。 */
const GALLERY_CAL = 'gallery.klyuch@gmail.com';

function gallery_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('gallery_v2');
  if (hit) return JSON.parse(hit);
  let cal = CalendarApp.getCalendarById(GALLERY_CAL);
  // 共有されただけでは自分のカレンダー一覧に入らず null になるので、一度だけ登録する
  if (!cal) { try { cal = CalendarApp.subscribeToCalendar(GALLERY_CAL, { hidden: true, selected: false }); } catch (err) { cal = null; } }
  if (!cal) return { items: [], error: 'ギャラリーのカレンダーがまだ共有されていません' };
  const p = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd').split('/');
  const from = new Date(+p[0], +p[1] - 1, +p[2]);  // appsscript.json の timeZone は Asia/Tokyo
  const to = new Date(from.getTime() + (DAYS + 1) * 864e5);
  const items = [];
  cal.getEvents(new Date(from.getTime() - 60 * 864e5), to).forEach(ev => {
    const title = String(ev.getTitle() || '');
    const desc = String(ev.getDescription() || '');
    const auto = desc.indexOf('[klyuch-auto]') !== -1;
    const st = (title.match(/^【([^】]+)】/) || [])[1] || '';
    if (/仮|入金|終了|キャンセル/.test(st)) return;
    if (auto && !/確定|開催中/.test(st)) return;
    const venue = (title.replace(/^【[^】]+】/, '').match(/^\[([^\]]+)\]/) || [])[1] || 'ギャラリー';
    if (!auto && /休館/.test(title)) return;
    // 終日予定の終わりは翌日0時なので1日戻す
    const allDay = ev.isAllDayEvent();
    const s = allDay ? ev.getAllDayStartDate() : ev.getStartTime();
    const e = allDay ? new Date(ev.getAllDayEndDate().getTime() - 864e5) : ev.getEndTime();
    let start = Utilities.formatDate(s, TZ, 'yyyy/MM/dd'), moveIn = '', time = '';
    let end = Utilities.formatDate(e, TZ, 'yyyy/MM/dd');
    let name;
    if (auto) {
      name = (desc.match(/お客様:[^\n(（]*[（(]([^)）\n]+)[)）]/) || [])[1] || 'ギャラリーのご利用';
      if (/前日搬入あり/.test(desc)) { moveIn = start; start = Utilities.formatDate(new Date(s.getTime() + 864e5), TZ, 'yyyy/MM/dd'); }
    } else {
      const owner = /オーナー対応/.test(title);
      if (/見学|内見/.test(title)) name = owner ? '見学のお客さま（オーナー対応）' : '見学のお客さま';
      else if (/受注会/.test(title)) name = '受注会';
      else if (/ワークショップ|WS/.test(title)) name = 'ワークショップ';
      else name = '展示・イベント';
      // 「27日搬入日」「[8日搬入のみ]」
      const mv = title.match(/(\d{1,2})日搬入/);
      if (mv) {
        let d = new Date(s.getFullYear(), s.getMonth(), +mv[1]);
        if (d < new Date(s.getTime() - 15 * 864e5)) d = new Date(s.getFullYear(), s.getMonth() + 1, +mv[1]);
        const md = Utilities.formatDate(d, TZ, 'yyyy/MM/dd');
        if (/搬入のみ/.test(title)) {
          if (md === end) { moveIn = md; start = md; }       // 1日だけの搬入
          else { moveIn = md; if (md === start) start = Utilities.formatDate(new Date(d.getTime() + 864e5), TZ, 'yyyy/MM/dd'); }
        } else {
          moveIn = md;
          if (md === start && start < end) start = Utilities.formatDate(new Date(d.getTime() + 864e5), TZ, 'yyyy/MM/dd');
        }
      }
    }
    if (!allDay && start === end) time = Utilities.formatDate(s, TZ, 'H:mm') + '〜' + Utilities.formatDate(e, TZ, 'H:mm');
    if (end < Utilities.formatDate(from, TZ, 'yyyy/MM/dd')) return;
    items.push({ name: name.slice(0, 60), venue: venue, start: start, end: end, moveIn: moveIn, time: time });
  });
  items.sort((a, b) => (a.moveIn || a.start).localeCompare(b.moveIn || b.start));
  const out = { items: items };
  cache.put('gallery_v2', JSON.stringify(out), 600);
  return out;
}

/* ---------- 東京都現代美術館（店の表「MOT展覧会」。店長が直せる） ---------- */
const MOT_SEED = [
  ['多田美波（仮）', '2026/08/29', '2026/12/06'],
  ['共時的星叢―時を共にした星たち 越境する芸術のまなざし', '2026/09/05', '2026/12/13'],
  ['サンプライド財団との共催展（仮）', '2027/02/06', '2027/05/16'],
  ['ハンス・ハーケ（仮）', '2027/02/06', '2027/05/16'],
  ['MOTアニュアル2026（仮）', '2027/02/20', '2027/05/30'],
];

/** エディタで1回実行：カレンダーの許可を出し、MOTの表を作り、結果をログに出す */
function setupAround() {
  const r = setupMot();
  CacheService.getScriptCache().remove('gallery_v2');
  const g = gallery_();
  Logger.log(r + '／ギャラリー：' + (g.error || g.items.length + '件'));
  Logger.log(JSON.stringify(g));
}

function setupMot() {
  const store = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('STORE_ID'));
  const sh = sheet_(store, 'MOT展覧会', ['展覧会名', '開始', '終了', 'メモ']);
  if (sh.getLastRow() < 2) {
    sh.getRange(2, 1, MOT_SEED.length, 3).setNumberFormat('@').setValues(MOT_SEED);
    sh.getRange(2, 4).setValue('2025/10/27 公表の年間予定より。（仮）は正式名が出たら直す');
  }
  return 'MOT展覧会：' + (sh.getLastRow() - 1) + '件';
}

function mot_() {
  const store = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('STORE_ID'));
  const sh = store.getSheetByName('MOT展覧会');
  if (!sh || sh.getLastRow() < 2) return MOT_SEED.map(r => ({ title: r[0], start: r[1], end: r[2] }));
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd');
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues()
    .map(r => ({ title: String(r[0]).trim(), start: ymd_(r[1]), end: ymd_(r[2]) }))
    .filter(m => m.title && m.start && m.end && m.end >= today)
    .sort((a, b) => a.start.localeCompare(b.start));
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
function showToday() { Logger.log(JSON.stringify(payload_())); }
