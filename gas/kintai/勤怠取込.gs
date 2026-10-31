/**
 * le bois 勤怠取込（管理者用）
 *
 * freee人事労務の勤怠を毎朝読み、シフトの予定と突き合わせて、
 * 日ごとの実働時間と人件費（概算）を管理者用の表に書く。
 * freee には一切書き込まない（読むだけ）。打刻は今まで通り freee で行う。
 *
 * 時給が入るので、この表は管理者だけが見る。スタッフアプリには出さない。
 * freee の鍵（クライアントID・シークレット・トークン）はスクリプト プロパティにだけ置く。
 * コード・表・GitHub には書かない。
 *
 * 初回だけ
 *   1. freee のアプリ管理でアプリを作り、クライアントIDとシークレットを
 *      スクリプト プロパティ FREEE_CLIENT_ID / FREEE_CLIENT_SECRET に入れる
 *   2. このプロジェクトをウェブアプリとしてデプロイ（実行：自分／アクセス：自分のみ）し、
 *      その URL を freee アプリのコールバックURLに登録する
 *   3. ウェブアプリの URL を開いて「freee と連携する」→ 承認
 *   4. エディタで setup を実行（表を作り、毎朝の取り込みを予約し、今月分を取り込む）
 */

const TZ = 'Asia/Tokyo';
const API = 'https://api.freee.co.jp/hr/api/v1';
const AUTH = 'https://accounts.secure.freee.co.jp/public_api';
const SHIFT_STORE_ID = '1OD-NtOhC41nZ5a-YHL_6m9csOIUgY_ERzk2gK4YlsYY'; // le bois シフト連携（アプリ用）
const RECHECK_DAYS = 3; // 毎朝、直近この日数ぶんを取り直す（打刻の修正を拾うため）

const P = PropertiesService.getScriptProperties();

/* ---------- 連携（OAuth） ---------- */
function doGet(e) {
  const self = ScriptApp.getService().getUrl();
  // 管理者がブラウザから初回設定を走らせる用（このウェブアプリは「自分のみ」）
  if (e && e.parameter && e.parameter.run === 'setup') {
    try { return page_(setup()); } catch (err) { return page_('準備に失敗：' + err.message); }
  }
  if (e && e.parameter && e.parameter.code) {
    try {
      token_({ grant_type: 'authorization_code', code: e.parameter.code, redirect_uri: self });
      const me = api_('/users/me');
      const cos = (me.companies || []).map(c => c.id + '：' + c.name + '（' + c.role + '）');
      if (me.companies && me.companies.length === 1) P.setProperty('COMPANY_ID', String(me.companies[0].id));
      return page_('freee と連携できました。<br>事業所：<br>' + cos.join('<br>') +
        (P.getProperty('COMPANY_ID') ? '' : '<br><br>事業所が複数あります。スクリプト プロパティ COMPANY_ID に使う番号を入れてください。'));
    } catch (err) {
      return page_('連携に失敗しました：' + err.message);
    }
  }
  const url = AUTH + '/authorize?response_type=code&client_id=' + encodeURIComponent(String(P.getProperty('FREEE_CLIENT_ID') || '').trim()) +
    '&redirect_uri=' + encodeURIComponent(self) + '&prompt=select_company';
  return page_('<a href="' + url + '" target="_top">freee と連携する</a><br><br>コールバックURL：<br><code>' + self + '</code>');
}

function page_(html) {
  return HtmlService.createHtmlOutput('<div style="font:16px sans-serif;padding:24px;line-height:1.8">' + html + '</div>')
    .setTitle('le bois 勤怠取込');
}

function token_(params) {
  params.client_id = String(P.getProperty('FREEE_CLIENT_ID') || '').trim();
  params.client_secret = String(P.getProperty('FREEE_CLIENT_SECRET') || '').trim();
  const res = UrlFetchApp.fetch(AUTH + '/token', { method: 'post', payload: params, muteHttpExceptions: true });
  let j = {};
  try { j = JSON.parse(res.getContentText() || '{}'); } catch (e) { j = { error: res.getContentText().slice(0, 200) }; }
  if (res.getResponseCode() !== 200 || !j.access_token) {
    throw new Error('トークン取得に失敗（' + res.getResponseCode() + ' ' + (j.error || '') + '）' + (j.error_description || '') +
      ' ／ ID長さ' + params.client_id.length + '・鍵長さ' + params.client_secret.length + (params.redirect_uri ? ' ／ 戻り先 ' + params.redirect_uri : ''));
  }
  P.setProperties({
    FREEE_ACCESS_TOKEN: j.access_token,
    FREEE_REFRESH_TOKEN: j.refresh_token, // freee のリフレッシュトークンは使うたびに新しくなる
    FREEE_EXPIRES: String(Date.now() + (j.expires_in - 300) * 1000)
  });
  return j.access_token;
}

