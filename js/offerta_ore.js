/*
 * CALENDARIO v4 — «Carica offerta Excel»: dalle voci dell'offerta alle ore per capitolo.
 * ------------------------------------------------------------------------------------
 * Usa:
 *   - SheetJS 0.20.3 in locale (lib/xlsx-0.20.3.full.min.js, window.XLSX)
 *   - la copia NON modificata del lettore del Preventivatore (js/importa_offerta.js, window.CTImporta)
 * Questo file contiene SOLO le aggiunte del Calendario: la copia del lettore resta uguale all'originale.
 *
 * Il file Excel non lascia mai il browser: arriva qui come ArrayBuffer letto dal disco dell'utente,
 * niente upload, niente Storage, niente worker. Nessuna scrittura nel database da qui.
 *
 * Regole (Umberto, 2.11.2026):
 *   - ore per voce = quantità (colonna D) × minuti (colonna «TEMPO LAVORO IN MINUTI», di solito Q) / 60
 *   - raggruppate per capitolo dell'offerta, con il totale ore per capitolo
 *   - voci con minuti ma costo cantiere vuoto o 0 (lattonieri esterni) = «esterno - solo tempistica»,
 *     mostrate a parte e NON spuntate di partenza
 *   - avviso (mai blocco) se una voce ha quantità o minuti vuoti
 * Le colonne si riconoscono dal titolo come fa il lettore (le offerte vecchie hanno colonne spostate).
 */
