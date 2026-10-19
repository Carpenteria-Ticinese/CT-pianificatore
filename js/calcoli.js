/* ═══════════════════════════════════════════════════════════════════════════
   Pianificatore cantieri — CALCOLI
   Solo funzioni pure: niente pagina (DOM), niente Supabase, niente rete.
   Le usa l'app nel browser (window.PLC) e le prove in tests/ con node.

   Convenzioni
   - Le date sono testi 'AAAA-MM-GG' (come arrivano da Supabase). I conti sulle
     date si fanno in UTC, così l'ora legale non sposta mai un giorno.
   - Le ore sono numeri (9, 4.5). Si lavora con ore, non con orari.
   - Una "persona" in un'assegnazione è persona_id (operai.id) oppure, se i nomi
     non sono ancora decisi, un segnaposto numerato (1, 2, 3) della commessa.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.PLC = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  // ── Date ──────────────────────────────────────────────────────────────────
  function aData(iso) {
    var p = String(iso).slice(0, 10).split('-')
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]))
  }
  function aIso(d) {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
           String(d.getUTCDate()).padStart(2, '0')
  }
  function isoDa(anno, mese, giorno) { return aIso(new Date(Date.UTC(anno, mese - 1, giorno))) }
  function aggiungiGiorni(iso, n) { var d = aData(iso); d.setUTCDate(d.getUTCDate() + n); return aIso(d) }
  // 1 = lunedì … 7 = domenica
  function giornoSettimana(iso) { var g = aData(iso).getUTCDay(); return g === 0 ? 7 : g }
  function anno(iso) { return +String(iso).slice(0, 4) }
  function mese(iso) { return +String(iso).slice(5, 7) }
  function giorniNelMese(a, m) { return new Date(Date.UTC(a, m, 0)).getUTCDate() }
  function lunediDi(iso) { return aggiungiGiorni(iso, 1 - giornoSettimana(iso)) }
  function differenzaGiorni(da, a) { return Math.round((aData(a) - aData(da)) / 86400000) }
  function oggiIso(d) { d = d || new Date(); return isoDa(d.getFullYear(), d.getMonth() + 1, d.getDate()) }

  var GIORNI_BREVI = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
  var GIORNI_LUNGHI = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
  var MESI = ['', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
              'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

  // ── Numeri (formato svizzero) ─────────────────────────────────────────────
  // 1234.5 → "1'234.5"; al massimo `dec` decimali, senza zeri inutili.
  function fmtNum(n, dec) {
    if (n === null || n === undefined || isNaN(n)) return '–'
    if (dec === undefined) dec = 1
    var f = Math.pow(10, dec)
    var r = Math.round(Number(n) * f) / f
    var neg = r < 0; r = Math.abs(r)
    var parti = r.toFixed(dec).split('.')
    var intero = parti[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'")
    var decimali = parti[1] ? parti[1].replace(/0+$/, '') : ''
    return (neg ? '−' : '') + intero + (decimali ? '.' + decimali : '')
  }
  function fmtOre(n) { return fmtNum(n, 2) + ' h' }
  function fmtGiorni(n) { return fmtNum(n, 1) + (Math.abs(n) === 1 ? ' giorno' : ' giorni') }
  function fmtGiorniLavorativi(n) { return fmtNum(n, 1) + (Math.abs(n) === 1 ? ' giorno lavorativo' : ' giorni lavorativi') }
  // "mar 12.01"
  function fmtGiorno(iso) {
    return GIORNI_BREVI[giornoSettimana(iso)] + ' ' + iso.slice(8, 10) + '.' + iso.slice(5, 7)
  }
  // "12.01.2027"
  function fmtDataAnno(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '' }

  // Numero scritto a mano: accetta virgola e punto, apostrofi e spazi delle migliaia.
  function leggiNumero(s) {
    if (typeof s === 'number') return s
    if (s === null || s === undefined) return NaN
    var t = String(s).trim().replace(/['’\s]/g, '').replace(',', '.')
    if (t === '' || !/^[-+]?\d*\.?\d+$/.test(t)) return NaN
    return Number(t)
  }
  // Ore: "12.5", "12,5", "12:30", "12 h"
  function leggiOre(s) {
    var t = String(s === null || s === undefined ? '' : s).trim().replace(/\s*(h|ore)$/i, '')
    var m = /^(\d+):(\d{1,2})$/.exec(t)
    if (m) {
      var min = +m[2]
      if (min >= 60) return NaN
      return +m[1] + min / 60
    }
    return leggiNumero(t)
  }

  // Arrotondamenti a mezze unità
  function perEccessoMezzo(x) { return x <= 0 ? 0 : Math.ceil(x * 2 - 1e-9) / 2 }
  function perDifettoMezzo(x) { return x <= 0 ? 0 : Math.floor(x * 2 + 1e-9) / 2 }
  function arrotonda5(min) { return Math.round(min / 5) * 5 }

  // ── Festivi Ticino ────────────────────────────────────────────────────────
  // Pasqua (calendario gregoriano, algoritmo anonimo di Meeus/Jones/Butcher)
  function pasqua(a) {
    var A = a % 19, b = Math.floor(a / 100), c = a % 100, d = Math.floor(b / 4), e = b % 4
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
    var h = (19 * A + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((A + 11 * h + 22 * l) / 451)
    var mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = ((h + l - 7 * m + 114) % 31) + 1
    return isoDa(a, mese, giorno)
  }
  // I 15 festivi del Ticino. Venerdì Santo NON c'è: in Ticino è lavorativo.
  function festiviTicino(a) {
    var p = pasqua(a)
    var l = [
      [isoDa(a, 1, 1), 'Capodanno'],
      [isoDa(a, 1, 6), 'Epifania'],
      [isoDa(a, 3, 19), 'San Giuseppe'],
      [aggiungiGiorni(p, 1), 'Lunedì di Pasqua'],
      [isoDa(a, 5, 1), 'Festa del lavoro'],
      [aggiungiGiorni(p, 39), 'Ascensione'],
      [aggiungiGiorni(p, 50), 'Lunedì di Pentecoste'],
      [aggiungiGiorni(p, 60), 'Corpus Domini'],
      [isoDa(a, 6, 29), 'SS. Pietro e Paolo'],
      [isoDa(a, 8, 1), 'Festa nazionale'],
      [isoDa(a, 8, 15), 'Assunzione'],
      [isoDa(a, 11, 1), 'Ognissanti'],
      [isoDa(a, 12, 8), 'Immacolata'],
      [isoDa(a, 12, 25), 'Natale'],
      [isoDa(a, 12, 26), 'Santo Stefano']
    ]
    return l.map(function (x) { return { data: x[0], nome: x[1] } })
      .sort(function (x, y) { return x.data < y.data ? -1 : 1 })
  }

  // Periodo inverno proposto: dal primo lunedì di novembre dell'anno all'ultimo
  // venerdì di marzo dell'anno dopo.
  function periodoInvernoProposto(a) {
    var inizio = isoDa(a, 11, 1)
    while (giornoSettimana(inizio) !== 1) inizio = aggiungiGiorni(inizio, 1)
    var fine = isoDa(a + 1, 3, 31)
    while (giornoSettimana(fine) !== 5) fine = aggiungiGiorni(fine, -1)
    return { anno: a, data_inizio: inizio, data_fine: fine }
  }

  // ── Calendario ────────────────────────────────────────────────────────────
  var IMPOSTAZIONI_BASE = {
    ore_estate_lungio: 9, ore_estate_ven: 8, ore_inverno_lungio: 8, ore_inverno_ven: 7,
    max_settimanale: 45, soglia_giornata_piena: 6, viaggio_incluso: true,
    fattore_ora_punta: 1.25, malattia_giorni_anno: 5, malattia_quota_inverno: 50,
    recupero_pioggia: 50, stazione_meteo: 'MAG', persone_medie: 3
  }

  // dati: { imp, periodiInverno:[{anno,data_inizio,data_fine}], festivi:[{data,nome,attivo}] (le
  //         righe salvate: valgono come interruttori), chiusure:[{dal,al,motivo}] }
  function creaCalendario(dati) {
    dati = dati || {}
    var imp = {}
    Object.keys(IMPOSTAZIONI_BASE).forEach(function (k) {
      var v = dati.imp && dati.imp[k]
      imp[k] = (v === null || v === undefined) ? IMPOSTAZIONI_BASE[k] : v
    })
    var periodi = {}
    ;(dati.periodiInverno || []).forEach(function (p) { periodi[p.anno] = p })
    var interruttori = {}
    ;(dati.festivi || []).forEach(function (f) { interruttori[f.data] = f })
    return {
      imp: imp, periodi: periodi, interruttori: interruttori,
      chiusure: (dati.chiusure || []).slice(), _festivi: {}
    }
  }
  function periodoInverno(cal, a) { return cal.periodi[a] || periodoInvernoProposto(a) }
  function eInverno(cal, iso) {
    var a = anno(iso)
    return [a - 1, a].some(function (x) {
      var p = periodoInverno(cal, x)
      return iso >= p.data_inizio && iso <= p.data_fine
    })
  }
  // Festivo di quel giorno, con l'interruttore salvato (default: attivo)
  function festivo(cal, iso) {
    var a = anno(iso)
    if (!cal._festivi[a]) {
      var m = {}
      festiviTicino(a).forEach(function (f) { m[f.data] = f })
      cal._festivi[a] = m
    }
    var f = cal._festivi[a][iso]
    if (!f) return null
    var s = cal.interruttori[iso]
    return { data: iso, nome: f.nome, attivo: s ? s.attivo !== false : true }
  }
  function festiviAnno(cal, a) {
    return festiviTicino(a).map(function (f) { return festivo(cal, f.data) })
  }
  function chiusuraDi(cal, iso) {
    for (var i = 0; i < cal.chiusure.length; i++) {
      var c = cal.chiusure[i]
      if (iso >= c.dal && iso <= c.al) return c
    }
    return null
  }
  // { lavorativo, tipo: null|'weekend'|'festivo'|'chiusura', etichetta }
  function infoGiorno(cal, iso) {
    var g = giornoSettimana(iso)
    if (g === 6) return { lavorativo: false, tipo: 'weekend', etichetta: 'Sabato' }
    if (g === 7) return { lavorativo: false, tipo: 'weekend', etichetta: 'Domenica' }
    var f = festivo(cal, iso)
    if (f && f.attivo) return { lavorativo: false, tipo: 'festivo', etichetta: 'Festivo · ' + f.nome }
    var c = chiusuraDi(cal, iso)
    if (c) return { lavorativo: false, tipo: 'chiusura', etichetta: 'Chiusura' + (c.motivo ? ' · ' + c.motivo : ''), chiusura: c }
    return { lavorativo: true, tipo: null, etichetta: '' }
  }
  function eLavorativo(cal, iso) { return infoGiorno(cal, iso).lavorativo }

  // Ore della giornata da calendario (estate/inverno, venerdì), senza riduzioni.
  function oreBase(cal, iso) {
    var inv = eInverno(cal, iso), ven = giornoSettimana(iso) === 5
    if (inv) return ven ? +cal.imp.ore_inverno_ven : +cal.imp.ore_inverno_lungio
    return ven ? +cal.imp.ore_estate_ven : +cal.imp.ore_estate_lungio
  }
  // Ore della giornata per una commessa: riduzione su lun-gio, regola del venerdì.
  function oreGiornataCommessa(cal, iso, commessa) {
    var rid = Number((commessa && commessa.riduzione_ore) || 0)
    var inv = eInverno(cal, iso)
    var lungio = (inv ? +cal.imp.ore_inverno_lungio : +cal.imp.ore_estate_lungio) - rid
    if (giornoSettimana(iso) !== 5) return Math.max(0, lungio)
    if (commessa && commessa.venerdi_regola === 'Uguale agli altri giorni') return Math.max(0, lungio)
    // "Un'ora in meno" (default): il venerdì del calendario, ridotto come gli altri giorni
    var ven = (inv ? +cal.imp.ore_inverno_ven : +cal.imp.ore_estate_ven) - rid
    return Math.max(0, ven)
  }
  // Ore di lavoro in cantiere per persona in quel giorno.
  // viaggioIncluso = true (default): il viaggio sta già nelle ore del preventivo, non si toglie.
  // false: si tolgono andata e ritorno; il risultato si arrotonda per difetto alla mezz'ora.
  function oreCantiere(cal, iso, commessa, viaggioIncluso) {
    if (!eLavorativo(cal, iso)) return 0
    var ore = oreGiornataCommessa(cal, iso, commessa)
    if (viaggioIncluso === undefined) viaggioIncluso = cal.imp.viaggio_incluso !== false
    if (!viaggioIncluso) {
      var v = Number((commessa && commessa.viaggio_min_andata) || 0)
      ore = perDifettoMezzo(ore - 2 * v / 60)
    }
    return Math.max(0, ore)
  }
  // Sposta di n giorni lavorativi (n anche negativo). n = 0: se il giorno non è
  // lavorativo, il primo lavorativo dopo.
  function spostaLavorativi(cal, iso, n) {
    var d = iso, passo = n < 0 ? -1 : 1, conta = Math.abs(n)
    if (n === 0) {
      var giri0 = 0
      while (!eLavorativo(cal, d) && giri0++ < 800) d = aggiungiGiorni(d, 1)
      return d
    }
    var giri = 0
    while (conta > 0 && giri++ < 5000) {
      d = aggiungiGiorni(d, passo)
      if (eLavorativo(cal, d)) conta--
    }
    return d
  }
  // Giorni lavorativi in [da, a] compresi
  function giorniLavorativiFra(cal, da, a) {
    var n = 0
    for (var d = da; d <= a; d = aggiungiGiorni(d, 1)) if (eLavorativo(cal, d)) n++
    return n
  }

  // ── Persone e assenze ─────────────────────────────────────────────────────
  function chiavePersona(a) {
    return a.persona_id ? 'p:' + a.persona_id : 's:' + a.commessa_id + ':' + a.segnaposto
  }
  function assenzaDi(assenze, personaId, iso) {
    if (!personaId) return null
    for (var i = 0; i < (assenze || []).length; i++) {
      var x = assenze[i]
      if (x.persona_id === personaId && iso >= x.dal && iso <= x.al) return x
    }
    return null
  }

  // ── Import capitoli incollati (Zoho Sheet / Excel) ────────────────────────
  // 2 o 3 colonne separate da tab: capitolo | ore | [coperto]
  var PAROLE_COPERTO = ['coperto', 'al coperto', 'interno', 'c', 'x']
  function leggiCapitoliIncollati(testo) {
    var valide = [], scartate = []
    String(testo || '').split(/\r?\n/).forEach(function (riga, i) {
      var n = i + 1
      if (riga.trim() === '') return                       // riga vuota: ignorata
      var col = riga.split('\t')
      var nome = (col[0] || '').trim()
      if (col.length < 2) {
        scartate.push({ riga: n, testo: riga, motivo: 'Manca la colonna delle ore (le colonne vanno separate da tabulazione)' }); return
      }
      var oreTesto = (col[1] || '').trim()
      if (!nome) { scartate.push({ riga: n, testo: riga, motivo: 'Manca il nome del capitolo' }); return }
      if (oreTesto === '') { scartate.push({ riga: n, testo: riga, motivo: 'Mancano le ore' }); return }
      var ore = leggiOre(oreTesto)
      if (isNaN(ore)) { scartate.push({ riga: n, testo: riga, motivo: 'Ore non leggibili: «' + oreTesto + '»' }); return }
      if (ore <= 0) { scartate.push({ riga: n, testo: riga, motivo: 'Ore zero o negative' }); return }
      var terza = (col[2] || '').trim().toLowerCase()
      var nota = ''
      var ubicazione = 'All\'aperto'
      if (terza !== '') {
        if (PAROLE_COPERTO.indexOf(terza) >= 0) ubicazione = 'Al coperto'
        else nota = 'Terza colonna «' + col[2].trim() + '» non riconosciuta: considerato All\'aperto'
      }
      valide.push({ riga: n, nome: nome, ore: Math.round(ore * 100) / 100, ubicazione: ubicazione, nota: nota })
    })
    var totale = valide.reduce(function (s, x) { return s + x.ore }, 0)
    return { valide: valide, scartate: scartate, totale: Math.round(totale * 100) / 100 }
  }

  // ── Riempi automaticamente ────────────────────────────────────────────────
  // Divide `resto` ore fra n persone in passi da mezz'ora, il più equo possibile.
  function dividiInMezzore(resto, n) {
    var unita = Math.floor(resto * 2 + 1e-9)
    var frazione = Math.round((resto - unita / 2) * 1000) / 1000
    var base = Math.floor(unita / n), extra = unita % n
    var out = []
    for (var i = 0; i < n; i++) out.push((base + (i < extra ? 1 : 0)) / 2)
    out[0] += frazione
    return out
  }
  // p: { oreTotali, dataInizio, persone:[{persona_id}|{segnaposto}], cal, commessa,
  //      assenze, viaggioIncluso, altreAssegnazioni (per la posizione nel giorno) }
  // Crea le assegnazioni giorno per giorno, saltando giorni non lavorativi e
  // assenze, finché le ore sono coperte. Le ore dell'ultimo giorno si dividono
  // in parti uguali fra le persone presenti.
  function riempiAutomatico(p) {
    var resto = Number(p.oreTotali) || 0
    var out = []
    var occupate = {}
    ;(p.altreAssegnazioni || []).forEach(function (a) {
      if (!a.persona_id) return
      var k = a.persona_id + '|' + a.data
      occupate[k] = Math.max(occupate[k] || 0, a.posizione || 1)
    })
    if (resto <= 0 || !p.persone || !p.persone.length) return { assegnazioni: out, fine: null, oreNonCoperte: Math.max(0, resto) }
    var d = p.dataInizio, giri = 0
    while (resto > 1e-9 && giri++ < 800) {
      var cap = oreCantiere(p.cal, d, p.commessa, p.viaggioIncluso)
      if (cap > 0) {
        var presenti = p.persone.filter(function (x) { return !assenzaDi(p.assenze, x.persona_id, d) })
        if (presenti.length) {
          var quote
          if (resto >= cap * presenti.length - 1e-9) quote = presenti.map(function () { return cap })
          else quote = dividiInMezzore(resto, presenti.length)
          presenti.forEach(function (x, i) {
            var ore = Math.min(cap, quote[i])
            if (ore <= 0) return
            var pos = x.persona_id ? (occupate[x.persona_id + '|' + d] || 0) + 1 : 1
            out.push({
              data: d, persona_id: x.persona_id || null, segnaposto: x.persona_id ? null : (x.segnaposto || null),
              commessa_id: p.commessa && p.commessa.id, ore: Math.round(ore * 1000) / 1000, posizione: pos
            })
            resto -= ore
          })
        }
      }
      d = aggiungiGiorni(d, 1)
    }
    var fine = out.length ? out[out.length - 1].data : null
    return { assegnazioni: out, fine: fine, oreNonCoperte: Math.max(0, Math.round(resto * 1000) / 1000) }
  }

  // ── Riepilogo di una commessa (la durata si legge dalle assegnazioni) ────
  function sommaOre(l) { return Math.round(l.reduce(function (s, x) { return s + Number(x.ore || 0) }, 0) * 1000) / 1000 }

  // assTutte: tutte le assegnazioni (servono per le ore libere dell'ultimo giorno:
  // se una persona ha già un'altra commessa quel giorno, quelle ore non sono libere)
  function riepilogoCommessa(commessa, capitoli, assTutte, cal, viaggioIncluso) {
    var caps = (capitoli || []).filter(function (c) { return c.commessa_id === commessa.id || c.commessa_id === undefined })
    var ass = (assTutte || []).filter(function (a) { return a.commessa_id === commessa.id })
    var orePrev = sommaOre(caps)
    var oreAperto = sommaOre(caps.filter(function (c) { return c.ubicazione !== 'Al coperto' }))
    var oreAss = sommaOre(ass)
    var date = Array.from(new Set(ass.map(function (a) { return a.data }))).sort()
    var giorniPersona = new Set(ass.map(function (a) { return a.data + '|' + chiavePersona(a) })).size
    var r = {
      orePreventivo: orePrev, oreAssegnate: oreAss,
      residue: Math.round((orePrev - oreAss) * 1000) / 1000,
      quotaAperto: orePrev > 0 ? oreAperto / orePrev : 0,
      inizio: date[0] || null, fine: date[date.length - 1] || null,
      date: date, giorni: date.length, giorniPersona: giorniPersona, ultimoGiorno: null
    }
    // Di cui viaggio: ogni giorno-persona è un viaggio di andata e ritorno
    var v = Number(commessa.viaggio_min_andata || 0)
    r.oreViaggio = Math.round(giorniPersona * 2 * v / 60 * 100) / 100
    r.oreInCantiere = Math.round((orePrev - r.oreViaggio) * 100) / 100
    r.pctViaggio = orePrev > 0 ? r.oreViaggio / orePrev * 100 : 0

    if (r.fine) {
      var g = r.fine
      var cap = oreCantiere(cal, g, commessa, viaggioIncluso)
      var perPersona = {}
      ass.filter(function (a) { return a.data === g }).forEach(function (a) {
        var k = chiavePersona(a)
        if (!perPersona[k]) perPersona[k] = { chiave: k, persona_id: a.persona_id || null, segnaposto: a.segnaposto || null, lavoro: 0, altro: 0 }
        perPersona[k].lavoro += Number(a.ore)
      })
      Object.keys(perPersona).forEach(function (k) {
        var pp = perPersona[k]
        if (pp.persona_id) {
          pp.altro = sommaOre((assTutte || []).filter(function (a) {
            return a.persona_id === pp.persona_id && a.data === g && a.commessa_id !== commessa.id
          }))
        }
        pp.capacita = cap
        pp.libere = Math.max(0, Math.round((cap - pp.lavoro - pp.altro) * 1000) / 1000)
      })
      var lista = Object.keys(perPersona).map(function (k) { return perPersona[k] })
      r.ultimoGiorno = {
        data: g, capacita: cap, persone: lista,
        oreLavoro: sommaOre(lista.map(function (x) { return { ore: x.lavoro } })),
        oreLibere: sommaOre(lista.map(function (x) { return { ore: x.libere } }))
      }
    }
    return r
  }

  // ── Margine pioggia ───────────────────────────────────────────────────────
  // meteo: { 1: giorni con pioggia ≥ 1 mm, …, 12: … } (valori normali della stazione)
  function nomiPeriodo(mesiOrdinati) {
    if (mesiOrdinati.length === 1) return 'A ' + MESI[mesiOrdinati[0]]
    return 'Fra ' + MESI[mesiOrdinati[0]] + ' e ' + MESI[mesiOrdinati[mesiOrdinati.length - 1]]
  }
  function articoloPct(n) {
    var s = String(Math.round(n))
    return (s === '1' || s === '11' || s.charAt(0) === '8') ? 'l\'' : 'il '
  }
  function marginePioggia(p) {
    // p: { date:[iso giorni di lavoro], meteo, recupero (%), quotaAperto (0-1), stazione }
    if (!p.quotaAperto || p.quotaAperto <= 0) return { nessuno: true, motivo: 'Tutto il lavoro è al coperto: nessun margine per la pioggia.' }
    var meteo = p.meteo || {}
    if (!Object.keys(meteo).length) return { mancanoDati: true, motivo: 'Dati pioggia mancanti: margine non calcolabile.' }
    var date = Array.from(new Set(p.date || [])).sort()
    if (!date.length) return { nessuno: true, motivo: 'Nessun giorno pianificato: margine non calcolabile.' }
    var attesi = 0, mesiVisti = []
    for (var i = 0; i < date.length; i++) {
      var a = anno(date[i]), m = mese(date[i])
      if (meteo[m] === undefined || meteo[m] === null) return { mancanoDati: true, motivo: 'Dati pioggia mancanti per ' + MESI[m] + '.' }
      attesi += Number(meteo[m]) / giorniNelMese(a, m)
      var chiaveMese = a * 100 + m
      if (mesiVisti.indexOf(chiaveMese) < 0) mesiVisti.push(chiaveMese)
    }
    var recupero = (p.recupero === undefined ? 50 : Number(p.recupero)) / 100
    var grezzo = attesi * (1 - recupero) * p.quotaAperto
    var giorni = perEccessoMezzo(grezzo)
    var pctAperto = Math.round(p.quotaAperto * 100)
    var testoRecupero = Math.round(recupero * 100) === 50 ? 'metà si recupera'
      : Math.round(recupero * 100) === 0 ? 'non se ne recupera niente'
      : 'se ne recupera ' + articoloPct(recupero * 100) + Math.round(recupero * 100) + '%'
    var motivo = nomiPeriodo(mesiVisti.map(function (x) { return x % 100 })) + ' a ' + (p.stazione || 'Magadino') +
      ' piove in media ' + fmtNum(attesi, 1) + ' giorni lavorativi; ' + testoRecupero + '; ' +
      articoloPct(pctAperto) + pctAperto + '% del lavoro è all\'aperto → ' + fmtGiorni(giorni)
    return { giorni: giorni, attesi: attesi, grezzo: grezzo, motivo: motivo }
  }

  // ── Margine malattia ──────────────────────────────────────────────────────
  var MESI_INVERNO_MALATTIA = [11, 12, 1, 2]
  // Giorni di malattia attesi in un mese, per una persona
  function malattiaMese(m, giorniAnno, quotaInverno) {
    var q = (quotaInverno === undefined ? 50 : quotaInverno) / 100
    if (MESI_INVERNO_MALATTIA.indexOf(m) >= 0) return giorniAnno * q / 4
    return giorniAnno * (1 - q) / 8
  }
  // Giorni lavorativi del mese per il tasso giornaliero: lun-ven meno i festivi attivi
  // (le chiusure aziendali non contano: non sono giorni in cui ci si ammala di meno).
  function giorniLavorativiMese(cal, a, m) {
    var n = 0
    for (var g = 1; g <= giorniNelMese(a, m); g++) {
      var iso = isoDa(a, m, g), gs = giornoSettimana(iso)
      if (gs >= 6) continue
      var f = festivo(cal, iso)
      if (f && f.attivo) continue
      n++
    }
    return n
  }
  // p: { assegnazioni (della commessa), cal, giorniAnno, quotaInverno }
  function margineMalattia(p) {
    var ass = p.assegnazioni || []
    var gp = {}
    ass.forEach(function (a) { gp[a.data + '|' + chiavePersona(a)] = a.data })
    var giorniPersona = Object.keys(gp).map(function (k) { return gp[k] })
    if (!giorniPersona.length) return { nessuno: true, motivo: 'Nessun giorno pianificato: margine non calcolabile.' }
    var giorniAnno = p.giorniAnno === undefined ? 5 : Number(p.giorniAnno)
    var attesi = 0
    giorniPersona.forEach(function (d) {
      var a = anno(d), m = mese(d)
      var wd = giorniLavorativiMese(p.cal, a, m)
      if (wd > 0) attesi += malattiaMese(m, giorniAnno, p.quotaInverno) / wd
    })
    var date = Array.from(new Set(giorniPersona)).sort()
    var personeMedie = giorniPersona.length / date.length
    var grezzo = attesi / personeMedie
    var giorni = perEccessoMezzo(grezzo)
    var mesi = []
    date.forEach(function (d) { var k = anno(d) * 100 + mese(d); if (mesi.indexOf(k) < 0) mesi.push(k) })
    var pm = Math.round(personeMedie * 10) / 10
    var motivo = nomiPeriodo(mesi.map(function (x) { return x % 100 })) + ', con ' + fmtNum(pm, 1) +
      (pm === 1 ? ' persona' : ' persone') + ' per ' + date.length + (date.length === 1 ? ' giorno' : ' giorni') +
      ', la media dice ' + fmtGiorni(giorni) + ' di assenza. Il rischio vero è un\'assenza di una settimana: tieni una riparazione pronta'
    return { giorni: giorni, attesiGiorniPersona: attesi, personeMedie: personeMedie, grezzo: grezzo, motivo: motivo }
  }
  // Riquadro Squadra: giorni di malattia attesi per mese per una squadra di n persone
  function squadraMalattia(n, giorniAnno, quotaInverno) {
    var out = []
    for (var m = 1; m <= 12; m++) out.push({ mese: m, nome: MESI[m], giorni: n * malattiaMese(m, giorniAnno, quotaInverno) })
    return out
  }

  // ── Piani di modifica (l'app li applica dopo conferma) ────────────────────
  // Ogni piano restituisce la NUOVA lista di assegnazioni della commessa.
  function copia(a, cambi) {
    var o = {}
    Object.keys(a).forEach(function (k) { if (k !== 'id' && k !== 'created_at' && k !== 'updated_at') o[k] = a[k] })
    Object.keys(cambi || {}).forEach(function (k) { o[k] = cambi[k] })
    return o
  }
  // Rimette i giorni della commessa in fila da `primoNuovo`, tenendo l'ordine e
  // le pause: fra due giorni vecchi ci sono k giorni lavorativi (almeno 1), fra i
  // nuovi altrettanti. Due giorni diversi non finiscono mai sulla stessa data,
  // nemmeno se uno era su un giorno non lavorativo.
  function rimappa(assCommessa, primoNuovo, cal) {
    var date = Array.from(new Set(assCommessa.map(function (a) { return a.data }))).sort()
    var mappa = {}
    if (!date.length) return []
    mappa[date[0]] = spostaLavorativi(cal, primoNuovo, 0)
    for (var i = 1; i < date.length; i++) {
      var k = Math.max(1, giorniLavorativiFra(cal, aggiungiGiorni(date[i - 1], 1), date[i]))
      mappa[date[i]] = spostaLavorativi(cal, mappa[date[i - 1]], k)
    }
    return assCommessa.map(function (a) { return copia(a, { data: mappa[a.data] }) })
  }
  // Sposta di n giorni lavorativi (salta weekend, festivi, chiusure)
  function pianoSposta(assCommessa, n, cal) {
    if (!assCommessa.length) return []
    var primo = assCommessa.map(function (a) { return a.data }).sort()[0]
    var base = eLavorativo(cal, primo) ? primo : spostaLavorativi(cal, primo, 0)
    return rimappa(assCommessa, spostaLavorativi(cal, base, n), cal)
  }
  // Avviso 6, scelta 1: tutta la commessa riparte dopo la chiusura
  function pianoSpostaDopoChiusura(assCommessa, chiusura, cal) {
    if (!assCommessa.length) return []
    var date = assCommessa.map(function (a) { return a.data }).sort()
    var primo = date[0]
    var obiettivo = spostaLavorativi(cal, aggiungiGiorni(chiusura.al, 1), 0)
    if (primo >= obiettivo) return assCommessa.map(function (a) { return copia(a) })
    return rimappa(assCommessa, obiettivo, cal)
  }
  // Avviso 6, scelta 2: quel che sta prima resta; i giorni dentro la chiusura
  // vanno subito dopo, e tutto quello che segue scala degli stessi giorni.
  function pianoInterrompi(assCommessa, chiusura, cal) {
    var dentro = Array.from(new Set(assCommessa.filter(function (a) {
      return a.data >= chiusura.dal && a.data <= chiusura.al
    }).map(function (a) { return a.data }))).sort()
    var m = dentro.length
    var ripresa = spostaLavorativi(cal, aggiungiGiorni(chiusura.al, 1), 0)
    return assCommessa.map(function (a) {
      if (a.data < chiusura.dal) return copia(a)
      if (a.data <= chiusura.al) return copia(a, { data: spostaLavorativi(cal, ripresa, dentro.indexOf(a.data)) })
      return copia(a, { data: m ? spostaLavorativi(cal, a.data, m) : a.data })
    })
  }
  // Avviso 6, scelta 3: chi è scelto lavora durante la chiusura (ferie da
  // recuperare). Le ore lavorate in chiusura si tolgono dalla fine della commessa.
  function pianoLavoraDurante(p) {
    // p: { assCommessa, chiusura, personeScelte:[persona_id], cal, commessa, viaggioIncluso, assenze }
    // In chiusura si lavora solo per le ore che mancano dopo quello che si fa prima.
    var ch = p.chiusura
    var fuori = p.assCommessa.filter(function (a) { return a.data < ch.dal || a.data > ch.al }).map(function (a) { return copia(a) })
    var tolte = sommaOre(p.assCommessa.filter(function (a) { return a.data >= ch.dal && a.data <= ch.al }))
    var mancano = sommaOre(p.assCommessa) - sommaOre(p.assCommessa.filter(function (a) { return a.data < ch.dal }))
    var date = p.assCommessa.map(function (a) { return a.data }).sort()
    var inizio = date[0] > ch.dal ? date[0] : ch.dal
    var nuove = []
    for (var d = inizio; d <= ch.al && mancano > 1e-9; d = aggiungiGiorni(d, 1)) {
      var gs = giornoSettimana(d)
      if (gs >= 6) continue
      var f = festivo(p.cal, d)
      if (f && f.attivo) continue
      var oreGiorno = oreGiornataCommessa(p.cal, d, p.commessa)
      if (p.viaggioIncluso === false) oreGiorno = perDifettoMezzo(oreGiorno - 2 * Number(p.commessa.viaggio_min_andata || 0) / 60)
      if (oreGiorno <= 0) continue
      var presenti = p.personeScelte.filter(function (pid) { return !assenzaDi(p.assenze, pid, d) })
      if (!presenti.length) continue
      var quote = mancano >= oreGiorno * presenti.length - 1e-9
        ? presenti.map(function () { return oreGiorno }) : dividiInMezzore(mancano, presenti.length)
      presenti.forEach(function (pid, i) {
        var ore = Math.min(oreGiorno, quote[i])
        if (ore <= 0) return
        nuove.push({ data: d, persona_id: pid, segnaposto: null, commessa_id: p.commessa.id, ore: ore, posizione: 1, nota: 'ferie da recuperare' })
        mancano -= ore
      })
    }
    var aggiunte = sommaOre(nuove)
    var delta = Math.round((aggiunte - tolte) * 1000) / 1000
    var lista = fuori.concat(nuove).sort(function (x, y) { return x.data < y.data ? -1 : x.data > y.data ? 1 : 0 })
    if (delta > 0) {
      // si toglie dalla fine
      for (var i = lista.length - 1; i >= 0 && delta > 1e-9; i--) {
        if (lista[i].nota === 'ferie da recuperare') continue
        var t = Math.min(delta, Number(lista[i].ore))
        lista[i].ore = Math.round((Number(lista[i].ore) - t) * 1000) / 1000
        delta -= t
      }
      lista = lista.filter(function (a) { return a.ore > 1e-9 })
    } else if (delta < 0) {
      // mancano ore: si aggiungono dopo la fine, con le persone dell'ultimo giorno
      var fine = lista.length ? lista[lista.length - 1].data : ch.al
      var ultime = lista.filter(function (a) { return a.data === fine })
      var persone = ultime.map(function (a) { return a.persona_id ? { persona_id: a.persona_id } : { segnaposto: a.segnaposto } })
      if (!persone.length) persone = p.personeScelte.map(function (pid) { return { persona_id: pid } })
      var r = riempiAutomatico({ oreTotali: -delta, dataInizio: aggiungiGiorni(fine, 1), persone: persone, cal: p.cal, commessa: p.commessa, assenze: p.assenze, viaggioIncluso: p.viaggioIncluso })
      lista = lista.concat(r.assegnazioni)
    }
    return lista
  }
  // "Finito il …" prima del previsto: si liberano le assegnazioni dopo quella data
  function pianoFinitoIl(assCommessa, finitoIl) {
    return {
      restano: assCommessa.filter(function (a) { return a.data <= finitoIl }),
      liberate: assCommessa.filter(function (a) { return a.data > finitoIl })
    }
  }

  // Chiusure che toccano il periodo [dal, al]
  function chiusureNelPeriodo(cal, dal, al) {
    if (!dal || !al) return []
    return cal.chiusure.filter(function (ch) { return ch.dal <= al && ch.al >= dal })
      .sort(function (x, y) { return x.dal < y.dal ? -1 : 1 })
  }
  // «Riempi automaticamente» quando il periodo attraversa una chiusura.
  // scelta: 'sposta_dopo' | 'interrompi' | 'lavora_durante' (con personeScelte)
  // p: gli stessi parametri di riempiAutomatico
  function riempiConChiusura(p, chiusura, scelta, personeScelte) {
    if (scelta === 'sposta_dopo') {
      var q = {}
      Object.keys(p).forEach(function (k) { q[k] = p[k] })
      q.dataInizio = spostaLavorativi(p.cal, aggiungiGiorni(chiusura.al, 1), 0)
      return riempiAutomatico(q)
    }
    var base = riempiAutomatico(p)          // salta già la chiusura: è «interrompi e riprendi»
    if (scelta !== 'lavora_durante') return base
    var lista = pianoLavoraDurante({ assCommessa: base.assegnazioni, chiusura: chiusura, personeScelte: personeScelte || [], cal: p.cal,
      commessa: p.commessa, viaggioIncluso: p.viaggioIncluso, assenze: p.assenze })
    var date = lista.map(function (a) { return a.data }).sort()
    return { assegnazioni: lista, fine: date[date.length - 1] || null, oreNonCoperte: base.oreNonCoperte }
  }
  // Lo spostamento ha portato almeno un giorno dall'estate all'inverno (o viceversa)?
  // vecchie e nuove nello stesso ordine (i piani di spostamento lo mantengono).
  function cambiaPeriodo(vecchie, nuove, cal) {
    for (var i = 0; i < Math.min(vecchie.length, nuove.length); i++) {
      if (eInverno(cal, vecchie[i].data) !== eInverno(cal, nuove[i].data)) return true
    }
    return false
  }
  // «Ricalcola con le ore del nuovo periodo»: rifà Riempi con le stesse persone
  // (in ordine di comparsa) e la data d'inizio di adesso. Le modifiche a mano si perdono.
  function pianoRicalcola(assCommessa, p) {
    var ordinate = assCommessa.slice().sort(function (x, y) { return x.data < y.data ? -1 : x.data > y.data ? 1 : (x.posizione || 1) - (y.posizione || 1) })
    var viste = {}, persone = []
    ordinate.forEach(function (a) {
      var k = a.persona_id ? 'p:' + a.persona_id : 's:' + a.segnaposto
      if (viste[k]) return
      viste[k] = 1
      persone.push(a.persona_id ? { persona_id: a.persona_id } : { segnaposto: a.segnaposto })
    })
    if (!ordinate.length) return { assegnazioni: [], fine: null, oreNonCoperte: p.oreTotali }
    return riempiAutomatico({ oreTotali: p.oreTotali, dataInizio: ordinate[0].data, persone: persone, cal: p.cal, commessa: p.commessa,
      assenze: p.assenze, viaggioIncluso: p.viaggioIncluso, altreAssegnazioni: p.altreAssegnazioni })
  }

  // «Elimina commessa»: solo in Bozza. Dice cosa sparisce.
  function eliminazioneCommessa(c, capitoli, assegnazioni, previste) {
    if (!c || !c.id || c.stato !== 'Bozza' || c.interna) return { permessa: false, testo: 'Si elimina solo una commessa in stato Bozza. Le altre si mettono «Finito».' }
    var nc = (capitoli || []).filter(function (x) { return x.commessa_id === c.id }).length
    var na = (assegnazioni || []).filter(function (x) { return x.commessa_id === c.id }).length
    var np = (previste || []).filter(function (x) { return x.commessa_id === c.id }).length
    return {
      permessa: true, capitoli: nc, assegnazioni: na, previste: np,
      testo: 'Eliminare ' + c.numero + ' ' + c.nome + '? Spariscono anche ' + nc + (nc === 1 ? ' capitolo' : ' capitoli') + ' e ' +
        na + (na === 1 ? ' assegnazione' : ' assegnazioni') + (np ? ' (e ' + np + ' righe del «previsto»)' : '') + '. Non si può tornare indietro.'
    }
  }
  // Riparazione: il campo «Ore stimate» tiene un capitolo unico «Riparazione».
  // Restituisce { azione: 'nessuna'|'inserisci'|'aggiorna'|'bloccata', id, ore, motivo }
  function capitoloRiparazione(capitoliCommessa, ore) {
    var caps = capitoliCommessa || []
    var unico = caps.length === 1 && caps[0].nome === 'Riparazione' ? caps[0] : null
    if (caps.length && !unico) return { azione: 'bloccata', motivo: 'Questa riparazione ha già ' + caps.length + ' capitoli: le ore stimate sono la loro somma (' + fmtOre(sommaOre(caps)) + ').' }
    if (ore === null || ore === undefined || ore === '' || isNaN(ore)) return { azione: 'nessuna' }
    if (!(ore > 0)) return { azione: 'bloccata', motivo: 'Ore stimate: più di 0.' }
    ore = Math.round(ore * 100) / 100
    if (!unico) return { azione: 'inserisci', ore: ore }
    if (Math.abs(Number(unico.ore) - ore) < 1e-9) return { azione: 'nessuna' }
    return { azione: 'aggiorna', id: unico.id, ore: ore }
  }

  // ── Poche ore residue (avviso 9) ──────────────────────────────────────────
  // Opzione A: il giorno in più (com'è). Opzione B, eccezione: allungare di +1 h
  // gli ultimi lun-gio pieni e togliere il giorno corto.
  function settimanaMassima(assTutte, personaId, lunedi, cal, commesse, viaggioIncluso) {
    var tot = 0
    for (var i = 0; i < 7; i++) tot += caricoGiorno(assTutte, personaId, aggiungiGiorni(lunedi, i), commesse, viaggioIncluso)
    return tot
  }
  function caricoGiorno(assTutte, personaId, iso, commesse, viaggioIncluso) {
    var l = assTutte.filter(function (a) { return a.persona_id === personaId && a.data === iso })
    var ore = sommaOre(l)
    if (viaggioIncluso === false) {
      var visti = {}
      l.forEach(function (a) {
        if (visti[a.commessa_id]) return
        visti[a.commessa_id] = 1
        var c = (commesse || []).find(function (x) { return x.id === a.commessa_id })
        ore += 2 * Number((c && c.viaggio_min_andata) || 0) / 60
      })
    }
    return Math.round(ore * 100) / 100
  }
  function opzioniPocheOre(p) {
    // p: { commessa, assTutte, cal, commesse, viaggioIncluso, maxSettimanale }
    var c = p.commessa
    var ass = p.assTutte.filter(function (a) { return a.commessa_id === c.id })
    var rie = riepilogoCommessa(c, [], p.assTutte, p.cal, p.viaggioIncluso)
    if (!rie.ultimoGiorno) return null
    var ug = rie.ultimoGiorno
    var nPers = ug.persone.length
    var perPersona = ug.oreLavoro / nPers
    var viaggio = 2 * Number(c.viaggio_min_andata || 0) / 60
    var A = { lavoro: perPersona, viaggio: viaggio,
      testo: 'Giorno in più → ' + fmtOre(perPersona) + ' di lavoro + ' + fmtOre(viaggio) + ' di viaggio a persona' }
    // B: giorni pieni precedenti (lun-gio prima), dal più vicino alla fine
    var giorniPrima = rie.date.filter(function (d) { return d < ug.data }).reverse()
    var lungio = giorniPrima.filter(function (d) { return giornoSettimana(d) <= 4 })
    var altri = giorniPrima.filter(function (d) { return giornoSettimana(d) === 5 })
    var candidati = lungio.concat(altri)
    var nGiorni = Math.ceil(perPersona - 1e-9)
    if (candidati.length < nGiorni || nGiorni < 1) return { A: A, B: null, ultimo: ug }
    var scelti = candidati.slice(0, nGiorni).sort()
    // nuova lista
    var nuova = ass.filter(function (a) { return a.data !== ug.data }).map(function (a) { return copia(a) })
    ug.persone.forEach(function (pp) {
      var daAggiungere = pp.lavoro
      scelti.forEach(function (d) {
        if (daAggiungere <= 1e-9) return
        var piu = Math.min(1, daAggiungere)
        var riga = nuova.find(function (a) { return a.data === d && chiavePersona(a) === pp.chiave })
        if (riga) { riga.ore = Math.round((Number(riga.ore) + piu) * 1000) / 1000; daAggiungere -= piu }
      })
      // se una persona non lavorava in quei giorni, il resto torna sull'ultimo giorno
      if (daAggiungere > 1e-9) nuova.push({ data: ug.data, persona_id: pp.persona_id, segnaposto: pp.segnaposto, commessa_id: c.id, ore: daAggiungere, posizione: 1 })
    })
    // settimana più carica dopo la modifica, fra le persone vere
    var altreAss = p.assTutte.filter(function (a) { return a.commessa_id !== c.id }).concat(nuova)
    var settimanaMax = 0
    ug.persone.forEach(function (pp) {
      if (!pp.persona_id) {
        // segnaposto: si conta solo questa commessa
        var sett = {}
        nuova.filter(function (a) { return chiavePersona(a) === pp.chiave }).forEach(function (a) {
          var l = lunediDi(a.data); sett[l] = (sett[l] || 0) + Number(a.ore)
        })
        Object.keys(sett).forEach(function (l) { settimanaMax = Math.max(settimanaMax, sett[l]) })
        return
      }
      Array.from(new Set(scelti.map(lunediDi))).forEach(function (l) {
        settimanaMax = Math.max(settimanaMax, settimanaMassima(altreAss, pp.persona_id, l, p.cal, p.commesse, p.viaggioIncluso))
      })
    })
    var oreGiornataLunga = oreGiornataCommessa(p.cal, scelti[0], c) + 1
    var oltre = settimanaMax > p.maxSettimanale + 1e-9
    var B = {
      giorni: scelti, nGiorni: nGiorni, oreGiornata: oreGiornataLunga, settimana: settimanaMax, oltreMassimo: oltre,
      nuoveAssegnazioni: nuova,
      testo: 'allungare ' + nGiorni + (nGiorni === 1 ? ' giorno' : ' giorni') + ' di +1 h (giornate da ' + fmtOre(oreGiornataLunga) +
        ') → settimana a ' + fmtOre(settimanaMax) + (oltre ? ', oltre il massimo di ' + fmtNum(p.maxSettimanale) : '')
    }
    return { A: A, B: B, ultimo: ug }
  }

  // ── Differenze previsto / ora (avviso 7) ──────────────────────────────────
  function differenzePreviste(previste, attuali, nomeDi) {
    function perData(l) {
      var m = {}
      l.forEach(function (a) {
        if (!m[a.data]) m[a.data] = {}
        var k = chiavePersona(a)
        m[a.data][k] = (m[a.data][k] || 0) + Number(a.ore)
      })
      return m
    }
    function descrivi(x) {
      if (!x) return 'nessuno'
      return Object.keys(x).sort().map(function (k) { return nomeDi(k) + ' ' + fmtOre(x[k]) }).join(', ')
    }
    var P = perData(previste), O = perData(attuali)
    var date = Array.from(new Set(Object.keys(P).concat(Object.keys(O)))).sort()
    var out = []
    date.forEach(function (d) {
      var a = descrivi(P[d]), b = descrivi(O[d])
      if (a !== b) out.push({ data: d, previsto: a, ora: b })
    })
    return out
  }

  // ── Avvisi ────────────────────────────────────────────────────────────────
  var TIPI_AVVISO = {
    1: { icona: '⚠️', etichetta: 'Due cantieri in una giornata piena' },
    2: { icona: '⏱️', etichetta: 'Ore oltre la giornata' },
    3: { icona: '📅', etichetta: 'Settimana oltre il massimo' },
    4: { icona: '🚫', etichetta: 'Persona assente' },
    5: { icona: '⛔', etichetta: 'Giorno non lavorativo' },
    6: { icona: '🏭', etichetta: 'Commessa dentro una chiusura' },
    7: { icona: '🔄', etichetta: 'Previsto / ora' },
    8: { icona: '🕒', etichetta: 'Ore libere ultimo giorno' },
    9: { icona: '➗', etichetta: 'Poche ore residue' },
    10: { icona: '✅', etichetta: 'Finito prima' },
    11: { icona: '👷', etichetta: 'Persona senza lavoro' },
    12: { icona: '🏗️', etichetta: 'Cantiere senza persone' },
    residuo: { icona: '📋', etichetta: 'Ore da pianificare' },
    meteo: { icona: '🌧️', etichetta: 'Dati pioggia mancanti' },
    periodo: { icona: '🌗', etichetta: 'Cambio estate / inverno' }
  }
  var STATI_ATTIVI = ['Confermato', 'In corso']

  // S: { imp, cal, persone:[{id,nome}], assenze, commesse, capitoli, assegnazioni,
  //      previste, ignorati:[chiave], oggi, meteoVuoto, orizzonteGiorni }
  function calcolaAvvisi(S) {
    var cal = S.cal, imp = cal.imp
    var viaggioIncluso = imp.viaggio_incluso !== false
    var out = []
    var commesse = S.commesse || [], ass = S.assegnazioni || []
    var perId = {}; commesse.forEach(function (c) { perId[c.id] = c })
    // S.nomi: i nomi di tutti (anche chi non è più attivo ma ha assegnazioni)
    var nomi = {}; Object.keys(S.nomi || {}).forEach(function (k) { nomi[k] = S.nomi[k] })
    ;(S.persone || []).forEach(function (p) { nomi[p.id] = p.nome })
    function nomePersona(pid) { return nomi[pid] || 'Persona sconosciuta' }
    function nomeChiave(k) {
      if (k.indexOf('p:') === 0) return nomePersona(k.slice(2))
      return 'Persona ' + k.split(':')[2]
    }
    function num(c) { return c ? c.numero : '?' }
    function push(tipo, chiave, testo, data, extra) {
      var t = TIPI_AVVISO[tipo]
      var a = { tipo: tipo, chiave: chiave, icona: t.icona, etichetta: t.etichetta, testo: testo, data: data || null }
      Object.keys(extra || {}).forEach(function (k) { a[k] = extra[k] })
      out.push(a)
    }

    // Carico per persona e giorno (solo persone vere)
    var carico = {}
    ass.forEach(function (a) {
      if (!a.persona_id) return
      var k = a.persona_id + '|' + a.data
      if (!carico[k]) carico[k] = { persona_id: a.persona_id, data: a.data, perCommessa: {} }
      carico[k].perCommessa[a.commessa_id] = (carico[k].perCommessa[a.commessa_id] || 0) + Number(a.ore)
    })
    var soglia = Number(imp.soglia_giornata_piena)
    Object.keys(carico).forEach(function (k) {
      var x = carico[k]
      var ids = Object.keys(x.perCommessa)
      var dett = ids.map(function (id) { return num(perId[id]) + ' · ' + fmtOre(x.perCommessa[id]) }).join(', ')
      // 1. due cantieri in una giornata piena
      if (ids.length >= 2 && ids.some(function (id) { return x.perCommessa[id] > soglia + 1e-9 })) {
        push(1, '1|' + k, nomePersona(x.persona_id) + ', ' + fmtGiorno(x.data) + ': più di ' + fmtOre(soglia) +
          ' in un cantiere e un secondo cantiere lo stesso giorno (' + dett + ')', x.data, { persona_id: x.persona_id })
      }
      // 2. ore oltre la giornata
      var tot = caricoGiorno(ass, x.persona_id, x.data, commesse, viaggioIncluso)
      var base = oreBase(cal, x.data)
      if (tot > base + 1e-9) {
        push(2, '2|' + k + '|' + tot, nomePersona(x.persona_id) + ', ' + fmtGiorno(x.data) + ': ' + fmtOre(tot) + ' su una giornata di ' +
          fmtOre(base) + ' (' + dett + (viaggioIncluso ? '' : ', viaggio compreso') + ')', x.data, { persona_id: x.persona_id })
      }
      // 4. persona assente
      var as = assenzaDi(S.assenze, x.persona_id, x.data)
      if (as) {
        push(4, '4|' + k, nomePersona(x.persona_id) + ' è assegnato/a ' + fmtGiorno(x.data) + ' (' + dett + ') ma è assente: ' +
          as.tipo + (as.nota ? ' · ' + as.nota : ''), x.data, { persona_id: x.persona_id })
      }
    })
    // 3. settimana oltre il massimo
    var settimane = {}
    Object.keys(carico).forEach(function (k) {
      var x = carico[k]
      var sk = x.persona_id + '|' + lunediDi(x.data)
      settimane[sk] = (settimane[sk] || 0) + caricoGiorno(ass, x.persona_id, x.data, commesse, viaggioIncluso)
    })
    var max = Number(imp.max_settimanale)
    Object.keys(settimane).forEach(function (sk) {
      var tot = Math.round(settimane[sk] * 100) / 100
      if (tot > max + 1e-9) {
        var pid = sk.split('|')[0], lun = sk.split('|')[1]
        push(3, '3|' + sk + '|' + tot, nomePersona(pid) + ', settimana dal ' + fmtGiorno(lun) + ': ' + fmtOre(tot) +
          ', oltre il massimo di ' + fmtOre(max), lun, { persona_id: pid })
      }
    })
    // 5. giorno non lavorativo
    var visti5 = {}
    ass.forEach(function (a) {
      if (a.nota && /ferie da recuperare/i.test(a.nota)) return
      var info = infoGiorno(cal, a.data)
      if (info.lavorativo) return
      var k = a.commessa_id + '|' + a.data
      if (visti5[k]) return
      visti5[k] = 1
      push(5, '5|' + k, num(perId[a.commessa_id]) + ', ' + fmtGiorno(a.data) + ': assegnazione su un giorno non lavorativo (' + info.etichetta + ')',
        a.data, { commessa_id: a.commessa_id })
    })

    // Per commessa
    var meteoAvvisato = false
    commesse.forEach(function (c) {
      var assC = ass.filter(function (a) { return a.commessa_id === c.id })
      var capC = (S.capitoli || []).filter(function (x) { return x.commessa_id === c.id })
      var rie = riepilogoCommessa(c, capC, ass, cal, viaggioIncluso)
      var finita = c.stato === 'Finito'

      // Ore da pianificare (punto 5)
      // (una riparazione ancora senza date sta in coda: non è un'ora «mancante»)
      var inCoda = c.tipo === 'Riparazione' && !assC.length
      if (!c.interna && !finita && capC.length && !inCoda) {
        if (rie.residue > 1e-9) push('residuo', 'r|' + c.id + '|' + rie.residue, c.numero + ' ' + c.nome + ': mancano ' + fmtOre(rie.residue) + ' non pianificate', rie.fine || c.data_inizio, { commessa_id: c.id })
        else if (rie.residue < -1e-9) push('residuo', 'r|' + c.id + '|' + rie.residue, c.numero + ' ' + c.nome + ': pianificate ' + fmtOre(-rie.residue) + ' oltre il preventivo', rie.fine, { commessa_id: c.id })
      }
      if (!assC.length) return

      // 6. dentro una chiusura: solo se almeno un'assegnazione cade dentro
      // (le "ferie da recuperare" sono già una scelta fatta, non contano)
      if (!finita) {
        cal.chiusure.forEach(function (ch) {
          var dentro = assC.filter(function (a) { return a.data >= ch.dal && a.data <= ch.al && !(a.nota && /ferie da recuperare/i.test(a.nota)) })
          if (dentro.length) {
            var gd = Array.from(new Set(dentro.map(function (a) { return a.data }))).sort()
            push(6, '6|' + c.id + '|' + ch.dal + '|' + ch.al + '|' + gd.join(','),
              c.numero + ' ' + c.nome + ': ' + gd.length + (gd.length === 1 ? ' giorno pianificato' : ' giorni pianificati') + ' dentro la chiusura ' +
              (ch.motivo ? '«' + ch.motivo + '» ' : '') + 'dal ' + fmtDataAnno(ch.dal) + ' al ' + fmtDataAnno(ch.al) + ' (' + gd.map(fmtGiorno).join(', ') + ')',
              ch.dal, { commessa_id: c.id, chiusura: ch, azioni: [
                { id: 'sposta_dopo', etichetta: 'Sposta tutto dopo la chiusura' },
                { id: 'interrompi', etichetta: 'Interrompi e riprendi dopo' },
                { id: 'lavora_durante', etichetta: 'Qualcuno lavora durante la chiusura' }
              ] })
          }
        })
      }

      // Spostata fra estate e inverno: le ore sono rimaste quelle di prima
      if (c.periodo_cambiato && !finita && !c.interna) {
        push('periodo', 'p|' + c.id + '|' + rie.inizio + '|' + rie.fine, c.numero + ' ' + c.nome + ' è stata spostata fra estate e inverno: ' +
          'le ore di ogni giorno sono rimaste quelle di prima (' + fmtGiorno(rie.inizio) + ' – ' + fmtGiorno(rie.fine) + ')', rie.inizio,
          { commessa_id: c.id, azioni: [{ id: 'ricalcola', etichetta: 'Ricalcola con le ore del nuovo periodo' }] })
      }

      // 7. previsto / ora
      var prev = (S.previste || []).filter(function (a) { return a.commessa_id === c.id })
      if (prev.length && STATI_ATTIVI.indexOf(c.stato) >= 0) {
        differenzePreviste(prev, assC, nomeChiave).forEach(function (d) {
          push(7, '7|' + c.id + '|' + d.data + '|' + d.previsto + '|' + d.ora, c.numero + ', ' + fmtGiorno(d.data) + ': previsto ' + d.previsto + ' · ora ' + d.ora,
            d.data, { commessa_id: c.id })
        })
      }

      // 8 e 9. ultimo giorno
      if (!c.interna && !finita && rie.ultimoGiorno && rie.residue <= 1e-9 && rie.orePreventivo > 0) {
        var ug = rie.ultimoGiorno
        if (ug.oreLibere > 1e-9) {
          var uguali = ug.persone.every(function (x) { return Math.abs(x.libere - ug.persone[0].libere) < 1e-9 })
          var testa = ug.persone.length > 1
            ? (uguali ? ' (' + fmtNum(ug.persone[0].libere, 2) + ' a testa)' : ' (' + ug.persone.map(function (x) { return nomeChiave(x.chiave) + ' ' + fmtNum(x.libere, 2) }).join(', ') + ')')
            : ''
          var proposte = []
          ;(S.riparazioniInCoda || []).forEach(function (r) {
            if (r.oreStimate > 0 && r.oreStimate <= ug.oreLibere + 1e-9) proposte.push({ id: 'riparazione', commessa_id: r.id, etichetta: 'Riparazione ' + r.numero + ' ' + r.nome + ' · ' + fmtOre(r.oreStimate) + (r.indirizzo ? ' · ' + r.indirizzo : '') })
          })
          proposte.push({ id: 'magazzino', etichetta: 'Magazzino' })
          var succ = commessaSuccessiva(c, rie, commesse, ass)
          if (succ) proposte.push({ id: 'anticipa', commessa_id: succ.id, etichetta: 'Anticipa il cantiere successivo (' + succ.numero + ' ' + succ.nome + ')' })
          else proposte.push({ id: 'anticipa', commessa_id: null, etichetta: 'Anticipa il cantiere successivo (nessuno trovato)' })
          push(8, '8|' + c.id + '|' + ug.data + '|' + ug.oreLibere, c.numero + ' · ultimo giorno ' + fmtGiorno(ug.data) + ': ' + fmtOre(ug.oreLavoro) + ' di lavoro, ' +
            fmtOre(ug.oreLibere) + ' libere' + testa, ug.data, { commessa_id: c.id, azioni: proposte })
        }
        // 9. poche ore: l'ultimo giorno è meno di metà della giornata
        if (ug.oreLavoro < ug.capacita * ug.persone.length / 2 - 1e-9 && rie.giorni >= 2) {
          var op = opzioniPocheOre({ commessa: c, assTutte: ass, cal: cal, commesse: commesse, viaggioIncluso: viaggioIncluso, maxSettimanale: max })
          if (op) {
            var az = [{ id: 'opzione_a', etichetta: 'A: ' + op.A.testo }]
            if (op.B) az.push({ id: 'opzione_b', etichetta: 'B (eccezione): ' + op.B.testo })
            push(9, '9|' + c.id + '|' + ug.data + '|' + ug.oreLavoro, c.numero + ': dopo l\'ultimo giorno pieno restano ' + fmtOre(ug.oreLavoro) +
              ' che non riempiono una giornata (' + fmtGiorno(ug.data) + ')', ug.data, { commessa_id: c.id, azioni: az, opzioni: op })
          }
        }
      }

      // 12. cantiere confermato senza persone
      if (STATI_ATTIVI.indexOf(c.stato) >= 0 && !c.interna) {
        var buchi = []
        for (var d = rie.inizio; d <= rie.fine; d = aggiungiGiorni(d, 1)) {
          if (eLavorativo(cal, d) && rie.date.indexOf(d) < 0) buchi.push(d)
        }
        if (buchi.length) {
          push(12, '12|' + c.id + '|' + buchi.join(','), c.numero + ' ' + c.nome + ' è ' + c.stato.toLowerCase() + ' ma nessuno è in cantiere: ' +
            buchi.slice(0, 6).map(fmtGiorno).join(', ') + (buchi.length > 6 ? ' e altri ' + (buchi.length - 6) : ''), buchi[0], { commessa_id: c.id })
        }
      }
    })

    // 10. finito prima
    commesse.forEach(function (c) {
      if (c.stato !== 'Finito' || !c.finito_il || !c.fine_pianificata || c.finito_il >= c.fine_pianificata) return
      var giorniLib = giorniLavorativiFra(cal, aggiungiGiorni(c.finito_il, 1), c.fine_pianificata)
      var rie = { fine: c.finito_il }
      var succ = commessaSuccessiva(c, rie, commesse, ass)
      var az = []
      if (succ) az.push({ id: 'anticipa', commessa_id: succ.id, giorni: giorniLib, etichetta: 'Anticipa ' + succ.numero + ' ' + succ.nome + ' di ' + fmtGiorniLavorativi(giorniLib) })
      else az.push({ id: 'anticipa', commessa_id: null, etichetta: 'Anticipa la commessa successiva (nessuna trovata)' })
      az.push({ id: 'riparazione', commessa_id: null, etichetta: 'Riparazione in coda' })
      az.push({ id: 'magazzino', etichetta: 'Magazzino' })
      push(10, '10|' + c.id + '|' + c.finito_il, c.numero + ' ' + c.nome + ' finito il ' + fmtGiorno(c.finito_il) + ', prima del previsto (' +
        fmtGiorno(c.fine_pianificata) + '): ' + fmtGiorniLavorativi(giorniLib) + (giorniLib === 1 ? ' libero' : ' liberi'), c.finito_il, { commessa_id: c.id, azioni: az })
    })

    // 11. persona senza lavoro (da oggi per l'orizzonte), raggruppato per settimana
    var oggi = S.oggi || oggiIso()
    var orizzonte = S.orizzonteGiorni || 28
    ;(S.persone || []).forEach(function (p) {
      var perSett = {}
      for (var i = 0; i < orizzonte; i++) {
        var d = aggiungiGiorni(oggi, i)
        if (!eLavorativo(cal, d)) continue
        if (assenzaDi(S.assenze, p.id, d)) continue
        if (p.data_fine_rapporto && d > p.data_fine_rapporto) continue
        if (carico[p.id + '|' + d]) continue
        var l = lunediDi(d)
        ;(perSett[l] = perSett[l] || []).push(d)
      }
      Object.keys(perSett).sort().forEach(function (l) {
        var g = perSett[l]
        push(11, '11|' + p.id + '|' + g.join(','), p.nome + ' senza lavoro: ' + g.map(fmtGiorno).join(', '), g[0], { persona_id: p.id })
      })
    })

    if (S.meteoVuoto && !meteoAvvisato) {
      push('meteo', 'meteo|vuoto', 'Dati pioggia mancanti: la tabella dei valori normali MeteoSvizzera è vuota, il margine pioggia non si può calcolare', null)
    }

    var ign = {}; (S.ignorati || []).forEach(function (k) { ign[k] = 1 })
    out.forEach(function (a) { a.ignorato = !!ign[a.chiave] })
    out.sort(function (x, y) { return (x.data || '9999') < (y.data || '9999') ? -1 : (x.data || '9999') > (y.data || '9999') ? 1 : 0 })
    return out
  }
  // La commessa che viene dopo: la prima che inizia dopo la fine di questa e
  // ha almeno una persona in comune (se nessuna in comune, la prima che inizia dopo).
  function commessaSuccessiva(c, rie, commesse, ass) {
    var persone = new Set(ass.filter(function (a) { return a.commessa_id === c.id && a.persona_id }).map(function (a) { return a.persona_id }))
    var cand = []
    commesse.forEach(function (x) {
      if (x.id === c.id || x.stato === 'Finito' || x.interna) return
      var ax = ass.filter(function (a) { return a.commessa_id === x.id })
      if (!ax.length) return
      var inizio = ax.map(function (a) { return a.data }).sort()[0]
      if (inizio <= rie.fine) return
      var comune = ax.some(function (a) { return persone.has(a.persona_id) })
      cand.push({ c: x, inizio: inizio, comune: comune })
    })
    cand.sort(function (a, b) { return (b.comune - a.comune) || (a.inizio < b.inizio ? -1 : 1) })
    return cand.length ? cand[0].c : null
  }

  // ── Viste ─────────────────────────────────────────────────────────────────
  // Giorni da mostrare: settimana (lun-dom), mese, 3 mesi
  function intervalloVista(zoom, ancora) {
    if (zoom === 'settimana') { var l = lunediDi(ancora); return { dal: l, al: aggiungiGiorni(l, 6) } }
    var a = anno(ancora), m = mese(ancora)
    var dal = isoDa(a, m, 1)
    if (zoom === 'mese') return { dal: dal, al: isoDa(a, m, giorniNelMese(a, m)) }
    var m3 = m + 2, a3 = a
    if (m3 > 12) { m3 -= 12; a3++ }
    return { dal: dal, al: isoDa(a3, m3, giorniNelMese(a3, m3)) }
  }
  function spostaVista(zoom, ancora, verso) {
    if (zoom === 'settimana') return aggiungiGiorni(ancora, 7 * verso)
    var a = anno(ancora), m = mese(ancora) + (zoom === 'mese' ? 1 : 3) * verso
    while (m > 12) { m -= 12; a++ }
    while (m < 1) { m += 12; a-- }
    return isoDa(a, m, 1)
  }
  // I margini accettati, giorno per giorno dopo la fine (solo giorni lavorativi).
  // Restituisce [{ data, tipo:'pioggia'|'malattia'|'libero', etichetta, quota (0.5 o 1) }]
  function blocchiMargine(commessa, fine, cal) {
    if (!fine) return []
    var ma = commessa.margini_accettati || {}
    var voci = []
    if (ma.pioggia && ma.pioggia.stato === 'Aggiunto' && ma.pioggia.giorni > 0) voci.push({ tipo: 'pioggia', giorni: +ma.pioggia.giorni, etichetta: 'Pioggia ' + fmtNum(ma.pioggia.giorni) + ' g' })
    if (ma.malattia && ma.malattia.stato === 'Aggiunto' && ma.malattia.giorni > 0) voci.push({ tipo: 'malattia', giorni: +ma.malattia.giorni, etichetta: 'Malattia ' + fmtNum(ma.malattia.giorni) + ' g' })
    if (Number(commessa.margine_x_giorni) > 0) voci.push({ tipo: 'libero', giorni: +commessa.margine_x_giorni, etichetta: 'Margine ' + fmtNum(commessa.margine_x_giorni) + ' g' + (commessa.margine_x_nota ? ' · ' + commessa.margine_x_nota : '') })
    var out = [], d = fine, aperto = 0
    voci.forEach(function (v) {
      var resto = v.giorni, primo = true
      while (resto > 1e-9) {
        var quota
        if (aperto > 0) { quota = Math.min(aperto, resto); out.push({ data: d, tipo: v.tipo, etichetta: v.etichetta, quota: quota, primo: primo, meta: true }); aperto -= quota; resto -= quota; primo = false; continue }
        d = spostaLavorativi(cal, d, 1)
        quota = Math.min(1, resto)
        out.push({ data: d, tipo: v.tipo, etichetta: v.etichetta, quota: quota, primo: primo })
        primo = false
        resto -= quota
        aperto = 1 - quota
      }
    })
    return out
  }

  return {
    // date
    aData: aData, aIso: aIso, isoDa: isoDa, aggiungiGiorni: aggiungiGiorni, giornoSettimana: giornoSettimana,
    anno: anno, mese: mese, giorniNelMese: giorniNelMese, lunediDi: lunediDi, differenzaGiorni: differenzaGiorni,
    oggiIso: oggiIso, GIORNI_BREVI: GIORNI_BREVI, GIORNI_LUNGHI: GIORNI_LUNGHI, MESI: MESI,
    // numeri
    fmtNum: fmtNum, fmtOre: fmtOre, fmtGiorni: fmtGiorni, fmtGiorniLavorativi: fmtGiorniLavorativi, fmtGiorno: fmtGiorno, fmtDataAnno: fmtDataAnno,
    leggiNumero: leggiNumero, leggiOre: leggiOre, perEccessoMezzo: perEccessoMezzo, perDifettoMezzo: perDifettoMezzo,
    arrotonda5: arrotonda5,
    // calendario
    pasqua: pasqua, festiviTicino: festiviTicino, periodoInvernoProposto: periodoInvernoProposto,
    IMPOSTAZIONI_BASE: IMPOSTAZIONI_BASE, creaCalendario: creaCalendario, periodoInverno: periodoInverno,
    eInverno: eInverno, festivo: festivo, festiviAnno: festiviAnno, chiusuraDi: chiusuraDi, infoGiorno: infoGiorno,
    eLavorativo: eLavorativo, oreBase: oreBase, oreGiornataCommessa: oreGiornataCommessa, oreCantiere: oreCantiere,
    spostaLavorativi: spostaLavorativi, giorniLavorativiFra: giorniLavorativiFra,
    // pianificazione
    chiavePersona: chiavePersona, assenzaDi: assenzaDi, leggiCapitoliIncollati: leggiCapitoliIncollati,
    dividiInMezzore: dividiInMezzore, riempiAutomatico: riempiAutomatico, sommaOre: sommaOre,
    riepilogoCommessa: riepilogoCommessa, caricoGiorno: caricoGiorno,
    // margini
    marginePioggia: marginePioggia, margineMalattia: margineMalattia, malattiaMese: malattiaMese,
    giorniLavorativiMese: giorniLavorativiMese, squadraMalattia: squadraMalattia,
    // piani
    rimappa: rimappa, pianoSposta: pianoSposta, pianoSpostaDopoChiusura: pianoSpostaDopoChiusura, pianoInterrompi: pianoInterrompi,
    pianoLavoraDurante: pianoLavoraDurante, pianoFinitoIl: pianoFinitoIl,
    chiusureNelPeriodo: chiusureNelPeriodo, riempiConChiusura: riempiConChiusura, cambiaPeriodo: cambiaPeriodo, pianoRicalcola: pianoRicalcola,
    eliminazioneCommessa: eliminazioneCommessa, capitoloRiparazione: capitoloRiparazione, opzioniPocheOre: opzioniPocheOre,
    differenzePreviste: differenzePreviste, commessaSuccessiva: commessaSuccessiva,
    // avvisi e viste
    TIPI_AVVISO: TIPI_AVVISO, calcolaAvvisi: calcolaAvvisi, intervalloVista: intervalloVista,
    spostaVista: spostaVista, blocchiMargine: blocchiMargine
  }
})
