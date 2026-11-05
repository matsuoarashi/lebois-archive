/* 本番では Code.gs の末尾に追記してある（2026-11-06、バージョン9）。onOpen にメニュー「momoの見通しを更新」、doPost に action 'pickups' と日報送信後の更新を足した */
/* ====================== momo 向けの見通し（2026-11-06 追加） ======================
 * 酒井シェフが見る「momo見通し」シートを作る。発注数の入力は、これまでどおり「製造品目」シート。
 * 中身：次の2週間の売上予測と品目ごとの販売予測、在庫と発注の提案、直近2週の実績。
 * 計算は getDash()（ダッシュボードと同じ）をそのまま使う。
 * 更新：日報が送られたとき（doPost の submit 後）と、メニュー「momoの見通しを更新」。
 */
var SH_MOMO = 'momo見通し';
var MOMO_HOLIDAYS = {
  '2026-11-03':1,'2026-11-23':1,'2027-01-01':1,'2027-01-11':1,'2027-02-11':1,'2027-02-23':1,
  '2027-03-22':1,'2027-04-29':1,'2027-05-03':1,'2027-05-04':1,'2027-05-05':1,'2027-07-19':1,
  '2027-08-11':1,'2027-09-20':1,'2027-09-23':1,'2027-10-11':1,'2027-11-03':1,'2027-11-23':1
};

function menuMomo() { updateMomoSheet(); SpreadsheetApp.getActiveSpreadsheet().toast('momo見通しを更新しました'); }

function updateMomoSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = getDash();
  var sh = ss.getSheetByName(SH_MOMO) || ss.insertSheet(SH_MOMO);
  sh.clear(); sh.clearFormats();
  var rows = [], fmt = [];   // fmt: [行番号, 種類]
  function put(r, kind) { rows.push(r); if (kind) fmt.push([rows.length, kind]); }

  put(['momo見通し（le bois）', '', '', '', '', '', '', '', ''], 'title');
  put(['更新 ' + stamp_() + '　発注数は「製造品目」シートに入れてください。日報の入荷にそのまま入ります。', '', '', '', '', '', '', '', ''], 'note');
  if (!dash.products.length) { put(['まだ日報の記録がありません。'], 'note'); return momoWrite_(sh, rows, fmt); }

  /* ---- 1. 発注の提案 ---- */
  var plan = dash.plan;
  put([''], '');
  if (plan) {
    var when = plan.decide.map(function (d) { return d.label + '（' + d.wd + '）'; }).join('・');
    put(['1. 発注の提案　' + when + ' の分' + (plan.deadline ? '　締め ' + plan.deadline + (plan.overdue ? '（過ぎています）' : '') : ''), '', '', '', '', '', '', '', ''], 'h');
    var head = ['品目', '今の在庫', '1日平均', '在庫が尽きる見込み', '直近4週の廃棄'];
    plan.decide.forEach(function (d) { head.push(d.label + ' 提案', d.label + ' 入力済み'); });
    put(head, 'th');
    plan.lines.forEach(function (l) {
      var pr = dash.products.filter(function (p) { return p.key === l.key; })[0] || {};
      var stockTxt = l.total + l.unit + (l.bundle && l.per > 1 ? '（' + Math.round(l.total / l.per * 10) / 10 + l.bundle + '）' : '');
      var r = [l.name, stockTxt, Math.round(l.perDay * 10) / 10 + l.unit, l.runout || '4週間以上もつ', (pr.waste || 0) + l.unit];
      l.deliveries.forEach(function (d, j) {
        var u = l.bundle || l.unit;
        r.push(d.qty + u, plan.decide[j].blank ? 'まだ' : (d.current || 0) + u);
      });
      put(r, '');
    });
    put(['提案＝その納品から次の納品の前日までに売れる見込み＋1日分の余裕 − 届く時点の見込み在庫。月曜は定休として数えない。'], 'note');
  } else {
    put(['1. 発注の提案　「製造品目」に今日以降の引取日がありません。'], 'h');
  }

  /* ---- 2. 次の2週間の予測 ---- */
  var w = {}, salesWd = {};
  dash.dow.forEach(function (d) { w[d.wd] = d.weight || 1; salesWd[d.wd] = d.avgSales; });
  // 売上の予測は祝日を除いた曜日の平均（祝日の火曜などが平日の平均を押し上げないように）
  var sSum = {}, sCnt = {};
  dash.days.filter(function (x) { return x.open && !MOMO_HOLIDAYS[x.key]; }).slice(-42).forEach(function (x) { sSum[x.wd] = (sSum[x.wd] || 0) + x.sales; sCnt[x.wd] = (sCnt[x.wd] || 0) + 1; });
  Object.keys(sCnt).forEach(function (k) { salesWd[k] = sSum[k] / sCnt[k]; });
  var weekend = [salesWd['土'], salesWd['日']].filter(function (x) { return x; });
  var weekendAvg = weekend.length ? weekend.reduce(function (a, b) { return a + b; }, 0) / weekend.length : null;
  var weekendW = ((w['土'] || 1) + (w['日'] || 1)) / 2;
  var pick = momoPickups_(ss, 21);
  put([''], '');
  put(['2. 次の2週間の予測（直近6週・祝日を除いた曜日ごとの平均から）'], 'h');
  var h2 = ['日付', '曜日', '売上の予測'];
  dash.products.forEach(function (p) { h2.push(p.name + '（' + p.unit + '）'); });
  h2.push('引取', 'メモ');
  put(h2, 'th');
  var d = new Date(reportDate_() + 'T00:00:00+09:00');
  var tot = { sales: 0 }; dash.products.forEach(function (p) { tot[p.key] = 0; });
  for (var i = 0; i < 14; i++, d.setDate(d.getDate() + 1)) {
    var key = ymd_(d), wd = WD[dow_(d)], hol = !!MOMO_HOLIDAYS[key];
    var row = [md_(d), wd + (hol ? '・祝' : '')];
    var pk = pick[key];
    if (!isOpenDay_(d) && !hol) {
      row.push('定休');
      dash.products.forEach(function () { row.push(''); });
    } else {
      var s = hol ? weekendAvg : salesWd[wd];
      var ww = hol ? weekendW : (w[wd] || 1);
      row.push(s ? Math.round(s / 100) * 100 : '');
      if (s) tot.sales += Math.round(s / 100) * 100;
      dash.products.forEach(function (p) {
        var v = Math.round(p.perDay * ww * 10) / 10; row.push(v); tot[p.key] += v;
      });
    }
    row.push(pk ? pk.text : '', pk ? pk.memo : '');
    put(row, pk ? 'pick' : (hol || wd === '土' || wd === '日' ? 'we' : ''));
  }
  var tr = ['2週間の合計', '', tot.sales];
  dash.products.forEach(function (p) { tr.push(Math.round(tot[p.key] * 10) / 10); });
  put(tr, 'sum');
  put(['売上の予測は100円単位。祝日は土日の平均で見ている。品目の予測は「直近4週の1日平均×曜日の重み」で、発注の提案と同じ計算。'], 'note');

  /* ---- 3. 直近2週の実績 ---- */
  put([''], '');
  put(['3. 直近2週の実績（日報から）'], 'h');
  var h3 = ['日付', '曜日', '売上'];
  dash.products.forEach(function (p) { h3.push(p.name + ' 売れた', '廃棄'); });
  put(h3, 'th');
  dash.days.filter(function (x) { return x.open; }).slice(-14).forEach(function (x) {
    var r = [x.label, x.wd, x.sales];
    dash.products.forEach(function (p) { r.push(x.sold[p.key] || 0, x.waste[p.key] || 0); });
    put(r, (x.wd === '土' || x.wd === '日') ? 'we' : '');
  });
  return momoWrite_(sh, rows, fmt);
}

