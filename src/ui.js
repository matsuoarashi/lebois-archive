
(function(){
  var P = [
    {k:'cheese',  n:'チーズケーキ',     u:'切れ', b:'本',    per:7, fu:'b'},
    {k:'gateau',  n:'ガトーショコラ',   u:'切れ', b:'本',    per:9, fu:'b'},
    {k:'chiffon', n:'シフォンケーキ',   u:'個',   b:'ロール', per:8, fu:'u'},
    {k:'croque',  n:'クロックムッシュ', u:'食',   b:null,    per:1, fu:'u'}
  ];
  var MAP = [
    {sq:'チーズケーキ',             k:'cheese',  mul:1},
    {sq:'チーズケーキ（1本）',       k:'cheese',  mul:7},
    {sq:'ガトーショコラ',           k:'gateau',  mul:1},
    {sq:'シフォンケーキ（チョコ）',   k:'chiffon', mul:1},
    {sq:'シフォンケーキ（オレンジ）', k:'chiffon', mul:1},
    {sq:'クロックムッシュ',         k:'croque',  mul:1}
  ];

  var state;
  try{ state = JSON.parse(document.getElementById('state').textContent); }catch(e){ state = {}; }
  if(!state.stock) state.stock = {};
  P.forEach(function(p){ if(!state.stock[p.k]) state.stock[p.k] = {fz:0, ch:0}; });
  if(!state.log) state.log = [];
  if(!state.items) state.items = [];
  if(typeof state.float !== 'number') state.float = 0;

  var STEPS = ['今日のデータ', '在庫を数える', '差の確認', 'レジ金', '送信'];
  var SRC = [null, 'au', 'me', 'me', 'me', 'nn'];
  var ui = {step:1, done:false, fmt:'std', msg:'', ok:true};

  var form = {sales:0, cash:0, payout:0, counted:0,
              q:{}, arr:{}, fz:{}, fzu:{}, ch:{}, reason:{}, newNames:['',''], newQty:[0,0]};
  P.forEach(function(p){
    form.arr[p.k]=0; form.fzu[p.k]=p.fu; form.reason[p.k]=null;
    form.fz[p.k]= p.fu==='b' ? Math.round(state.stock[p.k].fz/p.per) : state.stock[p.k].fz;
    form.ch[p.k]= state.stock[p.k].ch;
  });

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){
    return c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':'&quot;'; }); }
  function yen(v){ return '¥' + Math.round(v).toLocaleString('ja-JP'); }
  function today(){
    var d = new Date(), w = ['日','月','火','水','木','金','土'][d.getDay()];
    return {iso:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),
            label:(d.getMonth()+1)+'/'+d.getDate()+'('+w+')',
            time:String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
  }
  function bundles(p, pieces){
    if(!p.b || pieces <= 0) return '';
    var whole = Math.floor(pieces/p.per), rem = pieces % p.per;
    if(whole === 0) return '';
    return rem === 0 ? '（'+whole+p.b+'）' : '（'+whole+p.b+'＋'+rem+p.u+'）';
  }
  function names(){ return MAP.map(function(m){return m.sq;}).concat(state.items); }
  function soldList(){
    var out = [];
    names().forEach(function(nm){ if((form.q[nm]||0) > 0) out.push({name:nm, qty:form.q[nm]}); });
    form.newNames.forEach(function(nm,i){
      if(nm && nm.trim() && form.newQty[i] > 0) out.push({name:nm.trim(), qty:form.newQty[i], isNew:true});
    });
    return out;
  }

  function compute(){
    var sold = {}; P.forEach(function(p){ sold[p.k]=0; });
    var list = soldList();
    list.forEach(function(it){
      MAP.forEach(function(m){ if(m.sq === it.name) sold[m.k] += it.qty * m.mul; });
    });
    var out = {_list:list};
    P.forEach(function(p){
      var prev = state.stock[p.k];
      var arrPieces = p.b ? form.arr[p.k] * p.per : form.arr[p.k];
      var expect = prev.fz + prev.ch + arrPieces - sold[p.k];
      var fzPieces = form.fzu[p.k] === 'b' ? form.fz[p.k] * p.per : form.fz[p.k];
      var actual = fzPieces + form.ch[p.k];
      var diff = actual - expect;
      out[p.k] = {sold:sold[p.k], arrPieces:arrPieces, expect:expect,
                  fzPieces:fzPieces, ch:form.ch[p.k], actual:actual, diff:diff,
                  waste: (diff < 0 && form.reason[p.k] === 'waste') ? -diff : 0,
                  unexp: (diff !== 0 && form.reason[p.k] !== 'waste') ? diff : 0};
    });
    return out;
  }
  function diffs(){
    var c = compute();
    return P.filter(function(p){ return c[p.k].diff !== 0; });
  }

  function buildReport(fmt){
    var c = compute(), t = today();
    var theo = state.float + form.cash - form.payout, d = form.counted - theo;
    var list = c._list.slice().sort(function(a,b){ return b.qty-a.qty; });
    var total = list.reduce(function(a,b){ return a+b.qty; }, 0);
    var L = [t.label + ' 日報', ''];
    if(fmt !== 'short'){
      L.push('【売上】');
      L.push('総売上 ' + yen(form.sales) + (total ? '（'+total+'点）' : ''));
      L.push('うち現金 ' + yen(form.cash));
      L.push('');
      L.push('【売れたもの】');
      if(list.length) list.forEach(function(it){ L.push(it.name + ' ' + it.qty); });
      else L.push('（なし）');
      L.push('');
    }
    L.push('【在庫数】');
    P.forEach(function(p){
      var r = c[p.k];
      L.push('▼' + p.n);
      L.push('冷凍' + r.fzPieces + p.u + bundles(p, r.fzPieces));
      L.push('冷蔵' + r.ch + p.u);
      if(r.waste > 0) L.push('廃棄' + r.waste + p.u);
    });
    var un = P.filter(function(p){ return c[p.k].unexp !== 0; });
    if(un.length){
      L.push('');
      L.push('【差異】');
      un.forEach(function(p){
        var v = c[p.k].unexp;
        L.push(p.n + ' ' + (v>0?'+':'') + v + p.u + '（原因不明）');
      });
    }
    if(fmt === 'full'){
      var a = [];
      P.forEach(function(p){ if(form.arr[p.k] > 0) a.push(p.n+' '+form.arr[p.k]+(p.b||p.u)); });
      if(a.length){ L.push(''); L.push('【入荷】'); L.push(a.join(' / ')); }
    }
    if(fmt !== 'short'){
      L.push('');
      L.push('【レジ締め】');
      if(fmt === 'full'){
        L.push('理論 ' + yen(theo) + '（釣銭 ' + yen(state.float) + ' ＋ 現金 ' + yen(form.cash)
          + (form.payout ? ' − 出金 ' + yen(form.payout) : '') + '）');
        L.push('実査 ' + yen(form.counted));
        L.push('差異 ' + (d===0?'±0':(d>0?'+':'')+d.toLocaleString('ja-JP')));
      } else {
        L.push('実査 ' + yen(form.counted) + ' ／ 差異 ' + (d===0?'±0':(d>0?'+':'')+d.toLocaleString('ja-JP')));
      }
    }
    return L.join('\n');
  }

  function paint(){
    var s = document.getElementById('status');
    if(!s) return;
    s.className = 'status ' + (ui.ok ? 'ok' : 'ng');
    s.textContent = ui.msg;
  }

  function submit(){
    var c = compute(), t = today(), list = c._list;
    var entry = {d:t.iso, label:t.label, sales:form.sales, cash:form.cash,
      tx:list.reduce(function(a,b){return a+b.qty;},0), counted:form.counted,
      diff: form.counted - (state.float + form.cash - form.payout)};
    var items = state.items.slice();
    list.forEach(function(it){
      if(!it.isNew) return;
      if(MAP.some(function(m){return m.sq===it.name;}) || items.indexOf(it.name)>=0) return;
      items.push(it.name);
    });
    var next = {v:5, float:state.float, items:items, stock:{}, log:[entry].concat(state.log).slice(0,30)};
    P.forEach(function(p){ next.stock[p.k] = {fz:c[p.k].fzPieces, ch:c[p.k].ch}; });
    entry.detail = {};
    P.forEach(function(p){
      entry.detail[p.k] = {fz:c[p.k].fzPieces, ch:c[p.k].ch, sold:c[p.k].sold,
                           arr:c[p.k].arrPieces, expect:c[p.k].expect,
                           waste:c[p.k].waste, gap:c[p.k].unexp};
    });
    entry.items = list.map(function(x){ return {n:x.name, q:x.qty}; });
    state = next; ui.done = true; ui.msg = '保存しています…'; ui.ok = true; render();
    STORE.save(next, entry,
      function(){ ui.msg = '保存しました。明日はこの在庫が「あるはずの数」の出発点になります。'; ui.ok = true; paint(); },
      function(m){ ui.msg = m || '保存できませんでした。報告文はコピーして使えます。'; ui.ok = false; paint(); });
  }

  function copyReport(){
    var el = document.getElementById('bub'); if(!el) return;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(el.textContent).then(function(){
        var b = document.getElementById('copybtn');
        b.textContent = 'コピーしました';
        setTimeout(function(){ b.textContent = '報告文をコピー'; }, 1800);
      }).catch(sel);
    } else sel();
    function sel(){ var r = document.createRange(); r.selectNodeContents(el);
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  }

  function stepper(id, val){
    return '<span class="stp"><button type="button" data-step="-1" data-t="'+id+'" aria-label="減らす">−</button>'
      + '<input type="number" inputmode="numeric" data-f="'+id+'" value="'+(val||0)+'" class="'+((val)?'':'zero')+'">'
      + '<button type="button" data-step="1" data-t="'+id+'" aria-label="増やす">＋</button></span>';
  }
  function moneyRow(label, sub, id, val, tag){
    var tg = tag ? '<span class="tag '+tag[0]+'">'+tag[1]+'</span>' : '';
    return '<div class="money big"><span class="lb">'+label+tg+(sub?'<i>'+sub+'</i>':'')+'</span>'
      + '<input type="number" inputmode="numeric" data-f="'+id+'" value="'+val+'" aria-label="'+label+'"></div>';
  }

  function render(){
    var t = today(), c = compute(), h = '', dl = diffs();

    h += '<div class="topbar"><span class="who">le bois 日報<span class="when">'+t.label+' '+t.time+'</span></span>'
       + '<button class="gear" id="gear">'+(ui.step===0?'とじる':'設定')+'</button></div>';

    if(ui.step > 0){
      h += '<div class="bars">';
      for(var i=1;i<=STEPS.length;i++){
        var skip = (i===3 && dl.length===0) ? ' skip' : '';
        h += '<i class="'+((i<=ui.step||ui.done)?'on':'')+' s-'+SRC[i]+skip+'"></i>';
      }
      h += '</div><div class="legend"><span class="src sq">自動で入る</span>'
         + '<span class="src me">数えて入れる</span></div>';
    }

    h += '<div class="pane">';

    if(ui.step === 0){
      h += '<p class="kicker">setup</p><p class="q">設定</p>'
         + '<p class="qsub">在庫の出発点や釣銭の額がずれているときに直します。</p>';
      P.forEach(function(p){
        h += '<div class="row"><span class="nm">'+p.n+'<i>冷凍 / 冷蔵（'+p.u+'）</i></span><span class="stp">'
           + '<input type="number" inputmode="numeric" data-s="fz_'+p.k+'" value="'+state.stock[p.k].fz+'" aria-label="'+p.n+' 冷凍">'
           + '<input type="number" inputmode="numeric" data-s="ch_'+p.k+'" value="'+state.stock[p.k].ch+'" aria-label="'+p.n+' 冷蔵">'
           + '</span></div>';
      });
      h += '<div class="money big"><span class="lb">釣銭準備金</span>'
         + '<input type="number" inputmode="numeric" data-s="float" value="'+state.float+'" aria-label="釣銭準備金"></div>'
         + '<div class="nav"><button class="prim" id="applysetup">この数字に直す</button></div>';
      if(state.log.length){
        h += '<p class="sgroup">これまでの記録</p><div class="hist">';
        state.log.forEach(function(e){
          var dt = (e.diff==null)?'差異 —':'差異 '+(e.diff===0?'±0':(e.diff>0?'+':'')+e.diff.toLocaleString('ja-JP'));
          h += '<div class="hrow"><span>'+e.label+'</span><span class="r">'+yen(e.sales)+' ／ '+(e.tx||0)+'点 ／ '+dt+'</span></div>';
        });
        h += '</div>';
      }
      h += '</div>';
      document.getElementById('app').innerHTML = h; wire(); return;
    }

    if(ui.done){
      h += '<p class="kicker">done</p><p class="q">送信しました</p>'
         + '<p class="qsub">下の報告文をコピーして、LINEに貼ってください。</p>'
         + '<div class="fmt">'
         + '<label><input type="radio" name="fmt" value="std"'+(ui.fmt==='std'?' checked':'')+'><span>標準</span></label>'
         + '<label><input type="radio" name="fmt" value="short"'+(ui.fmt==='short'?' checked':'')+'><span>在庫だけ</span></label>'
         + '<label><input type="radio" name="fmt" value="full"'+(ui.fmt==='full'?' checked':'')+'><span>詳しく</span></label>'
         + '</div><div class="rep"><div class="bub" id="bub">'+esc(buildReport(ui.fmt))+'</div></div>'
         + '<div class="nav"><button class="prim" id="copybtn">報告文をコピー</button></div>'
         + '<div class="status" id="status"></div></div>';
      document.getElementById('app').innerHTML = h; paint(); wire(); return;
    }

    /* step 1: 自動データの確認 */
    if(ui.step === 1){
      h += '<p class="kicker">step 1 / 5</p><p class="q">今日のデータです</p>'
         + '<div class="banner sq"><span class="src sq">自動</span><span>'
         + (LIVE
             ? '<b>この画面は自動で埋まっています。</b>売上と売れたものはSquareから、入荷は発注表から。見て次へ進んでください。数が違っていたら直せます。'
             : '<b>本番ではこの画面は開いた時点で埋まっています。</b>売上と売れたものはSquareから、入荷は発注表から。見て次へ進むだけになります。')
         + '</span></div>'
         + moneyRow('総売上高','', 'sales', form.sales, ['sq','自動'])
         + moneyRow('うち現金','', 'cash', form.cash, ['sq','自動'])
         + '<p class="sgroup">売れたもの<span class="tag sq">自動</span></p>';
      MAP.forEach(function(m){
        h += '<div class="row"><span class="nm">'+esc(m.sq)+'</span>'+stepper('q:'+m.sq, form.q[m.sq]||0)+'</div>';
      });
      h += '<p class="sgroup">入荷<span class="tag sq">自動</span></p>';
      P.forEach(function(p){
        h += '<div class="row"><span class="nm">'+p.n+'<i>'+(p.b||p.u)+'</i></span>'+stepper('arr:'+p.k, form.arr[p.k])+'</div>';
      });
      h += '<details class="more"><summary>そのほかの商品（'+state.items.length+'件）<span class="tag sq">自動</span></summary><div style="padding-top:8px">';
      state.items.forEach(function(nm){
        h += '<div class="row"><span class="nm">'+esc(nm)+'</span>'+stepper('q:'+nm, form.q[nm]||0)+'</div>';
      });
      h += '<p class="sgroup">新しい商品</p>';
      [0,1].forEach(function(i){
        h += '<div class="row"><span class="nm" style="flex:1"><input type="text" data-f="nn'+i+'" value="'+esc(form.newNames[i])+'" placeholder="商品名" aria-label="新しい商品名" style="width:100%;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--ground);color:var(--ink);font-family:inherit;font-size:12.5px"></span>'
           + stepper('nq'+i, form.newQty[i]) + '</div>';
      });
      h += '</div></details>';
      if(!LIVE) h += '<div class="trial"><b>試用版です。</b>Squareとまだ繋がっていないので、今は手で入れてください。</div>';
    }

    /* step 2: 在庫を数える */
    if(ui.step === 2){
      h += '<p class="kicker">step 2 / 5</p><p class="q">在庫を数えてください</p>'
         + '<p class="qsub">いま冷凍庫と冷蔵庫にある数です。青い数字は、売れた数から計算した「あるはずの数」。</p>';
      P.forEach(function(p){
        var r = c[p.k];
        var cls = r.diff === 0 ? ' ok' : ' bad';
        var fu = form.fzu[p.k];
        var sel = p.b ? '<select data-f="fzu:'+p.k+'" aria-label="'+p.n+' 冷凍の単位">'
              + '<option value="b"'+(fu==='b'?' selected':'')+'>'+p.b+'</option>'
              + '<option value="u"'+(fu==='u'?' selected':'')+'>'+p.u+'</option></select>' : p.u;
        h += '<div class="cnt'+cls+'" data-card="'+p.k+'"><div class="hd"><span class="nm">'+p.n+'</span>'
           + '<span class="exp">あるはず '+r.expect+p.u+bundles(p,r.expect)+'</span></div>'
           + '<div class="in">'
           + '<span class="cell"><label>冷凍 '+sel+'</label>'
           + '<input type="number" inputmode="numeric" data-f="fz:'+p.k+'" value="'+form.fz[p.k]+'" aria-label="'+p.n+' 冷凍"></span>'
           + '<span class="cell"><label>冷蔵 '+p.u+'</label>'
           + '<input type="number" inputmode="numeric" data-f="ch:'+p.k+'" value="'+form.ch[p.k]+'" aria-label="'+p.n+' 冷蔵"></span>'
           + '</div><div class="res"><span data-tot="'+p.k+'">数えた合計 '+r.actual+p.u+'</span>'
           + '<span data-dif="'+p.k+'" class="'+(r.diff===0?'g':'r')+'">'
           + (r.diff===0 ? 'ぴったり' : (r.diff>0?'+':'')+r.diff+p.u) + '</span></div></div>';
      });
      h += '<p class="note">売れた数は計算に入っています。解凍した数を覚えている必要はありません。</p>';
    }

    /* step 3: 差の確認 */
    if(ui.step === 3){
      h += '<p class="kicker">step 3 / 5</p><p class="q">数が合わないものがあります</p>'
         + '<p class="qsub">理由がわかるものだけ選んでください。わからなければそのままで大丈夫です。</p>';
      dl.forEach(function(p){
        var r = c[p.k];
        var short = r.diff < 0;
        h += '<div class="cnt bad"><div class="hd"><span class="nm">'+p.n+'</span>'
           + '<span class="exp" style="color:var(--warn)">'+(r.diff>0?'+':'')+r.diff+p.u+'</span></div>'
           + '<div style="font-size:12.5px;line-height:1.7">あるはず '+r.expect+p.u+' に対して、数えたのは '+r.actual+p.u+'。'
           + (short ? Math.abs(r.diff)+p.u+' 足りません。' : Math.abs(r.diff)+p.u+' 多いです。')+'</div>'
           + '<div class="choice">'
           + (short ? '<button type="button" data-r="waste" data-k="'+p.k+'" class="'+(form.reason[p.k]==='waste'?'on':'')+'">廃棄した</button>' : '')
           + '<button type="button" data-r="other" data-k="'+p.k+'" class="'+(form.reason[p.k]==='other'?'on':'')+'">わからない</button>'
           + '</div></div>';
      });
      h += '<p class="note">「廃棄した」を選ぶと報告文に廃棄として載ります。「わからない」は差異として記録され、あとから原因を探せます。</p>';
    }

    /* step 4: レジ金 */
    if(ui.step === 4){
      var theo = state.float + form.cash - form.payout, d4 = form.counted - theo;
      h += '<p class="kicker">step 4 / 5</p><p class="q">レジのお金は？</p>'
         + '<p class="qsub">数えた金額をそのまま入れてください。</p>'
         + '<div class="money info"><span class="lb">あるはずの金額<span class="tag sq">自動</span>'
         + '<i id="theosub">釣銭 '+yen(state.float)+' ＋ 現金売上 '+yen(form.cash)+(form.payout?' − 出金 '+yen(form.payout):'')+'</i></span>'
         + '<span class="v" id="theov">'+yen(theo)+'</span></div>'
         + moneyRow('数えた金額','', 'counted', form.counted, ['me','入力'])
         + '<div class="money calc"><span class="lb">差異</span><span class="v" id="diffv" style="color:'
         + (d4===0?'var(--moss)':'var(--warn)')+'">'+(d4===0?'±0':(d4>0?'+':'')+d4.toLocaleString('ja-JP'))+'</span></div>'
         + '<details class="more"><summary>出金があった場合（両替・支払いに使った分）</summary>'
         + '<div style="padding-top:8px">'+moneyRow('出金','', 'payout', form.payout)+'</div></details>';
    }

    /* step 5: 確認 */
    if(ui.step === 5){
      var list5 = c._list.slice().sort(function(a,b){return b.qty-a.qty;});
      var tot5 = list5.reduce(function(a,b){return a+b.qty;},0);
      var theo5 = state.float + form.cash - form.payout, d5 = form.counted - theo5;
      h += '<p class="kicker">step 5 / 5</p><p class="q">これで送りますか？</p>'
         + '<div class="sum">売上 <b>'+yen(form.sales)+'</b>（'+tot5+'点）／ 現金 <b>'+yen(form.cash)+'</b><hr>';
      P.forEach(function(p){
        var r = c[p.k];
        h += p.n+' 冷凍<b>'+r.fzPieces+p.u+bundles(p,r.fzPieces)+'</b> ／ 冷蔵<b>'+r.ch+p.u+'</b>'
           + (r.waste?' ／ 廃棄<b>'+r.waste+p.u+'</b>':'')
           + (r.unexp?' ／ <b style="color:var(--warn)">差異'+(r.unexp>0?'+':'')+r.unexp+p.u+'</b>':'')+'<br>';
      });
      h += '<hr>レジ 実査 <b>'+yen(form.counted)+'</b> ／ 差異 <b style="color:'
         + (d5===0?'var(--moss)':'var(--warn)')+'">'+(d5===0?'±0':(d5>0?'+':'')+d5.toLocaleString('ja-JP'))+'</b></div>'
         + '<div class="fmt">'
         + '<label><input type="radio" name="fmt" value="std"'+(ui.fmt==='std'?' checked':'')+'><span>標準</span></label>'
         + '<label><input type="radio" name="fmt" value="short"'+(ui.fmt==='short'?' checked':'')+'><span>在庫だけ</span></label>'
         + '<label><input type="radio" name="fmt" value="full"'+(ui.fmt==='full'?' checked':'')+'><span>詳しく</span></label>'
         + '</div><div class="rep"><div class="bub">'+esc(buildReport(ui.fmt))+'</div></div>'
         + '<div class="future"><b>本番になったら</b>'
         + '<div class="r"><span>1 今日のデータ</span><span style="color:var(--sq)">自動・見るだけ</span></div>'
         + '<div class="r"><span>2 在庫を数える</span><span style="color:var(--hand)">数えて入れる</span></div>'
         + '<div class="r"><span>3 差の確認</span><span style="color:var(--muted)">合っていれば出ない</span></div>'
         + '<div class="r"><span>4 レジ金</span><span style="color:var(--hand)">金額を1つ</span></div>'
         + '<div class="r"><span>5 送信</span><span style="color:var(--muted)">タップ</span></div>'
         + '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">'
         + '数える作業はいまと同じ。増えるのは<b>「あるはずの数」と照合できる</b>ことだけです。</div></div>';
    }

    var last = (ui.step === 5);
    h += '<div class="nav">';
    if(ui.step > 1) h += '<button class="ghost" id="prev">もどる</button>';
    h += '<button class="prim" id="next">'+(last?'送信する':'つぎへ')+'</button></div>'
       + '<div class="status" id="status"></div></div>';

    document.getElementById('app').innerHTML = h;
    paint(); wire();
  }

  function setVal(k, v){
    if(k.indexOf('q:')===0){ form.q[k.slice(2)] = v; return; }
    if(k.indexOf('arr:')===0){ form.arr[k.slice(4)] = v; return; }
    if(k.indexOf('fzu:')===0){ form.fzu[k.slice(4)] = v; return; }
    if(k.indexOf('fz:')===0){ form.fz[k.slice(3)] = v; return; }
    if(k.indexOf('ch:')===0){ form.ch[k.slice(3)] = v; return; }
    if(k==='nq0'){ form.newQty[0]=v; return; }
    if(k==='nq1'){ form.newQty[1]=v; return; }
    if(k==='nn0'){ form.newNames[0]=v; return; }
    if(k==='nn1'){ form.newNames[1]=v; return; }
    form[k] = v;
  }
  function getVal(k){
    if(k.indexOf('q:')===0) return form.q[k.slice(2)]||0;
    if(k.indexOf('arr:')===0) return form.arr[k.slice(4)];
    if(k.indexOf('fz:')===0) return form.fz[k.slice(3)];
    if(k.indexOf('ch:')===0) return form.ch[k.slice(3)];
    if(k==='nq0') return form.newQty[0];
    if(k==='nq1') return form.newQty[1];
    return form[k]||0;
  }
  function liveMoney(){
    var theo = state.float + form.cash - form.payout, d = form.counted - theo;
    var a = document.getElementById('theov'); if(a) a.textContent = yen(theo);
    var b = document.getElementById('theosub');
    if(b) b.textContent = '釣銭 '+yen(state.float)+' ＋ 現金売上 '+yen(form.cash)+(form.payout?' − 出金 '+yen(form.payout):'');
    var e = document.getElementById('diffv');
    if(e){ e.textContent = (d===0?'±0':(d>0?'+':'')+d.toLocaleString('ja-JP'));
           e.style.color = d===0?'var(--moss)':'var(--warn)'; }
  }

  function liveCount(){
    var c = compute();
    P.forEach(function(p){
      var r = c[p.k];
      var card = document.querySelector('[data-card="'+p.k+'"]');
      if(card) card.className = 'cnt' + (r.diff===0 ? ' ok' : ' bad');
      var tt = document.querySelector('[data-tot="'+p.k+'"]');
      if(tt) tt.textContent = '数えた合計 ' + r.actual + p.u;
      var df = document.querySelector('[data-dif="'+p.k+'"]');
      if(df){
        df.className = (r.diff===0 ? 'g' : 'r');
        df.textContent = (r.diff===0 ? 'ぴったり' : (r.diff>0?'+':'')+r.diff+p.u);
      }
    });
  }

  function wire(){
    document.querySelectorAll('[data-f]').forEach(function(el){
      el.addEventListener(el.tagName==='SELECT'?'change':'input', function(){
        var k = el.getAttribute('data-f');
        setVal(k, el.type==='number' ? (parseFloat(el.value)||0) : el.value);
        if(el.type==='number') el.classList.toggle('zero', !parseFloat(el.value));
        if(ui.step === 2) liveCount();
        else liveMoney();
      });
    });
    document.querySelectorAll('[data-step]').forEach(function(b){
      b.addEventListener('click', function(){
        var k = b.getAttribute('data-t');
        var v = Math.max(0, getVal(k) + parseInt(b.getAttribute('data-step'),10));
        setVal(k, v);
        var inp = document.querySelector('[data-f="'+k+'"]');
        if(inp){ inp.value = v; inp.classList.toggle('zero', !v); }
      });
    });
    document.querySelectorAll('[data-r]').forEach(function(b){
      b.addEventListener('click', function(){
        var k = b.getAttribute('data-k'), r = b.getAttribute('data-r');
        form.reason[k] = (form.reason[k] === r) ? null : r;
        render();
      });
    });
    var b;
    if((b = document.getElementById('next'))) b.addEventListener('click', function(){
      if(ui.step === 5){ submit(); return; }
      if(ui.step === 2 && diffs().length === 0){ ui.step = 4; } else { ui.step++; }
      ui.msg=''; render();
    });
    if((b = document.getElementById('prev'))) b.addEventListener('click', function(){
      if(ui.step === 4 && diffs().length === 0){ ui.step = 2; } else { ui.step--; }
      ui.msg=''; render();
    });
    if((b = document.getElementById('gear'))) b.addEventListener('click', function(){
      ui.step = (ui.step===0)?1:0; render();
    });
    if((b = document.getElementById('copybtn'))) b.addEventListener('click', copyReport);
    if((b = document.getElementById('applysetup'))) b.addEventListener('click', function(){
      P.forEach(function(p){
        var f = document.querySelector('[data-s="fz_'+p.k+'"]'), g = document.querySelector('[data-s="ch_'+p.k+'"]');
        state.stock[p.k] = {fz: parseFloat(f.value)||0, ch: parseFloat(g.value)||0};
        form.fz[p.k] = form.fzu[p.k]==='b' ? Math.round(state.stock[p.k].fz/p.per) : state.stock[p.k].fz;
        form.ch[p.k] = state.stock[p.k].ch;
      });
      var fl = document.querySelector('[data-s="float"]');
      if(fl) state.float = parseFloat(fl.value)||0;
      ui.msg = '直しました。送信すると保存されます。'; ui.ok = true; ui.step = 1; render();
    });
    document.querySelectorAll('input[name=fmt]').forEach(function(r){
      r.addEventListener('change', function(){ ui.fmt = r.value; render(); });
    });
  }

  function resetForm(){
    P.forEach(function(p){
      form.fz[p.k] = form.fzu[p.k]==='b' ? Math.round(state.stock[p.k].fz/p.per) : state.stock[p.k].fz;
      form.ch[p.k] = state.stock[p.k].ch;
    });
  }

  /* リンク（#d=...）からデータを読む。Squareトークンを使わずに実データを流し込むための入口 */
  function readLink(){
    var h = location.hash || '';
    if(h.indexOf('#d=') !== 0) return null;
    try{
      var b = h.slice(3).replace(/-/g, '+').replace(/_/g, '/');
      while(b.length % 4) b += '=';
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    }catch(e){ return null; }
  }
  function applyLink(d){
    if(d.stock) Object.keys(d.stock).forEach(function(k){
      if(state.stock[k]) state.stock[k] = {fz:Number(d.stock[k].fz)||0, ch:Number(d.stock[k].ch)||0};
    });
    if(typeof d.float === 'number') state.float = d.float;
    if(typeof d.sales === 'number') form.sales = d.sales;
    if(typeof d.cash === 'number') form.cash = d.cash;
    if(d.items) Object.keys(d.items).forEach(function(nm){
      form.q[nm] = d.items[nm];
      var known = MAP.some(function(m){ return m.sq === nm; }) || state.items.indexOf(nm) >= 0;
      if(!known) state.items.push(nm);
    });
    if(d.arrivals) Object.keys(d.arrivals).forEach(function(k){
      if(form.arr[k] !== undefined) form.arr[k] = Number(d.arrivals[k]) || 0;
    });
    resetForm();
    ui.msg = d.note || 'リンクからデータを読み込みました。'; ui.ok = true;
  }

  /* 起動：保存済みの状態を読み、リンクのデータを重ね、そのあとSquareを取りにいく */
  var LINK = readLink();
  render();
  if(STORE.load) STORE.load(function(st){
    if(st && st.stock){ state = st; resetForm(); }
    if(LINK){ applyLink(LINK); render(); if(!STORE.today) return; }
    else render();
    if(!STORE.today) return;
    ui.msg = '今日のデータを取得しています…'; ui.ok = true; paint();
    STORE.today(function(d){
      if(d){
        if(typeof d.sales === 'number') form.sales = d.sales;
        if(typeof d.cash === 'number') form.cash = d.cash;
        if(d.items) Object.keys(d.items).forEach(function(nm){
          form.q[nm] = d.items[nm];
          var known = MAP.some(function(m){return m.sq===nm;}) || state.items.indexOf(nm)>=0;
          if(!known) state.items.push(nm);
        });
        if(d.arrivals) Object.keys(d.arrivals).forEach(function(k){ form.arr[k] = d.arrivals[k]; });
        ui.msg = d.note || '今日のデータが入りました。'; ui.ok = true;
      } else {
        ui.msg = '今日のデータを取得できませんでした。手で入れてください。'; ui.ok = false;
      }
      render();
    }, function(m){ ui.msg = m || '今日のデータを取得できませんでした。手で入れてください。'; ui.ok = false; render(); });
  });
})();