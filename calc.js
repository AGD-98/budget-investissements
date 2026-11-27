/* Calculs du budget et des investissements — logique reprise du classeur Excel.
   Utilisable dans le navigateur (window.Calc) et dans Node (require). */
(function (root) {
  'use strict';

  // ---------- Expressions (« =74.62+14.24 ») sans eval ----------
  function evalExpr(input) {
    if (input === null || input === undefined) return 0;
    if (typeof input === 'number') return isFinite(input) ? input : 0;
    let s = String(input).trim();
    if (s.startsWith('=')) s = s.slice(1);
    s = s.replace(/ /g, '').replace(/\s+/g, '').replace(/€/g, '').replace(/,/g, '.');
    if (s === '') return 0;
    let i = 0;
    function peek() { return s[i]; }
    function number() {
      const m = /^\d*\.?\d+(e[+-]?\d+)?|^\d+\.?/i.exec(s.slice(i));
      if (!m) throw new Error('Nombre attendu');
      i += m[0].length;
      return parseFloat(m[0]);
    }
    function factor() {
      const c = peek();
      if (c === '+') { i++; return factor(); }
      if (c === '-') { i++; return -factor(); }
      if (c === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error(') attendue'); i++; return v; }
      return number();
    }
    function term() {
      let v = factor();
      while (peek() === '*' || peek() === '/') {
        const op = s[i++]; const r = factor();
        v = op === '*' ? v * r : (r === 0 ? 0 : v / r);
      }
      return v;
    }
    function expr() {
      let v = term();
      while (peek() === '+' || peek() === '-') {
        const op = s[i++]; const r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    const v = expr();
    if (i !== s.length) throw new Error('Caractère inattendu : ' + s[i]);
    return v;
  }
  function isValidExpr(input) { try { evalExpr(input); return true; } catch (e) { return false; } }
  function num(input) { try { return evalExpr(input); } catch (e) { return 0; } }
  // Ajoute un montant en gardant le détail : "116" -> "116+48"
  function appendToExpr(expr, montant) {
    const m = round2(montant);
    const abs = fmtPlain(Math.abs(m));
    let s = (expr === null || expr === undefined) ? '' : String(expr).trim();
    if (s.startsWith('=')) s = s.slice(1);
    if (s === '' || num(s) === 0 && !/[+\-*/]/.test(s)) return (m < 0 ? '-' : '') + abs;
    return s + (m < 0 ? '-' : '+') + abs;
  }
  function fmtPlain(v) { return String(round2(v)); }
  function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

  // ---------- Dates ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function monthKey(y, m) { // m: 1..12, normalise les débordements
    const d = new Date(Date.UTC(y, m - 1, 1));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }
  function keyParts(k) { const [y, m] = k.split('-').map(Number); return { y, m }; }
  function addMonths(k, n) { const p = keyParts(k); return monthKey(p.y, p.m + n); }
  function keyLabel(k) { const p = keyParts(k); return pad(p.m) + '-' + p.y; }
  const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const MOIS_COURT = ['Janv.', 'Févr.', 'Mars', 'Avril', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
  function keyLong(k) { const p = keyParts(k); return MOIS[p.m - 1] + ' ' + p.y; }
  function todayISO(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function currentKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function isoToKey(iso) { return iso ? iso.slice(0, 7) : ''; }
  function isoFr(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d + '/' + m + '/' + y; }
  function frToIso(s) {
    const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(String(s).trim());
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    const d = new Date(Date.UTC(y, +m[2] - 1, +m[1]));
    if (d.getUTCMonth() !== +m[2] - 1) return null;
    return y + '-' + pad(+m[2]) + '-' + pad(+m[1]);
  }
  function isoDate(y, m, d) { const x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()); }
  function addDaysIso(iso, n) { const [y, m, d] = iso.split('-').map(Number); return isoDate(y, m, d + n); }
  function weekdayIso(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); } // 0=dim
  function daysInMonth(k) { const p = keyParts(k); return new Date(Date.UTC(p.y, p.m, 0)).getUTCDate(); }

  // ---------- Jours fériés (France) + congés ----------
  function paques(an) {
    const a = an % 19, b = Math.floor(an / 100), c = an % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
    return isoDate(an, mois, jour);
  }
  function feriesAnnee(an) {
    const p = paques(an);
    return [
      [isoDate(an, 1, 1), "Jour de l'an"], [addDaysIso(p, 1), 'Lundi de Pâques'], [isoDate(an, 5, 1), 'Fête du travail'],
      [isoDate(an, 5, 8), 'Victoire 1945'], [addDaysIso(p, 39), 'Ascension'], [addDaysIso(p, 50), 'Lundi de Pentecôte'],
      [isoDate(an, 7, 14), 'Fête nationale'], [isoDate(an, 8, 15), 'Assomption'], [isoDate(an, 11, 1), 'Toussaint'],
      [isoDate(an, 11, 11), 'Armistice'], [isoDate(an, 12, 25), 'Noël']
    ].map(([date, lib]) => ({ date, lib, type: 'ferie' })).sort((a, b) => a.date.localeCompare(b.date));
  }
  function joursNonTravailles(data, an) {
    const map = new Map();
    feriesAnnee(an).forEach(f => map.set(f.date, f));
    (data.conges || []).forEach(c => {
      if (!c.debut) return;
      let d = c.debut, fin = c.fin && c.fin >= c.debut ? c.fin : c.debut, guard = 0;
      while (d <= fin && guard++ < 800) {
        const wd = weekdayIso(d);
        if (d.slice(0, 4) === String(an) && wd !== 0 && wd !== 6 && !map.has(d)) map.set(d, { date: d, lib: 'Congé' + (c.lib ? ' - ' + c.lib : ''), type: 'conge' });
        d = addDaysIso(d, 1);
      }
    });
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  // NETWORKDAYS du mois k, hors fériés et congés
  function joursOuvres(data, k) {
    const p = keyParts(k), set = new Set(joursNonTravailles(data, p.y).map(x => x.date));
    let n = 0;
    for (let d = 1; d <= daysInMonth(k); d++) {
      const iso = isoDate(p.y, p.m, d), wd = weekdayIso(iso);
      if (wd !== 0 && wd !== 6 && !set.has(iso)) n++;
    }
    return n;
  }
  function tarifPour(data, k) {
    const t = (data.tarifs || []).filter(x => x.mois && x.c1 !== '' && x.c2 !== '' && x.c1 !== null && x.c2 !== null)
      .slice().sort((a, b) => a.mois.localeCompare(b.mois));
    if (!t.length) return 0;
    let best = null;
    t.forEach(x => { if (x.mois <= k) best = x; });
    if (!best) best = t[0];
    return num(best.c1) + num(best.c2);
  }
  // « Expense Record per Day » : jours ouvrés du mois précédent × tarif du mois
  function indemnites(data, k) { return round2(joursOuvres(data, addMonths(k, -1)) * tarifPour(data, k)); }

  // ---------- Mois ----------
  const SECTIONS = ['income', 'schedule', 'fixed', 'variable'];
  function monthKeys(data) { return Object.keys(data.months || {}).sort(); }
  function lineValue(data, k, line, which) {
    if (line.auto === 'perDay') return indemnites(data, k);
    if (which === 'reel' && line.reelSuitPrevu) return num(line.prevu);
    return num(line[which]);
  }
  function computeAll(data) {
    const keys = monthKeys(data), res = {};
    let prev = null, parentsP = num(data.settings.parentsInitial), parentsR = parentsP;
    keys.forEach((k, idx) => {
      const m = data.months[k], r = { key: k, sums: {}, lines: {} };
      SECTIONS.forEach(sec => {
        let p = 0, re = 0;
        (m.sections[sec] || []).forEach(l => {
          const vp = lineValue(data, k, l, 'prevu'), vr = lineValue(data, k, l, 'reel');
          r.lines[l.id] = { prevu: vp, reel: vr };
          p += vp; re += vr;
        });
        r.sums[sec] = { prevu: p, reel: re };
      });
      const roleSum = (role, w) => SECTIONS.reduce((s, sec) => s + (m.sections[sec] || []).filter(l => l.role === role).reduce((a, l) => a + r.lines[l.id][w], 0), 0);
      r.base = idx === 0 || !prev ? num(m.base) : (data.settings.report === 'Prevu' ? prev.remP : prev.remR);
      r.incP = r.sums.income.prevu + r.sums.schedule.prevu;
      r.incR = r.sums.income.reel + r.sums.schedule.reel;
      r.expP = r.sums.fixed.prevu + r.sums.variable.prevu;
      r.expR = r.sums.fixed.reel + r.sums.variable.reel;
      r.remP = r.incP - r.expP + r.base;
      r.remR = r.incR - r.expR + r.base;
      r.investP = roleSum('invest', 'prevu'); r.investR = roleSum('invest', 'reel');
      r.parP = roleSum('parents', 'prevu'); r.parR = roleSum('parents', 'reel');
      r.courP = r.expP - r.parP - r.investP; r.courR = r.expR - r.parR - r.investR;
      r.horsInvR = r.expR - r.investR; r.horsInvP = r.expP - r.investP;
      parentsP += r.parP; parentsR += r.parR;
      r.totalParentsP = parentsP; r.totalParentsR = parentsR;
      r.tauxEpargneR = r.incR ? r.investR / r.incR : 0;
      r.tauxEpargneP = r.incP ? r.investP / r.incP : 0;
      r.prevKey = prev ? prev.key : null;
      res[k] = r; prev = r;
    });
    return res;
  }
  // Statut d'une catégorie de dépense (même règle que le Dashboard Excel)
  function statut(prevu, reel, tol) {
    if (prevu === 0 && reel > 0) return 'nonprevu';
    if (reel > prevu * (1 + tol) + 0.005) return 'depasse';
    if (reel === 0) return 'avenir';
    return 'ok';
  }
  function joursRestants(k, today) {
    const t = today || todayISO(), tk = isoToKey(t);
    if (tk !== k) return 0;
    return daysInMonth(k) - Number(t.slice(8, 10)) + 1;
  }
  function precaution(data, comp, today) {
    const cur = currentKey(today ? new Date(today + 'T12:00:00') : undefined);
    const vals = Object.values(comp).filter(r => r.horsInvR > 0);
    const clos = vals.filter(r => r.key < cur);
    const pool = clos.length ? clos : vals;
    const moy = pool.length ? pool.reduce((s, r) => s + r.horsInvR, 0) / pool.length : 0;
    const ep = (typeof epargneActuelle === 'function' ? epargneActuelle(data).montant : num(data.settings.epargneActuelle)), cible = num(data.settings.moisPrecaution) * moy;
    return { moyenne: moy, cible, manque: Math.max(0, cible - ep), couverture: moy ? ep / moy : 0, epargne: ep };
  }
  // Projection fin de mois (onglet Solde)
  function projectionSolde(data, k, comp) {
    const m = data.months[k], r = comp[k];
    if (!m || !r) return null;
    let resteDep = 0, resteRev = 0;
    ['income', 'schedule'].forEach(sec => (m.sections[sec] || []).forEach(l => { const v = r.lines[l.id]; resteRev += Math.max(0, v.prevu - v.reel); }));
    ['fixed', 'variable'].forEach(sec => (m.sections[sec] || []).forEach(l => { const v = r.lines[l.id]; resteDep += Math.max(0, v.prevu - v.reel); }));
    const tol = num(data.settings.soldeTolere);
    const finSaisie = r.remR - resteDep + resteRev;
    const solde = data.solde && data.solde.montant !== null && data.solde.montant !== '' && data.solde.montant !== undefined ? num(data.solde.montant) : null;
    const finCompte = solde === null ? null : solde - resteDep + resteRev;
    return {
      prevu: r.remP, reelAJour: r.remR, resteDep, resteRev, finSaisie, finCompte, solde, tol,
      ecartSaisie: finSaisie - r.remP, ecartCompte: finCompte === null ? null : finCompte - r.remP,
      okSaisie: finSaisie - r.remP >= -tol, okCompte: finCompte === null ? null : finCompte - r.remP >= -tol,
      ecartCompteVsSaisie: solde === null ? null : solde - r.remR
    };
  }

  // ---------- Investissements ----------
  function fv(rate, nper, pmt, pv) { // convention Excel FV(rate,nper,-pmt,-pv) avec pmt/pv positifs
    if (nper <= 0) return pv;
    if (Math.abs(rate) < 1e-12) return pv + pmt * nper;
    const g = Math.pow(1 + rate, nper);
    return pv * g + pmt * (g - 1) / rate;
  }
  function tauxMensuel(rend, frais) { return Math.pow((1 + rend) * (1 - frais), 1 / 12) - 1; }
  function capitalLigne(plan, l, mois, delta) {
    const r = tauxMensuel(num(l.rend) + (delta || 0), num(l.frais));
    const v1 = num(l.part) * num(plan.v1), v2 = num(l.part) * num(plan.v2), d = num(plan.delai);
    const n1 = Math.min(mois, d), n2 = Math.max(0, mois - d);
    return fv(r, n1, v1, num(l.capital)) * Math.pow(1 + r, n2) + fv(r, n2, v2, 0);
  }
  function lignesPlan(plan) { return (plan.lines || []).filter(l => l.nom && String(l.nom).trim()); }
  function planResultats(plan) {
    const H = num(plan.horizon) * 12, d = num(plan.delai);
    const rows = lignesPlan(plan).map(l => {
      const v1 = num(l.part) * num(plan.v1), v2 = num(l.part) * num(plan.v2);
      const verse = num(l.capital) + v1 * Math.min(H, d) + v2 * Math.max(0, H - d);
      const fin = capitalLigne(plan, l, H, 0), gain = fin - verse, impot = Math.max(0, gain) * num(plan.impot), net = fin - impot;
      return { id: l.id, nom: l.nom, v1, v2, verse, fin, gain, impot, net, netReel: net / Math.pow(1 + num(plan.inflation), num(plan.horizon)) };
    });
    const tot = k => rows.reduce((s, r) => s + r[k], 0);
    const partTot = (plan.lines || []).reduce((s, l) => s + num(l.part), 0);
    return { rows, total: { v1: tot('v1'), v2: tot('v2'), verse: tot('verse'), fin: tot('fin'), gain: tot('gain'), impot: tot('impot'), net: tot('net'), netReel: tot('netReel'), capital: (plan.lines || []).reduce((s, l) => s + num(l.capital), 0) }, partTot };
  }
  function projection(plan) {
    const out = [], lines = lignesPlan(plan), d = num(plan.delai), e = num(plan.ecart);
    const cap = lines.reduce((s, l) => s + num(l.capital), 0);
    const v1 = lines.reduce((s, l) => s + num(l.part) * num(plan.v1), 0), v2 = lines.reduce((s, l) => s + num(l.part) * num(plan.v2), 0);
    for (let an = 1; an <= 40; an++) {
      const M = an * 12;
      const central = lines.reduce((s, l) => s + capitalLigne(plan, l, M, 0), 0);
      out.push({
        an, verse: cap + v1 * Math.min(M, d) + v2 * Math.max(0, M - d),
        pess: lines.reduce((s, l) => s + capitalLigne(plan, l, M, -e), 0), central,
        opt: lines.reduce((s, l) => s + capitalLigne(plan, l, M, e), 0),
        reel: central / Math.pow(1 + num(plan.inflation), an),
        parLigne: lines.map(l => capitalLigne(plan, l, M, 0))
      });
    }
    return out;
  }
  function prevuPlanMois(plan, k) { // Suivi_Prevu
    const n = (keyParts(k).y - keyParts(plan.start).y) * 12 + (keyParts(k).m - keyParts(plan.start).m) + 1;
    if (n < 1) return null;
    return n <= num(plan.delai) ? num(plan.v1) : num(plan.v2);
  }
  function journalMois(inv, k) { return (inv.journal || []).filter(j => isoToKey(j.date) === k).reduce((s, j) => s + num(j.montant), 0); }
  function suiviMensuel(inv, nb) {
    const rows = []; let cp = 0, cr = 0;
    for (let i = 0; i < (nb || 60); i++) {
      const k = addMonths(inv.plan.start, i), p = prevuPlanMois(inv.plan, k), r = journalMois(inv, k);
      cp += p; cr += r;
      rows.push({ n: i + 1, key: k, prevu: p, reel: r, ecart: r - p, cumP: cp, cumR: cr, real: p ? r / p : null });
    }
    return rows;
  }
  function portefeuille(inv, today) {
    const plan = inv.plan, lines = lignesPlan(plan), vals = inv.valeurs || {};
    const cur = currentKey(today ? new Date(today + 'T12:00:00') : undefined);
    const pm = prevuPlanMois(plan, cur); const prevuMois = pm === null ? num(plan.v1) : pm;
    const has = l => vals[l.nom] !== undefined && vals[l.nom] !== null && vals[l.nom] !== '';
    const totalVal = lines.reduce((s, l) => s + (has(l) ? num(vals[l.nom]) : 0), 0);
    const rows = lines.map(l => {
      const verse = num(l.capital) + (inv.journal || []).filter(j => j.ligne === l.nom).reduce((s, j) => s + num(j.montant), 0);
      const val = has(l) ? num(vals[l.nom]) : null;
      return { nom: l.nom, env: l.env, part: num(l.part), verse, val, pv: val === null ? null : val - verse, perf: val === null || verse === 0 ? null : (val - verse) / verse,
        poids: val === null || totalVal === 0 ? null : val / totalVal, sous: Math.max(0, num(l.part) * (totalVal + prevuMois) - (val || 0)) };
    });
    const sumSous = rows.reduce((s, r) => s + r.sous, 0);
    rows.forEach(r => { r.conseil = sumSous === 0 ? prevuMois * r.part : prevuMois * r.sous / sumSous; r.ecartPts = r.poids === null ? null : (r.poids - r.part) * 100; });
    const verseTot = rows.reduce((s, r) => s + r.verse, 0);
    return { rows, prevuMois, verse: verseTot, valeur: totalVal, pv: totalVal ? totalVal - verseTot : null, perf: totalVal && verseTot ? (totalVal - verseTot) / verseTot : null };
  }

  // ---------- Contrôles de cohérence ----------
  function controles(data, today) {
    const out = [], add = (niveau, texte, goto) => out.push({ niveau, texte, goto });
    const comp = computeAll(data), keys = monthKeys(data), tol = 0.005, td = today || todayISO();
    const inv = data.invest, plan = inv.plan;
    const pr = planResultats(plan);
    if (Math.abs(pr.partTot - 1) > 0.0001) add('ALERTE', "Plan d'investissement : la somme des parts fait " + (pr.partTot * 100).toFixed(1) + ' % (elle devrait faire 100 %).', 'plan');
    (plan.lines || []).forEach((l, i) => { if (!(l.nom && l.nom.trim()) && num(l.part) > 0) add('ALERTE', "Plan d'investissement ligne " + (i + 1) + ' : part renseignée mais nom vide.', 'plan'); });
    if (keys.length) {
      let k = keys[0];
      while (k <= keys[keys.length - 1]) { if (!data.months[k]) add('ERREUR', 'Mois manquant dans la suite : ' + keyLabel(k) + ' (le report saute ce mois).'); k = addMonths(k, 1); }
      const cur = isoToKey(td);
      if (keys[keys.length - 1] < cur) add('ALERTE', 'Le mois en cours (' + keyLabel(cur) + ") n'existe pas encore : « Créer le mois suivant ».", 'mois');
    }
    keys.forEach(k => {
      const m = data.months[k], r = comp[k];
      SECTIONS.forEach(sec => (m.sections[sec] || []).forEach(l => {
        ['prevu', 'reel'].forEach(w => { if (l[w] && !isValidExpr(l[w])) add('ERREUR', keyLabel(k) + ' : « ' + l.label + ' » (' + (w === 'prevu' ? 'prévu' : 'réel') + ') contient une formule invalide : ' + l[w], 'mois:' + k); });
      }));
      if (r.remP < 0) add('ALERTE', keyLabel(k) + ' : reste prévu négatif (' + fmtEur(r.remP) + ').', 'mois:' + k);
      if (r.remR < 0) add('ALERTE', keyLabel(k) + ' : reste réel négatif (' + fmtEur(r.remR) + ').', 'mois:' + k);
      const e = round2(r.investR - journalMois(inv, k));
      if (Math.abs(e) > tol) add('ALERTE', keyLabel(k) + ' : investi réel (' + fmtEur(r.investR) + ") différent du journal des versements (écart " + fmtEur(e) + ') : « Synchroniser ».', 'versements');
    });
    const noms = new Set(lignesPlan(plan).map(l => l.nom));
    let nPb = 0;
    (inv.journal || []).forEach((j, i) => {
      let pb = [];
      if (!j.date) pb.push('date manquante'); else if (j.date > td) pb.push('date dans le futur');
      if (j.montant === '' || j.montant === null || j.montant === undefined) pb.push('montant manquant');
      if (!j.ligne) pb.push('investissement manquant'); else if (!noms.has(j.ligne)) pb.push('investissement absent du plan');
      if (pb.length && ++nPb <= 10) add('ALERTE', 'Versement du ' + isoFr(j.date) + ' : ' + pb.join(', ') + '.', 'versements');
    });
    if (nPb > 10) add('ALERTE', 'Journal des versements : ' + (nPb - 10) + ' autre(s) ligne(s) à corriger.', 'versements');
    let nD = 0;
    (data.depenses || []).forEach(d => { if (d.mois && !data.months[d.mois] && ++nD <= 5) add('ALERTE', 'Journal des dépenses : le mois ' + keyLabel(d.mois) + " d'une saisie n'existe pas.", 'journal'); });
    const t = (data.tarifs || []).filter(x => x.mois);
    for (let i = 1; i < t.length; i++) if (t[i].mois <= t[i - 1].mois) { add('ALERTE', 'Paramètres : les mois des indemnités journalières ne sont pas triés par date croissante.', 'parametres'); break; }
    if (t.length) {
      const last = t.map(x => x.mois).sort().pop();
      if (last < isoToKey(td)) add('INFO', 'Paramètres : dernier tarif journalier en ' + keyLabel(last) + ' ; il s’applique aux mois suivants tant qu’aucune ligne n’est ajoutée.', 'parametres');
    }
    (data.conges || []).forEach(c => { if (c.debut && c.fin && c.fin < c.debut) add('ERREUR', 'Congé « ' + (c.lib || '') + ' » : la fin est avant le début.', 'parametres'); });
    if (!out.length) add('OK', 'Aucun problème détecté.');
    return out;
  }


  // ================= v2 : PEA =================
  // Simulation du plafond de versements PEA (150 000 €) avec débordement éventuel sur un CTO
  function peaSimulation(p) {
    const plafond = num(p.plafond) || 150000, r = Math.pow(1 + num(p.rendement), 1 / 12) - 1;
    const H = Math.max(1, Math.round(num(p.horizonAns) * 12)), ps = num(p.ps), pfu = num(p.pfu);
    let vP = num(p.dejaVerse), valP = p.valeurActuelle === null || p.valeurActuelle === undefined || p.valeurActuelle === '' ? vP : num(p.valeurActuelle);
    let vC = 0, valC = 0, vAll = vP, valAll = valP, plafondKey = vP >= plafond - 0.005 ? p.debutKey : null, nPlafond = vP >= plafond - 0.005 ? 0 : null;
    const rows = [];
    for (let m = 1; m <= H; m++) {
      const k = addMonths(p.debutKey, m - 1), c = m <= num(p.delai) ? num(p.v1) : num(p.v2);
      const room = Math.max(0, plafond - vP), toP = Math.min(c, room), toC = p.debordement === 'stop' ? 0 : c - toP;
      vP += toP; vC += toC; valP = valP * (1 + r) + toP; valC = valC * (1 + r) + toC;
      vAll += toP + toC; valAll = valAll * (1 + r) + toP + toC;
      if (nPlafond === null && vP >= plafond - 0.005) { nPlafond = m; plafondKey = k; }
      rows.push({ m, key: k, verseP: vP, valP, verseC: vC, valC, verseTot: vP + vC, valTot: valP + valC });
    }
    const finKey = addMonths(p.debutKey, H - 1);
    const cinqAns = p.ouverture ? addMonths(isoToKey(p.ouverture), 60) : null;
    const apres5 = cinqAns ? finKey >= cinqAns : true;
    const gP = valP - vP, gC = valC - vC, gAll = valAll - vAll;
    const taxP = Math.max(0, gP) * (apres5 ? ps : pfu), taxC = Math.max(0, gC) * pfu, taxAll = Math.max(0, gAll) * pfu;
    const netTot = valP - taxP + valC - taxC, netAll = valAll - taxAll;
    return { rows, plafond, nPlafond, plafondKey, cinqAns, apres5, finKey,
      fin: { verseP: vP, valP, gainP: gP, taxP, netP: valP - taxP, verseC: vC, valC, gainC: gC, taxC, netC: valC - taxC, netTot, netAll, taxAll, economie: netTot - netAll, restant: Math.max(0, plafond - vP) } };
  }
  // Versements PEA déjà effectués d'après le plan et le journal
  function peaEtat(data) {
    const inv = data.invest, pea = inv.pea || {}, env = (pea.enveloppe || 'PEA').toLowerCase();
    const lignes = lignesPlan(inv.plan).filter(l => String(l.env || '').toLowerCase() === env);
    const noms = new Set(lignes.map(l => l.nom));
    const capital = lignes.reduce((s, l) => s + num(l.capital), 0);
    const journal = (inv.journal || []).filter(j => noms.has(j.ligne)).reduce((s, j) => s + num(j.montant), 0);
    const part = lignes.reduce((s, l) => s + num(l.part), 0);
    const pf = portefeuille(inv), val = pf.rows.filter(r => noms.has(r.nom) && r.val !== null).reduce((s, r) => s + r.val, 0);
    const rendMoy = part ? lignes.reduce((s, l) => s + num(l.part) * ((1 + num(l.rend)) * (1 - num(l.frais)) - 1), 0) / part : 0.06;
    return { verse: num(pea.anterieur) + capital + journal, part, valeur: val || null, lignes, rendMoy, plafond: num(pea.plafond) || 150000, ouverture: pea.ouverture || null };
  }

  // ================= v2 : comptes & patrimoine =================
  const TYPES_COMPTE = { courant: 'Compte courant', livret: 'Livret / épargne', pea: 'PEA', cto: 'Compte-titres', av: 'Assurance-vie', crypto: 'Crypto', immo: 'Immobilier', dette: 'Dette / crédit', autre: 'Autre' };
  function soldeAu(c, iso) {
    const r = (c.releves || []).filter(x => x.date && (!iso || x.date <= iso)).sort((a, b) => a.date.localeCompare(b.date));
    return r.length ? { solde: num(r[r.length - 1].solde), date: r[r.length - 1].date } : null;
  }
  function valeurPortefeuilleAu(inv, iso) {
    const h = (inv.historique || []).filter(x => x.date <= iso).sort((a, b) => a.date.localeCompare(b.date));
    const verse = lignesPlan(inv.plan).reduce((s, l) => s + num(l.capital), 0) + (inv.journal || []).filter(j => j.date && j.date <= iso).reduce((s, j) => s + num(j.montant), 0);
    if (h.length) { const last = h[h.length - 1]; return last.total + (verse - last.verse); } // valeur + versements depuis
    return verse;
  }
  function patrimoine(data, iso) {
    iso = iso || todayISO();
    const comptes = (data.comptes || []).filter(c => !c.archive).map(c => { const s = soldeAu(c, iso); const v = s ? s.solde * (c.type === 'dette' ? -1 : 1) * (c.type === 'dette' && s.solde < 0 ? -1 : 1) : 0; return { c, solde: s ? s.solde : null, date: s ? s.date : null, valeur: c.type === 'dette' ? -Math.abs(s ? s.solde : 0) : v }; });
    const pfOn = data.settings.patrimoinePortefeuille !== false;
    const pfVal = pfOn ? valeurPortefeuilleAu(data.invest, iso) : 0;
    const total = comptes.reduce((s, x) => s + x.valeur, 0) + pfVal;
    const parType = {};
    comptes.forEach(x => { parType[x.c.type] = (parType[x.c.type] || 0) + x.valeur; });
    if (pfOn && pfVal) parType.portefeuille = (parType.portefeuille || 0) + pfVal;
    return { comptes, pfVal, pfOn, total, parType };
  }
  function patrimoineSerie(data, nMois) {
    const out = [], ck = currentKey();
    for (let i = (nMois || 12) - 1; i >= 0; i--) {
      const k = addMonths(ck, -i), iso = i === 0 ? todayISO() : k + '-' + String(daysInMonth(k)).padStart(2, '0');
      out.push({ key: k, iso, total: patrimoine(data, iso).total });
    }
    return out;
  }
  function epargneActuelle(data) {
    const pc = (data.comptes || []).filter(c => c.precaution && !c.archive);
    if (!pc.length) return { montant: num(data.settings.epargneActuelle), auto: false };
    return { montant: pc.reduce((s, c) => { const x = soldeAu(c); return s + (x ? x.solde : 0); }, 0), auto: true, comptes: pc.map(c => c.nom) };
  }
  function objectifEtat(data, o) {
    const auto = (o.comptes || []).length;
    const actuel = auto ? (data.comptes || []).filter(c => o.comptes.includes(c.id)).reduce((s, c) => { const x = soldeAu(c); return s + (x ? x.solde : 0); }, 0) : num(o.actuel);
    const cible = num(o.cible), pct = cible ? Math.min(1, actuel / cible) : 0;
    let mois = null, parMois = null;
    if (o.echeance) { const ek = isoToKey(o.echeance), ck = currentKey(); mois = (keyParts(ek).y - keyParts(ck).y) * 12 + keyParts(ek).m - keyParts(ck).m; parMois = mois > 0 ? Math.max(0, cible - actuel) / mois : null; }
    return { actuel, cible, pct, reste: Math.max(0, cible - actuel), mois, parMois, auto: !!auto };
  }

  // ================= v2 : abonnements =================
  const FREQ = { hebdo: { l: 'Hebdomadaire', m: 52 / 12, add: d => addDaysIso(d, 7) }, mensuel: { l: 'Mensuel', m: 1, add: d => addMonthsIso(d, 1) }, bimestriel: { l: 'Tous les 2 mois', m: 1 / 2, add: d => addMonthsIso(d, 2) }, trimestriel: { l: 'Trimestriel', m: 1 / 3, add: d => addMonthsIso(d, 3) }, semestriel: { l: 'Semestriel', m: 1 / 6, add: d => addMonthsIso(d, 6) }, annuel: { l: 'Annuel', m: 1 / 12, add: d => addMonthsIso(d, 12) } };
  function addMonthsIso(iso, n) { const [y, m, d] = iso.split('-').map(Number); const k = monthKey(y, m + n); return k + '-' + pad(Math.min(d, daysInMonth(k))); }
  function abonnementsResume(data, jours) {
    const actifs = (data.abonnements || []).filter(a => a.actif !== false);
    const mensuel = actifs.reduce((s, a) => s + num(a.montant) * (FREQ[a.frequence] || FREQ.mensuel).m, 0);
    const today = todayISO(), lim = addDaysIso(today, jours || 30);
    const prochains = [];
    actifs.forEach(a => { let d = a.prochaine, g = 0; while (d && d <= lim && g++ < 60) { if (d >= today || g === 1) prochains.push({ a, date: d, retard: d < today }); d = (FREQ[a.frequence] || FREQ.mensuel).add(d); } });
    prochains.sort((x, y) => x.date.localeCompare(y.date));
    return { mensuel, annuel: mensuel * 12, actifs: actifs.length, prochains };
  }

  // ================= v2 : voyages =================
  const CATS_VOYAGE = ['Billets', 'Hébergement', 'Transport local', 'Activités / Visites', 'Restaurants', 'Shopping / Souvenirs', 'Autres'];
  function voyageEtat(v) {
    const t = v.devise && v.devise !== 'EUR' ? (num(v.taux) || 1) : 1;
    const parCat = {}; CATS_VOYAGE.forEach(c => { parCat[c] = { prevu: 0, reel: 0 }; });
    (v.depenses || []).forEach(d => { const c = parCat[d.cat] ? d.cat : 'Autres'; parCat[c].prevu += num(d.prevu) * t; parCat[c].reel += num(d.reel) * t; });
    const prevu = Object.values(parCat).reduce((s, x) => s + x.prevu, 0), reel = Object.values(parCat).reduce((s, x) => s + x.reel, 0);
    const today = todayISO();
    const jours = v.debut && v.fin ? Math.round((new Date(v.fin) - new Date(v.debut)) / 864e5) + 1 : null;
    const statut = !v.debut ? 'idee' : today < v.debut ? 'avenir' : (v.fin && today > v.fin) ? 'passe' : 'encours';
    const dans = v.debut ? Math.round((new Date(v.debut) - new Date(today)) / 864e5) : null;
    const pers = Math.max(1, num(v.voyageurs) || 1), budget = num(v.budget) || prevu;
    const check = (v.checklist || []), fait = check.filter(c => c.fait).length;
    return { parCat, prevu, reel, budget, jours, statut, dans, parPers: (reel || prevu) / pers, parJour: jours ? (reel || prevu) / jours : null, check: { n: check.length, fait }, pctBudget: budget ? reel / budget : 0, planningCout: (v.planning || []).reduce((s, p) => s + num(p.cout), 0) };
  }

  // ================= v2 : impôts & salaire =================
  function impotRevenu(f, ri) {
    const b = (f.bareme || []).slice().sort((a, b) => num(a.seuil) - num(b.seuil));
    let brut = 0, tmi = 0;
    b.forEach((t, i) => { const hi = i + 1 < b.length ? num(b[i + 1].seuil) : Infinity; const part = Math.max(0, Math.min(ri, hi) - num(t.seuil)); brut += part * num(t.taux); if (ri > num(t.seuil)) tmi = num(t.taux); });
    const decote = brut < num(f.decoteSeuil) ? Math.max(0, num(f.decoteFixe) - num(f.decoteTaux) * brut) : 0;
    const net = Math.max(0, brut - decote);
    return { brut, decote, net, tmi, tauxMoyen: ri ? net / ri : 0 };
  }
  function scenarioSalaire(f, s) {
    const brut = num(s.brut), mois = num(s.mois) || 12, cot = s.cadre ? num(f.cotisCadre) : num(f.cotisNonCadre);
    const brutM = brut / mois, netAvant = brutM * (1 - cot), netAn = netAvant * mois;
    const ri = brut * num(f.ratioImposable), ir = impotRevenu(f, ri);
    return { brutM, cot, netAvant, netAn, ri, ir, pasEstime: netAn ? ir.net / netAn : 0, netApresPas: netAvant * (1 - num(s.pas)), netApresImpot: netAvant - ir.net / 12 };
  }
  // Effort mensuel pour atteindre un objectif (versements en fin de mois)
  function effortMensuel(cible, annees, rend, initial) {
    const n = Math.round(num(annees) * 12), r = Math.pow(1 + num(rend), 1 / 12) - 1, fvI = num(initial) * Math.pow(1 + r, n);
    if (n <= 0) return null; const reste = num(cible) - fvI; if (reste <= 0) return 0;
    return Math.abs(r) < 1e-12 ? reste / n : reste * r / (Math.pow(1 + r, n) - 1);
  }


  // ================= v2.1 : achats =================
  const SITES = { amazon: 'Amazon', ledenicheur: 'LeDénicheur', fnac: 'Fnac', darty: 'Darty', boulanger: 'Boulanger', cdiscount: 'Cdiscount', ldlc: 'LDLC', leboncoin: 'leboncoin', ikea: 'IKEA', decathlon: 'Decathlon', backmarket: 'Back Market', 'materiel': 'Materiel.net', topachat: 'TopAchat', rakuten: 'Rakuten', aliexpress: 'AliExpress', zalando: 'Zalando', ebay: 'eBay', apple: 'Apple', samsung: 'Samsung', leroymerlin: 'Leroy Merlin', castorama: 'Castorama', vinted: 'Vinted', idealo: 'idealo', pccomponentes: 'PcComponentes', alternate: 'Alternate', grosbill: 'Grosbill', kobo: 'Kobo', carrefour: 'Carrefour', auchan: 'Auchan', maisonsdumonde: 'Maisons du Monde', conforama: 'Conforama', but: 'BUT' };
  function siteDe(url) {
    if (!url) return '';
    let h = String(url).trim().replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].toLowerCase().replace(/^www\.|^m\./, '');
    if (!h || h.indexOf('.') < 0) return '';
    const base = h.split('.').slice(-2)[0], first = h.split('.')[0];
    for (const k of Object.keys(SITES)) if (h.indexOf(k) >= 0) return SITES[k];
    const n = first.length > 2 ? first : base; return n.charAt(0).toUpperCase() + n.slice(1);
  }
  const STATUTS_ACHAT = { envie: 'Envie', aacheter: 'À acheter', commande: 'Commandé', recu: 'Reçu', retourne: 'Retourné', abandonne: 'Abandonné' };
  function achatEtat(a, today) {
    today = today || todayISO();
    const offres = (a.offres || []).map(o => ({ o, total: num(o.prix) + num(o.port) })).filter(x => num(x.o.prix) > 0);
    const min = offres.length ? Math.min(...offres.map(x => x.total)) : null, max = offres.length ? Math.max(...offres.map(x => x.total)) : null;
    const tri = offres.slice().sort((x, y) => x.total - y.total);
    const rang = {}; offres.forEach(x => { rang[x.o.id] = offres.filter(y => y.total < x.total - 1e-9).length + 1; });
    const best = tri[0] || null;
    const hist = best ? (best.o.historique || []).slice().sort((x, y) => x.date.localeCompare(y.date)) : [];
    const tendance = hist.length >= 2 ? num(hist[hist.length - 1].prix) - num(hist[hist.length - 2].prix) : 0;
    const plusHaut = Math.max(0, ...offres.flatMap(x => (x.o.historique || []).map(h => num(h.prix) + num(x.o.port))).concat(max || 0));
    const paye = a.achat && a.achat.prix !== undefined && a.achat.prix !== null && a.achat.prix !== '' ? num(a.achat.prix) : null;
    let retour = null;
    if (a.statut === 'recu' && a.achat && (a.achat.reception || a.achat.date)) { const j = num(a.retourJours) || 14; retour = addDaysIso(a.achat.reception || a.achat.date, j); }
    const cible = num(a.prixCible) || null;
    return { offres, min, max, best, rang, ecart: id => { const x = offres.find(y => y.o.id === id); return x && min !== null ? x.total - min : null; },
      nb: offres.length, tendance, cibleAtteinte: cible !== null && min !== null && min <= cible, cible, paye, economie: paye !== null && plusHaut ? Math.max(0, plusHaut - paye) : 0,
      retour, retourOuvert: retour !== null && retour >= today, joursRetour: retour ? Math.round((new Date(retour) - new Date(today)) / 864e5) : null,
      ouvert: ['envie', 'aacheter'].includes(a.statut || 'envie'), prixRef: paye !== null ? paye : min };
  }
  function achatsResume(data, today) {
    const list = data.achats || [], ck = currentKey(today ? new Date(today + 'T12:00:00') : undefined);
    const e = list.map(a => ({ a, e: achatEtat(a, today) }));
    const envies = e.filter(x => x.e.ouvert);
    const moisAchats = e.filter(x => x.e.paye !== null && x.a.achat && isoToKey(x.a.achat.date) === ck);
    return { n: list.length, envies: envies.length, totalEnvies: envies.reduce((s, x) => s + (x.e.min || 0), 0), achatsMois: moisAchats.reduce((s, x) => s + x.e.paye, 0), nbMois: moisAchats.length,
      economies: e.reduce((s, x) => s + x.e.economie, 0), retours: e.filter(x => x.e.retourOuvert).map(x => x), cibles: e.filter(x => x.e.ouvert && x.e.cibleAtteinte).map(x => x), enCours: e.filter(x => x.a.statut === 'commande').length };
  }

  // ---------- Formats ----------
  function fmtEur(v, dec) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return '–';
    const d = dec === undefined ? 2 : dec;
    return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '\u00a0€';
  }
  function fmtNum(v, dec) { if (v === null || v === undefined || isNaN(v)) return '–'; return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }).format(v); }
  function fmtPct(v, dec) { if (v === null || v === undefined || v === '' || isNaN(v)) return '–'; return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec === undefined ? 1 : dec, maximumFractionDigits: dec === undefined ? 1 : dec }).format(v * 100) + ' %'; }

  const Calc = {
    evalExpr, isValidExpr, num, appendToExpr, round2,
    monthKey, keyParts, addMonths, keyLabel, keyLong, MOIS, MOIS_COURT, todayISO, currentKey, isoToKey, isoFr, frToIso, daysInMonth,
    paques, feriesAnnee, joursNonTravailles, joursOuvres, tarifPour, indemnites,
    SECTIONS, monthKeys, computeAll, statut, joursRestants, precaution, projectionSolde,
    fv, tauxMensuel, planResultats, projection, prevuPlanMois, journalMois, suiviMensuel, portefeuille, lignesPlan,
    controles, fmtEur, fmtNum, fmtPct,
    peaSimulation, peaEtat, TYPES_COMPTE, soldeAu, valeurPortefeuilleAu, patrimoine, patrimoineSerie, epargneActuelle, objectifEtat,
    FREQ, addMonthsIso, siteDe, STATUTS_ACHAT, achatEtat, achatsResume, abonnementsResume, CATS_VOYAGE, voyageEtat, impotRevenu, scenarioSalaire, effortMensuel, addDaysIso, weekdayIso
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc; else root.Calc = Calc;
})(typeof window !== 'undefined' ? window : globalThis);
