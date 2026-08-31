/* ------------------------------------------------------------------
   STORE（本番版）: Google Apps Script 経由でスプレッドシートに読み書きします。
   Code.gs の getState / submitDay / getToday を呼びます。
   ------------------------------------------------------------------ */
var STORE = (function(){
  function run(){ return google.script.run; }
  return {
    load: function(cb){
      run().withSuccessHandler(function(st){ cb(st); })
           .withFailureHandler(function(){ cb(null); })
           .getState();
    },
    save: function(state, entry, ok, ng){
      run().withSuccessHandler(function(res){
              if(res && res.ok) ok();
              else ng((res && res.message) || '保存できませんでした。');
            })
           .withFailureHandler(function(err){ ng('保存できませんでした：' + (err && err.message || '')); })
           .submitDay(entry);
    },
    today: function(ok, ng){
      run().withSuccessHandler(function(d){ ok(d); })
           .withFailureHandler(function(err){ ng('Squareから取得できませんでした：' + (err && err.message || '')); })
           .getToday();
    }
  };
})();