function access_() {
  if (P.getProperty('FREEE_ACCESS_TOKEN') && Number(P.getProperty('FREEE_EXPIRES')) > Date.now()) return P.getProperty('FREEE_ACCESS_TOKEN');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (P.getProperty('FREEE_ACCESS_TOKEN') && Number(P.getProperty('FREEE_EXPIRES')) > Date.now()) return P.getProperty('FREEE_ACCESS_TOKEN');
    if (!P.getProperty('FREEE_REFRESH_TOKEN')) throw new Error('freee と未連携です。ウェブアプリの URL を開いて連携してください');
    return token_({ grant_type: 'refresh_token', refresh_token: P.getProperty('FREEE_REFRESH_TOKEN') });
  } finally { lock.releaseLock(); }
}

function api_(path, query) {
  const q = query ? '?' + Object.keys(query).map(k => k + '=' + encodeURIComponent(query[k])).join('&') : '';
  for (let i = 0; i < 3; i++) {
    const res = UrlFetchApp.fetch(API + path + q, { headers: { Authorization: 'Bearer ' + access_() }, muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    if (code === 404) return null;
    if (code === 401) { P.deleteProperty('FREEE_ACCESS_TOKEN'); continue; }
    if (code === 429 || code >= 500) { Utilities.sleep(2000 * (i + 1)); continue; }
    throw new Error('freee API ' + code + ' ' + path + ' ' + res.getContentText().slice(0, 200));
  }
  throw new Error('freee API が応答しません ' + path);
}

/* ---------- 初回設定 ---------- */
function setup() {
  let ss;
  if (P.getProperty('STORE_ID')) ss = SpreadsheetApp.openById(P.getProperty('STORE_ID'));
  else { ss = SpreadsheetApp.create('le bois 勤怠実績（管理者用）'); P.setProperty('STORE_ID', ss.getId()); }
  sheet_(ss, '日別', ['日付', '名前', '表示名', '予定', '出勤', '退勤', '休憩(分)', '実働(分)', '予定(分)', '差(分)', '時給', '人件費(概算)', 'メモ', '取得']);
  sheet_(ss, '日次合計', ['日付', '曜日', '人数', '予定(時間)', '実働(時間)', '差(時間)', '人件費(概算)', '取得']);
  sheet_(ss, '名前対応', ['freeeの氏名', 'シフト表の名前（違うときだけ）']);
  const def = ss.getSheetByName('シート1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'daily').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('daily').timeBased().everyDays(1).atHour(5).inTimezone(TZ).create();

  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const n = importRange(ymd_(first), ymd_(new Date(today.getTime() - 864e5)));
  const msg = '準備完了。保存先: ' + ss.getUrl() + ' ／ 取り込んだ行: ' + n;
  Logger.log(msg);
  return msg;
}

function sheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}

/* ---------- 毎朝 ---------- */
function daily() {
  const y = new Date(Date.now() - 864e5);
  const from = new Date(y.getTime() - (RECHECK_DAYS - 1) * 864e5);
  importRange(ymd_(from), ymd_(y));
}

/* エディタから：先月分を取り込む */
function importLastMonth() {
  const t = new Date();
  importRange(ymd_(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd_(new Date(t.getFullYear(), t.getMonth(), 0)));
}

/* from〜to（yyyy/MM/dd）を取り込み、その日付の行を入れ替える */
function importRange(from, to) {
  const company = P.getProperty('COMPANY_ID');
  if (!company) throw new Error('COMPANY_ID が未設定です');
  const ss = SpreadsheetApp.openById(P.getProperty('STORE_ID'));
  const dates = [];
  for (let d = parse_(from); ymd_(d) <= to; d = new Date(d.getTime() + 864e5)) dates.push(ymd_(d));
  if (!dates.length) return 0;

  const plan = shiftPlan_(dates);
  const alias = aliases_(ss);
  const targets = targets_(alias, plan);
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm');
  const rows = [];

  // 月ごとに在籍者と時給を取る
  const months = {};
  dates.forEach(d => { months[d.slice(0, 7)] = true; });
  const staff = {}; // month -> [{id, name, key, wage}]
  Object.keys(months).forEach(m => {
    const [yy, mm] = m.split('/').map(Number);
    // freee の事業所はアウタ全体なので、le bois のシフト表にいる人（表示名シート・名前対応シート）だけに絞る
    staff[m] = employees_(company, yy, mm).map(e => {
      const name = String(e.display_name || ((e.last_name || '') + ' ' + (e.first_name || ''))).trim();
      return { e: e, name: name, key: alias[norm_(name)] || norm_(name) };
    }).filter(x => targets[x.key]).map(x => {
      const e = x.e, name = x.name;
      const res = api_('/employees/' + e.id + '/basic_pay_rule', { company_id: company, year: yy, month: mm }) || {};
      const rule = res.employee_basic_pay_rule || res.basic_pay_rule || res;
      return { id: e.id, name: name, key: x.key,
               wage: rule.pay_calc_type === 'hourly' ? Number(rule.pay_amount) || 0 : 0,
               wageNote: rule.pay_calc_type && rule.pay_calc_type !== 'hourly' ? '時給以外（' + rule.pay_calc_type + '）' : '' };
    });
  });

  dates.forEach(d => {
    const list = staff[d.slice(0, 7)];
    const iso = d.replace(/\//g, '-');
    const seen = {};
    const recs = apiAll_(list.map(s => ['/employees/' + s.id + '/work_records/' + iso, { company_id: company }]));
    list.forEach((s, i) => {
      const w = recs[i];
      const p = (plan[d] || {})[s.key];
      const r = work_(w);
      if (!r.mins && !p) return; // 予定も打刻もない人は出さない
      seen[s.key] = true;
      const planMins = p ? p.mins : 0;
      const memo = [];
      if (p && !r.mins && !r.inAt) memo.push(r.absence ? '欠勤' : '予定あり・打刻なし');
      if (!p && r.mins) memo.push('予定外の勤務');
      if (r.open) memo.push('退勤の打刻なし');
      if (s.wageNote) memo.push(s.wageNote);
      rows.push([d, s.name, p ? p.disp : (typeof targets[s.key] === 'string' ? targets[s.key] : ''), p ? p.label : '', r.inAt, r.outAt, r.brk, r.mins, planMins,
        r.mins - planMins, s.wage || '', s.wage ? Math.round(s.wage * r.mins / 60) : '', memo.join('／'), now]);
    });
    // シフト表にいるのに freee に見つからない人
    Object.keys(plan[d] || {}).forEach(k => {
      if (seen[k] || list.some(s => s.key === k)) return;
      const p = plan[d][k];
      rows.push([d, '', p.disp, p.label, '', '', '', 0, p.mins, -p.mins, '', '', 'freee に該当者なし（名前対応シートで対応づけ）', now]);
    });
  });

  replace_(ss.getSheetByName('日別'), dates, rows, 14);
  replace_(ss.getSheetByName('日次合計'), dates, summary_(dates, rows, now), 8);
  return rows.length;
}

/* まとめて取る。失敗したものだけ1件ずつ取り直す */
function apiAll_(calls) {
  const tok = access_();
  const reqs = calls.map(c => ({
    url: API + c[0] + '?' + Object.keys(c[1]).map(k => k + '=' + encodeURIComponent(c[1][k])).join('&'),
    headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true
  }));
  const res = reqs.length ? UrlFetchApp.fetchAll(reqs) : [];
  return res.map((r, i) => {
    const code = r.getResponseCode();
    if (code === 200) return JSON.parse(r.getContentText());
    if (code === 404) return null;
    return api_(calls[i][0], calls[i][1]);
  });
}

function employees_(company, y, m) {
  const out = [];
  for (let off = 0; ; off += 100) {
    const j = api_('/employees', { company_id: company, year: y, month: m, limit: 100, offset: off }) || {};
    const list = j.employees || [];
    out.push.apply(out, list);
    if (list.length < 100 || out.length >= (j.total_count || 0)) break;
  }
  return out;
}

/* freee の勤怠1日分 → 出勤・退勤・休憩・実働 */
function work_(w) {
  const r = { inAt: '', outAt: '', brk: 0, mins: 0, open: false, absence: false };
  if (!w) return r;
  r.absence = !!w.is_absence;
  const ci = w.clock_in_at ? new Date(w.clock_in_at) : null;
  const co = w.clock_out_at ? new Date(w.clock_out_at) : null;
  if (ci) r.inAt = Utilities.formatDate(ci, TZ, 'HH:mm');
  if (co) r.outAt = Utilities.formatDate(co, TZ, 'HH:mm');
  (w.break_records || []).forEach(b => {
    if (b.clock_in_at && b.clock_out_at) r.brk += Math.round((new Date(b.clock_out_at) - new Date(b.clock_in_at)) / 60000);
  });
  if (ci && co) r.mins = Math.max(0, Math.round((co - ci) / 60000) - r.brk);
  else if (ci) r.open = true;
  return r; // 所定時間（normal_work_mins）は打刻がなくても入るので使わない
}

/* シフトの予定：日付 → 名前キー → {disp, label, mins} */
function shiftPlan_(dates) {
  const want = {};
  dates.forEach(d => { want[d] = true; });
  const ss = SpreadsheetApp.openById(SHIFT_STORE_ID);
  const disp = {};
  const dn = ss.getSheetByName('表示名');
  if (dn && dn.getLastRow() > 1) dn.getRange(2, 1, dn.getLastRow() - 1, 2).getValues().forEach(r => { disp[norm_(r[0])] = String(r[1]); });
  const rec = ss.getSheetByName('シフト記録');
  const out = {};
  if (rec.getLastRow() < 2) return out;
  rec.getRange(2, 1, rec.getLastRow() - 1, 5).getDisplayValues().forEach(r => {
    const d = r[0], name = String(r[4]).trim();
    if (!want[d] || !name || name.charAt(0) === '※') return;
    const k = norm_(name);
    const mins = span_(r[2], r[3]);
    const label = String(r[1]).replace(/^[^぀-ヿ一-鿿]+/, '').replace(/[AB]$/, '') + ' ' + r[2] + '〜' + r[3];
    const day = out[d] = out[d] || {};
    if (day[k]) { day[k].mins += mins; day[k].label += '、' + label; }
    else day[k] = { disp: disp[k] || name, label: label, mins: mins };
  });
  return out;
}

/* 対象者：シフト連携の「表示名」シートにいる人＋名前対応シートの人＋期間中にシフトがある人 */
function targets_(alias, plan) {
  const t = {};
  const dn = SpreadsheetApp.openById(SHIFT_STORE_ID).getSheetByName('表示名');
  if (dn && dn.getLastRow() > 1) dn.getRange(2, 1, dn.getLastRow() - 1, 2).getValues().forEach(r => { if (r[0]) t[norm_(r[0])] = String(r[1] || '') || true; });
  Object.keys(alias).forEach(k => { t[alias[k]] = true; });
  Object.keys(plan).forEach(d => Object.keys(plan[d]).forEach(k => { t[k] = true; }));
  return t;
}

function aliases_(ss) {
  const sh = ss.getSheetByName('名前対応');
  const m = {};
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    if (r[0] && r[1]) m[norm_(r[0])] = norm_(r[1]);
  });
  return m;
}

function summary_(dates, rows, now) {
  const wd = ['日', '月', '火', '水', '木', '金', '土'];
  return dates.map(d => {
    const rs = rows.filter(r => r[0] === d);
    const plan = rs.reduce((a, r) => a + (Number(r[8]) || 0), 0);
    const act = rs.reduce((a, r) => a + (Number(r[7]) || 0), 0);
    const cost = rs.reduce((a, r) => a + (Number(r[11]) || 0), 0);
    const ppl = rs.filter(r => Number(r[7]) > 0).length;
    return [d, wd[parse_(d).getDay()], ppl, h_(plan), h_(act), h_(act - plan), cost, now];
  });
}

/* 指定日付の行を消して入れ直す（日付は文字列で持つ） */
function replace_(sh, dates, rows, width) {
  const want = {};
  dates.forEach(d => { want[d] = true; });
  const old = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getDisplayValues() : [];
  const kept = old.filter(r => !want[r[0]]);
  const all = kept.concat(rows).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (old.length) sh.getRange(2, 1, old.length, width).clearContent();
  if (all.length) {
    sh.getRange(2, 1, all.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, all.length, width).setValues(all);
  }
}

/* ---------- 小さな道具 ---------- */
function norm_(s) { return String(s || '').replace(/[\s　]+/g, ''); }
function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyy/MM/dd'); }
function parse_(s) { const m = String(s).split('/').map(Number); return new Date(m[0], m[1] - 1, m[2], 12); }
function span_(a, b) {
  const t = s => { const m = String(s).match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const x = t(a), y = t(b);
  return x === null || y === null ? 0 : Math.max(0, y - x);
}
function h_(m) { return Math.round(m / 6) / 10; }

/* エディタから動作確認用 */
function showCompanies() { Logger.log(JSON.stringify(api_('/users/me'), null, 1)); }