/** 製造品目から、今日から n 日のうちの引取日。{ 'yyyy-MM-dd': {text, memo} } */
function momoPickups_(ss, n) {
  var out = {};
  var sh = ss.getSheetByName(SH_ORDER);
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues();
  var head = v[0].map(function (x) { return String(x).trim(); });
  var col = {}; head.forEach(function (h, i) { col[h] = i; });
  var from = new Date(reportDate_() + 'T00:00:00+09:00'), to = new Date(from.getTime() + n * 864e5);
  for (var r = 1; r < v.length; r++) {
    var c = v[r][col['引取日']]; if (!c) continue;
    var d = (c instanceof Date) ? c : new Date(c);
    if (isNaN(d.getTime()) || d < from || d >= to) continue;
    var parts = [], blank = true;
    PRODUCTS.forEach(function (p) {
      var x = v[r][col[p.orderCol]];
      if (x !== '' && x !== null && x !== undefined) blank = false;
      if (Number(x) > 0) parts.push(p.name + ' ' + Number(x) + (p.bundle || p.unit));
    });
    var k = ymd_(d), prev = out[k];
    var text = blank ? '引取（数はまだ）' : (parts.length ? parts.join('・') : '引取なし（0）');
    var memo = col['マイルストーン'] !== undefined ? String(v[r][col['マイルストーン']] || '') : '';
    out[k] = { text: prev ? prev.text + ' ／ ' + text : text, memo: prev ? prev.memo : memo, blank: blank, items: parts };
  }
  return out;
}

function momoWrite_(sh, rows, fmt) {
  var width = rows.reduce(function (a, r) { return Math.max(a, r.length); }, 1);
  var grid = rows.map(function (r) { var x = r.slice(); while (x.length < width) x.push(''); return x; });
  sh.getRange(1, 1, grid.length, width).setValues(grid);
  sh.getRange(1, 1, grid.length, width).setFontFamily('Noto Sans JP').setFontSize(11).setVerticalAlignment('middle');
  fmt.forEach(function (f) {
    var rg = sh.getRange(f[0], 1, 1, width);
    if (f[1] === 'title') sh.getRange(f[0], 1).setFontSize(16).setFontWeight('bold').setFontColor('#55663A');
    if (f[1] === 'note') sh.getRange(f[0], 1).setFontSize(10).setFontColor('#7A7262');
    if (f[1] === 'h') sh.getRange(f[0], 1).setFontSize(13).setFontWeight('bold').setFontColor('#55663A');
    if (f[1] === 'th') rg.setFontWeight('bold').setBackground('#E7EBDA').setWrap(true);
    if (f[1] === 'we') rg.setBackground('#F6E8DC');
    if (f[1] === 'pick') rg.setBackground('#FFF4C2').setFontWeight('bold');
    if (f[1] === 'sum') rg.setFontWeight('bold').setBorder(true, null, null, null, null, null);
  });
  sh.getRange(1, 3, grid.length, 1).setNumberFormat('#,##0');
  sh.setColumnWidth(1, 110);
  for (var c = 2; c <= width; c++) sh.setColumnWidth(c, 104);
  sh.setFrozenRows(2);
  return { ok: true, rows: grid.length };
}

/** アプリ用：次の引取（今日から10日）。数と品目だけ。 */
function momoNextPickups_() {
  var p = momoPickups_(SpreadsheetApp.getActiveSpreadsheet(), 10);
  return Object.keys(p).sort().map(function (k) {
    return { date: k, text: p[k].text, blank: p[k].blank };
  });
}
