/* ═══════════════════════════════════════════════════════════════════════════
   Pianificatore cantieri — APP (pagina)
   I calcoli stanno in calcoli.js (PLC), il database in dati.js (PLD).
   Qui: disegno delle viste, pannelli, scheda commessa, avvisi, impostazioni.
   Regola: AVVISA, NON BLOCCA MAI. Ogni modifica che tocca più giorni si
   conferma prima.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict'
var C = window.PLC, V = window.PLViaggio, D = window.PLD

var ST = {
  dati: null, profilo: null, email: '',
  vista: 'cantieri', zoom: 'mese', ancora: C.oggiIso(), pagina: 'piano',
  cal: null, nomi: {}, persone: [], perId: {}, capPer: {}, assPer: {}, rie: {},
  meteoMap: {}, magazzino: null, coda: [], avvisi: []
}
var PALETTE = ['#2d6a4f', '#1d4ed8', '#b45309', '#7c3aed', '#be123c', '#0f766e', '#4d7c0f', '#c2410c', '#0369a1', '#a21caf']
var STAZIONI = { MAG: 'Magadino', LUG: 'Lugano' }
var STATI = ['Bozza', 'Confermato', 'In corso', 'Finito']

// ── Utilità ─────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id) }
function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  })
}
function f(n, d) { return C.fmtNum(n, d) }
function fOre(n) { return C.fmtOre(n) }
function gAnno(iso) { return iso ? C.fmtGiorno(iso) + '.' + iso.slice(0, 4) : '–' }
function toast(msg, ko) {
  var t = document.createElement('div')
  t.className = 'msg' + (ko ? ' ko' : '')
  t.textContent = msg
  $('toast').appendChild(t)
  while ($('toast').children.length > 3) $('toast').firstChild.remove()   // al massimo 3: non coprono lo schermo
  setTimeout(function () { t.remove() }, ko ? 7000 : 3500)
}
function mezzOra(x) { return Math.round(x * 2) / 2 }
function viaggioIncluso() { return ST.dati.imp.viaggio_incluso !== false }
function hexRgb(h) { h = (h || '#888888').replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c }).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] }
function chiaro(hex) { var c = hexRgb(hex); return 'rgb(' + c.map(function (v) { return Math.round(v + (255 - v) * 0.7) }).join(',') + ')' }
function testoSu(hex) { var c = hexRgb(hex); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 > 0.6 ? '#111' : '#fff' }
function colore(c) { return (c && c.colore) || '#6b7280' }
function nomeChiave(k) {
  if (k.indexOf('p:') === 0) return ST.nomi[k.slice(2)] || 'Persona sconosciuta'
  var p = k.split(':')
  var c = ST.perId[p[1]]
  return 'Persona ' + p[2] + ' (da decidere' + (c ? ', ' + c.numero : '') + ')'
}
function nomeAss(a) { return nomeChiave(C.chiavePersona(a)) }

// ── Finestre (pannelli e conferme) ──────────────────────────────────────────
// ESC chiude la finestra in cima. Clic fuori NON chiude: solo ✕, Chiudi, Annulla, ESC.
var _finestre = []
function apriFinestra(titolo, opz) {
  opz = opz || {}
  var sf = document.createElement('div')
  sf.className = 'sfondo-modale' + (opz.centro ? ' centro' : '')
  sf.innerHTML = '<div class="finestra' + (opz.piccola ? ' piccola' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(titolo) + '">' +
    '<div class="testata-finestra"><h2>' + esc(titolo) + '</h2><button type="button" class="chiudi">✕ Chiudi</button></div>' +
    '<div class="corpo"></div></div>'
  document.body.appendChild(sf)
  var w = { el: sf, corpo: sf.querySelector('.corpo'), opz: opz }
  w.chiudi = function () { chiudiFinestra(w) }
  sf.querySelector('.chiudi').addEventListener('click', w.chiudi)
  _finestre.push(w)
  return w
}
function chiudiFinestra(w) {
  var i = _finestre.indexOf(w)
  if (i < 0) return
  _finestre.splice(i, 1)
  w.el.remove()
  if (w.opz.onChiudi) w.opz.onChiudi()
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && _finestre.length) { e.preventDefault(); chiudiFinestra(_finestre[_finestre.length - 1]) }
})
function conferma(testoHtml, opz) {
  opz = opz || {}
  return new Promise(function (risolvi) {
    var fatto = false
    var w = apriFinestra(opz.titolo || 'Conferma', { centro: true, piccola: true, onChiudi: function () { if (!fatto) risolvi(false) } })
    w.corpo.innerHTML = '<div>' + testoHtml + '</div><div class="riga-bottoni">' +
      '<button type="button" class="' + (opz.pericolo ? 'pericolo' : 'primario') + '" data-si>' + esc(opz.si || 'Conferma') + '</button>' +
      '<button type="button" data-no>Annulla</button></div>'
    w.corpo.querySelector('[data-si]').addEventListener('click', function () { fatto = true; w.chiudi(); risolvi(true) })
    w.corpo.querySelector('[data-no]').addEventListener('click', function () { w.chiudi() })
    w.corpo.querySelector('[data-si]').focus()
  })
}
function mostraErrore(msg) {
  var w = apriFinestra('Attenzione', { centro: true, piccola: true })
  w.corpo.innerHTML = '<div class="esito ko">' + esc(msg).replace(/\n/g, '<br>') + '</div><div class="riga-bottoni"><button type="button" class="primario">OK</button></div>'
  w.corpo.querySelector('button').addEventListener('click', w.chiudi)
}
function gestisciErrore(e) {
  if (e && e.sessioneAssente) { mostraLogin('Sessione assente o scaduta: entra di nuovo. Niente è stato mostrato senza accesso.'); return }
  console.error(e)
  mostraErrore((e && e.message) || String(e))
}
async function esegui(fn) {
  try { return await fn() } catch (e) { gestisciErrore(e) }
}

// ── Avvio, login, blocchi ───────────────────────────────────────────────────
function mostraSolo(id) {
  ;['schermo-login', 'schermo-blocco', 'app'].forEach(function (x) { $(x).hidden = x !== id })
}
function mostraLogin(msg) {
  while (_finestre.length) chiudiFinestra(_finestre[_finestre.length - 1])
  ST.dati = null
  mostraSolo('schermo-login')
  var m = $('login-messaggio')
  m.hidden = !msg
  m.textContent = msg || ''
  $('login-email').focus()
}
function mostraBlocco(titolo, testo) {
  ST.dati = null
  mostraSolo('schermo-blocco')
  $('blocco-titolo').textContent = titolo
  $('blocco-testo').textContent = testo
}
async function entraNellApp() {
  try {
    var acc = await D.controllaAccesso()
    if (!acc.ok) {
      if (acc.motivo === 'sql') mostraBlocco('Database non pronto', 'Manca lo SQL del Pianificatore. Va lanciato in Supabase → SQL Editor il file sql/da_applicare/PL_01_tabelle.sql, poi Ctrl+F5. (' + (acc.dettaglio || '') + ')')
      else mostraBlocco('Accesso riservato', 'Il Pianificatore è solo per titolare e responsabile. Il profilo di questo utente non lo permette: il piano non viene mostrato.')
      return
    }
    ST.profilo = acc.profilo
    ST.email = acc.email
    await ricaricaTutto()
    mostraSolo('app')
    disegna()
  } catch (e) {
    if (e && e.sessioneAssente) return mostraLogin('Sessione assente o scaduta: entra di nuovo.')
    console.error(e)
    mostraBlocco('Dati non leggibili', e.message + ' — Il piano non viene mostrato finché i dati non si leggono per intero.')
  }
}
async function ricaricaTutto() {
  ST.dati = await D.caricaTutto()
  ricostruisci()
}
var TABELLE = {
  commesse: ['pl_commesse', '*', 'numero'], capitoli: ['pl_capitoli', '*', 'commessa_id,ordine'],
  assegnazioni: ['pl_assegnazioni', '*', 'data,posizione'], previste: ['pl_assegnazioni_previste', '*', 'data'],
  assenze: ['pl_assenze', '*', 'dal'], chiusure: ['pl_chiusure', '*', 'dal'], festivi: ['pl_festivi', '*', 'data'],
  periodi: ['pl_periodi_inverno', '*', 'anno']
}
async function ricarica(nomi) {
  var r = await Promise.all(nomi.map(function (n) { var t = TABELLE[n]; return D.leggi(t[0], t[1], t[2]) }))
  nomi.forEach(function (n, i) { ST.dati[n] = r[i] })
  ricostruisci()
  disegna()
}
async function ricaricaImpostazioni() {
  var r = await D.leggi('pl_impostazioni', '*')
  if (r.length !== 1) throw new Error('Impostazioni non leggibili (' + r.length + ' righe invece di 1): il piano non è attendibile. Esci e rientra.')
  ST.dati.imp = r[0]
  ricostruisci(); disegna()
}
async function ricaricaIgnorati() {
  ST.dati.ignorati = (await D.leggi('pl_avvisi_ignorati', 'chiave')).map(function (r) { return r.chiave })
  ricostruisci(); disegna()
}

function nomeOperaio(o) { return ((o.nome || '') + ' ' + (o.cognome || '')).trim() || 'Senza nome' }
function ricostruisci() {
  var d = ST.dati
  ST.cal = C.creaCalendario({ imp: d.imp, periodiInverno: d.periodi, festivi: d.festivi, chiusure: d.chiusure })
  ST.nomi = {}
  d.operai.forEach(function (o) { ST.nomi[o.id] = nomeOperaio(o) })
  var oggi = C.oggiIso()
  ST.persone = d.operai.filter(function (o) { return o.attivo !== false && (!o.data_fine_rapporto || o.data_fine_rapporto >= oggi) })
    .map(function (o) { return { id: o.id, nome: ST.nomi[o.id], data_fine_rapporto: o.data_fine_rapporto } })
    .sort(function (a, b) { return a.nome.localeCompare(b.nome) })
  ST.titolariMancanti = titolariNonInOperai()
  ST.perId = {}; d.commesse.forEach(function (c) { ST.perId[c.id] = c })
  ST.capPer = {}; d.capitoli.forEach(function (x) { (ST.capPer[x.commessa_id] = ST.capPer[x.commessa_id] || []).push(x) })
  ST.assPer = {}; d.assegnazioni.forEach(function (x) { (ST.assPer[x.commessa_id] = ST.assPer[x.commessa_id] || []).push(x) })
  ST.rie = {}
  ST.meteoMap = {}
  d.meteo.filter(function (r) { return r.stazione === d.imp.stazione_meteo }).forEach(function (r) { ST.meteoMap[r.mese] = Number(r.giorni_pioggia) })
  ST.magazzino = d.commesse.find(function (c) { return c.numero === PL_CONFIG.NUMERO_MAGAZZINO }) || d.commesse.find(function (c) { return c.interna }) || null
  ST.coda = d.commesse.filter(function (c) { return c.tipo === 'Riparazione' && c.stato === 'Confermato' && !(ST.assPer[c.id] || []).length })
    .map(function (c) { return { id: c.id, numero: c.numero, nome: c.nome, indirizzo: c.indirizzo, colore: c.colore, oreStimate: C.sommaOre(ST.capPer[c.id] || []) } })
  ST.avvisi = C.calcolaAvvisi({
    cal: ST.cal, persone: ST.persone, nomi: ST.nomi, assenze: d.assenze, commesse: d.commesse, capitoli: d.capitoli,
    assegnazioni: d.assegnazioni, previste: d.previste, ignorati: d.ignorati, oggi: oggi,
    meteoVuoto: !Object.keys(ST.meteoMap).length, riparazioniInCoda: ST.coda, orizzonteGiorni: 28
  })
}
// Il titolare lavora in cantiere: deve essere fra gli operai attivi. Si riconosce come
// fa l'App Cantieri: stessa email (per chi è collegato) oppure stesso «nome cognome».
function normNome(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim() }
function titolariNonInOperai() {
  var attivi = ST.persone.map(function (p) { return ST.dati.operai.find(function (o) { return o.id === p.id }) })
  return (ST.dati.profili || []).filter(function (p) { return p.ruolo === 'titolare' }).filter(function (p) {
    return !attivi.some(function (o) {
      if (p.id === (ST.profilo && ST.profilo.id) && o.email && ST.email && o.email.toLowerCase() === ST.email.toLowerCase()) return true
      var n = normNome(p.nome)
      return n && (n === normNome(o.nome + ' ' + o.cognome) || n === normNome(o.cognome + ' ' + o.nome))
    })
  }).map(function (p) { return p.nome || 'titolare' })
}
function rie(c) {
  if (!ST.rie[c.id]) ST.rie[c.id] = C.riepilogoCommessa(c, ST.capPer[c.id] || [], ST.dati.assegnazioni, ST.cal, viaggioIncluso())
  return ST.rie[c.id]
}

// ── Disegno generale ────────────────────────────────────────────────────────
function disegna() {
  if (!ST.dati) return
  document.querySelectorAll('[data-vista]').forEach(function (b) { b.setAttribute('aria-pressed', String(ST.pagina === 'piano' && b.dataset.vista === ST.vista)) })
  document.querySelectorAll('[data-zoom]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.zoom === ST.zoom)) })
  $('pagina-piano').hidden = ST.pagina !== 'piano'
  $('pagina-impostazioni').hidden = ST.pagina !== 'impostazioni'
  $('titolo-periodo').textContent = ST.pagina === 'impostazioni' ? 'Impostazioni' : titoloPeriodo()
  var n = ST.avvisi.filter(function (a) { return !a.ignorato }).length
  $('cont-avvisi').textContent = n
  $('cont-avvisi').className = 'contatore' + (n ? '' : ' zero')
  var meteo = $('avviso-meteo')
  meteo.hidden = !!Object.keys(ST.meteoMap).length
  meteo.textContent = '🌧️ Dati pioggia mancanti: la tabella dei valori normali MeteoSvizzera per la stazione ' + ST.dati.imp.stazione_meteo + ' è vuota. Il margine pioggia non si calcola.'
  var tit = $('avviso-titolare')
  tit.hidden = !ST.titolariMancanti.length
  tit.textContent = '👷 Il titolare (' + ST.titolariMancanti.join(', ') + ') non risulta fra gli operai attivi, quindi non compare nella vista Persone. ' +
    'Va aggiunto nell\'App Cantieri → Collaboratori, con lo stesso nome o la stessa email.'
  if (ST.pagina === 'piano') { disegnaGriglia(); disegnaCoda() } else disegnaImpostazioni()
}
function titoloPeriodo() {
  var iv = C.intervalloVista(ST.zoom, ST.ancora)
  if (ST.zoom === 'settimana') return 'Settimana ' + C.fmtDataAnno(iv.dal).slice(0, 5) + ' – ' + C.fmtDataAnno(iv.al)
  if (ST.zoom === 'mese') return C.MESI[C.mese(iv.dal)] + ' ' + C.anno(iv.dal)
  return C.MESI[C.mese(iv.dal)] + ' ' + C.anno(iv.dal) + ' – ' + C.MESI[C.mese(iv.al)] + ' ' + C.anno(iv.al)
}

// ── Griglia ────────────────────────────────────────────────────────────────
var LARGHEZZE = { settimana: 150, mese: 76, '3mesi': 36 }
function giorniVista() {
  var iv = C.intervalloVista(ST.zoom, ST.ancora), out = []
  for (var d = iv.dal; d <= iv.al; d = C.aggiungiGiorni(d, 1)) out.push(d)
  return out
}
function disegnaGriglia() {
  var giorni = giorniVista()
  var oggi = C.oggiIso()
  var larg = LARGHEZZE[ST.zoom]
  var stretta = ST.zoom !== 'settimana'
  var h = '<table class="gantt' + (stretta ? ' stretta' : '') + '"><colgroup><col style="width:var(--col-testa)">'
  giorni.forEach(function () { h += '<col style="width:' + larg + 'px">' })
  h += '</colgroup><thead><tr><th class="testa">' + (ST.vista === 'cantieri' ? '🏗️ Commesse' : '👷 Persone') + '</th>'
  giorni.forEach(function (d) {
    var info = C.infoGiorno(ST.cal, d)
    var cls = 'giorno' + (info.lavorativo ? '' : ' nonlav') + (d === oggi ? ' oggi' : '')
    var etich = ''
    if (d === oggi) etich += '<span class="etichetta-nl">Oggi</span>'
    if (info.tipo === 'festivo' || info.tipo === 'chiusura') etich += '<span class="etichetta-nl">' + esc(info.etichetta) + '</span>'
    h += '<th class="' + cls + '" title="' + esc(gAnno(d) + (info.etichetta ? ' · ' + info.etichetta : '')) + '">' +
      '<span class="gs">' + C.GIORNI_BREVI[C.giornoSettimana(d)] + '</span><span class="gn">' + d.slice(8, 10) + (ST.zoom === 'settimana' ? '.' + d.slice(5, 7) : '') + '</span>' + etich + '</th>'
  })
  h += '</tr></thead><tbody>'
  var righe = ST.vista === 'cantieri' ? righeCantieri(giorni, oggi) : righePersone(giorni, oggi)
  if (!righe) righe = '<tr><td class="testa vuoto-griglia" colspan="' + (giorni.length + 1) + '">' +
    (ST.vista === 'cantieri' ? 'Nessuna commessa da mostrare. Premi «+ Nuova commessa».' : 'Nessuna persona attiva nella tabella operai.') + '</td></tr>'
  $('griglia').innerHTML = h + righe + '</tbody></table>'
}
function commesseDaMostrare(giorni) {
  var dal = giorni[0], al = giorni[giorni.length - 1]
  return ST.dati.commesse.filter(function (c) {
    var a = ST.assPer[c.id] || []
    var nelPeriodo = a.some(function (x) { return x.data >= dal && x.data <= al })
    if (c.interna) return nelPeriodo
    if (c.stato === 'Finito') return nelPeriodo
    if (c.tipo === 'Riparazione' && c.stato === 'Confermato' && !a.length) return false // sta nella coda
    return true
  }).sort(function (x, y) {
    var ix = rie(x).inizio || x.data_inizio || '9999', iy = rie(y).inizio || y.data_inizio || '9999'
    return ix < iy ? -1 : ix > iy ? 1 : x.numero.localeCompare(y.numero)
  })
}
function righeCantieri(giorni, oggi) {
  var lista = commesseDaMostrare(giorni)
  if (!lista.length) return ''
  var h = ''
  lista.forEach(function (c) {
    var r = rie(c)
    var col = colore(c), txt = testoSu(col), lt = chiaro(col)
    var margini = {}
    if (!c.interna) C.blocchiMargine(c, r.fine, ST.cal).forEach(function (b) { (margini[b.data] = margini[b.data] || []).push(b) })
    var sotto = c.interna ? 'interna' : (fOre(r.orePreventivo) + ' preventivo' +
      (r.residue > 1e-9 ? ' · mancano ' + fOre(r.residue) : r.residue < -1e-9 ? ' · ' + fOre(-r.residue) + ' oltre' : r.fine ? ' · fine ' + C.fmtGiorno(r.fine) : ''))
    h += '<tr data-riga="' + c.id + '"><td class="testa"><button type="button" class="link" data-apri-commessa="' + c.id + '">' +
      '<span class="pallino" style="background:' + col + '"></span><span class="num">' + esc(c.numero) + '</span> ' + esc(c.nome) +
      ' <span class="stato">' + esc(c.stato) + (c.tipo === 'Riparazione' ? ' · Riparazione' : '') + '</span>' +
      '<span class="sottoriga">' + esc(sotto) + '</span></button></td>'
    giorni.forEach(function (d) {
      var info = C.infoGiorno(ST.cal, d)
      var ass = (ST.assPer[c.id] || []).filter(function (a) { return a.data === d })
      var cls = 'cella' + (info.lavorativo ? '' : ' nonlav') + (d === oggi ? ' oggi' : '')
      var dentro = '', titolo = gAnno(d) + (info.etichetta ? ' · ' + info.etichetta : '')
      var trascina = ''
      if (ass.length) {
        var nPers = new Set(ass.map(C.chiavePersona)).size
        var ore = C.sommaOre(ass)
        var testo = ST.zoom === 'settimana' ? nPers + ' pers. · ' + fOre(ore) : ST.zoom === 'mese' ? nPers + ' pers.' : String(nPers)
        titolo += ' · ' + c.numero + ': ' + nPers + ' pers., ' + fOre(ore) + ' (' + ass.map(function (a) { return nomeAss(a) + ' ' + fOre(a.ore) }).join(', ') + ')'
        var stile = 'background:' + col + ';color:' + txt
        var libera = ''
        if (!c.interna && d === r.fine && r.ultimoGiorno && r.ultimoGiorno.oreLibere > 1e-9) {
          var ug = r.ultimoGiorno
          var fr = ug.oreLavoro / (ug.oreLavoro + ug.oreLibere)
          var pct = Math.round(fr * 100)
          stile = 'background:linear-gradient(to right,' + col + ' 0 ' + pct + '%,' + lt + ' ' + pct + '% 100%);color:' + txt
          libera = '<span class="parte-libera" style="width:' + (100 - pct) + '%">' + (ST.zoom === 'settimana' ? fOre(ug.oreLibere) + ' libere' : ST.zoom === 'mese' ? 'libere' : 'lib.') + '</span>'
          titolo += ' · ultimo giorno: ' + fOre(ug.oreLavoro) + ' di lavoro, ' + fOre(ug.oreLibere) + ' libere'
          if (ST.zoom === 'settimana') testo = nPers + ' pers. · ' + fOre(ug.oreLavoro)
        }
        dentro += '<div class="blocco" style="' + stile + '"><span class="testo-blocco">' + esc(testo) + '</span>' + libera + '</div>'
        if (!c.interna) trascina = ' draggable="true" data-trascina="commessa"'   // il Magazzino è di tutti: non si sposta in blocco
      }
      ;(margini[d] || []).forEach(function (b) {
        var sinistra = b.meta ? 50 : 0
        dentro += '<div class="margine" style="left:' + sinistra + '%;width:' + (b.quota * 100) + '%">' + (b.primo ? '<span>' + esc(b.etichetta) + '</span>' : '') + '</div>'
        titolo += ' · ' + b.etichetta
      })
      h += '<td class="' + cls + '" data-data="' + d + '" data-commessa="' + c.id + '" title="' + esc(titolo) + '"' + trascina + '>' + dentro + '</td>'
    })
    h += '</tr>'
  })
  return h
}
function righePersone(giorni, oggi) {
  var dal = giorni[0], al = giorni[giorni.length - 1]
  var nelPeriodo = ST.dati.assegnazioni.filter(function (a) { return a.data >= dal && a.data <= al })
  var righe = ST.persone.map(function (p) { return { chiave: 'p:' + p.id, nome: p.nome, persona_id: p.id } })
  var viste = {}; righe.forEach(function (r) { viste[r.chiave] = 1 })
  nelPeriodo.forEach(function (a) {
    var k = C.chiavePersona(a)
    if (viste[k]) return
    viste[k] = 1
    righe.push({ chiave: k, nome: nomeChiave(k), persona_id: a.persona_id || null, segnaposto: !a.persona_id })
  })
  if (!righe.length) return ''
  var h = ''
  righe.forEach(function (r) {
    var mie = nelPeriodo.filter(function (a) { return C.chiavePersona(a) === r.chiave })
    h += '<tr data-riga="' + esc(r.chiave) + '"><td class="testa"><strong>' + esc(r.nome) + '</strong>' +
      '<span class="sottoriga">' + fOre(C.sommaOre(mie)) + ' nel periodo</span></td>'
    giorni.forEach(function (d) {
      var info = C.infoGiorno(ST.cal, d)
      var ass = mie.filter(function (a) { return a.data === d }).sort(function (x, y) { return (x.posizione || 1) - (y.posizione || 1) })
      var assenza = r.persona_id ? C.assenzaDi(ST.dati.assenze, r.persona_id, d) : null
      var cls = 'cella' + (info.lavorativo && !assenza ? '' : ' nonlav') + (d === oggi ? ' oggi' : '')
      var titolo = r.nome + ' · ' + gAnno(d) + (info.etichetta ? ' · ' + info.etichetta : '')
      var dentro = ''
      if (assenza) {
        dentro += '<div class="assenza">' + esc(assenza.tipo) + '</div>'
        titolo += ' · ' + assenza.tipo + (assenza.nota ? ' (' + assenza.nota + ')' : '')
      }
      if (ass.length) {
        dentro = '<div class="chips">' + ass.map(function (a) {
          var c = ST.perId[a.commessa_id] || {}
          var col = colore(c)
          var testo = ST.zoom === 'settimana' ? c.numero + ' · ' + fOre(a.ore) : ST.zoom === 'mese' ? (c.numero || '').slice(3) + ' · ' + f(a.ore, 2) : f(a.ore, 1)
          titolo += ' · ' + c.numero + ' ' + (c.nome || '') + ' · ' + fOre(a.ore) + (a.nota ? ' · ' + a.nota : '')
          return '<div class="chip' + (a.nota && /ferie da recuperare/i.test(a.nota) ? ' recupero' : '') + '" draggable="true" data-trascina="ass" data-ass="' + a.id + '" style="background:' + col + ';color:' + testoSu(col) + '">' + esc(testo) + '</div>'
        }).join('') + '</div>'
        if (assenza) {
          dentro = dentro.replace('<div class="chips">', '<div class="chips"><div class="chip" style="background:#9ca3af;color:#111">' + esc(assenza.tipo) + '</div>')
          titolo += ' · ATTENZIONE: assegnato/a durante ' + assenza.tipo
        }
      }
      h += '<td class="' + cls + '" data-data="' + d + '" data-persona="' + esc(r.chiave) + '" title="' + esc(titolo) + '">' + dentro + '</td>'
    })
    h += '</tr>'
  })
  return h
}

// ── Riparazioni in coda ─────────────────────────────────────────────────────
function disegnaCoda() {
  var el = $('coda-lista')
  if (!ST.coda.length) { el.innerHTML = '<p class="aiuto">Nessuna riparazione in coda.</p>'; return }
  el.innerHTML = ST.coda.map(function (r) {
    return '<div class="carta-coda" draggable="true" data-trascina="coda" data-commessa="' + r.id + '" style="border-left-color:' + colore(r) + '" tabindex="0" role="button" title="Trascina in una cella, oppure clic per aprire">' +
      '<strong>🔧 ' + esc(r.numero) + ' ' + esc(r.nome) + '</strong><span class="piccolo-testo">' + fOre(r.oreStimate) + ' stimate' +
      (r.indirizzo ? ' · ' + esc(r.indirizzo) : '') + '</span></div>'
  }).join('')
}

// ── Trascinare (PC) ─────────────────────────────────────────────────────────
var _trascinato = null
function avviaTrascinamento() {
  document.addEventListener('dragstart', function (e) {
    var t = e.target.closest && e.target.closest('[data-trascina]')
    if (!t) return
    _trascinato = { tipo: t.dataset.trascina, commessa_id: t.dataset.commessa, data: t.dataset.data, ass: t.dataset.ass }
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', JSON.stringify(_trascinato)) } catch (_) {}
  })
  var griglia = $('griglia')
  griglia.addEventListener('dragover', function (e) {
    var td = e.target.closest('td.cella')
    if (!td || !_trascinato) return
    e.preventDefault()
    griglia.querySelectorAll('.sopra').forEach(function (x) { if (x !== td) x.classList.remove('sopra') })
    td.classList.add('sopra')
  })
  griglia.addEventListener('dragleave', function (e) {
    var td = e.target.closest('td.cella'); if (td) td.classList.remove('sopra')
  })
  griglia.addEventListener('drop', function (e) {
    var td = e.target.closest('td.cella')
    if (!td || !_trascinato) return
    e.preventDefault()
    td.classList.remove('sopra')
    var t = _trascinato; _trascinato = null
    esegui(function () { return lasciaSu(t, td) })
  })
  document.addEventListener('dragend', function () { _trascinato = null; document.querySelectorAll('.sopra').forEach(function (x) { x.classList.remove('sopra') }) })
}
function deltaLavorativi(da, a) {
  if (a === da) return 0
  if (a > da) return C.giorniLavorativiFra(ST.cal, C.aggiungiGiorni(da, 1), a)
  return -C.giorniLavorativiFra(ST.cal, a, C.aggiungiGiorni(da, -1))
}
async function lasciaSu(t, td) {
  var data = td.dataset.data
  if (t.tipo === 'commessa') {
    if (td.dataset.commessa !== t.commessa_id) { toast('Un cantiere si sposta nella sua riga. Per cambiare persona usa la vista Persone.', true); return }
    var n = deltaLavorativi(t.data, data)
    if (!n) return
    var c = ST.perId[t.commessa_id]
    if (!await conferma('Spostare <strong>' + esc(c.numero + ' ' + c.nome) + '</strong> di <strong>' + n + '</strong> giorni lavorativi? Si saltano weekend, festivi e chiusure.')) return
    await applicaPiano(c.id, C.pianoSposta(ST.assPer[c.id] || [], n, ST.cal), 'Spostata di ' + n + ' giorni lavorativi', { spostamento: true })
  } else if (t.tipo === 'ass') {
    var a = ST.dati.assegnazioni.find(function (x) { return x.id === t.ass })
    if (!a || !td.dataset.persona) return
    var k = td.dataset.persona
    var campi = { data: data }
    if (k.indexOf('p:') === 0) { campi.persona_id = k.slice(2); campi.segnaposto = null }
    else {
      var p = k.split(':')
      if (p[1] !== a.commessa_id) { toast('Un segnaposto («Persona N, da decidere») vale solo per la sua commessa.', true); return }
      campi.persona_id = null; campi.segnaposto = +p[2]
    }
    if (campi.data === a.data && (campi.persona_id || null) === (a.persona_id || null) && (campi.segnaposto || null) === (a.segnaposto || null)) return
    campi.posizione = prossimaPosizione(campi.persona_id, data, a.id)
    await D.aggiorna('pl_assegnazioni', a.id, campi)
    await ricarica(['assegnazioni'])
    toast('Spostata: ' + (ST.perId[a.commessa_id] || {}).numero + ' · ' + fOre(a.ore) + ' → ' + nomeChiave(k) + ', ' + C.fmtGiorno(data))
  } else if (t.tipo === 'coda') {
    var r = ST.perId[t.commessa_id]
    if (td.dataset.persona && td.dataset.persona.indexOf('p:') === 0) {
      var pid = td.dataset.persona.slice(2)
      var ore = C.sommaOre(ST.capPer[r.id] || [])
      if (!(ore > 0)) { toast('La riparazione ' + r.numero + ' non ha ore stimate (capitoli): aprila e aggiungile.', true); return }
      if (!await conferma('Pianificare la riparazione <strong>' + esc(r.numero + ' ' + r.nome) + '</strong> (' + fOre(ore) + ') con <strong>' + esc(ST.nomi[pid]) + '</strong> da ' + gAnno(data) + '?')) return
      var piano = C.riempiAutomatico({ oreTotali: ore, dataInizio: data, persone: [{ persona_id: pid }], cal: ST.cal, commessa: r, assenze: ST.dati.assenze, viaggioIncluso: viaggioIncluso(), altreAssegnazioni: ST.dati.assegnazioni })
      if (!piano.assegnazioni.length || piano.oreNonCoperte > 0) { mostraErrore('Non sono riuscito a pianificare tutte le ' + fOre(ore) + ' della riparazione ' + r.numero + ' (assenze o chiusure?). Niente è stato cambiato.'); return }
      await applicaPiano(r.id, piano.assegnazioni, 'Riparazione pianificata', { ripianificato: true })
    } else apriRiempi(r, data)
  }
}
function prossimaPosizione(personaId, data, esclusoId) {
  if (!personaId) return 1
  var p = ST.dati.assegnazioni.filter(function (a) { return a.persona_id === personaId && a.data === data && a.id !== esclusoId })
  return p.reduce(function (m, a) { return Math.max(m, a.posizione || 1) }, 0) + 1
}

// Sostituisce le assegnazioni di una commessa con il piano nuovo:
// PRIMA si inseriscono le nuove, POI si tolgono le vecchie (se l'inserimento
// fallisce, non si è perso niente).
function rigaAss(a) {
  return { data: a.data, persona_id: a.persona_id || null, segnaposto: a.persona_id ? null : (a.segnaposto || null), commessa_id: a.commessa_id, ore: a.ore, posizione: a.posizione || 1, nota: a.nota || null }
}
// opz.spostamento: è uno spostamento (le ore restano): se qualche giorno passa
//   fra estate e inverno si segna periodo_cambiato e compare l'avviso «Ricalcola».
// opz.ripianificato: Riempi o Ricalcola hanno rifatto le ore: si toglie il segno.
async function applicaPiano(commessaId, nuove, messaggio, opz) {
  opz = opz || {}
  var prima = (ST.assPer[commessaId] || []).slice()
  var vecchie = prima.map(function (a) { return a.id })
  var righe = nuove.map(function (a) { var r = rigaAss(a); r.commessa_id = commessaId; return r })
  var c = ST.perId[commessaId]
  var segno = null
  if (opz.spostamento && C.cambiaPeriodo(prima, nuove, ST.cal)) segno = true
  else if (opz.ripianificato && c && c.periodo_cambiato) segno = false
  if (righe.length) await D.inserisci('pl_assegnazioni', righe)
  try {
    if (vecchie.length) await D.eliminaId('pl_assegnazioni', vecchie)
  } catch (e) {
    await ricarica(['assegnazioni'])
    throw new Error('ATTENZIONE: le assegnazioni nuove sono salvate ma le vecchie NON sono state tolte: ora ci sono doppioni in ' +
      (ST.perId[commessaId] || {}).numero + '. Ricarica la pagina e controlla.\n' + e.message)
  }
  if (segno !== null) {
    await D.aggiorna('pl_commesse', commessaId, { periodo_cambiato: segno })
    await ricarica(['commesse', 'assegnazioni'])
  } else await ricarica(['assegnazioni'])
  if (messaggio) toast(messaggio)
  if (segno === true) toast('Attenzione: ' + c.numero + ' è passata fra estate e inverno. Le ore sono rimaste quelle di prima: vedi Avvisi → «Ricalcola con le ore del nuovo periodo».', true)
}

// ── Pannello "Assegna" ──────────────────────────────────────────────────────
function apriAssegna(p) {
  var data = p.data
  var w = apriFinestra('Assegna · ' + gAnno(data))
  var info = C.infoGiorno(ST.cal, data)
  var statoForm = { ore: null, modo: 'intera' }
  function commesseScelta() {
    return ST.dati.commesse.filter(function (c) { return c.stato !== 'Finito' || c.id === p.commessa_id })
      .sort(function (a, b) { return a.numero.localeCompare(b.numero) })
  }
  function disegnaPannello() {
    var giaQui = ST.dati.assegnazioni.filter(function (a) {
      if (a.data !== data) return false
      if (p.chiave) return C.chiavePersona(a) === p.chiave
      return a.commessa_id === p.commessa_id
    })
    var h = ''
    if (!info.lavorativo) h += '<div class="esito attenzione">⚠️ Giorno non lavorativo: ' + esc(info.etichetta) + '. Puoi assegnare lo stesso: comparirà un avviso.</div>'
    h += '<h3>' + (p.chiave ? 'Già assegnato a ' + esc(nomeChiave(p.chiave)) : 'Già in ' + esc((ST.perId[p.commessa_id] || {}).numero || '')) + '</h3>'
    if (!giaQui.length) h += '<p class="aiuto">Niente, per ora.</p>'
    else h += '<ul class="lista-ass">' + giaQui.map(function (a) {
      var c = ST.perId[a.commessa_id] || {}
      return '<li><span><strong>' + esc(c.numero) + '</strong> ' + esc(c.nome) + ' · ' + esc(nomeAss(a)) + ' · <strong>' + fOre(a.ore) + '</strong>' + (a.nota ? ' · ' + esc(a.nota) : '') + '</span>' +
        '<span><button type="button" class="piccolo" data-cambia="' + a.id + '">Ore</button> <button type="button" class="piccolo pericolo" data-togli="' + a.id + '">Togli</button></span></li>'
    }).join('') + '</ul>'
    var personaSel = p.chiave && p.chiave.indexOf('p:') === 0 ? p.chiave.slice(2) : ''
    h += '<h3>Nuova assegnazione</h3><div class="campi">' +
      '<div class="campo"><label for="as-persona">Persona</label><select id="as-persona">' +
      ST.persone.map(function (x) { return '<option value="p:' + x.id + '"' + (x.id === personaSel ? ' selected' : '') + '>' + esc(x.nome) + '</option>' }).join('') +
      [1, 2, 3].map(function (n) { return '<option value="s:' + n + '"' + (p.chiave && p.chiave === 's:' + p.commessa_id + ':' + n ? ' selected' : '') + '>Persona ' + n + ' (da decidere)</option>' }).join('') +
      '</select></div>' +
      '<div class="campo"><label for="as-commessa">Commessa</label><select id="as-commessa">' +
      commesseScelta().map(function (c) { return '<option value="' + c.id + '"' + (c.id === (p.commessa_id || (p.chiave && p.chiave.split(':')[1])) ? ' selected' : '') + '>' + esc(c.numero + ' ' + c.nome) + '</option>' }).join('') +
      '</select></div></div>' +
      '<div class="campo" style="margin-top:10px"><label>Ore</label><div class="rapidi" id="as-rapidi"></div>' +
      '<input id="as-ore" type="text" inputmode="decimal" placeholder="ore, es. 4,5" hidden aria-label="Ore (altro)"></div>' +
      '<div class="riga-bottoni"><button type="button" class="primario grande" id="as-salva">Assegna</button><button type="button" id="as-chiudi">Chiudi</button></div>' +
      '<div id="as-esito"></div>'
    w.corpo.innerHTML = h
    var selC = w.corpo.querySelector('#as-commessa'), selP = w.corpo.querySelector('#as-persona')
    function aggiornaRapidi() {
      var c = ST.perId[selC.value]
      var intera = info.lavorativo ? C.oreCantiere(ST.cal, data, c, viaggioIncluso()) : C.oreGiornataCommessa(ST.cal, data, c)
      var meta = mezzOra(intera / 2)
      var r = w.corpo.querySelector('#as-rapidi')
      r.innerHTML = '<button type="button" data-modo="intera">Giornata intera · ' + fOre(intera) + '</button>' +
        '<button type="button" data-modo="meta">Metà · ' + fOre(meta) + '</button><button type="button" data-modo="altro">Altro…</button>'
      r.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('attivo', b.dataset.modo === statoForm.modo)
        b.addEventListener('click', function () {
          statoForm.modo = b.dataset.modo
          aggiornaRapidi()
          if (statoForm.modo === 'altro') w.corpo.querySelector('#as-ore').focus()
        })
      })
      statoForm.intera = intera; statoForm.meta = meta
      w.corpo.querySelector('#as-ore').hidden = statoForm.modo !== 'altro'
    }
    selC.addEventListener('change', aggiornaRapidi)
    aggiornaRapidi()
    w.corpo.querySelector('#as-chiudi').addEventListener('click', w.chiudi)
    w.corpo.querySelector('#as-salva').addEventListener('click', function () {
      esegui(async function () {
        var ore = statoForm.modo === 'intera' ? statoForm.intera : statoForm.modo === 'meta' ? statoForm.meta : C.leggiNumero(w.corpo.querySelector('#as-ore').value)
        if (!(ore > 0)) { w.corpo.querySelector('#as-esito').innerHTML = '<div class="esito ko">Scrivi le ore (più di 0).</div>'; return }
        ore = mezzOra(ore)
        if (!(ore > 0)) ore = 0.5
        if (ore > 24) { w.corpo.querySelector('#as-esito').innerHTML = '<div class="esito ko">Al massimo 24 h in un giorno.</div>'; return }
        var k = selP.value
        var riga = { data: data, commessa_id: selC.value, ore: ore, persona_id: null, segnaposto: null }
        if (k.indexOf('p:') === 0) riga.persona_id = k.slice(2); else riga.segnaposto = +k.slice(2)
        riga.posizione = prossimaPosizione(riga.persona_id, data)
        await D.inserisci('pl_assegnazioni', riga)
        await ricarica(['assegnazioni'])
        toast('Assegnato: ' + ST.perId[riga.commessa_id].numero + ' · ' + fOre(ore))
        disegnaPannello()
      })
    })
    w.corpo.querySelectorAll('[data-togli]').forEach(function (b) {
      b.addEventListener('click', function () {
        esegui(async function () {
          var a = ST.dati.assegnazioni.find(function (x) { return x.id === b.dataset.togli })
          if (!await conferma('Togliere ' + esc(nomeAss(a)) + ' · ' + fOre(a.ore) + ' da ' + esc(ST.perId[a.commessa_id].numero) + ', ' + gAnno(a.data) + '?', { si: 'Togli', pericolo: true })) return
          await D.eliminaId('pl_assegnazioni', a.id)
          await ricarica(['assegnazioni'])
          disegnaPannello()
        })
      })
    })
    w.corpo.querySelectorAll('[data-cambia]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = ST.dati.assegnazioni.find(function (x) { return x.id === b.dataset.cambia })
        var li = b.closest('li')
        li.innerHTML = '<span>' + esc(nomeAss(a)) + ' · ' + esc(ST.perId[a.commessa_id].numero) + '</span><span><input type="text" inputmode="decimal" value="' + f(a.ore, 2) + '" style="width:90px" aria-label="Ore"> h <button type="button" class="piccolo primario">Salva</button></span>'
        li.querySelector('button').addEventListener('click', function () {
          esegui(async function () {
            var ore = mezzOra(C.leggiNumero(li.querySelector('input').value))
            if (!(ore > 0) || ore > 24) { toast('Ore non valide (fra 0.5 e 24)', true); return }
            await D.aggiorna('pl_assegnazioni', a.id, { ore: ore })
            await ricarica(['assegnazioni'])
            disegnaPannello()
          })
        })
      })
    })
  }
  disegnaPannello()
}

// ── Scheda commessa ─────────────────────────────────────────────────────────
function numeroProposto() {
  var aa = String(new Date().getFullYear()).slice(2)
  var max = 0
  ST.dati.commesse.forEach(function (c) { if (c.numero.slice(0, 2) === aa) max = Math.max(max, +c.numero.slice(3)) })
  return aa + '-' + String(max + 1).padStart(3, '0')
}
function apriCommessa(id) {
  var c = id ? ST.perId[id] : null
  var nuova = !c
  if (nuova) c = { numero: numeroProposto(), nome: '', indirizzo: '', tipo: 'Cantiere', stato: 'Bozza', riduzione_ore: 0, venerdi_regola: "Un'ora in meno", colore: PALETTE[ST.dati.commesse.length % PALETTE.length], margine_x_giorni: 0, margini_accettati: {} }
  var w = apriFinestra(nuova ? 'Nuova commessa' : c.numero + ' · ' + c.nome, { centro: true })
  w.commessaId = c.id || null
  disegnaScheda(w, c)
  return w
}
function riapriScheda(w) {
  var c = ST.perId[w.commessaId]
  if (!c) { w.chiudi(); return }
  w.el.querySelector('.testata-finestra h2').textContent = c.numero + ' · ' + c.nome
  disegnaScheda(w, c)
}
function opzioniSel(lista, val) { return lista.map(function (x) { return '<option' + (x === val ? ' selected' : '') + '>' + esc(x) + '</option>' }).join('') }
function disegnaScheda(w, c) {
  var nuova = !c.id
  var rid = Number(c.riduzione_ore || 0)
  var ridStd = [0, 0.5, 1].indexOf(rid) >= 0
  var h = '<div class="sezione"><h3>Dati</h3><div class="campi">' +
    campo('Numero (AA-NNN)', '<input id="sc-numero" value="' + esc(c.numero) + '" placeholder="26-014" maxlength="6">') +
    campo('Nome', '<input id="sc-nome" value="' + esc(c.nome) + '">') +
    campo('Indirizzo', '<input id="sc-indirizzo" value="' + esc(c.indirizzo || '') + '" placeholder="Via, NPA Località">') +
    campo('Tipo', '<select id="sc-tipo">' + opzioniSel(['Cantiere', 'Riparazione'], c.tipo) + '</select>') +
    campoOreStimate(c) +
    campo('Stato', '<select id="sc-stato">' + opzioniSel(STATI, c.stato) + '</select>') +
    campo('Data inizio prevista', '<input id="sc-inizio" type="date" value="' + esc(c.data_inizio || '') + '">') +
    campo('Persone previste', '<input id="sc-persone" type="text" inputmode="numeric" value="' + esc(c.persone_previste || '') + '">', 'persone') +
    campo('Colore nel piano', '<input id="sc-colore" type="color" value="' + esc(c.colore || '#2d6a4f') + '">') +
    campo('Cantiere nell\'App Cantieri (facoltativo)', '<select id="sc-cantiere"><option value="">— nessuno —</option>' + ST.dati.cantieri.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === c.cantiere_id ? ' selected' : '') + '>' + esc(x.nome) + (x.citta ? ' · ' + esc(x.citta) : '') + '</option>' }).join('') + '</select>') +
    '</div></div>'

  h += '<div class="sezione"><h3>🚗 Viaggio (andata)</h3><div class="campi">' +
    campo('Minuti di viaggio, andata', '<input id="sc-viaggio" type="text" inputmode="numeric" value="' + esc(c.viaggio_min_andata === null || c.viaggio_min_andata === undefined ? '' : c.viaggio_min_andata) + '">', 'min') +
    campo('Chilometri', '<input id="sc-km" type="text" inputmode="decimal" value="' + esc(c.viaggio_km === null || c.viaggio_km === undefined ? '' : f(c.viaggio_km)) + '">', 'km') +
    campo('Fonte', '<input id="sc-fonte" value="' + esc(c.viaggio_fonte || '—') + '" readonly>') +
    '</div><div class="riga-bottoni"><button type="button" id="sc-calcola">🧭 Calcola viaggio</button>' +
    '<a id="sc-mappa" href="' + esc(V.linkMappa(c.indirizzo)) + '" target="_blank" rel="noopener">🗺️ Controlla su mappa (traffico vero) ↗</a></div>' +
    '<p class="aiuto">Partenza: ' + esc(V.PARTENZA) + '. Calcolo gratis con OpenStreetMap; minuti × ' + f(ST.dati.imp.fattore_ora_punta, 2) + ' per l\'ora di punta. Se cambi i minuti a mano, vince il tuo valore.</p>' +
    '<div id="sc-viaggio-esito"></div></div>'

  h += '<div class="sezione"><h3>🕘 Giornata</h3><div class="campi">' +
    campo('Riduzione lun-gio', '<select id="sc-rid"><option value="0"' + (rid === 0 ? ' selected' : '') + '>Nessuna</option><option value="0.5"' + (rid === 0.5 ? ' selected' : '') + '>−0.5 h</option><option value="1"' + (rid === 1 ? ' selected' : '') + '>−1 h</option><option value="altro"' + (!ridStd ? ' selected' : '') + '>Altro…</option></select>') +
    campo('Riduzione (altro)', '<input id="sc-rid-altro" type="text" inputmode="decimal" value="' + (ridStd ? '' : f(rid, 2)) + '"' + (ridStd ? ' disabled' : '') + '>', 'h') +
    campo('Venerdì', '<select id="sc-venerdi">' + opzioniSel(["Un'ora in meno", 'Uguale agli altri giorni'], c.venerdi_regola || "Un'ora in meno") + '</select>') +
    '</div><p class="aiuto" id="sc-giornata-anteprima"></p></div>'

  h += '<div class="riga-bottoni"><button type="button" class="primario grande" id="sc-salva">💾 Salva dati</button><button type="button" id="sc-chiudi">Chiudi</button>' +
    (C.eliminazioneCommessa(c, [], [], []).permessa ? '<button type="button" class="pericolo" id="sc-elimina">🗑️ Elimina commessa</button>' : '') +
    '</div><div id="sc-esito"></div>'

  if (nuova) {
    h += '<p class="esito attenzione">Salva i dati per aggiungere capitoli, pianificazione e margini.</p>'
  } else {
    h += sezioneCapitoli(c) + sezioneRiepilogo(c) + sezionePianificazione(c) + sezioneMargini(c)
  }
  w.corpo.innerHTML = h
  collegaScheda(w, c)
}
// Riparazione: «Ore stimate» = un capitolo unico «Riparazione», creato/aggiornato al salvataggio
function campoOreStimate(c) {
  var caps = c.id ? (ST.capPer[c.id] || []) : []
  var stato = C.capitoloRiparazione(caps, NaN)
  var valore = caps.length === 1 && caps[0].nome === 'Riparazione' ? f(caps[0].ore, 2) : caps.length ? f(C.sommaOre(caps), 2) : ''
  return '<div class="campo" id="sc-ore-stimate-campo"' + (c.tipo === 'Riparazione' ? '' : ' hidden') + '><label for="sc-ore-stimate">Ore stimate <span class="unita">(h)</span></label>' +
    '<input id="sc-ore-stimate" inputmode="decimal" value="' + esc(valore) + '"' + (stato.azione === 'bloccata' ? ' disabled title="' + esc(stato.motivo) + '"' : '') + ' placeholder="es. 4,5">' +
    (stato.azione === 'bloccata' ? '<span class="aiuto">' + esc(stato.motivo) + '</span>' : '<span class="aiuto">Diventa il capitolo «Riparazione».</span>') + '</div>'
}
function campo(etichetta, controllo, unita) {
  var m = /id="([^"]+)"/.exec(controllo)
  return '<div class="campo"><label' + (m ? ' for="' + m[1] + '"' : '') + '>' + esc(etichetta) + (unita ? ' <span class="unita">(' + esc(unita) + ')</span>' : '') + '</label>' + controllo + '</div>'
}
function leggiRiduzione(w) {
  var v = w.corpo.querySelector('#sc-rid').value
  if (v === 'altro') return C.leggiNumero(w.corpo.querySelector('#sc-rid-altro').value)
  return Number(v)
}
function anteprimaGiornata(w) {
  var finta = { riduzione_ore: leggiRiduzione(w) || 0, venerdi_regola: w.corpo.querySelector('#sc-venerdi').value }
  // un lunedì e un venerdì d'estate e d'inverno qualsiasi, solo per mostrare le ore
  var p = C.periodoInverno(ST.cal, C.anno(C.oggiIso()))
  var inv = p.data_inizio, invVen = C.aggiungiGiorni(inv, 4)
  var est = C.anno(C.oggiIso()) + '-06-01'; while (C.giornoSettimana(est) !== 1) est = C.aggiungiGiorni(est, 1)
  var estVen = C.aggiungiGiorni(est, 4)
  w.corpo.querySelector('#sc-giornata-anteprima').textContent = 'Ore della giornata con queste regole — estate: lun-gio ' + fOre(C.oreGiornataCommessa(ST.cal, est, finta)) +
    ', ven ' + fOre(C.oreGiornataCommessa(ST.cal, estVen, finta)) + ' · inverno: lun-gio ' + fOre(C.oreGiornataCommessa(ST.cal, inv, finta)) +
    ', ven ' + fOre(C.oreGiornataCommessa(ST.cal, invVen, finta)) +
    (viaggioIncluso() ? '. Il viaggio è già compreso nelle ore del preventivo: non si toglie.' : '. Viaggio NON compreso: in cantiere si tolgono andata e ritorno.')
}
function collegaScheda(w, c) {
  var q = function (s) { return w.corpo.querySelector(s) }
  var fonte = c.viaggio_fonte || null
  var calcolatoPer = null          // indirizzo dell'ultimo «Calcola viaggio» fatto in questa scheda
  q('#sc-chiudi').addEventListener('click', w.chiudi)
  q('#sc-tipo').addEventListener('change', function () { q('#sc-ore-stimate-campo').hidden = q('#sc-tipo').value !== 'Riparazione' })
  if (q('#sc-elimina')) q('#sc-elimina').addEventListener('click', function () {
    esegui(async function () {
      var el = C.eliminazioneCommessa(c, ST.dati.capitoli, ST.dati.assegnazioni, ST.dati.previste)
      if (!el.permessa) { mostraErrore(el.testo); return }
      if (!await conferma(esc(el.testo), { si: 'Elimina', pericolo: true, titolo: 'Elimina commessa' })) return
      await D.eliminaId('pl_commesse', c.id)
      w.chiudi()
      await ricarica(['commesse', 'capitoli', 'assegnazioni', 'previste'])
      toast(c.numero + ' eliminata')
    })
  })
  q('#sc-rid').addEventListener('change', function () { q('#sc-rid-altro').disabled = q('#sc-rid').value !== 'altro'; anteprimaGiornata(w) })
  q('#sc-rid-altro').addEventListener('input', function () { anteprimaGiornata(w) })
  q('#sc-venerdi').addEventListener('change', function () { anteprimaGiornata(w) })
  anteprimaGiornata(w)
  q('#sc-viaggio').addEventListener('input', function () { fonte = 'A mano'; q('#sc-fonte').value = 'A mano (al salvataggio)' })
  q('#sc-indirizzo').addEventListener('input', function () { q('#sc-mappa').href = V.linkMappa(q('#sc-indirizzo').value) })
  q('#sc-calcola').addEventListener('click', function () {
    esegui(async function () {
      var ind = q('#sc-indirizzo').value.trim()
      var es = q('#sc-viaggio-esito')
      if (!ind) { es.innerHTML = '<div class="esito ko">Scrivi prima l\'indirizzo.</div>'; return }
      q('#sc-calcola').disabled = true
      es.innerHTML = '<div class="esito attenzione">Calcolo in corso… (OpenStreetMap, qualche secondo)</div>'
      var r = await V.calcolaViaggio(ind, { fattore: ST.dati.imp.fattore_ora_punta })
      q('#sc-calcola').disabled = false
      if (!r.ok) { es.innerHTML = '<div class="esito ko">' + esc(r.messaggio) + '</div>'; return }   // niente 0 scritto
      q('#sc-viaggio').value = r.minuti
      q('#sc-km').value = f(r.km)
      q('#sc-fonte').value = 'Calcolato'
      fonte = 'Calcolato'
      calcolatoPer = ind
      var msg = r.minuti + ' min andata (' + r.minutiSenzaTraffico + ' min senza traffico × ' + f(ST.dati.imp.fattore_ora_punta, 2) + ', ai 5 minuti) · ' + f(r.km) + ' km'
      if (c.id) {
        var mod = V.modificaDaRisultato(r)
        await D.aggiorna('pl_commesse', c.id, mod)
        await ricarica(['commesse'])
        es.innerHTML = '<div class="esito ok">Salvato: ' + esc(msg) + '</div>'
      } else es.innerHTML = '<div class="esito ok">' + esc(msg) + ' — si salva con «Salva dati».</div>'
    })
  })
  q('#sc-salva').addEventListener('click', function () {
    esegui(async function () {
      var es = q('#sc-esito')
      var numero = q('#sc-numero').value.trim()
      var nome = q('#sc-nome').value.trim()
      if (!/^\d{2}-\d{3}$/.test(numero)) { es.innerHTML = '<div class="esito ko">Numero nel formato AA-NNN, per esempio 26-014.</div>'; return }
      if (!nome) { es.innerHTML = '<div class="esito ko">Scrivi il nome della commessa.</div>'; return }
      var dupl = ST.dati.commesse.find(function (x) { return x.numero === numero && x.id !== c.id })
      if (dupl) { es.innerHTML = '<div class="esito ko">Il numero ' + esc(numero) + ' è già usato da «' + esc(dupl.nome) + '».</div>'; return }
      var vtxt = q('#sc-viaggio').value.trim()
      var viaggio = vtxt === '' ? null : Math.round(C.leggiNumero(vtxt))
      if (vtxt !== '' && !(viaggio >= 0)) { es.innerHTML = '<div class="esito ko">Minuti di viaggio non leggibili.</div>'; return }
      var rid = leggiRiduzione(w)
      if (!(rid >= 0)) { es.innerHTML = '<div class="esito ko">Riduzione non leggibile.</div>'; return }
      var pers = q('#sc-persone').value.trim()
      var kmT = q('#sc-km').value.trim()
      var campi = {
        numero: numero, nome: nome, indirizzo: q('#sc-indirizzo').value.trim() || null, tipo: q('#sc-tipo').value,
        stato: q('#sc-stato').value, data_inizio: q('#sc-inizio').value || null,
        persone_previste: pers ? Math.round(C.leggiNumero(pers)) || null : null, colore: q('#sc-colore').value,
        cantiere_id: q('#sc-cantiere').value || null, viaggio_min_andata: viaggio,
        viaggio_km: kmT ? C.leggiNumero(kmT) : null,
        viaggio_fonte: viaggio === null ? null : (fonte || 'A mano'),
        riduzione_ore: rid, venerdi_regola: q('#sc-venerdi').value
      }
      if (campi.viaggio_km !== null && !(campi.viaggio_km >= 0)) campi.viaggio_km = null
      // Riparazione: ore stimate → capitolo unico «Riparazione»
      var oreStimate = NaN
      var inOre = q('#sc-ore-stimate')
      if (campi.tipo === 'Riparazione' && inOre && !inOre.disabled && inOre.value.trim() !== '') {
        oreStimate = C.leggiOre(inOre.value)
        if (!(oreStimate > 0)) { es.innerHTML = '<div class="esito ko">Ore stimate non leggibili: «' + esc(inOre.value) + '».</div>'; return }
      }
      var indirizzoCambiato = (c.indirizzo || null) !== campi.indirizzo
      var diventaConfermato = campi.stato === 'Confermato' && c.stato !== 'Confermato'
      // «Finito» dal menu: si salva il resto, poi si passa da «Finito il…» con la data di oggi,
      // così le assegnazioni dopo oggi si liberano (dopo conferma) e l'avviso 10 funziona.
      var diventaFinito = campi.stato === 'Finito' && c.stato !== 'Finito'
      if (diventaFinito) campi.stato = c.stato || 'Bozza'
      var salvata
      if (c.id) salvata = await D.aggiorna('pl_commesse', c.id, campi)
      else salvata = (await D.inserisci('pl_commesse', campi))[0]
      w.commessaId = salvata.id
      await ricarica(['commesse'])
      if (campi.tipo === 'Riparazione') {
        var cr = C.capitoloRiparazione(ST.capPer[salvata.id] || [], oreStimate)
        if (cr.azione === 'inserisci') await D.inserisci('pl_capitoli', { commessa_id: salvata.id, ordine: 1, nome: 'Riparazione', ore: cr.ore, ubicazione: 'All\'aperto' })
        else if (cr.azione === 'aggiorna') await D.aggiorna('pl_capitoli', cr.id, { ore: cr.ore })
        if (cr.azione === 'inserisci' || cr.azione === 'aggiorna') await ricarica(['capitoli'])
      }
      if (diventaConfermato) await salvaPreviste(salvata.id)
      toast('Commessa ' + numero + ' salvata')
      if (diventaFinito) {
        var dataFine = (q('#pi-finito') && q('#pi-finito').value) || C.oggiIso()
        await segnaFinito(ST.perId[salvata.id], dataFine)
      }
      // indirizzo cambiato: si ricalcola il viaggio, ma solo se non è stato messo a mano
      if (indirizzoCambiato && campi.indirizzo && campi.viaggio_fonte !== 'A mano' && calcolatoPer !== campi.indirizzo) {
        riapriScheda(w)
        var es2 = w.corpo.querySelector('#sc-viaggio-esito')
        es2.innerHTML = '<div class="esito attenzione">Indirizzo cambiato: ricalcolo il viaggio…</div>'
        var r = await V.calcolaViaggio(campi.indirizzo, { fattore: ST.dati.imp.fattore_ora_punta })
        if (r.ok) {
          await D.aggiorna('pl_commesse', salvata.id, V.modificaDaRisultato(r))
          await ricarica(['commesse'])
          riapriScheda(w)
          w.corpo.querySelector('#sc-viaggio-esito').innerHTML = '<div class="esito ok">Viaggio ricalcolato: ' + r.minuti + ' min andata · ' + f(r.km) + ' km</div>'
        } else {
          w.corpo.querySelector('#sc-viaggio-esito').innerHTML = '<div class="esito ko">' + esc(r.messaggio) + '</div>'
        }
        return
      }
      riapriScheda(w)
    })
  })
  if (c.id) {
    collegaCapitoli(w, c)
    collegaPianificazione(w, c)
    collegaMargini(w, c)
  }
}

// Copia del piano al passaggio a "Confermato"
async function salvaPreviste(commessaId) {
  var vecchie = ST.dati.previste.filter(function (a) { return a.commessa_id === commessaId }).map(function (a) { return a.id })
  var copie = (ST.assPer[commessaId] || []).map(rigaAss)
  if (copie.length) await D.inserisci('pl_assegnazioni_previste', copie)
  if (vecchie.length) await D.eliminaId('pl_assegnazioni_previste', vecchie)
  await ricarica(['previste'])
  toast(copie.length ? 'Piano confermato: salvata la copia «previsto» (' + copie.length + ' assegnazioni)' : 'Confermata senza assegnazioni: la copia «previsto» è vuota')
}

// Capitoli
function sezioneCapitoli(c) {
  var caps = (ST.capPer[c.id] || []).slice().sort(function (a, b) { return a.ordine - b.ordine })
  var tot = C.sommaOre(caps)
  var aperto = C.sommaOre(caps.filter(function (x) { return x.ubicazione !== 'Al coperto' }))
  var h = '<div class="sezione"><h3>📋 Capitoli del preventivo</h3>'
  if (caps.length) {
    h += '<table class="elenco"><thead><tr><th>#</th><th>Capitolo</th><th class="num">Ore</th><th>Dove</th><th></th></tr></thead><tbody>' +
      caps.map(function (x, i) {
        var cop = x.ubicazione === 'Al coperto'
        return '<tr><td>' + (i + 1) + '</td><td><input data-cap-nome="' + x.id + '" value="' + esc(x.nome) + '" aria-label="Nome capitolo"></td>' +
          '<td class="num"><input data-cap-ore="' + x.id + '" value="' + f(x.ore, 2) + '" inputmode="decimal" style="width:90px;text-align:right" aria-label="Ore"> h</td>' +
          '<td><button type="button" class="ubicazione ' + (cop ? 'coperto' : 'aperto') + '" data-cap-ubi="' + x.id + '" aria-label="Ubicazione: ' + esc(x.ubicazione) + ', clic per cambiare">' + (cop ? '🏠 Al coperto' : '☀ All\'aperto') + '</button></td>' +
          '<td><button type="button" class="piccolo pericolo" data-cap-togli="' + x.id + '">Togli</button></td></tr>'
      }).join('') + '</tbody><tfoot><tr><th></th><th>Totale</th><th class="num">' + fOre(tot) + '</th><th colspan="2">all\'aperto ' + f(tot ? aperto / tot * 100 : 0, 0) + '%</th></tr></tfoot></table>'
  } else h += '<p class="aiuto">Nessun capitolo. Incollali dal foglio qui sotto, o aggiungili uno alla volta.</p>'
  h += '<h3>Aggiungi un capitolo</h3><div class="campi">' + campo('Capitolo', '<input id="cap-nuovo-nome">') +
    campo('Ore', '<input id="cap-nuovo-ore" inputmode="decimal" placeholder="12,5 o 12:30">', 'h') +
    campo('Dove', '<select id="cap-nuovo-ubi"><option>All\'aperto</option><option>Al coperto</option></select>') + '</div>' +
    '<div class="riga-bottoni"><button type="button" id="cap-aggiungi">+ Aggiungi capitolo</button></div>' +
    '<h3>Incolla dal foglio (Zoho Sheet o Excel)</h3><p class="aiuto">Seleziona 2 o 3 colonne nel foglio: capitolo | ore | [coperto] e incolla qui. Ore: 12.5, 12,5 o 12:30. Terza colonna vuota = All\'aperto; «coperto», «interno», «c» o «x» = Al coperto.</p>' +
    '<textarea id="cap-incolla" aria-label="Capitoli incollati"></textarea>' +
    '<div class="riga-bottoni"><button type="button" id="cap-anteprima">👁️ Anteprima</button></div><div id="cap-anteprima-esito"></div></div>'
  return h
}
function collegaCapitoli(w, c) {
  var q = function (s) { return w.corpo.querySelector(s) }
  w.corpo.querySelectorAll('[data-cap-nome]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      esegui(async function () {
        if (!inp.value.trim()) { toast('Il nome non può essere vuoto', true); return }
        await D.aggiorna('pl_capitoli', inp.dataset.capNome, { nome: inp.value.trim() }); await ricarica(['capitoli'])
      })
    })
  })
  w.corpo.querySelectorAll('[data-cap-ore]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      esegui(async function () {
        var ore = C.leggiOre(inp.value)
        if (!(ore > 0)) { toast('Ore non leggibili: «' + inp.value + '»', true); return }
        await D.aggiorna('pl_capitoli', inp.dataset.capOre, { ore: Math.round(ore * 100) / 100 }); await ricarica(['capitoli']); riapriScheda(w)
      })
    })
  })
  w.corpo.querySelectorAll('[data-cap-ubi]').forEach(function (b) {
    b.addEventListener('click', function () {
      esegui(async function () {
        var x = ST.dati.capitoli.find(function (k) { return k.id === b.dataset.capUbi })
        await D.aggiorna('pl_capitoli', x.id, { ubicazione: x.ubicazione === 'Al coperto' ? 'All\'aperto' : 'Al coperto' })
        await ricarica(['capitoli']); riapriScheda(w)
      })
    })
  })
  w.corpo.querySelectorAll('[data-cap-togli]').forEach(function (b) {
    b.addEventListener('click', function () {
      esegui(async function () {
        var x = ST.dati.capitoli.find(function (k) { return k.id === b.dataset.capTogli })
        if (!await conferma('Togliere il capitolo «' + esc(x.nome) + '» (' + fOre(x.ore) + ')?', { si: 'Togli', pericolo: true })) return
        await D.eliminaId('pl_capitoli', x.id); await ricarica(['capitoli']); riapriScheda(w)
      })
    })
  })
  q('#cap-aggiungi').addEventListener('click', function () {
    esegui(async function () {
      var nome = q('#cap-nuovo-nome').value.trim(), ore = C.leggiOre(q('#cap-nuovo-ore').value)
      if (!nome || !(ore > 0)) { toast('Scrivi nome e ore del capitolo', true); return }
      var ordine = (ST.capPer[c.id] || []).reduce(function (m, x) { return Math.max(m, x.ordine) }, 0) + 1
      await D.inserisci('pl_capitoli', { commessa_id: c.id, ordine: ordine, nome: nome, ore: Math.round(ore * 100) / 100, ubicazione: q('#cap-nuovo-ubi').value })
      await ricarica(['capitoli']); riapriScheda(w)
    })
  })
  q('#cap-anteprima').addEventListener('click', function () {
    var r = C.leggiCapitoliIncollati(q('#cap-incolla').value)
    var es = q('#cap-anteprima-esito')
    if (!r.valide.length && !r.scartate.length) { es.innerHTML = '<div class="esito ko">Niente da leggere: incolla le righe del foglio.</div>'; return }
    var esistenti = (ST.capPer[c.id] || []).length
    var h = '<table class="elenco"><thead><tr><th>Riga</th><th>Capitolo</th><th class="num">Ore</th><th>Dove / motivo</th></tr></thead><tbody>' +
      r.valide.map(function (x) { return '<tr><td>' + x.riga + '</td><td>' + esc(x.nome) + '</td><td class="num">' + fOre(x.ore) + '</td><td>' + (x.ubicazione === 'Al coperto' ? '🏠 Al coperto' : '☀ All\'aperto') + (x.nota ? ' · ' + esc(x.nota) : '') + '</td></tr>' }).join('') +
      r.scartate.map(function (x) { return '<tr class="scartata"><td>' + x.riga + '</td><td colspan="2">✖ SCARTATA: ' + esc(x.testo) + '</td><td>' + esc(x.motivo) + '</td></tr>' }).join('') +
      '</tbody><tfoot><tr><th></th><th>' + r.valide.length + ' righe valide' + (r.scartate.length ? ', ' + r.scartate.length + ' scartate' : '') + '</th><th class="num">' + fOre(r.totale) + '</th><th></th></tr></tfoot></table>'
    if (r.valide.length) {
      h += (esistenti ? '<p><label><input type="checkbox" id="cap-sostituisci"> Sostituisci i ' + esistenti + ' capitoli che ci sono già (altrimenti si aggiungono in fondo)</label></p>' : '') +
        '<div class="riga-bottoni"><button type="button" class="primario" id="cap-conferma">Salva ' + r.valide.length + ' capitoli</button><button type="button" id="cap-annulla">Annulla</button></div>'
    }
    es.innerHTML = h
    if (!r.valide.length) return
    es.querySelector('#cap-annulla').addEventListener('click', function () { es.innerHTML = '' })
    es.querySelector('#cap-conferma').addEventListener('click', function () {
      esegui(async function () {
        var sost = es.querySelector('#cap-sostituisci') && es.querySelector('#cap-sostituisci').checked
        var vecchi = (ST.capPer[c.id] || []).map(function (x) { return x.id })
        var base = sost ? 0 : (ST.capPer[c.id] || []).reduce(function (m, x) { return Math.max(m, x.ordine) }, 0)
        await D.inserisci('pl_capitoli', r.valide.map(function (x, i) { return { commessa_id: c.id, ordine: base + i + 1, nome: x.nome, ore: x.ore, ubicazione: x.ubicazione } }))
        if (sost && vecchi.length) await D.eliminaId('pl_capitoli', vecchi)
        await ricarica(['capitoli']); riapriScheda(w)
        toast(r.valide.length + ' capitoli salvati')
      })
    })
  })
}

// Riepilogo
function sezioneRiepilogo(c) {
  var r = rie(c)
  var h = '<div class="sezione"><h3>📊 Durata (dalle assegnazioni)</h3><div class="riquadro"><dl>' +
    '<dt>Ore preventivo</dt><dd>' + fOre(r.orePreventivo) + '</dd>' +
    '<dt>Ore pianificate</dt><dd>' + fOre(r.oreAssegnate) + '</dd>' +
    '<dt>Residue</dt><dd>' + (r.residue > 1e-9 ? '⚠️ Mancano ' + fOre(r.residue) + ' non pianificate' : r.residue < -1e-9 ? '⚠️ Pianificate ' + fOre(-r.residue) + ' oltre il preventivo' : '✔ 0 h: tutto pianificato') + '</dd>' +
    '<dt>Inizio</dt><dd>' + gAnno(r.inizio) + '</dd><dt>Fine</dt><dd>' + gAnno(r.fine) + '</dd>' +
    '<dt>Giorni di cantiere</dt><dd>' + r.giorni + ' · ' + r.giorniPersona + ' giorni-persona</dd>'
  if (r.ultimoGiorno) {
    var ug = r.ultimoGiorno
    h += '<dt>Ultimo giorno</dt><dd>' + C.fmtGiorno(ug.data) + ': ' + fOre(ug.oreLavoro) + ' di lavoro, ' + fOre(ug.oreLibere) + ' libere</dd>'
  }
  h += '</dl></div>'
  var v = Number(c.viaggio_min_andata || 0)
  h += '<h3>🚗 Di cui viaggio</h3><div class="riquadro"><dl>' +
    '<dt>Ore preventivo</dt><dd>' + fOre(r.orePreventivo) + '</dd>' +
    '<dt>Di cui viaggio</dt><dd>' + fOre(r.oreViaggio) + ' <span class="aiuto">(' + r.giorniPersona + ' giorni-persona × 2 × ' + v + ' min)</span></dd>' +
    '<dt>Restano in cantiere</dt><dd>' + fOre(r.oreInCantiere) + '</dd>' +
    '<dt>% viaggio</dt><dd>' + f(r.pctViaggio, 1) + '%</dd></dl></div>' +
    '<p class="aiuto">Solo informazione. Un giorno parziale conta come un viaggio intero.' + (c.viaggio_min_andata === null || c.viaggio_min_andata === undefined ? ' Minuti di viaggio non ancora inseriti.' : '') + '</p></div>'
  return h
}

// Pianificazione: riempi, sposta, finito
function sezionePianificazione(c) {
  if (c.interna) return '<div class="sezione"><h3>🗓️ Pianificazione</h3><p class="aiuto">Commessa interna: si assegna cella per cella.</p></div>'
  var r = rie(c)
  var h = '<div class="sezione"><h3>🗓️ Riempi automaticamente</h3>' +
    '<p class="aiuto">Crea le assegnazioni giorno per giorno da questa data, saltando weekend, festivi, chiusure e assenze, finché le ' + fOre(r.orePreventivo) + ' del preventivo sono coperte. Poi correggi a mano.</p>' +
    '<button type="button" class="primario" id="pi-riempi">Riempi automaticamente…</button>' +
    '<h3>↔️ Sposta di N giorni lavorativi</h3><div class="campi">' + campo('Giorni lavorativi (negativo = indietro)', '<input id="pi-n" inputmode="numeric" value="1">', 'giorni') + '</div>' +
    '<div class="riga-bottoni"><button type="button" id="pi-sposta">Sposta</button></div>' +
    '<h3>✅ Finito il…</h3><div class="campi">' + campo('Data di fine lavori', '<input id="pi-finito" type="date" value="' + esc(c.finito_il || '') + '">') + '</div>' +
    '<div class="riga-bottoni"><button type="button" id="pi-segna-finito">Segna finito</button></div></div>'
  return h
}
function collegaPianificazione(w, c) {
  if (c.interna) return
  var q = function (s) { return w.corpo.querySelector(s) }
  q('#pi-riempi').addEventListener('click', function () { apriRiempi(c, null, w) })
  q('#pi-sposta').addEventListener('click', function () {
    esegui(async function () {
      var n = Math.round(C.leggiNumero(q('#pi-n').value))
      if (!n) { toast('Scrivi un numero di giorni diverso da 0', true); return }
      var ass = ST.assPer[c.id] || []
      if (!ass.length) { toast('Nessuna assegnazione da spostare', true); return }
      if (!await conferma('Spostare ' + esc(c.numero) + ' di ' + n + ' giorni lavorativi (' + ass.length + ' assegnazioni)? Si saltano weekend, festivi e chiusure.')) return
      await applicaPiano(c.id, C.pianoSposta(ass, n, ST.cal), 'Spostata di ' + n + ' giorni lavorativi', { spostamento: true })
      riapriScheda(w)
    })
  })
  q('#pi-segna-finito').addEventListener('click', function () {
    esegui(async function () {
      var d = q('#pi-finito').value
      if (!d) { toast('Scegli la data di fine', true); return }
      await segnaFinito(c, d)
      riapriScheda(w)
    })
  })
}
async function segnaFinito(c, data) {
  var ass = ST.assPer[c.id] || []
  var pf = C.pianoFinitoIl(ass, data)
  var fineP = ass.length ? ass.map(function (a) { return a.data }).sort().pop() : null
  var testo = 'Segnare <strong>' + esc(c.numero + ' ' + c.nome) + '</strong> finito il ' + gAnno(data) + '?'
  if (pf.liberate.length) testo += '<br>Le <strong>' + pf.liberate.length + '</strong> assegnazioni dopo questa data vengono tolte e quei giorni tornano liberi.'
  if (!await conferma(testo)) return
  if (pf.liberate.length) await D.eliminaId('pl_assegnazioni', pf.liberate.map(function (a) { return a.id }))
  await D.aggiorna('pl_commesse', c.id, { stato: 'Finito', finito_il: data, fine_pianificata: fineP })
  await ricarica(['commesse', 'assegnazioni'])
  toast(c.numero + ' segnata finita' + (pf.liberate.length ? ': guarda gli avvisi per usare i giorni liberati' : ''))
}
function apriRiempi(c, dataProposta, schedaW) {
  var r = rie(c)
  var w = apriFinestra('Riempi automaticamente · ' + c.numero, { centro: true, piccola: true })
  var inizio = dataProposta || c.data_inizio || C.spostaLavorativi(ST.cal, C.oggiIso(), 0)
  var ore = r.orePreventivo
  w.corpo.innerHTML = '<p>Ore da coprire: <strong>' + fOre(ore) + '</strong> (preventivo).</p><div class="campi">' +
    campo('Data inizio', '<input id="ri-data" type="date" value="' + esc(inizio) + '">') + '</div>' +
    '<h3>Persone</h3><p><label><input type="radio" name="ri-modo" value="nomi" checked> Con nome</label> &nbsp; <label><input type="radio" name="ri-modo" value="numero"> Solo il numero (nomi da decidere)</label></p>' +
    '<div id="ri-nomi">' + ST.persone.map(function (p) { return '<p><label><input type="checkbox" value="' + p.id + '"> ' + esc(p.nome) + '</label></p>' }).join('') + '</div>' +
    '<div id="ri-numero" hidden>' + campo('Quante persone', '<input id="ri-quante" inputmode="numeric" value="' + (c.persone_previste || 2) + '">', 'persone') + '</div>' +
    '<p class="esito attenzione" id="ri-sostituisce" hidden></p>' +
    '<div class="riga-bottoni"><button type="button" class="primario" id="ri-vai">Riempi</button><button type="button" id="ri-annulla">Annulla</button></div><div id="ri-esito"></div>'
  var q = function (s) { return w.corpo.querySelector(s) }
  // Le assegnazioni PRIMA della data d'inizio restano (lavoro già fatto o già deciso);
  // da quella data in poi si rifà tutto e si coprono solo le ore che mancano.
  function divisione(data) {
    var tutte = ST.assPer[c.id] || []
    var tenute = tutte.filter(function (a) { return a.data < data })
    return { tenute: tenute, sostituite: tutte.length - tenute.length, daCoprire: Math.round((ore - C.sommaOre(tenute)) * 1000) / 1000 }
  }
  function aggiornaNota() {
    var d = q('#ri-data').value, el = q('#ri-sostituisce')
    if (!d) { el.hidden = true; return }
    var dv = divisione(d)
    el.hidden = !dv.sostituite && !dv.tenute.length
    el.textContent = (dv.sostituite ? 'Le ' + dv.sostituite + ' assegnazioni di ' + c.numero + ' dal ' + gAnno(d) + ' in poi vengono sostituite. ' : '') +
      (dv.tenute.length ? 'Le ' + dv.tenute.length + ' prima di questa data restano (' + fOre(C.sommaOre(dv.tenute)) + '): si coprono le ' + fOre(dv.daCoprire) + ' che mancano.' : '')
  }
  q('#ri-data').addEventListener('change', aggiornaNota)
  aggiornaNota()
  w.corpo.querySelectorAll('[name="ri-modo"]').forEach(function (x) {
    x.addEventListener('change', function () { var nomi = q('[name="ri-modo"]:checked').value === 'nomi'; q('#ri-nomi').hidden = !nomi; q('#ri-numero').hidden = nomi })
  })
  q('#ri-annulla').addEventListener('click', w.chiudi)
  q('#ri-vai').addEventListener('click', function () {
    esegui(async function () {
      var es = q('#ri-esito')
      if (!(ore > 0)) { es.innerHTML = '<div class="esito ko">La commessa non ha ore nei capitoli: aggiungili prima.</div>'; return }
      var data = q('#ri-data').value
      if (!data) { es.innerHTML = '<div class="esito ko">Scegli la data di inizio.</div>'; return }
      var persone
      if (q('[name="ri-modo"]:checked').value === 'nomi') {
        persone = Array.from(w.corpo.querySelectorAll('#ri-nomi input:checked')).map(function (x) { return { persona_id: x.value } })
        if (!persone.length) { es.innerHTML = '<div class="esito ko">Scegli almeno una persona, o «Solo il numero».</div>'; return }
      } else {
        var n = Math.round(C.leggiNumero(q('#ri-quante').value))
        if (!(n >= 1 && n <= 20)) { es.innerHTML = '<div class="esito ko">Numero di persone fra 1 e 20.</div>'; return }
        persone = []; for (var i = 1; i <= n; i++) persone.push({ segnaposto: i })
      }
      var dv = divisione(data)
      if (!(dv.daCoprire > 0)) { es.innerHTML = '<div class="esito ko">Prima del ' + gAnno(data) + ' sono già pianificate tutte le ore del preventivo: niente da riempire.</div>'; return }
      var altre = ST.dati.assegnazioni.filter(function (a) { return a.commessa_id !== c.id })
      var p = { oreTotali: dv.daCoprire, dataInizio: data, persone: persone, cal: ST.cal, commessa: c, assenze: ST.dati.assenze, viaggioIncluso: viaggioIncluso(), altreAssegnazioni: altre }
      var piano = C.riempiAutomatico(p)
      if (!piano.assegnazioni.length) { es.innerHTML = '<div class="esito ko">Nessun giorno disponibile trovato.</div>'; return }
      // Il periodo attraversa una chiusura? PRIMA di riempire si chiede cosa fare.
      var gestite = {}
      for (var giro = 0; giro < 12; giro++) {
        var ch = C.chiusureNelPeriodo(ST.cal, p.dataInizio, piano.fine).filter(function (x) { return !gestite[x.dal + '|' + x.al] })[0]
        if (!ch) break
        gestite[ch.dal + '|' + ch.al] = 1
        var scelta = await sceltaChiusura(c, ch, piano)
        if (!scelta) { es.innerHTML = '<div class="esito attenzione">Annullato: niente è stato cambiato.</div>'; return }
        if (scelta.id === 'sposta_dopo') {
          piano = C.riempiConChiusura(p, ch, 'sposta_dopo')
          p.dataInizio = piano.assegnazioni.length ? piano.assegnazioni[0].data : p.dataInizio
        } else if (scelta.id === 'lavora_durante') {
          var lista = C.pianoLavoraDurante({ assCommessa: piano.assegnazioni, chiusura: ch, personeScelte: scelta.persone, cal: ST.cal, commessa: c, viaggioIncluso: viaggioIncluso(), assenze: ST.dati.assenze })
          piano = { assegnazioni: lista, fine: lista.map(function (a) { return a.data }).sort().pop(), oreNonCoperte: piano.oreNonCoperte }
        }
      }
      if (piano.oreNonCoperte > 0) { es.innerHTML = '<div class="esito ko">Non sono riuscito a coprire ' + fOre(piano.oreNonCoperte) + ' (troppe assenze o chiusure?).</div>'; return }
      w.chiudi()
      await applicaPiano(c.id, dv.tenute.concat(piano.assegnazioni), c.numero + ': pianificata da ' + C.fmtGiorno(piano.assegnazioni.map(function (a) { return a.data }).sort()[0]) + ' a ' + C.fmtGiorno(piano.fine), { ripianificato: true })
      if (schedaW && _finestre.indexOf(schedaW) >= 0) riapriScheda(schedaW)
    })
  })
}

// Riempi: il periodo attraversa una chiusura → le 3 scelte. Restituisce
// { id: 'sposta_dopo'|'interrompi'|'lavora_durante', persone:[persona_id] } oppure null (annullato).
function sceltaChiusura(c, ch, piano) {
  return new Promise(function (risolvi) {
    var fatto = false
    var w = apriFinestra('Chiusura nel periodo · ' + c.numero, { centro: true, piccola: true, onChiudi: function () { if (!fatto) risolvi(null) } })
    var ripresa = C.spostaLavorativi(ST.cal, C.aggiungiGiorni(ch.al, 1), 0)
    w.corpo.innerHTML = '<p>Il lavoro di <strong>' + esc(c.numero + ' ' + c.nome) + '</strong> attraversa la chiusura ' + (ch.motivo ? '<strong>«' + esc(ch.motivo) + '»</strong> ' : '') +
      'dal ' + gAnno(ch.dal) + ' al ' + gAnno(ch.al) + '. Cosa vuoi fare?</p>' +
      '<div class="azioni-avviso" style="display:flex;flex-direction:column;gap:8px">' +
      '<button type="button" data-scelta="sposta_dopo">Sposta tutto dopo la chiusura (inizio ' + gAnno(ripresa) + ')</button>' +
      '<button type="button" data-scelta="interrompi">Interrompi e riprendi dopo (' + gAnno(ripresa) + ')</button>' +
      '<button type="button" data-scelta="lavora_durante">Qualcuno lavora durante la chiusura (ferie da recuperare)</button></div>' +
      '<div id="sc-chi" hidden><h3>Chi lavora durante la chiusura?</h3>' + ST.persone.map(function (p) { return '<p><label><input type="checkbox" value="' + p.id + '"> ' + esc(p.nome) + '</label></p>' }).join('') +
      '<div class="riga-bottoni"><button type="button" class="primario" data-ok>Continua</button></div><div data-esito></div></div>' +
      '<div class="riga-bottoni"><button type="button" data-no>Annulla</button></div>'
    var fine = function (v) { fatto = true; w.chiudi(); risolvi(v) }
    w.corpo.querySelectorAll('[data-scelta]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.scelta === 'lavora_durante') { w.corpo.querySelector('#sc-chi').hidden = false; return }
        fine({ id: b.dataset.scelta, persone: [] })
      })
    })
    w.corpo.querySelector('[data-ok]').addEventListener('click', function () {
      var l = Array.from(w.corpo.querySelectorAll('#sc-chi input:checked')).map(function (x) { return x.value })
      if (!l.length) { w.corpo.querySelector('[data-esito]').innerHTML = '<div class="esito ko">Scegli almeno una persona.</div>'; return }
      fine({ id: 'lavora_durante', persone: l })
    })
    w.corpo.querySelector('[data-no]').addEventListener('click', w.chiudi)
  })
}

// Margini
function nomeStazione() { return STAZIONI[ST.dati.imp.stazione_meteo] || ST.dati.imp.stazione_meteo }
function calcolaMargini(c) {
  var r = rie(c)
  var imp = ST.dati.imp
  return {
    pioggia: C.marginePioggia({ date: r.date, meteo: ST.meteoMap, recupero: imp.recupero_pioggia, quotaAperto: r.quotaAperto, stazione: nomeStazione() }),
    malattia: C.margineMalattia({ assegnazioni: ST.assPer[c.id] || [], cal: ST.cal, giorniAnno: imp.malattia_giorni_anno, quotaInverno: imp.malattia_quota_inverno })
  }
}
function sezioneMargini(c) {
  if (c.interna) return ''
  var m = calcolaMargini(c)
  var ma = c.margini_accettati || {}
  var h = '<div class="sezione"><h3>🧮 Margini — proposti, mai aggiunti da soli</h3>'
  if (!rie(c).orePreventivo) return h + '<p class="aiuto">Mancano i capitoli del preventivo: margini non calcolabili.</p></div>'
  function scheda(tipo, icona, nome, x) {
    if (x.nessuno && tipo === 'pioggia' && /coperto/.test(x.motivo)) return ''        // tutto al coperto: nessuna scheda
    var salvato = ma[tipo] || {}
    var s = '<div class="scheda-margine"><div><strong>' + icona + ' ' + nome + '</strong></div>'
    if (x.mancanoDati) return s + '<div class="esito ko">' + esc(x.motivo) + '</div></div>'
    if (x.nessuno) return s + '<p class="aiuto">' + esc(x.motivo) + '</p></div>'
    s += '<div class="giorni">' + C.fmtGiorni(x.giorni) + '</div><p>' + esc(x.motivo) + '</p>'
    s += '<p class="stato-margine">Stato: ' + (salvato.stato ? esc(salvato.stato) + (salvato.stato === 'Aggiunto' ? ' (' + C.fmtGiorni(salvato.giorni) + ')' : '') : 'da decidere') + '</p>'
    if (salvato.stato === 'Aggiunto' && Math.abs(Number(salvato.giorni) - x.giorni) > 1e-9) s += '<p class="esito attenzione">Il calcolo adesso dice ' + C.fmtGiorni(x.giorni) + ': premi «Aggiungi» per aggiornare.</p>'
    s += '<div class="riga-bottoni"><button type="button" class="primario" data-margine="' + tipo + '" data-azione="Aggiunto">➕ Aggiungi</button>' +
      '<button type="button" data-margine="' + tipo + '" data-azione="Non aggiunto">Non aggiungere</button></div></div>'
    return s
  }
  h += scheda('pioggia', '🌧️', 'Pioggia (solo capitoli all\'aperto)', m.pioggia)
  h += scheda('malattia', '🤒', 'Malattia', m.malattia)
  h += '<div class="scheda-margine"><strong>📝 Margine libero</strong><div class="campi">' +
    campo('Giorni', '<input id="mx-giorni" inputmode="decimal" value="' + esc(f(c.margine_x_giorni || 0, 1)) + '">', 'giorni') +
    campo('Nota (facoltativa)', '<input id="mx-nota" value="' + esc(c.margine_x_nota || '') + '">') + '</div>' +
    '<div class="riga-bottoni"><button type="button" id="mx-salva">Salva margine libero</button></div></div></div>'
  return h
}
function collegaMargini(w, c) {
  if (c.interna) return
  w.corpo.querySelectorAll('[data-margine]').forEach(function (b) {
    b.addEventListener('click', function () {
      esegui(async function () {
        var m = calcolaMargini(c)[b.dataset.margine]
        var ma = JSON.parse(JSON.stringify(c.margini_accettati || {}))
        ma[b.dataset.margine] = { stato: b.dataset.azione, giorni: m.giorni, motivo: m.motivo, il: C.oggiIso() }
        await D.aggiorna('pl_commesse', c.id, { margini_accettati: ma })
        await ricarica(['commesse']); riapriScheda(w)
        toast(b.dataset.azione === 'Aggiunto' ? 'Margine aggiunto: compare tratteggiato dopo la fine' : 'Margine non aggiunto')
      })
    })
  })
  var mxSalva = w.corpo.querySelector('#mx-salva')
  if (!mxSalva) return           // senza capitoli la sezione margini non ha campi
  mxSalva.addEventListener('click', function () {
    esegui(async function () {
      var g = C.leggiNumero(w.corpo.querySelector('#mx-giorni').value || '0')
      if (!(g >= 0)) { toast('Giorni non leggibili', true); return }
      await D.aggiorna('pl_commesse', c.id, { margine_x_giorni: C.perEccessoMezzo(g), margine_x_nota: w.corpo.querySelector('#mx-nota').value.trim() || null })
      await ricarica(['commesse']); riapriScheda(w)
      toast('Margine libero salvato')
    })
  })
}

// ── Avvisi ──────────────────────────────────────────────────────────────────
var _finestraAvvisi = null
function apriAvvisi() {
  if (_finestraAvvisi && _finestre.indexOf(_finestraAvvisi) >= 0) { disegnaAvvisi(); return }
  _finestraAvvisi = apriFinestra('🔔 Avvisi', { onChiudi: function () { _finestraAvvisi = null } })
  disegnaAvvisi()
}
function disegnaAvvisi() {
  var w = _finestraAvvisi
  if (!w) return
  var attivi = ST.avvisi.filter(function (a) { return !a.ignorato })
  var ignorati = ST.avvisi.length - attivi.length
  var h = '<p class="aiuto">Gli avvisi non bloccano niente. «Vai» porta al punto nel piano, «Ignora» lo toglie dall\'elenco.</p>'
  if (!attivi.length) h += '<div class="esito ok">✔ Nessun avviso aperto.</div>'
  h += attivi.map(function (a, i) {
    var s = '<div class="avviso"><div class="tipo">' + a.icona + ' ' + esc(a.etichetta) + '</div>' +
      (a.data ? '<div class="data">' + gAnno(a.data) + '</div>' : '') + '<div>' + esc(a.testo) + '</div>'
    if (a.azioni && a.azioni.length) {
      s += '<div class="azioni-avviso">' + a.azioni.map(function (z, j) {
        return '<button type="button" data-az="' + i + ':' + j + '"' + (z.id === 'anticipa' && !z.commessa_id ? ' disabled' : '') + '>' + esc(z.etichetta) + '</button>'
      }).join('') + '</div>'
    }
    s += '<div class="riga-bottoni"><button type="button" class="piccolo primario" data-vai="' + i + '">➜ Vai</button><button type="button" class="piccolo" data-ignora="' + i + '">Ignora</button></div></div>'
    return s
  }).join('')
  if (ignorati) h += '<p class="aiuto">' + ignorati + ' avvisi ignorati non sono mostrati.</p>'
  w.corpo.innerHTML = h
  w.corpo.querySelectorAll('[data-vai]').forEach(function (b) { b.addEventListener('click', function () { vaiAAvviso(attivi[+b.dataset.vai]) }) })
  w.corpo.querySelectorAll('[data-ignora]').forEach(function (b) {
    b.addEventListener('click', function () {
      esegui(async function () {
        await D.inserisci('pl_avvisi_ignorati', { chiave: attivi[+b.dataset.ignora].chiave })
        await ricaricaIgnorati(); disegnaAvvisi()
      })
    })
  })
  w.corpo.querySelectorAll('[data-az]').forEach(function (b) {
    b.addEventListener('click', function () {
      var p = b.dataset.az.split(':')
      var a = attivi[+p[0]]
      esegui(function () { return azioneAvviso(a, a.azioni[+p[1]]) })
    })
  })
}
function vaiAAvviso(a) {
  if (_finestraAvvisi) _finestraAvvisi.chiudi()
  ST.pagina = 'piano'
  ST.vista = a.persona_id ? 'persone' : 'cantieri'
  ST.ancora = a.data || C.oggiIso()
  disegna()
  var chiave = a.persona_id ? 'p:' + a.persona_id : a.commessa_id
  var tr = chiave && document.querySelector('tr[data-riga="' + chiave + '"]')
  if (tr) { tr.classList.add('lampeggia'); tr.scrollIntoView({ block: 'center' }); setTimeout(function () { tr.classList.remove('lampeggia') }, 2600) }
  else if (a.commessa_id && ST.perId[a.commessa_id]) apriCommessa(a.commessa_id)
}
async function azioneAvviso(a, z) {
  var c = ST.perId[a.commessa_id]
  var ass = c ? (ST.assPer[c.id] || []) : []
  if (a.tipo === 'periodo' && z.id === 'ricalcola') {
    var orePrev = rie(c).orePreventivo
    if (!(orePrev > 0)) { mostraErrore(c.numero + ' non ha ore nei capitoli: non si può ricalcolare.'); return }
    var nuovo = C.pianoRicalcola(ass, { oreTotali: orePrev, cal: ST.cal, commessa: c, assenze: ST.dati.assenze, viaggioIncluso: viaggioIncluso(),
      altreAssegnazioni: ST.dati.assegnazioni.filter(function (x) { return x.commessa_id !== c.id }) })
    if (!await conferma('Ricalcolare <strong>' + esc(c.numero + ' ' + c.nome) + '</strong> con le ore del nuovo periodo? Si rifà «Riempi» con le stesse persone dal ' +
      gAnno(ass.map(function (x) { return x.data }).sort()[0]) + ': nuova fine ' + gAnno(nuovo.fine) + '.<br><strong>Le modifiche fatte a mano su questa commessa si perdono.</strong>', { si: 'Ricalcola' })) return
    await applicaPiano(c.id, nuovo.assegnazioni, c.numero + ' ricalcolata: fine ' + C.fmtGiorno(nuovo.fine), { ripianificato: true })
  } else if (a.tipo === 6) {
    var ch = a.chiusura
    if (z.id === 'sposta_dopo') {
      if (!await conferma('Spostare tutta ' + esc(c.numero) + ' dopo la chiusura (dal ' + gAnno(C.spostaLavorativi(ST.cal, C.aggiungiGiorni(ch.al, 1), 0)) + ')?')) return
      await applicaPiano(c.id, C.pianoSpostaDopoChiusura(ass, ch, ST.cal), c.numero + ' spostata dopo la chiusura', { spostamento: true })
    } else if (z.id === 'interrompi') {
      if (!await conferma('Interrompere ' + esc(c.numero) + ' durante la chiusura e riprendere subito dopo? Quel che sta prima resta com\'è.')) return
      await applicaPiano(c.id, C.pianoInterrompi(ass, ch, ST.cal), c.numero + ': interrotta e ripresa dopo la chiusura', { spostamento: true })
    } else if (z.id === 'lavora_durante') {
      var scelte = await scegliPersone('Chi lavora durante la chiusura?', 'Le ore lavorate in chiusura avranno la nota «ferie da recuperare».')
      if (!scelte || !scelte.length) return
      var piano = C.pianoLavoraDurante({ assCommessa: ass, chiusura: ch, personeScelte: scelte, cal: ST.cal, commessa: c, viaggioIncluso: viaggioIncluso(), assenze: ST.dati.assenze })
      var inCh = piano.filter(function (x) { return x.nota === 'ferie da recuperare' })
      if (!await conferma(esc(scelte.map(function (s) { return ST.nomi[s] }).join(', ')) + ' lavora su ' + esc(c.numero) + ' durante la chiusura: ' + inCh.length + ' giornate, ' + fOre(C.sommaOre(inCh)) + ' (ferie da recuperare). Confermi?')) return
      await applicaPiano(c.id, piano, 'Piano aggiornato: ferie da recuperare segnate')
    }
  } else if (a.tipo === 8) {
    var r = rie(c), ug = r.ultimoGiorno
    var liberi = ug.persone.filter(function (p) { return p.libere > 1e-9 })
    if (z.id === 'magazzino') {
      if (!ST.magazzino) { mostraErrore('Commessa Magazzino non trovata (numero 00-000). È nello SQL PL_01: rilancialo.'); return }
      if (!await conferma('Assegnare le ore libere di ' + C.fmtGiorno(ug.data) + ' al Magazzino? (' + liberi.map(function (p) { return esc(nomeChiave(p.chiave)) + ' ' + fOre(p.libere) }).join(', ') + ')')) return
      var righe = liberi.filter(function (p) { return p.persona_id }).map(function (p) { return { data: ug.data, persona_id: p.persona_id, commessa_id: ST.magazzino.id, ore: mezzOra(p.libere) || 0.5, posizione: prossimaPosizione(p.persona_id, ug.data) } })
      if (!righe.length) { toast('Le persone dell\'ultimo giorno sono ancora «da decidere»: assegna prima i nomi.', true); return }
      await D.inserisci('pl_assegnazioni', righe); await ricarica(['assegnazioni']); toast('Ore libere al Magazzino')
    } else if (z.id === 'riparazione') {
      var rip = ST.perId[z.commessa_id]
      var resto = C.sommaOre(ST.capPer[rip.id] || [])
      if (!await conferma('Mettere la riparazione ' + esc(rip.numero + ' ' + rip.nome) + ' (' + fOre(resto) + ') nelle ore libere di ' + C.fmtGiorno(ug.data) + '?')) return
      var nuove = []
      liberi.forEach(function (p) {
        if (resto <= 1e-9 || !p.persona_id) return
        var o = Math.min(p.libere, resto)
        nuove.push({ data: ug.data, persona_id: p.persona_id, commessa_id: rip.id, ore: o, posizione: prossimaPosizione(p.persona_id, ug.data) })
        resto -= o
      })
      if (!nuove.length) { toast('Le persone dell\'ultimo giorno sono ancora «da decidere»: assegna prima i nomi.', true); return }
      await D.inserisci('pl_assegnazioni', nuove); await ricarica(['assegnazioni'])
      toast(resto > 1e-9 ? 'Riparazione messa; restano ' + fOre(resto) + ' da pianificare' : 'Riparazione pianificata nelle ore libere')
    } else if (z.id === 'anticipa') {
      await anticipaSuccessiva(ST.perId[z.commessa_id], C.spostaLavorativi(ST.cal, ug.data, 1))
    }
  } else if (a.tipo === 9) {
    if (z.id === 'opzione_a') {
      await D.inserisci('pl_avvisi_ignorati', { chiave: a.chiave })
      await ricaricaIgnorati(); toast('Tenuto il giorno in più (opzione A)')
    } else if (z.id === 'opzione_b') {
      var B = a.opzioni.B
      if (!await conferma('<strong>Eccezione:</strong> ' + esc(B.testo) + '.<br>Giorni allungati: ' + B.giorni.map(C.fmtGiorno).join(', ') + '. L\'ultimo giorno corto sparisce. La base resta ' + fOre(C.eInverno(ST.cal, B.giorni[0]) ? ST.dati.imp.ore_inverno_lungio : ST.dati.imp.ore_estate_lungio) + ' lun-gio e ' + fOre(C.eInverno(ST.cal, B.giorni[0]) ? ST.dati.imp.ore_inverno_ven : ST.dati.imp.ore_estate_ven) + ' ven: le giornate lunghe valgono solo per questi giorni.', { si: 'Applica l\'eccezione' })) return
      await applicaPiano(c.id, B.nuoveAssegnazioni, 'Eccezione applicata: ' + B.nGiorni + ' giorni da ' + fOre(B.oreGiornata))
    }
  } else if (a.tipo === 10) {
    var dopo = C.spostaLavorativi(ST.cal, c.finito_il, 1)
    if (z.id === 'anticipa') await anticipaSuccessiva(ST.perId[z.commessa_id], dopo)
    else if (z.id === 'magazzino') { if (_finestraAvvisi) _finestraAvvisi.chiudi(); apriAssegna({ data: dopo, commessa_id: ST.magazzino && ST.magazzino.id }) }
    else if (z.id === 'riparazione') {
      if (_finestraAvvisi) _finestraAvvisi.chiudi()
      ST.pagina = 'piano'; ST.vista = 'persone'; ST.ancora = dopo; disegna()
      $('coda').scrollIntoView({ block: 'start' })
      toast(ST.coda.length ? 'Trascina una riparazione dalla coda nella cella libera di ' + C.fmtGiorno(dopo) : 'Nessuna riparazione in coda', !ST.coda.length)
    }
  }
  disegnaAvvisi()
}
// La commessa successiva comincia dal giorno indicato (se comincia dopo)
async function anticipaSuccessiva(s, primoGiorno) {
  if (!s) return
  var ass = ST.assPer[s.id] || []
  var inizio = ass.map(function (a) { return a.data }).sort()[0]
  if (!inizio || inizio <= primoGiorno) { toast(s.numero + ' comincia già ' + (inizio ? C.fmtGiorno(inizio) : '—') + ': niente da anticipare', true); return }
  var n = -C.giorniLavorativiFra(ST.cal, primoGiorno, C.aggiungiGiorni(inizio, -1))
  if (!n) { toast('Niente da anticipare', true); return }
  if (!await conferma('Anticipare ' + esc(s.numero + ' ' + s.nome) + ' di ' + (-n) + ' giorni lavorativi (inizio ' + gAnno(primoGiorno) + ')?')) return
  await applicaPiano(s.id, C.pianoSposta(ass, n, ST.cal), s.numero + ' anticipata di ' + (-n) + ' giorni lavorativi', { spostamento: true })
}
function scegliPersone(titolo, nota) {
  return new Promise(function (risolvi) {
    var fatto = false
    var w = apriFinestra(titolo, { centro: true, piccola: true, onChiudi: function () { if (!fatto) risolvi(null) } })
    w.corpo.innerHTML = (nota ? '<p class="aiuto">' + esc(nota) + '</p>' : '') + ST.persone.map(function (p) { return '<p><label><input type="checkbox" value="' + p.id + '"> ' + esc(p.nome) + '</label></p>' }).join('') +
      '<div class="riga-bottoni"><button type="button" class="primario" data-ok>Continua</button><button type="button" data-no>Annulla</button></div>'
    w.corpo.querySelector('[data-ok]').addEventListener('click', function () {
      fatto = true
      var l = Array.from(w.corpo.querySelectorAll('input:checked')).map(function (x) { return x.value })
      w.chiudi(); risolvi(l)
    })
    w.corpo.querySelector('[data-no]').addEventListener('click', w.chiudi)
  })
}

// ── Impostazioni ────────────────────────────────────────────────────────────
var _annoFestivi = C.anno(C.oggiIso())
function disegnaImpostazioni() {
  var imp = ST.dati.imp
  var el = $('pagina-impostazioni')
  var h = '<h1>⚙️ Impostazioni</h1>'
  // Valori
  h += '<div class="sezione"><h2>Giornata, limiti e calcoli</h2><div class="campi">' +
    campo('Estate: lun-gio', inNum('ore_estate_lungio', imp), 'h') + campo('Estate: venerdì', inNum('ore_estate_ven', imp), 'h') +
    campo('Inverno: lun-gio', inNum('ore_inverno_lungio', imp), 'h') + campo('Inverno: venerdì', inNum('ore_inverno_ven', imp), 'h') +
    campo('Massimo settimanale', inNum('max_settimanale', imp), 'h') + campo('Soglia giornata piena', inNum('soglia_giornata_piena', imp), 'h') +
    campo('Viaggio incluso nelle ore del preventivo', '<select id="im-viaggio_incluso"><option value="true"' + (imp.viaggio_incluso !== false ? ' selected' : '') + '>Sì (default)</option><option value="false"' + (imp.viaggio_incluso === false ? ' selected' : '') + '>No: si toglie andata e ritorno</option></select>') +
    campo('Fattore ora di punta', inNum('fattore_ora_punta', imp), '× minuti senza traffico') +
    campo('Giorni di malattia per anno e persona', inNum('malattia_giorni_anno', imp), 'giorni') +
    campo('Quota malattia nov-feb', inNum('malattia_quota_inverno', imp), '%') +
    campo('Recupero pioggia', inNum('recupero_pioggia', imp), '%') +
    campo('Stazione meteo', '<select id="im-stazione_meteo">' + Object.keys(STAZIONI).map(function (k) { return '<option value="' + k + '"' + (k === imp.stazione_meteo ? ' selected' : '') + '>' + k + ' · ' + STAZIONI[k] + '</option>' }).join('') + '</select>') +
    campo('Persone per le medie (riquadro Squadra)', inNum('persone_medie', imp), 'persone') +
    '</div><div class="riga-bottoni"><button type="button" class="primario" id="im-salva">💾 Salva impostazioni</button></div></div>'

  // Squadra
  var sq = C.squadraMalattia(Number(imp.persone_medie), Number(imp.malattia_giorni_anno), Number(imp.malattia_quota_inverno))
  h += '<div class="sezione"><h2>🤒 Squadra: giorni di malattia attesi per mese</h2><p class="aiuto">Squadra di ' + imp.persone_medie + ' persone, ' + f(imp.malattia_giorni_anno) + ' giorni l\'anno a testa, ' + f(imp.malattia_quota_inverno) + '% fra novembre e febbraio.</p>' +
    '<table class="elenco"><thead><tr>' + sq.map(function (x) { return '<th class="num">' + x.nome.slice(0, 3) + '</th>' }).join('') + '<th class="num">Anno</th></tr></thead><tbody><tr>' +
    sq.map(function (x) { return '<td class="num">' + f(x.giorni, 1) + '</td>' }).join('') + '<td class="num"><strong>' + f(sq.reduce(function (s, x) { return s + x.giorni }, 0), 1) + '</strong></td></tr></tbody></table></div>'

  // Periodi inverno
  var anniPeriodi = ST.dati.periodi.map(function (p) { return p.anno })
  h += '<div class="sezione"><h2>❄️ Periodi inverno</h2><p class="aiuto">Una riga per anno (l\'anno in cui l\'inverno comincia). Proposta: dal primo lunedì di novembre all\'ultimo venerdì di marzo.</p>' +
    '<table class="elenco"><thead><tr><th>Anno</th><th>Dal</th><th>Al</th><th></th></tr></thead><tbody>' +
    ST.dati.periodi.map(function (p) {
      return '<tr><td>' + p.anno + '/' + String(p.anno + 1).slice(2) + '</td><td><input type="date" data-inv-dal="' + p.anno + '" value="' + p.data_inizio + '"></td><td><input type="date" data-inv-al="' + p.anno + '" value="' + p.data_fine + '"></td>' +
        '<td><button type="button" class="piccolo" data-inv-salva="' + p.anno + '">Salva</button></td></tr>'
    }).join('') + '</tbody></table>' +
    '<div class="riga-bottoni"><button type="button" id="inv-aggiungi">+ Aggiungi anno ' + (anniPeriodi.length ? Math.max.apply(null, anniPeriodi) + 1 : C.anno(C.oggiIso())) + '</button></div></div>'

  // Festivi
  var fest = C.festiviAnno(ST.cal, _annoFestivi)
  h += '<div class="sezione"><h2>🎉 Festivi Ticino</h2><div class="riga-bottoni"><button type="button" id="fe-prima">◀ ' + (_annoFestivi - 1) + '</button><strong style="align-self:center;font-size:1.2rem">' + _annoFestivi + '</strong><button type="button" id="fe-dopo">' + (_annoFestivi + 1) + ' ▶</button></div>' +
    '<p class="aiuto">I 15 festivi ticinesi, calcolati per ogni anno. Venerdì Santo in Ticino è lavorativo. Togli la spunta per lavorare quel giorno.</p>' +
    '<table class="elenco"><thead><tr><th>Data</th><th>Festivo</th><th>Attivo</th></tr></thead><tbody>' +
    fest.map(function (x) {
      return '<tr><td>' + C.GIORNI_LUNGHI[C.giornoSettimana(x.data)] + ' ' + C.fmtDataAnno(x.data) + '</td><td>' + esc(x.nome) + '</td>' +
        '<td><label><input type="checkbox" data-festivo="' + x.data + '" data-nome="' + esc(x.nome) + '"' + (x.attivo ? ' checked' : '') + '> ' + (x.attivo ? 'Attivo (non si lavora)' : 'Disattivato (si lavora)') + '</label></td></tr>'
    }).join('') + '</tbody></table></div>'

  // Chiusure
  h += '<div class="sezione"><h2>🏭 Chiusure aziendali</h2>' +
    (ST.dati.chiusure.length ? '<table class="elenco"><thead><tr><th>Dal</th><th>Al</th><th>Motivo</th><th></th></tr></thead><tbody>' +
      ST.dati.chiusure.map(function (x) { return '<tr><td>' + gAnno(x.dal) + '</td><td>' + gAnno(x.al) + '</td><td>' + esc(x.motivo || '') + '</td><td><button type="button" class="piccolo pericolo" data-chiusura-togli="' + x.id + '">Togli</button></td></tr>' }).join('') +
      '</tbody></table>' : '<p class="aiuto">Nessuna chiusura.</p>') +
    '<h3>Nuova chiusura</h3><div class="campi">' + campo('Dal', '<input type="date" id="ch-dal">') + campo('Al', '<input type="date" id="ch-al">') +
    campo('Motivo', '<input id="ch-motivo" placeholder="es. Ferie estive, Natale">') + '</div><div class="riga-bottoni"><button type="button" id="ch-aggiungi">+ Aggiungi chiusura</button></div></div>'

  // Assenze
  h += '<div class="sezione"><h2>🚫 Assenze delle persone</h2>' +
    (ST.dati.assenze.length ? '<table class="elenco"><thead><tr><th>Persona</th><th>Dal</th><th>Al</th><th>Tipo</th><th>Nota</th><th></th></tr></thead><tbody>' +
      ST.dati.assenze.map(function (x) { return '<tr><td>' + esc(ST.nomi[x.persona_id] || 'Persona sconosciuta') + '</td><td>' + gAnno(x.dal) + '</td><td>' + gAnno(x.al) + '</td><td>' + esc(x.tipo) + '</td><td>' + esc(x.nota || '') + '</td><td><button type="button" class="piccolo pericolo" data-assenza-togli="' + x.id + '">Togli</button></td></tr>' }).join('') +
      '</tbody></table>' : '<p class="aiuto">Nessuna assenza.</p>') +
    '<h3>Nuova assenza</h3><div class="campi">' +
    campo('Persona', '<select id="as-p">' + ST.persone.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nome) + '</option>' }).join('') + '</select>') +
    campo('Dal', '<input type="date" id="as-dal">') + campo('Al', '<input type="date" id="as-al">') +
    campo('Tipo', '<select id="as-tipo"><option>Ferie</option><option>Malattia</option><option>Altro</option></select>') +
    campo('Nota', '<input id="as-nota">') + '</div><div class="riga-bottoni"><button type="button" id="as-aggiungi">+ Aggiungi assenza</button></div></div>'

  // Meteo (sola lettura)
  var righeMeteo = ST.dati.meteo.filter(function (r) { return r.stazione === imp.stazione_meteo })
  h += '<div class="sezione"><h2>🌧️ Dati pioggia</h2>' + (righeMeteo.length
    ? '<p class="aiuto">MeteoSvizzera, valori normali 1991-2020: giorni con precipitazione ≥ 1 mm, media del mese. Stazione ' + esc(imp.stazione_meteo + ' · ' + nomeStazione()) + '.</p><table class="elenco"><thead><tr>' +
      righeMeteo.map(function (r) { return '<th class="num">' + C.MESI[r.mese].slice(0, 3) + '</th>' }).join('') + '</tr></thead><tbody><tr>' + righeMeteo.map(function (r) { return '<td class="num">' + f(r.giorni_pioggia, 1) + '</td>' }).join('') + '</tr></tbody></table>'
    : '<div class="esito ko">Dati pioggia mancanti per la stazione ' + esc(imp.stazione_meteo) + '. Il margine pioggia non si calcola.</div>') + '</div>'

  h += '<p class="aiuto">Utente: ' + esc(ST.email) + ' · ruolo ' + esc((ST.profilo && ST.profilo.ruolo) || '') + ' · versione ' + PL_CONFIG.VERSIONE + '</p>'
  el.innerHTML = h
  collegaImpostazioni(el)
}
function inNum(k, imp) { return '<input id="im-' + k + '" inputmode="decimal" value="' + esc(f(imp[k], 2)) + '">' }
function collegaImpostazioni(el) {
  var q = function (s) { return el.querySelector(s) }
  q('#im-salva').addEventListener('click', function () {
    esegui(async function () {
      // limiti uguali a quelli dello SQL PL_01 (così il messaggio è chiaro, non un errore del database)
      var LIMITI = {
        ore_estate_lungio: [0, 24, 'Estate lun-gio (h)'], ore_estate_ven: [0, 24, 'Estate venerdì (h)'],
        ore_inverno_lungio: [0, 24, 'Inverno lun-gio (h)'], ore_inverno_ven: [0, 24, 'Inverno venerdì (h)'],
        max_settimanale: [0.5, 168, 'Massimo settimanale (h)'], soglia_giornata_piena: [0.5, 24, 'Soglia giornata piena (h)'],
        fattore_ora_punta: [1, 3, 'Fattore ora di punta'], malattia_giorni_anno: [0, 365, 'Giorni di malattia per anno'],
        malattia_quota_inverno: [0, 100, 'Quota malattia nov-feb (%)'], recupero_pioggia: [0, 100, 'Recupero pioggia (%)'],
        persone_medie: [1, 50, 'Persone per le medie']
      }
      var campi = {}, errori = []
      Object.keys(LIMITI).forEach(function (k) {
        var l = LIMITI[k]
        var v = C.leggiNumero(q('#im-' + k).value)
        if (k === 'persone_medie') v = Math.round(v)
        if (isNaN(v) || v < l[0] || v > l[1]) errori.push(l[2] + ': fra ' + f(l[0], 2) + ' e ' + f(l[1], 2)); else campi[k] = v
      })
      if (errori.length) { mostraErrore('Valori non accettati, niente è stato salvato:\n' + errori.join('\n')); return }
      campi.viaggio_incluso = q('#im-viaggio_incluso').value === 'true'
      campi.stazione_meteo = q('#im-stazione_meteo').value
      await D.aggiorna('pl_impostazioni', 1, campi)
      await ricaricaImpostazioni()
      toast('Impostazioni salvate')
    })
  })
  el.querySelectorAll('[data-inv-salva]').forEach(function (b) {
    b.addEventListener('click', function () {
      esegui(async function () {
        var anno = +b.dataset.invSalva
        var dal = el.querySelector('[data-inv-dal="' + anno + '"]').value, al = el.querySelector('[data-inv-al="' + anno + '"]').value
        if (!dal || !al || al <= dal) { mostraErrore('Date del periodo inverno non valide.'); return }
        await D.aggiorna('pl_periodi_inverno', anno, { data_inizio: dal, data_fine: al }, 'anno')
        await ricarica(['periodi']); toast('Periodo inverno ' + anno + ' salvato')
      })
    })
  })
  q('#inv-aggiungi').addEventListener('click', function () {
    esegui(async function () {
      var anni = ST.dati.periodi.map(function (p) { return p.anno })
      var a = anni.length ? Math.max.apply(null, anni) + 1 : C.anno(C.oggiIso())
      await D.inserisci('pl_periodi_inverno', C.periodoInvernoProposto(a))
      await ricarica(['periodi'])
    })
  })
  q('#fe-prima').addEventListener('click', function () { _annoFestivi--; disegnaImpostazioni() })
  q('#fe-dopo').addEventListener('click', function () { _annoFestivi++; disegnaImpostazioni() })
  el.querySelectorAll('[data-festivo]').forEach(function (x) {
    x.addEventListener('change', function () {
      esegui(async function () {
        await D.salvaUpsert('pl_festivi', { data: x.dataset.festivo, nome: x.dataset.nome, attivo: x.checked }, 'data')
        await ricarica(['festivi'])
        toast(x.dataset.nome + ': ' + (x.checked ? 'attivo' : 'disattivato'))
      })
    })
  })
  el.querySelectorAll('[data-chiusura-togli]').forEach(function (b) {
    b.addEventListener('click', function () {
      esegui(async function () {
        if (!await conferma('Togliere questa chiusura?', { si: 'Togli', pericolo: true })) return
        await D.eliminaId('pl_chiusure', b.dataset.chiusuraTogli); await ricarica(['chiusure'])
      })
    })
  })
  q('#ch-aggiungi').addEventListener('click', function () {
    esegui(async function () {
      var dal = q('#ch-dal').value, al = q('#ch-al').value
      if (!dal || !al || al < dal) { mostraErrore('Scegli «dal» e «al» (al non prima di dal).'); return }
      await D.inserisci('pl_chiusure', { dal: dal, al: al, motivo: q('#ch-motivo').value.trim() || null })
      await ricarica(['chiusure']); toast('Chiusura aggiunta: controlla gli avvisi')
    })
  })
  el.querySelectorAll('[data-assenza-togli]').forEach(function (b) {
    b.addEventListener('click', function () {
      esegui(async function () {
        if (!await conferma('Togliere questa assenza?', { si: 'Togli', pericolo: true })) return
        await D.eliminaId('pl_assenze', b.dataset.assenzaTogli); await ricarica(['assenze'])
      })
    })
  })
  q('#as-aggiungi').addEventListener('click', function () {
    esegui(async function () {
      var p = q('#as-p').value, dal = q('#as-dal').value, al = q('#as-al').value
      if (!p) { mostraErrore('Nessuna persona attiva nella tabella operai.'); return }
      if (!dal || !al || al < dal) { mostraErrore('Scegli «dal» e «al» (al non prima di dal).'); return }
      await D.inserisci('pl_assenze', { persona_id: p, dal: dal, al: al, tipo: q('#as-tipo').value, nota: q('#as-nota').value.trim() || null })
      await ricarica(['assenze']); toast('Assenza aggiunta')
    })
  })
}

// ── Barra comandi e avvio ───────────────────────────────────────────────────
function collegaBarra() {
  document.querySelectorAll('[data-vista]').forEach(function (b) {
    b.addEventListener('click', function () { ST.vista = b.dataset.vista; ST.pagina = 'piano'; disegna() })
  })
  document.querySelectorAll('[data-zoom]').forEach(function (b) {
    b.addEventListener('click', function () { ST.zoom = b.dataset.zoom; ST.pagina = 'piano'; disegna() })
  })
  $('btn-indietro').addEventListener('click', function () { ST.ancora = C.spostaVista(ST.zoom, ST.ancora, -1); ST.pagina = 'piano'; disegna() })
  $('btn-avanti').addEventListener('click', function () { ST.ancora = C.spostaVista(ST.zoom, ST.ancora, 1); ST.pagina = 'piano'; disegna() })
  $('btn-oggi').addEventListener('click', function () { ST.ancora = C.oggiIso(); ST.pagina = 'piano'; disegna() })
  $('btn-nuova').addEventListener('click', function () { apriCommessa(null) })
  $('btn-avvisi').addEventListener('click', apriAvvisi)
  $('btn-impostazioni').addEventListener('click', function () { ST.pagina = 'impostazioni'; disegna() })
  $('btn-esci').addEventListener('click', function () { esegui(async function () { await D.esci(); mostraLogin('Sei uscito.') }) })
  $('blocco-esci').addEventListener('click', function () { esegui(async function () { await D.esci(); mostraLogin() }) })
  $('blocco-riprova').addEventListener('click', function () { entraNellApp() })
  $('form-login').addEventListener('submit', function (e) {
    e.preventDefault()
    var m = $('login-messaggio')
    m.hidden = true
    D.entra($('login-email').value.trim(), $('login-password').value)
      .then(function () { $('login-password').value = ''; return entraNellApp() })
      .catch(function (err) { m.hidden = false; m.textContent = err.message })
  })
  // Clic nella griglia: cella → Assegna; testata → scheda commessa
  $('griglia').addEventListener('click', function (e) {
    var b = e.target.closest('[data-apri-commessa]')
    if (b) { apriCommessa(b.dataset.apriCommessa); return }
    var td = e.target.closest('td.cella')
    if (!td) return
    if (td.dataset.commessa) apriAssegna({ data: td.dataset.data, commessa_id: td.dataset.commessa })
    else if (td.dataset.persona) {
      var k = td.dataset.persona
      apriAssegna({ data: td.dataset.data, chiave: k, commessa_id: k.indexOf('s:') === 0 ? k.split(':')[1] : null })
    }
  })
  $('coda-lista').addEventListener('click', function (e) {
    var cc = e.target.closest('[data-commessa]'); if (cc) apriCommessa(cc.dataset.commessa)
  })
  $('coda-lista').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return
    var cc = e.target.closest('[data-commessa]'); if (cc) apriCommessa(cc.dataset.commessa)
  })
  avviaTrascinamento()
}
async function avvio() {
  collegaBarra()
  D.sb.auth.onAuthStateChange(function (evento) {
    if (evento === 'SIGNED_OUT' && ST.dati) mostraLogin('Sessione chiusa: entra di nuovo.')
  })
  var s = await D.sessione()
  if (!s) { mostraLogin(); return }
  await entraNellApp()
}
if (!window.PL_SENZA_AVVIO) avvio()
