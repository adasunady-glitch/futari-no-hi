// Supabase の設定。空のままならデモモード（この端末だけに保存）で動く。
// anon key は公開前提の鍵で、データはデータベース側の権限設定（RLS）で守られる。
// service_role key は絶対にここへ書かないこと。
export const config = {
  supabaseUrl: 'https://yclsxbxtjhrezbtccczk.supabase.co',
  supabaseAnonKey: 'sb_publishable_W_l7xFEBS-_L7VeSgoGSgQ_8GwVqeVc',
};