(function (root) {
  'use strict'

  var MAX_BYTE = 20 * 1024 * 1024          // un'offerta vera pesa 0.5–3 MB
  var SCRITTA_ESTERNO = 'esterno - solo tempistica'
  var ESTENSIONI = /\.(xlsx|xlsm|xls)$/i

  function arrot2(x) { return Math.round(x * 100) / 100 }
  function numero(x) { return typeof x === 'number' && isFinite(x) }
  function pulisci(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim() }

  // Ore di una voce: D × minuti / 60. Quantità o minuti vuoti → 0 h (con avviso).
  function oreVoce(v) {
    if (!numero(v.q) || !numero(v.minuti)) return 0
    return v.q * v.minuti / 60
  }
  // Esterno: minuti > 0 ma costo cantiere vuoto o 0 (il lettore mette costoCantiereFisso = 0 in quel caso)
  function eEsterna(v) { return numero(v.minuti) && v.minuti > 0 && v.costoCantiereFisso === 0 }

  function nomeCapitolo(c, i) {
    var t = pulisci(c.titolo)
    if (!t) t = 'Capitolo ' + (i + 1) + ' (riga ' + c.rigaTitolo + ')'
    return t.length > 120 ? t.slice(0, 117) + '…' : t
  }

  // Righe con quantità e minuti numerici che il lettore NON dà come voci (es. voce con prezzo H scritto
  // a mano e F «-----»: nell'offerta 3 di prova 2 righe, 2.61 h). Per le ore contano lo stesso:
  // si aggiungono con un avviso. Il lettore resta com'è (copia non modificata).
  function righeNonLette(XLSX, ws, imp) {
    if (!XLSX || !ws || !ws['!ref'] || !imp.colonne || !imp.colonne.minuti) return []
    var lette = new Set((imp.voci || []).map(function (v) { return v.riga }))
    var totali = new Set((imp.capitoli || []).map(function (c) { return c.rigaTotale }))
    var val = function (c, r) { var x = ws[c + r]; return x ? x.v : undefined }
    var fine = Math.min(XLSX.utils.decode_range(ws['!ref']).e.r + 1, 6000)
    var colC = imp.colonne.cantiere, out = []
    for (var r = (imp.par && imp.par.rigaParametri || 1) + 1; r <= fine; r++) {
      if (lette.has(r) || totali.has(r)) continue
      var q = val('D', r), mi = val(imp.colonne.minuti, r)
      if (!numero(q) || !numero(mi)) continue
      var cc = colC ? val(colC, r) : undefined
      var B = pulisci(val('B', r)), F = val('F', r)
      out.push({
        riga: r, codice: val('A', r), descrizione: B, unita: val('C', r) || '', q: q, minuti: mi,
        costoCantiereFisso: numero(cc) ? cc : 0, eventuale: /^eventual/i.test(B),
        regolaF: { tipo: typeof F === 'string' && /-{3,}/.test(F) ? 'incluso' : 'altro' }, nonLetta: true
      })
    }
    return out
  }

  // Dal risultato del lettore (importaFoglio) alla vista del Calendario.
  // XLSX e ws (foglio OFFERTA) servono solo per le righe non lette dal lettore (vedi sopra).
  function analizza(imp, XLSX, ws) {
    var capitoli = [], voci = []
    var inCapitolo = new Set()
    var extra = righeNonLette(XLSX, ws, imp)
    function voceDa(v, capId) {
      var ore = oreVoce(v)
      var esterno = eEsterna(v)
      var avvisi = []
      var qVuota = !numero(v.q) || v.q === 0
      var mVuoti = !numero(v.minuti)
      if (qVuota) {
        var aCorpo = v.regolaF && /^(ceilingH|mroundH)$/.test(v.regolaF.tipo)
        var conUno = numero(v.minuti) && v.minuti > 0 ? arrot2(v.minuti / 60) : 0
        avvisi.push('Quantità vuota: 0 h' + (conUno ? ' (con quantità 1 sarebbero ' + conUno + ' h' + (aCorpo ? ', voce «a corpo»' : '') + ')' : ''))
      }
      if (mVuoti) avvisi.push('Minuti vuoti: 0 h')
      if (v.nonLetta) avvisi.push('Riga con prezzo scritto a mano, non letta dal Preventivatore: presa solo per le ore')
      var x = {
        id: 'v' + v.riga, riga: v.riga, codice: v.codice == null ? '' : pulisci(v.codice),
        testo: pulisci(v.descrizione), unita: pulisci(v.unita), q: numero(v.q) ? v.q : null,
        minuti: numero(v.minuti) ? v.minuti : null, ore: ore, esterno: esterno,
        eventuale: !!v.eventuale, incluso: !!(v.regolaF && v.regolaF.tipo === 'incluso' && !v.eventuale),
        avvisi: avvisi, capId: capId, nonLetta: !!v.nonLetta
      }
      // spuntata di partenza: interna, con ore, non eventuale
      x.sceltaIniziale = ore > 0 && !esterno && !x.eventuale
      voci.push(x)
      return x
    }
    var usate = new Set()
    ;(imp.capitoli || []).forEach(function (c, i) {
      var cap = { id: 'c' + i, titolo: nomeCapitolo(c, i), riga: c.rigaTitolo, voci: [] }
      var proprie = c.voci.slice()
      extra.forEach(function (e) { if (!usate.has(e) && e.riga >= c.rigaTitolo && e.riga <= c.rigaFine) { usate.add(e); proprie.push(e) } })
      proprie.sort(function (a, b) { return a.riga - b.riga })
      proprie.forEach(function (v) { inCapitolo.add(v); cap.voci.push(voceDa(v, cap.id)) })
      capitoli.push(cap)
    })
    // voci fuori da ogni totale di capitolo (nelle 5 offerte di prova non ce ne sono)
    var fuori = (imp.voci || []).concat(extra).filter(function (v) { return !inCapitolo.has(v) })
    fuori.sort(function (a, b) { return a.riga - b.riga })
    if (fuori.length) {
      var capF = { id: 'c' + capitoli.length, titolo: 'Voci fuori capitolo', riga: fuori[0].riga, voci: [], fuoriCapitolo: true }
      fuori.forEach(function (v) { capF.voci.push(voceDa(v, capF.id)) })
      capitoli.push(capF)
    }
    capitoli.forEach(function (cap) {
      cap.oreInterne = cap.voci.reduce(function (s, v) { return s + (v.esterno ? 0 : v.ore) }, 0)
      cap.oreEsterne = cap.voci.reduce(function (s, v) { return s + (v.esterno ? v.ore : 0) }, 0)
      cap.nEsterne = cap.voci.filter(function (v) { return v.esterno }).length
      cap.nInterne = cap.voci.length - cap.nEsterne
    })
    var col = imp.colonne || {}
    return {
      tipo: imp.tipo,
      colonne: { quantita: 'D', minuti: col.minuti || null, cantiere: col.cantiere || null },
      colonneSpostate: col.minuti !== 'Q' || col.cantiere !== 'P',
      capitoli: capitoli, voci: voci,
      oreInterne: capitoli.reduce(function (s, c) { return s + c.oreInterne }, 0),
      oreEsterne: capitoli.reduce(function (s, c) { return s + c.oreEsterne }, 0),
      nAvvisi: voci.filter(function (v) { return v.avvisi.length }).length,
      nEsterne: voci.filter(function (v) { return v.esterno }).length
    }
  }

  // Scelte → capitoli da creare in pl_capitoli (nome, ore arrotondate ai centesimi, All'aperto).
  // scelte: oggetto { idVoce: true/false }. Capitoli interni prima, poi quelli esterni.
  function proponiCapitoli(analisi, scelte) {
    var nuovi = [], saltati = []
    function somma(cap, esterno) {
      return cap.voci.reduce(function (s, v) { return s + (v.esterno === esterno && scelte[v.id] ? v.ore : 0) }, 0)
    }
    function aggiungi(nome, ore, esterno, nVoci) {
      var o = arrot2(ore)
      if (o > 0) nuovi.push({ nome: nome, ore: o, ubicazione: 'All\'aperto', esterno: esterno, nVoci: nVoci })
      else saltati.push({ nome: nome, motivo: 'meno di 0.01 h' })
    }
    analisi.capitoli.forEach(function (cap) {
      var n = cap.voci.filter(function (v) { return !v.esterno && scelte[v.id] }).length
      if (n) aggiungi(cap.titolo, somma(cap, false), false, n)
    })
    analisi.capitoli.forEach(function (cap) {
      var n = cap.voci.filter(function (v) { return v.esterno && scelte[v.id] }).length
      if (n) aggiungi(cap.titolo + ' (' + SCRITTA_ESTERNO + ')', somma(cap, true), true, n)
    })
    // voci spuntate con 0 h non creano niente: le dice l'anteprima
    var totale = arrot2(nuovi.reduce(function (s, x) { return s + x.ore }, 0))
    return { nuovi: nuovi, saltati: saltati, totale: totale }
  }

  function scelteIniziali(analisi) {
    var s = {}
    analisi.voci.forEach(function (v) { s[v.id] = v.sceltaIniziale })
    return s
  }

  // Lettura del file (ArrayBuffer o Uint8Array). Ritorna { ok, messaggio } oppure { ok: true, analisi, avvisi }.
  // XLSX = SheetJS, Importa = lettore (CTImporta). Niente rete: tutto in memoria.
  function leggiOfferta(XLSX, Importa, dati, nomeFile, dimensione) {
    var avvisi = []
    if (!XLSX || !Importa) return { ok: false, messaggio: 'Lettore Excel non caricato: ricarica la pagina con Ctrl+F5.' }
    if (dimensione != null && dimensione > MAX_BYTE) return { ok: false, messaggio: 'File troppo grande (' + Math.round(dimensione / 1048576) + ' MB): un\'offerta pesa di solito meno di 5 MB.' }
    if (nomeFile && !ESTENSIONI.test(nomeFile)) return { ok: false, messaggio: 'Il file «' + nomeFile + '» non è un file Excel (.xlsx, .xlsm o .xls).' }
    var nomi, wb
    try {
      nomi = XLSX.read(dati, { type: 'array', bookSheets: true }).SheetNames || []
    } catch (e) {
      return { ok: false, messaggio: 'Il file non si apre come Excel (' + pulisci(e && e.message).slice(0, 120) + ').' }
    }
    var foglio = nomi.find(function (n) { return n === 'OFFERTA' }) || nomi.find(function (n) { return /^\s*offerta\s*$/i.test(n) })
    if (!foglio) return { ok: false, messaggio: 'Non è un\'offerta riconosciuta: nel file manca il foglio «OFFERTA».' }
    try {
      wb = XLSX.read(dati, { type: 'array', cellFormula: true, sheets: [foglio] })
    } catch (e) {
      return { ok: false, messaggio: 'Il foglio «OFFERTA» non si legge (' + pulisci(e && e.message).slice(0, 120) + ').' }
    }
    var imp
    try { imp = Importa.importaFoglio(XLSX, wb, foglio) } catch (e) {
      return { ok: false, messaggio: 'Non è un\'offerta riconosciuta: ' + pulisci(e && e.message) + '.' }
    }
    if (!imp.colonne || !imp.colonne.minuti) return { ok: false, messaggio: 'Non è un\'offerta riconosciuta: manca la colonna «TEMPO LAVORO IN MINUTI».' }
    if (!imp.capitoli || !imp.capitoli.length) return { ok: false, messaggio: 'Non è un\'offerta riconosciuta: nessun capitolo trovato (nessuna riga «somma del capitolo» nella colonna F).' }
    var a = analizza(imp, XLSX, wb.Sheets[foglio])
    if (imp.tipo === 'catalogo') avvisi.push('Sembra un catalogo, non un\'offerta: più della metà delle voci non ha la quantità.')
    if (!a.colonne.cantiere) avvisi.push('Colonna «COSTO CHF CANTIERE» non trovata: nessuna voce si può riconoscere come esterna.')
    if (a.colonneSpostate) avvisi.push('Colonne riconosciute dal titolo: minuti in ' + a.colonne.minuti + ', costo cantiere in ' + (a.colonne.cantiere || '—') + ' (offerta con colonne spostate).')
    if (!(a.oreInterne + a.oreEsterne > 0)) avvisi.push('Nessuna voce con quantità e minuti: le ore sono 0.')
    return { ok: true, analisi: a, avvisi: avvisi, foglio: foglio }
  }

  var API = {
    SCRITTA_ESTERNO: SCRITTA_ESTERNO, MAX_BYTE: MAX_BYTE,
    oreVoce: oreVoce, eEsterna: eEsterna, analizza: analizza, proponiCapitoli: proponiCapitoli,
    scelteIniziali: scelteIniziali, leggiOfferta: leggiOfferta, arrot2: arrot2
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API
  else root.CTOffertaOre = API
})(typeof window !== 'undefined' ? window : globalThis)
