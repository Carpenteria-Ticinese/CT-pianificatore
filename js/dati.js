/* ═══════════════════════════════════════════════════════════════════════════
   Pianificatore cantieri — ACCESSO AI DATI (Supabase)

   LA TRAPPOLA (già pagata in un'altra app): con RLS un accesso negato NON dà
   errore, restituisce zero righe in silenzio. Quindi:
   - ogni lettura e scrittura controlla PRIMA che la sessione esista; senza
     sessione si lancia SessioneAssente e l'app mostra il login, mai un elenco
     vuoto che sembra "tutto a posto";
   - ogni scrittura chiede indietro le righe (.select()): zero righe = NON salvato;
   - all'avvio pl_puo_pianificare() deve dire true e pl_impostazioni deve dare
     1 riga: se no, schermata di errore, non un piano vuoto.

   operai: si leggono SOLO id, nome, cognome, email, attivo, data_fine_rapporto
   (l'email serve solo a riconoscere il titolare fra gli operai).
   Nessun dato di paga viene letto o mostrato.
   ═══════════════════════════════════════════════════════════════════════════ */
var PLD = (function () {
  'use strict'
  var sb = window.supabase.createClient(PL_CONFIG.SUPABASE_URL, PL_CONFIG.SUPABASE_KEY)

  function SessioneAssente(msg) {
    var e = new Error(msg || 'Sessione assente: entra di nuovo.')
    e.sessioneAssente = true
    return e
  }
  function errore(cosa, e) {
    var m = (e && (e.message || e.details || e.hint)) || String(e)
    var x = new Error(cosa + ': ' + m)
    x.originale = e
    if (e && /JWT|token|not authenticated|401/i.test(m)) x.sessioneAssente = true
    return x
  }

  async function sessione() {
    try { return (await sb.auth.getSession()).data.session || null } catch (_) { return null }
  }
  async function richiediSessione() {
    var s = await sessione()
    if (!s || !s.user) throw SessioneAssente()
    return s
  }

  async function entra(email, password) {
    var r = await sb.auth.signInWithPassword({ email: email, password: password })
    if (r.error) throw errore('Accesso non riuscito', r.error)
    return r.data.session
  }
  async function esci() { try { await sb.auth.signOut() } catch (_) {} }

  // Controllo d'accesso lato server. Restituisce { ok, motivo }.
  async function controllaAccesso() {
    var s = await richiediSessione()
    var r = await sb.rpc('pl_puo_pianificare')
    if (r.error) {
      if (/function|does not exist|not found|404|PGRST202/i.test(r.error.message + ' ' + (r.error.code || ''))) {
        return { ok: false, motivo: 'sql', dettaglio: r.error.message }
      }
      throw errore('Controllo accesso', r.error)
    }
    if (r.data !== true) return { ok: false, motivo: 'ruolo' }
    var p = await sb.from('profili').select('id,nome,ruolo').eq('id', s.user.id).maybeSingle()
    return { ok: true, profilo: p.data || { id: s.user.id, nome: s.user.email, ruolo: '' }, email: s.user.email }
  }

  // Lettura completa, a pagine da 1000 righe (il limite di Supabase)
  async function leggi(tabella, colonne, ordine, filtro) {
    await richiediSessione()
    var tutte = [], da = 0, PAG = 1000
    for (;;) {
      var q = sb.from(tabella).select(colonne || '*')
      if (filtro) q = filtro(q)
      if (ordine) ordine.split(',').forEach(function (o) { q = q.order(o.trim()) })
      var r = await q.range(da, da + PAG - 1)
      if (r.error) throw errore('Lettura ' + tabella, r.error)
      tutte = tutte.concat(r.data || [])
      if (!r.data || r.data.length < PAG) break
      da += PAG
    }
    return tutte
  }

  async function inserisci(tabella, righe) {
    await richiediSessione()
    if (!Array.isArray(righe)) righe = [righe]
    if (!righe.length) return []
    var r = await sb.from(tabella).insert(righe).select()
    if (r.error) throw errore('Salvataggio ' + tabella, r.error)
    if (!r.data || r.data.length !== righe.length) {
      throw new Error('Salvataggio ' + tabella + ' NON riuscito: il database ha salvato ' + ((r.data && r.data.length) || 0) + ' righe su ' + righe.length + '. Esci, rientra e riprova.')
    }
    return r.data
  }
  async function aggiorna(tabella, id, campi, colonnaId) {
    await richiediSessione()
    var r = await sb.from(tabella).update(campi).eq(colonnaId || 'id', id).select()
    if (r.error) throw errore('Modifica ' + tabella, r.error)
    if (!r.data || !r.data.length) throw new Error('Modifica ' + tabella + ' NON salvata dal database (0 righe). Esci, rientra e riprova.')
    return r.data[0]
  }
  async function salvaUpsert(tabella, righe, conflitto) {
    await richiediSessione()
    if (!Array.isArray(righe)) righe = [righe]
    var r = await sb.from(tabella).upsert(righe, { onConflict: conflitto }).select()
    if (r.error) throw errore('Salvataggio ' + tabella, r.error)
    if (!r.data || r.data.length !== righe.length) throw new Error('Salvataggio ' + tabella + ' NON riuscito (righe salvate: ' + ((r.data && r.data.length) || 0) + ').')
    return r.data
  }
  // Cancella per id; attesi = quante righe ci si aspetta
  async function eliminaId(tabella, ids, colonnaId) {
    await richiediSessione()
    if (!Array.isArray(ids)) ids = [ids]
    if (!ids.length) return 0
    var tot = 0
    for (var i = 0; i < ids.length; i += 200) {
      var pezzo = ids.slice(i, i + 200)
      var r = await sb.from(tabella).delete().in(colonnaId || 'id', pezzo).select(colonnaId || 'id')
      if (r.error) throw errore('Cancellazione ' + tabella, r.error)
      tot += (r.data || []).length
    }
    if (tot !== ids.length) throw new Error('Cancellazione ' + tabella + ': tolte ' + tot + ' righe su ' + ids.length + '. Ricarica la pagina e controlla.')
    return tot
  }

  // Tutto quello che serve al piano, in una volta
  async function caricaTutto() {
    var risultati = await Promise.all([
      leggi('pl_impostazioni', '*'),
      leggi('pl_periodi_inverno', '*', 'anno'),
      leggi('pl_festivi', '*', 'data'),
      leggi('pl_chiusure', '*', 'dal'),
      leggi('pl_assenze', '*', 'dal'),
      leggi('pl_commesse', '*', 'numero'),
      leggi('pl_capitoli', '*', 'commessa_id,ordine'),
      leggi('pl_assegnazioni', '*', 'data,posizione'),
      leggi('pl_assegnazioni_previste', '*', 'data'),
      leggi('pl_meteo_normali', '*', 'stazione,mese'),
      leggi('pl_avvisi_ignorati', 'chiave'),
      leggi('operai', 'id,nome,cognome,email,attivo,data_fine_rapporto', 'cognome'),
      leggi('cantieri', 'id,nome,via,cap,citta,stato', 'nome'),
      leggi('profili', 'id,nome,ruolo', 'nome')
    ])
    // Canarino: le impostazioni sono UNA riga sempre. Zero righe = RLS che nega
    // in silenzio (o SQL non applicato): non si mostra un piano vuoto.
    if (risultati[0].length !== 1) {
      throw new Error('Impostazioni non leggibili (' + risultati[0].length + ' righe invece di 1). ' +
        'Il database non dà i dati a questo utente, oppure lo SQL PL_01 non è stato applicato. Il piano NON è attendibile.')
    }
    return {
      imp: risultati[0][0], periodi: risultati[1], festivi: risultati[2], chiusure: risultati[3],
      assenze: risultati[4], commesse: risultati[5], capitoli: risultati[6], assegnazioni: risultati[7],
      previste: risultati[8], meteo: risultati[9], ignorati: risultati[10].map(function (r) { return r.chiave }),
      operai: risultati[11], cantieri: risultati[12], profili: risultati[13]
    }
  }

  return {
    sb: sb, sessione: sessione, richiediSessione: richiediSessione, entra: entra, esci: esci,
    controllaAccesso: controllaAccesso, leggi: leggi, inserisci: inserisci, aggiorna: aggiorna,
    salvaUpsert: salvaUpsert, eliminaId: eliminaId, caricaTutto: caricaTutto
  }
})()
