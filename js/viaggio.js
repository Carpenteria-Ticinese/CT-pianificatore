/* ═══════════════════════════════════════════════════════════════════════════
   Pianificatore cantieri — CALCOLO DEL VIAGGIO
   Gratis, senza chiave, nessun servizio Google a pagamento.
   - Indirizzo → coordinate: Nominatim (OpenStreetMap), massimo 1 richiesta al secondo
   - Coordinate → percorso: OSRM, server pubblico router.project-osrm.org, auto
   - Minuti con traffico = minuti OSRM × fattore ora di punta, arrotondati ai 5 minuti
   Se qualcosa non risponde: { ok:false, messaggio:'Calcolo non riuscito, …' }.
   MAI 0 messo in silenzio: chi chiama non scrive niente se ok è false.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.PLViaggio = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  var PARTENZA = 'Via Girardolo del Nado 2, 6500 Bellinzona'
  var MESSAGGIO_ERRORE = 'Calcolo non riuscito, inserisci i minuti a mano'
  var ATTESA_NOMINATIM_MS = 1100
  var _ultimaNominatim = 0

  function attendi(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  // fetch con limite di tempo
  function chiama(fetchFn, url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    var timer = setTimeout(function () { if (ctrl) ctrl.abort() }, ms || 10000)
    return Promise.resolve()
      .then(function () { return fetchFn(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: 'application/json' } }) })
      .then(function (r) {
        clearTimeout(timer)
        if (!r || !r.ok) throw new Error('risposta ' + (r ? r.status : 'assente'))
        return r.json()
      }, function (e) { clearTimeout(timer); throw e })
  }

  // Coordinate già trovate in questa sessione (la partenza è sempre la stessa):
  // meno richieste a Nominatim, come chiedono le sue regole d'uso.
  var _coordinate = {}
  async function coordinate(fetchFn, indirizzo, opz) {
    var chiave = String(indirizzo).trim().toLowerCase()
    if (_coordinate[chiave] && !opz.senzaCache) return _coordinate[chiave]
    var adesso = Date.now()
    var aspetta = _ultimaNominatim + ATTESA_NOMINATIM_MS - adesso
    if (aspetta > 0 && !opz.senzaAttesa) await attendi(aspetta)
    _ultimaNominatim = Date.now()
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ch,it&q=' + encodeURIComponent(indirizzo)
    var j = await chiama(fetchFn, url, opz.timeoutMs)
    if (!Array.isArray(j) || !j.length) return null
    var lat = Number(j[0].lat), lon = Number(j[0].lon)
    if (!isFinite(lat) || !isFinite(lon)) return null
    _coordinate[chiave] = { lat: lat, lon: lon }
    return _coordinate[chiave]
  }

  // opz: { fetch, fattore (default 1.25), partenza, timeoutMs, senzaAttesa }
  async function calcolaViaggio(indirizzo, opz) {
    opz = opz || {}
    var fetchFn = opz.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : null)
    var fattore = Number(opz.fattore) > 0 ? Number(opz.fattore) : 1.25
    if (!indirizzo || !String(indirizzo).trim()) return { ok: false, minuti: null, km: null, messaggio: MESSAGGIO_ERRORE + ' (indirizzo vuoto)' }
    if (!fetchFn) return { ok: false, minuti: null, km: null, messaggio: MESSAGGIO_ERRORE }
    try {
      var da = await coordinate(fetchFn, opz.partenza || PARTENZA, opz)
      if (!da) return { ok: false, minuti: null, km: null, messaggio: MESSAGGIO_ERRORE + ' (partenza non trovata)' }
      var a = await coordinate(fetchFn, indirizzo, opz)
      if (!a) return { ok: false, minuti: null, km: null, messaggio: MESSAGGIO_ERRORE + ' (indirizzo non trovato)' }
      var url = 'https://router.project-osrm.org/route/v1/driving/' + da.lon + ',' + da.lat + ';' + a.lon + ',' + a.lat + '?overview=false'
      var j = await chiama(fetchFn, url, opz.timeoutMs)
      if (!j || j.code !== 'Ok' || !j.routes || !j.routes.length) return { ok: false, minuti: null, km: null, messaggio: MESSAGGIO_ERRORE + ' (percorso non trovato)' }
      var sec = Number(j.routes[0].duration), metri = Number(j.routes[0].distance)
      if (!isFinite(sec) || !isFinite(metri) || sec <= 0) return { ok: false, minuti: null, km: null, messaggio: MESSAGGIO_ERRORE + ' (percorso non valido)' }
      var minutiOsrm = sec / 60
      var minuti = Math.max(5, Math.round(minutiOsrm * fattore / 5) * 5)
      return { ok: true, minuti: minuti, minutiSenzaTraffico: Math.round(minutiOsrm), km: Math.round(metri / 100) / 10, messaggio: '' }
    } catch (e) {
      return { ok: false, minuti: null, km: null, messaggio: MESSAGGIO_ERRORE + ' (servizio che non risponde)' }
    }
  }

  // Cosa scrivere nella commessa: solo se il calcolo è riuscito. Altrimenti niente.
  function modificaDaRisultato(risultato) {
    if (!risultato || !risultato.ok || !(risultato.minuti > 0)) return {}
    return { viaggio_min_andata: risultato.minuti, viaggio_km: risultato.km, viaggio_fonte: 'Calcolato' }
  }

  // Link a Google Maps nel browser (gratis, nessuna API): per vedere il traffico vero
  function linkMappa(indirizzo, partenza) {
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(partenza || PARTENZA) +
      '&destination=' + encodeURIComponent(indirizzo || '')
  }

  return { PARTENZA: PARTENZA, MESSAGGIO_ERRORE: MESSAGGIO_ERRORE, calcolaViaggio: calcolaViaggio, modificaDaRisultato: modificaDaRisultato, linkMappa: linkMappa }
})
