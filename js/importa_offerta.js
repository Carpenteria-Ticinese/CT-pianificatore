// Copia di Code Preventivatore\motore\src\importa.js del 2.11.2026, non modificata.
// (Solo queste due righe sono aggiunte. Le aggiunte del Calendario stanno in js/offerta_ore.js.)
/*
 * IMPORTAZIONE EXCEL — Preventivatore Carpenteria Ticinese Sagl
 * --------------------------------------------------------------
 * Legge il foglio "OFFERTA" (catalogo o offerta) da un workbook SheetJS
 * e produce: parametri, capitoli, voci, totali scritti nell'Excel, ed elenco errori.
 * Non modifica mai il file: legge solo.
 *
 * Le colonne si riconoscono dal TITOLO nella riga di intestazione ("PREZZO DI VENDITA"),
 * perché le offerte vecchie hanno colonne spostate (es. Skinner: niente minuteria).
 */
(function (root) {
  'use strict';

  const RUOLI = [
    ['imprevisti', /IMPREVISTI/i], ['ricPrivati', /GUADAGNO.*PRIVATI/i], ['ricImprese', /GUADAGNO.*IMPRESE/i],
    ['scarto', /SCARTO/i], ['materiale', /COSTO MATERIALE/i], ['terzi', /COSTO TERZI/i],
    ['minuteria', /MINUTERIA/i], ['iva', /^IVA$/i], ['cantiere', /COSTO CHF CANTIERE/i], ['minuti', /TEMPO LAVORO/i],
    ['lab', /LABORATORIO/i], ['k3', /HUNDEGGER/i], ['scm', /SCM/i],
  ];
  const BASE = ['materiale', 'scarto', 'terzi', 'minuteria', 'cantiere', 'lab', 'k3', 'scm', 'iva'];

  const chf = x => typeof x === 'number' ? Math.round(x * 100) / 100 : x;
  const NOMI = { imprevisti: 'Imprevisti', ricPrivati: 'Ricarico privati', ricImprese: 'Ricarico imprese', materiale: 'materiale', terzi: 'terzi', cantiere: 'costo cantiere', lab: 'laboratorio', k3: 'Hundegger K3', scm: 'SCM' };
  function lettera(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

  function importaFoglio(XLSX, wb, nomeFoglio) {
    const ws = wb.Sheets[nomeFoglio || 'OFFERTA'];
    if (!ws) throw new Error('Foglio OFFERTA non trovato');
    const rng = XLSX.utils.decode_range(ws['!ref']);
    const cella = (c, r) => ws[c + r];
    const val = (c, r) => { const x = cella(c, r); return x ? x.v : undefined; };
    const form = (c, r) => { const x = cella(c, r); return x && x.f ? x.f.replace(/\s+/g, '') : null; };
    const num = (c, r) => { const v = val(c, r); return typeof v === 'number' ? v : null; };
    const errori = [];
    const err = (r, livello, testo, extra) => errori.push(Object.assign({ riga: r, codice: val('A', r), voce: String(val('B', r) || '').slice(0, 70), livello, errore: testo }, extra || {}));
    const maxR = Math.min(rng.e.r + 1, 6000);

    // 1. Intestazione e colonne
    let rTit = null;
    for (let r = 1; r <= 30 && !rTit; r++) if (/PREZZO DI VENDITA/i.test(String(val('H', r) || ''))) rTit = r;
    if (!rTit) throw new Error('Riga "PREZZO DI VENDITA" non trovata nelle prime 30 righe');
    const col = {};
    for (let c = 8; c <= 21; c++) {
      const t = String(val(lettera(c), rTit) || '').trim();
      for (const [ruolo, re] of RUOLI) if (!col[ruolo] && re.test(t)) { col[ruolo] = lettera(c); break; }
    }
    const ruoloDi = {}; for (const k in col) ruoloDi[col[k]] = k;

    // 2. Riga parametri: H = "-" e imprevisti numerico
    let rPar = null;
    for (let r = rTit; r <= rTit + 8 && !rPar; r++) if (String(val('H', r)).trim() === '-' && num(col.imprevisti, r) != null) rPar = r;
    if (!rPar) throw new Error('Riga parametri (H = "-") non trovata');
    const par = {
      imprevisti: num(col.imprevisti, rPar), ricPrivati: num(col.ricPrivati, rPar), ricImprese: num(col.ricImprese, rPar),
      scarto: num(col.scarto, rPar), costoOraCalcolo: num(col.cantiere, rPar), rigaParametri: rPar,
    };
    for (let r = rPar + 1; r <= rPar + 2; r++) {
      if (/solito|normalmente/i.test(String(val('H', r) || ''))) {
        par.usatiNormalmente = { riga: r, imprevisti: num(col.imprevisti, r), ricPrivati: num(col.ricPrivati, r), ricImprese: num(col.ricImprese, r), scarto: num(col.scarto, r) };
      }
    }

    // 3. Totali capitolo: F = SUM(Fa:Fb)
    const capitoli = []; const totRiga = {};
    for (let r = rPar + 1; r <= maxR; r++) {
      const f = form('F', r); const m = f && f.match(/^SUM\(F(\d+):F(\d+)\)$/i);
      const tit = form('B', r);
      if (m) {
        const a = +m[1], b = +m[2];
        // riga con SUM nel riepilogo finale (TOTALE) non è un capitolo
        if (/TOTALE/i.test(String(val('B', r) || '')) && !tit) continue;
        const c = { titolo: String(val('B', a) || val('B', r) || ''), rigaTitolo: a, rigaFine: b, rigaTotale: r, totaleExcel: num('F', r), voci: [] };
        if (tit && +tit.slice(1) !== a) err(r, 'errore', `Titolo del totale (=${tit}) non corrisponde all'inizio della somma (riga ${a})`);
        capitoli.push(c); totRiga[r] = c;
      }
    }
    // somme che si sovrappongono
    for (let i = 1; i < capitoli.length; i++) {
      if (capitoli[i].rigaTitolo <= capitoli[i - 1].rigaFine) err(capitoli[i].rigaTotale, 'errore', `Somma capitolo sovrapposta al capitolo precedente (righe ${capitoli[i].rigaTitolo}–${capitoli[i - 1].rigaFine} contate due volte)`);
    }
    const capDi = r => capitoli.find(c => r >= c.rigaTitolo && r <= c.rigaFine);

    // 4. Voci
    const ref = (r) => new RegExp('^([A-Z]+)(\\d+)$');
    const tutte = [];
    for (let r = rPar + 1; r <= maxR; r++) {
      if (totRiga[r]) continue;
      let fH = form('H', r);
      // variante equivalente: IF(P="",0,P) = P
      if (fH) fH = fH.replace(/IF\(([A-Z]+\d+)="",0,\1\)/g, '$1');
      const mSommaH = fH && fH.match(/^SUM\(H(\d+):H(\d+)\)$/i);
      const Fv = val('F', r); const fF = form('F', r);
      const haCosti = fH && /[A-Z]\d+\*[A-Z]\d+/.test(fH);
      const Fnum = typeof Fv === 'number' && !fF;
      if (!haCosti && !mSommaH && !Fnum && !(fF && /^ROUND\(PRODUCT/i.test(fF))) continue;
      // righe del riepilogo finale
      if (/^(TOTALE|SCONTO|IVA)/i.test(String(val('B', r) || '').trim())) continue;
      if (fF && /^F\d+$/.test(fF)) continue;

      const v = { riga: r, codice: val('A', r), descrizione: String(val('B', r) || ''), unita: val('C', r) || '', q: num('D', r) };
      // H: forma della formula
      if (mSommaH) {
        v.sommaH = [+mSommaH[1], +mSommaH[2]];
        err(r, 'avviso', `Voce di gruppo: prezzo = somma dei prezzi delle righe ${mSommaH[1]}–${mSommaH[2]}`);
      }
      if (haCosti) {
        const s = fH.replace(/[()]/g, '');
        const parti = s.split('+');
        let ok = true; const somma = []; const dopo = []; let molt = null;
        const idx = parti.findIndex(p => (p.match(/\*/g) || []).length >= 2);
        if (idx < 0) ok = false;
        else {
          parti.forEach((p, i) => {
            const refs = p.split('*');
            if (i < idx) somma.push(refs); else if (i === idx) { somma.push([refs[0]]); molt = refs.slice(1); } else dopo.push(refs);
          });
        }
        // controllo righe: ogni riferimento deve essere sulla stessa riga
        const tuttiRef = s.split(/[+*]/);
        for (const t of tuttiRef) {
          const mm = t.match(/^\$?([A-Z]+)\$?(\d+)$/);
          if (!mm) { ok = false; break; }
          if (+mm[2] !== r) err(r, 'avviso', `Formula prezzo usa ${t} di un'altra riga (controllare se voluto)`, { formula: '=' + fH });
        }
        if (ok) {
          const ruoliSomma = somma.map(g => g.map(t => ruoloDi[t.replace(/\d+|\$/g, '')]));
          const sommati = new Set(ruoliSomma.flat());
          if (col.minuteria) {
            if (sommati.has('minuteria')) v.minuteriaModo = 'dentro';
            else if (dopo.some(g => ruoloDi[g[0].replace(/\d+/g, '')] === 'minuteria')) v.minuteriaModo = 'dopo';
            else v.minuteriaModo = 'fuori';
          } else v.minuteriaModo = 'dentro';
          // colonne di costo mancanti nella somma
          for (const k of ['materiale', 'terzi', 'cantiere', 'lab', 'k3', 'scm']) if (col[k] && !sommati.has(k)) err(r, 'avviso', `Colonna ${col[k]} (${NOMI[k]}) non sommata nel prezzo`, { formula: '=' + fH });
          v.formaH = ruoliSomma.map(g => g.join('*')).join('+') + ' × ' + (molt || []).map(t => ruoloDi[t.replace(/\d+|\$/g, '')]).join('*') + (dopo.length ? ' + ' + dopo.map(g => ruoloDi[g[0].replace(/\d+/g, '')]).join('+') : '');
        } else {
          err(r, 'errore', 'Formula prezzo (colonna H) non riconosciuta: voce importata con il prezzo scritto', { formula: '=' + fH });
          v.bloccata = true;
        }
      }
      v.Hexcel = num('H', r);

      // Costi (valori; le formule si tengono come nota)
      const leggi = (k) => col[k] ? num(col[k], r) : null;
      v.materiale = leggi('materiale'); v.scarto = leggi('scarto'); v.terzi = leggi('terzi');
      v.minuteria = col.minuteria ? leggi('minuteria') : null; v.minuti = leggi('minuti');
      v.lab = leggi('lab'); v.k3 = leggi('k3'); v.scm = leggi('scm');
      if (col.iva && num(col.iva, r)) err(r, 'avviso', `Valore nella colonna "IVA" (${col.iva}) sommato nel prezzo`);
      const fM = col.materiale && form(col.materiale, r); if (fM) v.formulaMateriale = '=' + fM;
      if (col.minuteria && num(col.minuteria, r) && v.minuteriaModo === 'fuori')
        err(r, 'errore', `Minuteria CHF ${chf(num(col.minuteria, r))} scritta ma NON sommata nel prezzo`);

      // Costo cantiere P
      const fP = col.cantiere && form(col.cantiere, r);
      const Pv = col.cantiere ? val(col.cantiere, r) : null;
      if (fP) {
        const mp = fP.match(/^IF\(([A-Z]+)(\d+)="","",CEILING\(\(\1\2\/60\)\*\$([A-Z]+)\$(\d+),0\.01\)\)$/i);
        const mk = !mp && fP.match(/^IF\(([A-Z]+)(\d+)="","",CEILING\(\(\1\2\/60\)\*([\d.]+),0\.01\)\)$/i);
        if (mk && +mk[2] === r) {
          v.costoOra = +mk[3];
          err(r, 'avviso', `Costo orario ${mk[3]} CHF scritto dentro la formula (offerta: ${par.costoOraCalcolo})`, { formula: '=' + fP });
        } else if (!mp) err(r, 'errore', 'Formula costo cantiere non standard', { formula: '=' + fP });
        else if (+mp[2] !== r) err(r, 'errore', `Costo cantiere calcolato con i minuti della riga ${mp[2]}`, { formula: '=' + fP });
        else if (+mp[4] !== rPar) err(r, 'avviso', `Costo orario preso dalla riga ${mp[4]} invece che dalla riga parametri ${rPar}`, { formula: '=' + fP });
        if (!mp && !(mk && +mk[2] === r)) v.costoCantiereFisso = typeof Pv === 'number' ? Pv : 0;
      } else if (typeof Pv === 'number' && Pv !== 0) {
        v.costoCantiereFisso = Pv;
        err(r, 'avviso', `Costo cantiere scritto a mano (CHF ${chf(Pv)}) invece che calcolato dai minuti`);
      } else if (col.cantiere) {
        // cella vuota: Excel conta 0 anche se ci sono minuti
        v.costoCantiereFisso = 0;
        if (v.minuti > 0 && haCosti) {
          const perso = Math.ceil(v.minuti / 60 * par.costoOraCalcolo * 100) / 100;
          // Deciso da Umberto 2.11.2026: lattonieri esterni, i minuti restano solo per la tempistica
          err(r, 'info', `Minuti ${Math.round(v.minuti * 100) / 100} solo per la tempistica (lavoro esterno): non entrano nel prezzo (varrebbero CHF ${perso}/unità con squadra interna)`, { importo: perso * (v.q || 1) });
        }
      }

      // Ricarichi: formula verso la riga parametri = usa parametro; numero = valore diverso per questa voce
      for (const k of ['imprevisti', 'ricPrivati', 'ricImprese']) {
        if (!col[k]) continue;
        const f = form(col[k], r); const x = num(col[k], r);
        if (f) {
          const mk = f.match(/^\$?[A-Z]+\$?(\d+)$/);
          if (!mk || +mk[1] !== rPar) { v[k] = x; err(r, 'avviso', `${NOMI[k]} preso da ${f} invece che dalla riga parametri`); }
          else v[k] = null;
        } else if (x != null) {
          v[k] = x;
          if (x !== par[k]) err(r, 'avviso', `${NOMI[k]} scritto a mano (${x}) diverso dal resto dell'offerta (${par[k]})`);
        } else v[k] = null;
      }

      // E
      const fE = form('E', r); const Ev = val('E', r);
      let me;
      if (fE && (me = fE.match(/^CEILING\(H(\d+),([\d.]+)\)$/i)) && +me[1] === r) v.regolaE = { tipo: 'ceiling', passo: +me[2] };
      else if (fE && (me = fE.match(/^(?:MROUND|ARROTONDA\.MULTIPLO)\(H(\d+),([\d.]+)\)$/i)) && +me[1] === r) v.regolaE = { tipo: 'mround', passo: +me[2] };
      else if (fE) { v.regolaE = { tipo: 'fisso', valore: typeof Ev === 'number' ? Ev : null }; err(r, 'avviso', 'Prezzo unitario con formula particolare: importato come prezzo fisso', { formula: '=' + fE }); }
      else if (typeof Ev === 'number') v.regolaE = { tipo: 'fisso', valore: Ev };
      else v.regolaE = { tipo: 'vuoto' };

      // F
      let mf;
      if (fF && (mf = fF.match(/^ROUND\(PRODUCT\(D(\d+),E(\d+)\)\/5,2\)\*5$/i))) {
        v.regolaF = { tipo: '5cent' };
        if (+mf[1] !== r || +mf[2] !== r) err(r, 'errore', 'Totale voce calcolato con quantità/prezzo di un\'altra riga', { formula: '=' + fF });
      }
      else if (fF && /^D\d+\*E\d+$/i.test(fF)) { v.regolaF = { tipo: 'prodotto' }; err(r, 'avviso', 'Totale voce non arrotondato ai 5 centesimi', { formula: '=' + fF }); }
      else if (fF && (mf = fF.match(/^CEILING\(H(\d+),([\d.]+)\)$/i))) { v.regolaF = { tipo: 'ceilingH', passo: +mf[2] }; if (v.q && v.q !== 1) err(r, 'errore', `Totale "a corpo" ignora la quantità ${v.q}`); }
      else if (fF && (mf = fF.match(/^(?:MROUND|ARROTONDA\.MULTIPLO)\(H(\d+),([\d.]+)\)$/i))) { v.regolaF = { tipo: 'mroundH', passo: +mf[2] }; if (v.q && v.q !== 1) err(r, 'errore', `Totale "a corpo" ignora la quantità ${v.q}`); }
      else if (fF) { v.regolaF = { tipo: 'fisso', valore: num('F', r) }; err(r, 'errore', 'Totale voce con formula particolare: importato come valore fisso', { formula: '=' + fF }); }
      else if (typeof Fv === 'number') { v.regolaF = { tipo: 'fisso', valore: Fv }; if (haCosti) err(r, 'avviso', `Totale voce scritto a mano (CHF ${chf(Fv)})`); }
      else if (typeof Fv === 'string' && /-{3,}/.test(Fv)) {
        v.regolaF = { tipo: 'incluso' };
        v.eventuale = /^\s*eventual/i.test(v.descrizione);
      }
      else v.regolaF = { tipo: 'vuoto' };
      if (v.regolaF.tipo === 'incluso' && v.Hexcel > 0 && !v.eventuale) err(r, 'avviso', `Voce "inclusa" con costo calcolato CHF ${Math.round(v.Hexcel * 100) / 100}: non pagata dal cliente`);

      v.Eexcel = num('E', r); v.Fexcel = typeof Fv === 'number' ? Fv : null;
      // Prezzo scritto a mano molto diverso dal calcolato
      if (v.regolaE.tipo === 'fisso' && v.Hexcel > 0 && v.regolaE.valore != null && Math.abs(v.regolaE.valore - v.Hexcel) / v.Hexcel > 0.15)
        err(r, 'avviso', `Prezzo scritto a mano ${chf(v.regolaE.valore)} lontano dal calcolato ${Math.round(v.Hexcel * 100) / 100} (${Math.round((v.regolaE.valore / v.Hexcel - 1) * 100)}%)`);
      if (typeof v.codice === 'string' && /\d,\d/.test(v.codice)) err(r, 'avviso', `Codice con virgola "${v.codice}": diventa "${v.codice.replace(',', '.')}"`);
      if (v.regolaF.tipo === '5cent' && (v.q == null || v.q === 0) && v.Hexcel > 0) err(r, 'avviso', 'Quantità vuota o zero: voce a 0 CHF');

      const cap = capDi(r);
      if (!cap) { if (v.regolaF.tipo !== 'vuoto' && v.regolaF.tipo !== 'incluso') err(r, 'errore', `Voce fuori da ogni totale di capitolo: CHF ${chf(v.Fexcel)} non entra nel totale`); }
      else cap.voci.push(v);
      tutte.push(v);
    }

    // 5. Riepilogo finale
    const riep = { righe: [], totaleExcel: null, sconto: null, iva: null, totaleComplessivoExcel: null };
    for (let r = rPar + 1; r <= maxR; r++) {
      const fF = form('F', r); const B = String(val('B', r) || '').trim();
      let m;
      if (fF && (m = fF.match(/^F(\d+)$/)) && totRiga[+m[1]]) riep.righe.push({ riga: r, capitolo: +m[1] });
      else if (/^TOTALE\s+COMPLESSIVO/i.test(B)) riep.totaleComplessivoExcel = num('F', r);
      else if (/^TOTALE$/i.test(B) && riep.totaleExcel == null) riep.totaleExcel = num('F', r);
      else if (/^SCONTO/i.test(B) && fF) {
        const p = fF.match(/\*\s*([\d.]+)\)?\/5/) || fF.match(/\*([\d.]+)/);
        riep.sconto = { riga: r, perc: p ? +p[1] : null, arrot5: /\/5,2\)\*5/.test(fF), excel: num('F', r), formula: '=' + fF };
      } else if (/^SCONTO/i.test(B) && typeof val('F', r) === 'number') {
        riep.sconto = { riga: r, fisso: val('F', r), excel: val('F', r) };
        err(r, 'avviso', `Sconto scritto a mano CHF ${val('F', r)} (non in percentuale)`);
      } else if (/^IVA/i.test(B) && fF) {
        const p = fF.match(/([\d.]+)%/) || fF.match(/\*([\d.]+)\)\/5/);
        riep.iva = { riga: r, perc: p ? +p[1] : null, arrot5: /\/5,2\)\*5/.test(fF), excel: num('F', r), formula: '=' + fF };
      }
    }
    if (riep.righe.length) {
      const citati = new Set(riep.righe.map(x => x.capitolo));
      for (const c of capitoli) if (!citati.has(c.rigaTotale)) err(c.rigaTotale, 'errore', `Capitolo "${c.titolo}" NON riportato nel riepilogo: CHF ${chf(c.totaleExcel)} mancano dal totale`);
      const visti = {}; for (const x of riep.righe) { if (visti[x.capitolo]) err(x.riga, 'errore', 'Capitolo riportato due volte nel riepilogo'); visti[x.capitolo] = 1; }
    }
    if (riep.righe.length && !riep.iva) {
      const ivaInclusa = [...Array(15).keys()].some(i => /IVA\s+INCLUSA/i.test(String(val('B', (riep.sconto ? riep.sconto.riga : rPar) + i) || '')));
      err(null, 'avviso', ivaInclusa ? 'Nessuna riga IVA: il totale è "IVA inclusa" — incasso netto = totale / 1.081' : 'Nessuna riga IVA nel riepilogo');
    }
    // IVA: deciso 2.11.2026 al centesimo (5 cts non obbligatorio): nessun errore

    const senzaQ = tutte.filter(v => !v.q).length;
    const tipo = (tutte.length && senzaQ / tutte.length > 0.5) ? 'catalogo' : 'offerta';
    if (tipo === 'catalogo') for (let i = errori.length - 1; i >= 0; i--) if (/^Quantità vuota/.test(errori[i].errore)) errori.splice(i, 1);
    return { tipo, colonne: col, rigaIntestazione: rTit, par, capitoli, voci: tutte, riepilogo: riep, errori };
  }

  const API = { importaFoglio };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CTImporta = API;
})(typeof window !== 'undefined' ? window : globalThis);
