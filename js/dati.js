/* ═══════════════════════════════════════════════════════════════════════════
   Calendario (pianificatore cantieri) — ACCESSO AI DATI (Supabase)

   LA TRAPPOLA (già pagata in un'altra app): con RLS un accesso negato NON dà
   errore, restituisce zero righe in silenzio. Quindi:
   - ogni lettura e scrittura controlla PRIMA che la sessione esista; senza
     sessione si lancia SessioneAssente e l'app mostra il login, mai un elenco
     vuoto che sembra "tutto a posto";
   - ogni scrittura chiede indietro le righe (.select()): zero righe = NON salvato;
   - all'avvio pl_puo_pianificare() deve dire true e pl_impostazioni deve dare
     1 riga: se no, schermata di errore, non un piano vuoto.

   operai: si leggono SOLO id, nome, cognome, email, user_id, attivo,
   data_fine_rapporto, rapporto, ditta_id (email e user_id servono solo a
   riconoscere il titolare). Nessun dato di paga viene letto o mostrato.
   v6: rapporto 'dipendente' | 'esterno'; per gli Esterni si legge il NOME della
   ditta da tm_contatti (Anagrafiche): id, ragione_sociale, nome, cognome, solo
   per gli id usati. Il Calendario non scrive mai operai né tm_contatti.
   cantieri (= commesse di Anagrafiche): si LEGGONO id, nome, numero_commessa,
   stato_commessa, tipo, indirizzo. Il Calendario non scrive mai cantieri né operai.
   v14 («📋 Elenco»): anche il cliente, cantieri.cliente_id + committente (copia del nome
   scritta da Anagrafiche); il nome del contatto da tm_contatti (id, ragione_sociale, nome,
   cognome), solo per gli id usati. Colonne mancanti → si legge come la v13, senza cliente.
   v15: anche stato_nota, richiamo_il, periodo_previsto, mese_inizio_previsto (SQL ANAG_12); il vecchio cantieri.stato NON si legge più.
   Lo stato si cambia SOLO con rpc('anag_commessa_cambia_stato'): mai un update su cantieri.
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

  var COLONNE_OPERAI = 'id,nome,cognome,email,user_id,attivo,data_fine_rapporto,rapporto,ditta_id'
  var COLONNE_OPERAI_V5 = 'id,nome,cognome,email,user_id,attivo,data_fine_rapporto'
  var COLONNE_DITTE = 'id,ragione_sociale,nome,cognome'
  var TESTO_SENZA_RAPPORTO = 'Nel database manca la colonna «rapporto» delle persone (SQL di Anagrafiche ANAG_F2_01): ' +
    'tutte le persone sono trattate come Dipendenti e il gruppo «Esterni» non si vede.'

  // Colonna che non esiste (42703 da Postgres, PGRST204 / messaggio da PostgREST)
  function colonnaMancante(e) {
    var o = (e && e.originale) || e || {}
    var t = (o.code || '') + ' ' + (o.message || '') + ' ' + (e && e.message || '')
    return /42703|PGRST204/.test(t) || /column .*(rapporto|ditta_id|committente|cliente_id|stato_nota|richiamo_il|periodo_previsto|mese_inizio_previsto).* does not exist/i.test(t)
  }

  // Persone con rapporto e ditta. Se la colonna rapporto manca: si leggono come
  // prima e si dice perché (mai un elenco vuoto muto). { operai, senzaRapporto }
  async function leggiOperai() {
    try {
      return { operai: await leggi('operai', COLONNE_OPERAI, 'cognome'), senzaRapporto: null }
    } catch (e) {
      if (e && e.sessioneAssente) throw e
      if (!colonnaMancante(e)) throw e
      var vecchi = await leggi('operai', COLONNE_OPERAI_V5, 'cognome')
      vecchi.forEach(function (o) { o.rapporto = 'dipendente'; o.ditta_id = null })
      return { operai: vecchi, senzaRapporto: TESTO_SENZA_RAPPORTO }
    }
  }

  // Nomi delle ditte degli Esterni. { ditte: { id: riga } | null, errore: testo | null }
  // Righe mancanti (RLS che nega in silenzio) = «ditta non leggibile» nell'app, mai vuoto.
  async function leggiDitte(operai) {
    var ids = []
    ;(operai || []).forEach(function (o) { if (o.rapporto === 'esterno' && o.ditta_id && ids.indexOf(o.ditta_id) < 0) ids.push(o.ditta_id) })
    if (!ids.length) return { ditte: {}, errore: null }
    try {
      var righe = []
      for (var i = 0; i < ids.length; i += 200) {
        var pezzo = ids.slice(i, i + 200)
        righe = righe.concat(await leggi('tm_contatti', COLONNE_DITTE, null, function (q) { return q.in('id', pezzo) }))
      }
      var ditte = {}
      righe.forEach(function (r) { ditte[r.id] = r })
      var mancano = ids.filter(function (id) { return !ditte[id] }).length
      return { ditte: ditte, errore: mancano ? 'Nomi delle ditte non leggibili per ' + mancano + (mancano === 1 ? ' ditta' : ' ditte') + ' (il database non li dà a questo utente).' : null }
    } catch (e) {
      if (e && e.sessioneAssente) throw e
      return { ditte: null, errore: 'Nomi delle ditte non leggibili: ' + ((e && e.message) || e) }
    }
  }
  // v15 (Umberto 10.11): lo stato della commessa è UNO solo, stato_commessa (7 parole). Il vecchio cantieri.stato
  // (Attivo / In pausa / Completato) non si legge più: non compare e non decide niente.
  var COLONNE_CANTIERI_V13 = 'id,nome,numero_commessa,stato_commessa,tipo,via,cap,citta,luogo'
  // Gruppi di colonne che possono mancare (database più vecchio): si leggono se ci sono, se no si va avanti senza.
  //   cliente (v14) · nota = stato_nota + richiamo_il (ANAG_12) · periodo = periodo_previsto + mese_inizio_previsto (ANAG_12)
  var GRUPPI_FACOLTATIVI = [
    { nome: 'cliente', colonne: ',committente,cliente_id', re: /committente|cliente_id/i },
    { nome: 'nota', colonne: ',stato_nota,richiamo_il', re: /stato_nota|richiamo_il/i },
    { nome: 'periodo', colonne: ',periodo_previsto,mese_inizio_previsto', re: /periodo_previsto|mese_inizio_previsto/i }
  ]
  var COLONNE_CANTIERI = COLONNE_CANTIERI_V13 + GRUPPI_FACOLTATIVI.map(function (g) { return g.colonne }).join('')
  var TESTO_SENZA_CLIENTE = 'Nel database mancano le colonne del cliente delle commesse (cantieri.cliente_id / committente): nell’Elenco il cliente non si vede.'

  // v14/v15: commesse di Anagrafiche con cliente, nota dello stato e periodo previsto. Colonna mancante (42703):
  // si toglie il gruppo di quella colonna (se il messaggio non la nomina: prima periodo, poi nota, poi cliente)
  // e si rilegge. { cantieri, senzaCliente (testo|null), senzaNota, senzaPeriodo }
  async function leggiCantieri() {
    var attivi = GRUPPI_FACOLTATIVI.slice()
    for (;;) {
      try {
        var righe = await leggi('cantieri', COLONNE_CANTIERI_V13 + attivi.map(function (g) { return g.colonne }).join(''), 'nome')
        var c = function (n) { return !attivi.some(function (g) { return g.nome === n }) }
        return { cantieri: righe, senzaCliente: c('cliente') ? TESTO_SENZA_CLIENTE : null, senzaNota: c('nota'), senzaPeriodo: c('periodo') }
      } catch (e) {
        if (e && e.sessioneAssente) throw e
        if (!colonnaMancante(e) || !attivi.length) throw e
        var t = ((e.originale && e.originale.message) || '') + ' ' + (e.message || '')
        var g = attivi.filter(function (x) { return x.re.test(t) })[0] || attivi[attivi.length - 1]
        attivi = attivi.filter(function (x) { return x !== g })
      }
    }
  }

  // v15 · cambio dello stato della commessa: SOLO con la funzione di Anagrafiche (la tabella cantieri non è nostra).
  // → { ok: true, data } | { ok: false, errore: { code, message } } (la traduzione in italiano è in calcoli.js)
  async function cambiaStatoCommessa(parametri) {
    await richiediSessione()
    var r
    try { r = await sb.rpc('anag_commessa_cambia_stato', parametri) } catch (e) { return { ok: false, errore: { code: '', message: (e && e.message) || String(e) } } }
    if (r.error) return { ok: false, errore: r.error }
    return { ok: true, data: r.data }
  }
  // v14: nomi dei clienti (tm_contatti), solo per i cliente_id usati. { clienti: { id: riga } | null, errore }
  // Righe mancanti (RLS che nega in silenzio) = «cliente non leggibile» nell'Elenco, mai vuoto.
  async function leggiClienti(cantieri) {
    var ids = []
    ;(cantieri || []).forEach(function (k) { if (k.cliente_id && ids.indexOf(k.cliente_id) < 0) ids.push(k.cliente_id) })
    if (!ids.length) return { clienti: {}, errore: null }
    try {
      var righe = []
      for (var i = 0; i < ids.length; i += 200) {
        var pezzo = ids.slice(i, i + 200)
        righe = righe.concat(await leggi('tm_contatti', COLONNE_DITTE, null, function (q) { return q.in('id', pezzo) }))
      }
      var clienti = {}
      righe.forEach(function (r) { clienti[r.id] = r })
      var mancano = ids.filter(function (id) { return !clienti[id] }).length
      return { clienti: clienti, errore: mancano ? 'Nomi dei clienti non leggibili per ' + mancano + (mancano === 1 ? ' contatto' : ' contatti') + ' (il database non li dà a questo utente).' : null }
    } catch (e) {
      if (e && e.sessioneAssente) throw e
      return { clienti: null, errore: 'Nomi dei clienti non leggibili: ' + ((e && e.message) || e) }
    }
  }

  // Versione dello schema pl_ nel database: 2 = PL_02 applicato (commesse da
  // Anagrafiche). Se la funzione manca → 1 (solo PL_01): l'app funziona, ma
  // «Pianifica commessa» dice che manca l'SQL.
  async function versioneDb() {
    await richiediSessione()
    var r = await sb.rpc('pl_versione_db')
    if (r.error) {
      if (/function|does not exist|not found|404|PGRST202/i.test(r.error.message + ' ' + (r.error.code || ''))) return 1
      throw errore('Controllo versione del database', r.error)
    }
    return Number(r.data) || 1
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
      leggiOperai(),
      leggiCantieri(),
      leggi('profili', 'id,nome,ruolo', 'nome'),
      versioneDb()
    ])
    // Canarino: le impostazioni sono UNA riga sempre. Zero righe = RLS che nega
    // in silenzio (o SQL non applicato): non si mostra un piano vuoto.
    if (risultati[0].length !== 1) {
      throw new Error('Impostazioni non leggibili (' + risultati[0].length + ' righe invece di 1). ' +
        'Il database non dà i dati a questo utente, oppure lo SQL PL_01 non è stato applicato. Il piano NON è attendibile.')
    }
    // Zero commesse di Anagrafiche mentre il piano ne ha di collegate = lettura negata
    // in silenzio: errore, non un piano con i nomi sbagliati.
    var ca = risultati[12]
    if (!ca.cantieri.length && risultati[5].some(function (c) { return c.cantiere_id })) {
      throw new Error('Commesse di Anagrafiche non leggibili (0 righe dalla tabella cantieri, ma il piano ne usa). Il piano NON è attendibile.')
    }
    var op = risultati[11]
    var di = await leggiDitte(op.operai)
    var cl = await leggiClienti(ca.cantieri)
    return {
      versioneDb: risultati[14],
      senzaCliente: ca.senzaCliente, senzaNota: ca.senzaNota, senzaPeriodo: ca.senzaPeriodo, clienti: cl.clienti, erroreClienti: cl.errore,
      senzaRapporto: op.senzaRapporto, ditte: di.ditte, erroreDitte: di.errore,
      imp: risultati[0][0], periodi: risultati[1], festivi: risultati[2], chiusure: risultati[3],
      assenze: risultati[4], commesse: risultati[5], capitoli: risultati[6], assegnazioni: risultati[7],
      previste: risultati[8], meteo: risultati[9], ignorati: risultati[10].map(function (r) { return r.chiave }),
      operai: op.operai, cantieri: ca.cantieri, profili: risultati[13]
    }
  }

  return {
    sb: sb, sessione: sessione, richiediSessione: richiediSessione, entra: entra, esci: esci,
    controllaAccesso: controllaAccesso, leggi: leggi, inserisci: inserisci, aggiorna: aggiorna,
    salvaUpsert: salvaUpsert, eliminaId: eliminaId, caricaTutto: caricaTutto, versioneDb: versioneDb,
    leggiOperai: leggiOperai, leggiDitte: leggiDitte, colonnaMancante: colonnaMancante,
    leggiCantieri: leggiCantieri, leggiClienti: leggiClienti, cambiaStatoCommessa: cambiaStatoCommessa,
    COLONNE_OPERAI: COLONNE_OPERAI, COLONNE_CANTIERI: COLONNE_CANTIERI
  }
})()
