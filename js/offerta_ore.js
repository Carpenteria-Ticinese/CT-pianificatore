/*
 * CALENDARIO v4–v5 — «Carica offerta Excel»: dalle voci dell'offerta alle ore per capitolo.
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
 *
 * v5 (prova di Umberto sulla v4 e sue decisioni del 2.11.2026):
 *   - tutto quello che sta DOPO il prezzo finale (riga «TOTALE COMPLESSIVO» o, se manca, l'ultimo TOTALE del
 *     riepilogo) non è un capitolo né una voce: acconti, rate, pagamenti, condizioni. Si ignora e l'anteprima
 *     dice quante righe (`fineOfferta`).
 *   - voce «a corpo» = F è un arrotondamento di H della stessa riga (CEILING / MROUND / ARROTONDA.MULTIPLO…)
 *     oppure unità (colonna C) «a corpo»: i minuti sono già il totale → ore = minuti / 60, senza quantità.
 *     Le altre voci restano D × minuti / 60.
 *   - tipo di ore per voce: Cantiere (di base) / Ufficio / Laboratorio, scelto nell'anteprima e ricordato per
 *     codice voce (colonna A) nel browser. Solo le ore Cantiere diventano capitoli in pl_capitoli; Ufficio e
 *     Laboratorio si vedono a parte con il loro totale. Esterno (lattonieri) come nella v4.
 *   - ore laboratorio = colonna «COSTO CHF LABORATORIO» / costo orario laboratorio della riga parametri
 *     (stessa colonna), × D come i minuti (a corpo: senza D). Senza costo orario: avviso e 0 h.
 *     Una voce con minuti e CHF laboratorio ha due ore separate: i minuti nel suo tipo, il laboratorio in Laboratorio.
 *   - nome del capitolo = la scritta della riga del totale (quella che l'Excel mostra nel riepilogo).
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

  // Nome del capitolo: la scritta della riga del totale (B), cioè quella che l'Excel riporta nel riepilogo.
  // Il lettore prende la B della prima riga sommata: nell'offerta 2 di prova la somma parte dalla prima voce
  // (riga 75 «Spalmatura…») e il titolo vero «IMPERMEABILIZZAZIONE…» sta nella riga 73 (B97 = B73).
  function nomeCapitolo(c, i, ws) {
    var bt = ws && ws['B' + c.rigaTotale]
    var t = bt && typeof bt.v === 'string' ? pulisci(bt.v) : ''
    if (!t) t = pulisci(c.titolo)
    if (!t) t = 'Capitolo ' + (i + 1) + ' (riga ' + c.rigaTitolo + ')'
    return t.length > 120 ? t.slice(0, 117) + '…' : t
  }

  // ── Fine dell'offerta: la riga del prezzo finale ────────────────────────────
  // Il riepilogo comincia alla prima riga che riporta il totale di un capitolo (F = F<totale capitolo>,
  // come lo riconosce il lettore). Da lì la fine è la prima riga «TOTALE COMPLESSIVO»; se manca, l'ultimo
  // «TOTALE» del blocco finale (righe TOTALE / SCONTO / IVA / vuote). Senza riepilogo si usa solo
  // «TOTALE COMPLESSIVO»; se non c'è nemmeno quello, la fine non si conosce e non si ignora niente.
  // Prudenza: se un capitolo citato nel riepilogo stesse dopo la fine, non si ignora niente.
  var RE_BLOCCO_FINALE = /^(TOTALE|SCONTO|IVA|EVENTUALE\s+IVA|RIEPILOGO|ARROTONDAMENTO)/i
  function fineOfferta(XLSX, ws, imp) {
    if (!XLSX || !ws || !ws['!ref'] || !imp || !imp.par) return null
    var val = function (c, r) { var x = ws[c + r]; return x ? x.v : undefined }
    var B = function (r) { return pulisci(val('B', r)) }
    var ultima = Math.min(XLSX.utils.decode_range(ws['!ref']).e.r + 1, 6000)
    var totCap = new Set((imp.capitoli || []).map(function (c) { return c.rigaTotale }))
    var righeRiep = ((imp.riepilogo && imp.riepilogo.righe) || []).map(function (x) { return x.riga })
    var riep = new Set(righeRiep)
    var eTotale = function (r) { return /^TOTALE\b/i.test(B(r)) && numero(val('F', r)) && !totCap.has(r) }
    var inizio = righeRiep.length ? Math.min.apply(null, righeRiep) : (imp.par.rigaParametri || 1) + 1
    var fine = null, r
    for (r = inizio; r <= ultima && fine == null; r++) if (/^TOTALE\s+COMPLESSIVO/i.test(B(r)) && !totCap.has(r)) fine = r
    if (fine == null && righeRiep.length) {
      for (r = inizio; r <= ultima; r++) {
        var b = B(r)
        if (riep.has(r) || !b || RE_BLOCCO_FINALE.test(b)) { if (eTotale(r)) fine = r; continue }
        break
      }
    }
    if (fine == null) return null
    // un capitolo citato nel riepilogo non può stare dopo la fine
    var citati = new Set(((imp.riepilogo && imp.riepilogo.righe) || []).map(function (x) { return x.capitolo }))
    if ((imp.capitoli || []).some(function (c) { return citati.has(c.rigaTotale) && c.rigaTotale > fine })) return null
    return fine
  }

  // ── Voce «a corpo» ─────────────────────────────────────────────────────────
  // Deciso da Umberto (2.11.2026): F = arrotondamento di H della stessa riga (nelle 5 offerte di prova
  // CEILING(H48,100), MROUND(H50,100), ARROTONDA.MULTIPLO(H43,50)) oppure unità «a corpo» → i minuti sono il totale.
  var RE_F_SU_H = /^(?:CEILING(?:\.MATH)?|MROUND|ROUNDUP|ROUND|ARROTONDA(?:\.[A-Z]+)*)\(\$?H\$?(\d+)[,;)]/i
  function aCorpoDi(ws, v) {
    var cF = ws && ws['F' + v.riga]
    var m = cF && cF.f && cF.f.replace(/\s+/g, '').match(RE_F_SU_H)
    if (m && +m[1] === v.riga) return 'F'
    if (/\ba\s*corpo\b/i.test(pulisci(v.unita))) return 'unità'
    return false
  }
  function quantitaVuota(v) { return !numero(v.q) || v.q === 0 }
  function codiceValido(c) { return /[0-9A-Za-z]/.test(pulisci(c)) }

  // Righe con quantità e minuti numerici che il lettore NON dà come voci (es. voce con prezzo H scritto
  // a mano e F «-----»: nell'offerta 3 di prova 2 righe, 2.61 h). Per le ore contano lo stesso:
  // si aggiungono con un avviso. Il lettore resta com'è (copia non modificata).
  // Solo fino alla fine dell'offerta (fineRiga), se conosciuta.
  function righeNonLette(XLSX, ws, imp, fineRiga) {
    if (!XLSX || !ws || !ws['!ref'] || !imp.colonne || !imp.colonne.minuti) return []
    var lette = new Set((imp.voci || []).map(function (v) { return v.riga }))
    var totali = new Set((imp.capitoli || []).map(function (c) { return c.rigaTotale }))
    var val = function (c, r) { var x = ws[c + r]; return x ? x.v : undefined }
    var fine = Math.min(XLSX.utils.decode_range(ws['!ref']).e.r + 1, 6000)
    if (fineRiga != null) fine = Math.min(fine, fineRiga)
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
        lab: imp.colonne.lab && numero(val(imp.colonne.lab, r)) ? val(imp.colonne.lab, r) : null,
        regolaF: { tipo: typeof F === 'string' && /-{3,}/.test(F) ? 'incluso' : 'altro' }, nonLetta: true
      })
    }
    return out
  }

  // Dal risultato del lettore (importaFoglio) alla vista del Calendario.
  // XLSX e ws (foglio OFFERTA) servono per: fine dell'offerta, voci a corpo (formula di F), costo orario
  // laboratorio, nome dei capitoli e righe non lette dal lettore.
  var COSTI_SENZA_ORE = [['k3', 'HUNDEGGER K3'], ['scm', 'SCM']]
  function costoOraLab(ws, imp) {
    var c = imp.colonne && imp.colonne.lab, r = imp.par && imp.par.rigaParametri
    var x = ws && c && r ? ws[c + r] : null
    return x && numero(x.v) && x.v > 0 ? x.v : null
  }
  function analizza(imp, XLSX, ws) {
    var capitoli = [], voci = []
    var inCapitolo = new Set()
    var fine = fineOfferta(XLSX, ws, imp)
    var dopo = function (r) { return fine != null && r > fine }
    var ignorate = new Set()
    var extra = righeNonLette(XLSX, ws, imp, null).filter(function (e) { if (dopo(e.riga)) { ignorate.add(e.riga); return false } return true })
    var oraLab = costoOraLab(ws, imp)
    var labSenzaCosto = 0
    function voceDa(v, capId) {
      var corpo = aCorpoDi(ws, v)
      var qVuota = quantitaVuota(v)
      // ore dai minuti: a corpo = minuti / 60; altrimenti D × minuti / 60
      var ore = corpo ? (numero(v.minuti) ? v.minuti / 60 : 0) : oreVoce(v)
      var esterno = eEsterna(v)
      // ore laboratorio dai CHF: (a corpo: 1 | D) × CHF / costo orario laboratorio
      var labChf = numero(v.lab) && v.lab > 0 ? v.lab : 0
      var oreLab = 0
      var avvisi = []
      if (labChf) {
        if (!oraLab) { labSenzaCosto++; avvisi.push('Costo laboratorio CHF ' + arrot2(labChf) + ' ma nessun costo orario laboratorio nella riga parametri: 0 h laboratorio') }
        else if (corpo) oreLab = labChf / oraLab
        else if (!qVuota) oreLab = v.q * labChf / oraLab
      }
      if (qVuota && !corpo) {
        var conUno = numero(v.minuti) && v.minuti > 0 ? arrot2(v.minuti / 60) : 0
        avvisi.push('Quantità vuota: 0 h' + (conUno ? ' (con quantità 1 sarebbero ' + conUno + ' h)' : ''))
      }
      if (!numero(v.minuti) && !labChf) avvisi.push('Minuti vuoti: 0 h')
      if (v.nonLetta) avvisi.push('Riga con prezzo scritto a mano, non letta dal Preventivatore: presa solo per le ore')
      // costi in CHF senza ore (Hundegger K3, SCM): solo informazione
      var senzaOre = COSTI_SENZA_ORE.filter(function (k) { return numero(v[k[0]]) && v[k[0]] > 0 }).map(function (k) { return k[1] })
      var x = {
        id: 'v' + v.riga, riga: v.riga, codice: v.codice == null ? '' : pulisci(v.codice),
        testo: pulisci(v.descrizione), unita: pulisci(v.unita), q: numero(v.q) ? v.q : null,
        minuti: numero(v.minuti) ? v.minuti : null, ore: ore, esterno: esterno, aCorpo: corpo,
        labChf: labChf || null, oreLab: oreLab,
        // codice per ricordare il tipo di ore: solo se ha lettere o cifre («---» delle sotto-voci non vale)
        codiceMemoria: codiceValido(v.codice) ? pulisci(v.codice) : '',
        eventuale: !!v.eventuale, incluso: !!(v.regolaF && v.regolaF.tipo === 'incluso' && !v.eventuale),
        avvisi: avvisi, capId: capId, nonLetta: !!v.nonLetta, costiSenzaOre: senzaOre
      }
      // spuntata di partenza: interna, con ore (minuti o laboratorio), non eventuale
      x.sceltaIniziale = (ore > 0 || oreLab > 0) && !esterno && !x.eventuale
      voci.push(x)
      return x
    }
    var usate = new Set()
    ;(imp.capitoli || []).forEach(function (c, i) {
      // capitolo che finisce dopo il prezzo finale (es. «1° acconto»): non è un capitolo
      if (dopo(c.rigaTotale)) {
        ignorate.add(c.rigaTotale)
        c.voci.forEach(function (v) { inCapitolo.add(v); ignorate.add(v.riga) })
        return
      }
      var cap = { id: 'c' + capitoli.length, titolo: nomeCapitolo(c, i, ws), riga: c.rigaTitolo, voci: [] }
      var proprie = c.voci.filter(function (v) { if (dopo(v.riga)) { inCapitolo.add(v); ignorate.add(v.riga); return false } return true })
      extra.forEach(function (e) { if (!usate.has(e) && e.riga >= c.rigaTitolo && e.riga <= c.rigaFine) { usate.add(e); proprie.push(e) } })
      proprie.sort(function (a, b) { return a.riga - b.riga })
      proprie.forEach(function (v) { inCapitolo.add(v); cap.voci.push(voceDa(v, cap.id)) })
      capitoli.push(cap)
    })
    // voci dopo il prezzo finale (acconti, rate, pagamenti): ignorate
    ;(imp.voci || []).forEach(function (v) { if (!inCapitolo.has(v) && dopo(v.riga)) { inCapitolo.add(v); ignorate.add(v.riga) } })
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
      cap.oreLab = cap.voci.reduce(function (s, v) { return s + v.oreLab }, 0)
      cap.nEsterne = cap.voci.filter(function (v) { return v.esterno }).length
      cap.nInterne = cap.voci.length - cap.nEsterne
      cap.nACorpo = cap.voci.filter(function (v) { return v.aCorpo }).length
      // voci con costi K3 / SCM scritti in CHF (senza ore): solo informazione
      cap.costiSenzaOre = {}
      cap.voci.forEach(function (v) { v.costiSenzaOre.forEach(function (k) { cap.costiSenzaOre[k] = (cap.costiSenzaOre[k] || 0) + 1 }) })
    })
    var col = imp.colonne || {}
    return {
      tipo: imp.tipo,
      colonne: { quantita: 'D', minuti: col.minuti || null, cantiere: col.cantiere || null, lab: col.lab || null },
      colonneSpostate: col.minuti !== 'Q' || col.cantiere !== 'P',
      costoOraLab: oraLab, labSenzaCosto: labSenzaCosto,
      fineOfferta: { riga: fine, nIgnorate: ignorate.size, righeIgnorate: Array.from(ignorate).sort(function (a, b) { return a - b }) },
      capitoli: capitoli, voci: voci,
      oreInterne: capitoli.reduce(function (s, c) { return s + c.oreInterne }, 0),
      oreEsterne: capitoli.reduce(function (s, c) { return s + c.oreEsterne }, 0),
      oreLab: capitoli.reduce(function (s, c) { return s + c.oreLab }, 0),
      nAvvisi: voci.filter(function (v) { return v.avvisi.length }).length,
      nEsterne: voci.filter(function (v) { return v.esterno }).length
    }
  }

  // ── Tipo di ore: Cantiere (C, di base) / Ufficio (U) / Laboratorio (L); Esterno (E) per le esterne ──
  var TIPI = { C: 'Cantiere', U: 'Ufficio', L: 'Laboratorio', E: 'Esterno' }
  // tipi = { idVoce: 'U' | 'L' } (quello che manca è Cantiere)
  function tipoMinuti(v, tipi) {
    if (v.esterno) return 'E'
    var t = tipi && tipi[v.id]
    return t === 'U' || t === 'L' ? t : 'C'
  }
  // Ore di una voce divise per tipo: i minuti nel tipo scelto, il laboratorio in CHF sempre in L
  function oreDiTipo(v, tipi) {
    var o = { C: 0, U: 0, L: 0, E: 0 }
    o[tipoMinuti(v, tipi)] += v.ore
    o.L += v.oreLab
    return o
  }
  // Totali per tipo, per capitolo e in tutto. Con «scelte» contano solo le voci spuntate.
  function totaliPerTipo(analisi, tipi, scelte) {
    var tot = { C: 0, U: 0, L: 0, E: 0 }, perCap = {}
    analisi.capitoli.forEach(function (cap) {
      var t = { C: 0, U: 0, L: 0, E: 0 }
      cap.voci.forEach(function (v) {
        if (scelte && !scelte[v.id]) return
        var o = oreDiTipo(v, tipi)
        for (var k in o) { t[k] += o[k]; tot[k] += o[k] }
      })
      perCap[cap.id] = t
    })
    return { tot: tot, perCap: perCap }
  }
  // Scelte ricordate (per codice voce, colonna A) → tipi di questa offerta. memoria = { codice: 'U'|'L' }
  function tipiIniziali(analisi, memoria) {
    var t = {}
    if (!memoria) return t
    analisi.voci.forEach(function (v) {
      if (v.esterno || !v.codiceMemoria) return
      var m = memoria[v.codiceMemoria]
      if (m === 'U' || m === 'L') t[v.id] = m
    })
    return t
  }

  // Scelte → capitoli da creare in pl_capitoli (nome, ore arrotondate ai centesimi, All'aperto).
  // scelte: oggetto { idVoce: true/false }. Capitoli interni prima, poi quelli esterni.
  // v5: dei minuti interni contano SOLO quelli di tipo Cantiere (tipi: { idVoce: 'U'|'L' }); Ufficio e
  // Laboratorio (e le ore laboratorio in CHF) non creano capitoli.
  function proponiCapitoli(analisi, scelte, tipi) {
    var nuovi = [], saltati = []
    function conta(v, esterno) { return v.esterno === esterno && !!scelte[v.id] && (esterno || tipoMinuti(v, tipi) === 'C') }
    function somma(cap, esterno) {
      return cap.voci.reduce(function (s, v) { return s + (conta(v, esterno) ? v.ore : 0) }, 0)
    }
    function aggiungi(nome, ore, esterno, nVoci) {
      var o = arrot2(ore)
      if (o > 0) nuovi.push({ nome: nome, ore: o, ubicazione: 'All\'aperto', esterno: esterno, nVoci: nVoci })
      else saltati.push({ nome: nome, motivo: 'meno di 0.01 h' })
    }
    analisi.capitoli.forEach(function (cap) {
      var n = cap.voci.filter(function (v) { return conta(v, false) && v.ore > 0 }).length
      if (n) aggiungi(cap.titolo, somma(cap, false), false, n)
    })
    analisi.capitoli.forEach(function (cap) {
      var n = cap.voci.filter(function (v) { return conta(v, true) && v.ore > 0 }).length
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
    if (!(a.oreInterne + a.oreEsterne + a.oreLab > 0)) avvisi.push('Nessuna voce con quantità e minuti: le ore sono 0.')
    if (a.labSenzaCosto) avvisi.push('Costo orario laboratorio non trovato nella riga parametri: ' + a.labSenzaCosto + (a.labSenzaCosto === 1 ? ' voce' : ' voci') + ' con costo laboratorio a 0 h.')
    return { ok: true, analisi: a, avvisi: avvisi, foglio: foglio }
  }

  var API = {
    SCRITTA_ESTERNO: SCRITTA_ESTERNO, MAX_BYTE: MAX_BYTE,
    oreVoce: oreVoce, eEsterna: eEsterna, analizza: analizza, proponiCapitoli: proponiCapitoli,
    fineOfferta: fineOfferta, aCorpoDi: aCorpoDi, TIPI: TIPI, tipoMinuti: tipoMinuti, oreDiTipo: oreDiTipo,
    totaliPerTipo: totaliPerTipo, tipiIniziali: tipiIniziali,
    scelteIniziali: scelteIniziali, leggiOfferta: leggiOfferta, arrot2: arrot2
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API
  else root.CTOffertaOre = API
})(typeof window !== 'undefined' ? window : globalThis)
