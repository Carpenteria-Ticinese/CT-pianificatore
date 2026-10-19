/* Pianificatore cantieri — configurazione
   Stesso progetto Supabase delle altre app (App Cantieri, Pre-contabilità).
   La chiave "publishable" è pubblica per definizione: la protezione vera sono
   le policy RLS sulle tabelle pl_ (vedi sql/da_applicare/PL_01_tabelle.sql). */
var PL_CONFIG = {
  VERSIONE: '2',
  SUPABASE_URL: 'https://wgidgbauhivdctdxfjnk.supabase.co',
  SUPABASE_KEY: 'sb_publishable_Ke7MTQGHPYVXvKInfOrUQQ_Ys6qKJvD',
  RUOLI_AMMESSI: ['titolare', 'responsabile'],
  NUMERO_MAGAZZINO: '00-000'
}
