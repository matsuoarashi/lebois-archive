/* le bois スタッフアプリ — 接続先
 *
 * supabaseUrl と anonKey が空のあいだは「お試しモード」で動く（記録はその端末だけに残る）。
 * Supabase の Project Settings → API にある Project URL と anon public key を入れると本番になる。
 * anon key は公開してよい鍵（読み書きできる範囲は schema.sql の権限で絞ってある）。
 */
window.LB_CONFIG = {
  store: "lebois",
  supabaseUrl: "",
  anonKey: "",
  /* 日報（Apps Script のウェブアプリ・スタッフ用URL） */
  nippoUrl: "https://script.google.com/macros/s/AKfycbzWHRojz5m8SLr7n5PSXRKKZuY6_5wG6_sjsImIf9iq5im3l_BDeoJe5vnDsnjX9oeN/exec"
};
