/* le bois スタッフアプリ — 接続先
 *
 * supabaseUrl と anonKey が空のあいだは「お試しモード」で動く（記録はその端末だけに残る）。
 * Supabase の Project Settings → API にある Project URL と anon public key を入れると本番になる。
 * anonKey は公開してよい鍵（publishable key）。表には直接さわれず、ログインの番号を確かめる関数だけ呼べる（schema.sql）。
 */
window.LB_CONFIG = {
  store: "lebois",
  supabaseUrl: "https://vedljpcvxchneazuoguo.supabase.co",
  anonKey: "sb_publishable_byKaWl2cyzwg1gA-QyfEoQ_mPF9N-1e",
  /* シフト（シフト連携の Apps Script・ウェブアプリURL）。空ならシフトは出さない */
  shiftUrl: "https://script.google.com/macros/s/AKfycbysQ3EqqvZwUHXrlHXeKUbZfw8I9nZ3J0egbD7p3kDu0eOSCQ0aWFleG0iv3fIQhKA/exec",
  /* 打刻（勤怠取込の Apps Script・「全員」デプロイ）。ログイン確認のうえ freee に打刻を登録する */
  punchUrl: "https://script.google.com/macros/s/AKfycbycJWjckVLoJAhH7svkzOYbwxZMz1qcGtIgFBPfe9ZdUduyI9XhzoDfmk8oN5JV6FQ/exec",
  /* 日報（Apps Script のウェブアプリ・スタッフ用URL） */
  nippoUrl: "https://script.google.com/macros/s/AKfycbzWHRojz5m8SLr7n5PSXRKKZuY6_5wG6_sjsImIf9iq5im3l_BDeoJe5vnDsnjX9oeN/exec"
};
