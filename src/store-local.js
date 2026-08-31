/* ------------------------------------------------------------------
   STORE（デモ版）: この端末のブラウザだけに保存します。
   GitHub Pages で公開しているお試し用。共有はされません。
   ------------------------------------------------------------------ */
var STORE = (function(){
  var KEY = 'lebois-nippo-v5';
  function seed(){
    try { return JSON.parse(document.getElementById('state').textContent); }
    catch(e){ return null; }
  }
  return {
    load: function(cb){
      var st = null;
      try { var raw = localStorage.getItem(KEY); if(raw) st = JSON.parse(raw); } catch(e){}
      cb(st || seed());
    },
    save: function(state, entry, ok, ng){
      try { localStorage.setItem(KEY, JSON.stringify(state)); ok(); }
      catch(e){ ng('このブラウザでは保存できませんでした（プライベートモードなど）。報告文はコピーして使えます。'); }
    },
    reset: function(){ try { localStorage.removeItem(KEY); } catch(e){} location.reload(); }
    /* today は未実装：デモ版は手入力 */
  };
})();
