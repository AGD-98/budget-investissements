/* v2.4 — Intelligence locale : prévisions, points d'attention, calendrier, défis, rééquilibrage, objectifs, « et si », PER.
   Fonctions pures (aucun accès réseau), testables sous Node. */
(function (root) {
  'use strict';
  const C = root.Calc || (typeof require === 'function' ? require('./calc.js') : null);
  const { num, round2, addMonths, keyParts, daysInMonth, isoToKey, todayISO, addDaysIso, weekdayIso, currentKey, monthKeys, keyLong, fmtEur } = C;
  const E0 = v => fmtEur(v, 0);
  const pct = v => Math.round(v * 100) + ' %';
  const moisNom = k => keyLong(k).toLowerCase();
  const monthsBetween = (a, b) => (keyParts(b).y - keyParts(a).y) * 12 + keyParts(b).m - keyParts(a).m;
  const median = arr => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  // Nombre d'achats contenus dans une case (=22+14,39+5,78 → 3)
  function nbAchats(expr) {
    let s = String(expr === undefined || expr === null ? '' : expr).trim().replace(/^=/, '');
    if (!s) return 0;
    let depth = 0, cur = '', terms = [];
    for (const ch of s) {
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === '+' && depth === 0) { terms.push(cur); cur = ''; } else cur += ch;
    }
    terms.push(cur);
    return terms.filter(t => { try { return Math.abs(C.evalExpr(t)) > 0.004; } catch (e) { return false; } }).length;
  }
  function lignesDepense(m) { return ['fixed', 'variable'].flatMap(sec => (m.sections[sec] || []).map(l => ({ l, sec }))); }
  function depensesDuMois(data, k) { return (data.depenses || []).filter(d => (d.mois || isoToKey(d.date)) === k); }

  // ================= 10. Prévision de fin de mois =================
  function prevision(data, comp, k, today) {
    today = today || todayISO();
    const m = data.months[k], r = comp[k];
    if (!m || !r) return null;
    const dim = daysInMonth(k), tk = isoToKey(today), tol = num(data.settings.tol);
    const day = tk === k ? Number(today.slice(8, 10)) : k < tk ? dim : 0;
    const rest = dim - day; // jours après aujourd'hui
    const jour = depensesDuMois(data, k);
    const lines = lignesDepense(m).map(({ l, sec }) => {
      const v = r.lines[l.id], n = Math.max(nbAchats(l.reel), jour.filter(d => d.cat === l.label && num(d.montant) > 0).length);
      const planned = Math.max(0, v.prevu - v.reel);
      let mode = 'plan', reste = planned;
      if (sec === 'variable' && !l.role && n >= 3 && v.reel > 0 && day >= 4 && rest > 0) {
        const pace = v.reel / day * rest, w = day / dim;
        reste = w * pace + (1 - w) * planned; mode = 'rythme';
      }
      if (day >= dim) reste = 0;
      const proj = v.reel + reste;
      const risque = !l.role && proj > v.prevu * (1 + tol) + 1;
      return { id: l.id, label: l.label, sec, role: l.role, prevu: v.prevu, reel: v.reel, n, mode, reste, proj, risque, depasse: v.reel > v.prevu * (1 + tol) + 0.005 && !l.role };
    });
    let resteRev = 0;
    ['income', 'schedule'].forEach(sec => (m.sections[sec] || []).forEach(l => { const v = r.lines[l.id]; resteRev += Math.max(0, v.prevu - v.reel); }));
    const resteDep = lines.reduce((s, x) => s + x.reste, 0);
    const cour = lines.filter(x => x.sec === 'variable' && !x.role);
    const budgetRestant = cour.reduce((s, x) => s + Math.max(0, x.prevu - x.reel), 0);
    const joursRestants = day >= dim ? 0 : dim - day + 1;
    const varReel = cour.reduce((s, x) => s + x.reel, 0), varPrevu = cour.reduce((s, x) => s + x.prevu, 0), varProj = cour.reduce((s, x) => s + x.proj, 0);
    const freq = cour.filter(x => x.mode === 'rythme'), baseR = freq.length ? freq : cour;
    const fin = r.remR - resteDep + resteRev;
    return {
      k, dim, day, rest, joursRestants, lines, resteDep, resteRev, finProjetee: fin, finPrevue: r.remP, ecart: fin - r.remP,
      budgetRestant, parJour: joursRestants ? budgetRestant / joursRestants : null,
      varReel, varPrevu, varProj, rythmeJour: day ? baseR.reduce((s, x) => s + x.reel, 0) / day : 0, planJour: dim ? baseR.reduce((s, x) => s + x.prevu, 0) / dim : 0, rythmeCats: freq.map(x => x.label),
      risques: lines.filter(x => x.risque).sort((a, b) => (b.proj - b.prevu) - (a.proj - a.prevu)),
      confiance: dim ? day / dim : 0, enCours: tk === k
    };
  }

  // ================= Historique par catégorie =================
  function historiqueCategories(data, comp, avant) {
    const h = {};
    monthKeys(data).filter(k => !avant || k < avant).forEach(k => {
      const m = data.months[k], r = comp[k];
      lignesDepense(m).forEach(({ l, sec }) => { (h[l.label] = h[l.label] || []).push({ k, sec, role: l.role, prevu: r.lines[l.id].prevu, reel: r.lines[l.id].reel, n: nbAchats(l.reel) }); });
    });
    return h;
  }

  // ================= 11 + 12. Points d'attention =================
  function recurrencesJournal(data) {
    const groups = {};
    (data.depenses || []).filter(d => num(d.montant) > 0 && d.date && d.com && !/\(abonnement\)/i.test(d.com)).forEach(d => { const key = norm(d.cat) + '|' + norm(d.com); (groups[key] = groups[key] || []).push(d); });
    const out = [];
    Object.values(groups).forEach(g => {
      if (g.length < 3) return;
      g.sort((a, b) => a.date.localeCompare(b.date));
      const mts = g.map(d => num(d.montant)), med = median(mts);
      if (mts.some(x => Math.abs(x - med) > Math.max(1, med * 0.12))) return;
      const gaps = []; for (let i = 1; i < g.length; i++) gaps.push((new Date(g[i].date) - new Date(g[i - 1].date)) / 864e5);
      const gm = median(gaps);
      const freq = gm >= 5 && gm <= 9 ? 'hebdo' : gm >= 25 && gm <= 36 ? 'mensuel' : gm >= 80 && gm <= 100 ? 'trimestriel' : gm >= 350 && gm <= 380 ? 'annuel' : null;
      if (!freq) return;
      const last = g[g.length - 1];
      out.push({ nom: last.com, cat: last.cat, montant: round2(med), freq, n: g.length, prochaine: C.FREQ[freq].add(last.date) });
    });
    return out;
  }
  function aboExiste(data, label, montant) {
    const n = norm(label);
    return (data.abonnements || []).some(a => a.categorie === label || norm(a.nom) === n || (n.length > 3 && (norm(a.nom).includes(n) || n.includes(norm(a.nom)))) || (a.categorie === label && Math.abs(num(a.montant) - montant) < 0.01));
  }
  function pointsAttention(data, comp, today) {
    today = today || todayISO();
    const out = [], ck = currentKey(new Date(today + 'T12:00:00')), ign = new Set(((data.analyse || {}).ignores) || []);
    const add = (key, niveau, icon, titre, detail, actions) => { if (!ign.has(key)) out.push({ key, niveau, icon, titre, detail, actions: actions || [] }); };
    const keys = monthKeys(data), clos = keys.filter(k => k < ck);
    const pv = data.months[ck] && comp[ck] ? prevision(data, comp, ck, today) : null;
    const hist = historiqueCategories(data, comp, ck);

    // Dépassements prévus au rythme actuel
    if (pv && pv.enCours) pv.risques.slice(0, 4).forEach(x => {
      add(`risque|${ck}|${x.label}`, x.depasse ? 'neg' : 'warn', 'trendDown',
        x.depasse ? `<b>${x.label}</b> a déjà dépassé son budget` : `<b>${x.label}</b> risque de dépasser son budget`,
        x.depasse ? `${E0(x.reel)} dépensés pour ${E0(x.prevu)} prévus` : `Au rythme actuel : ~${E0(x.proj)} d’ici la fin du mois pour ${E0(x.prevu)} prévus (${x.n} achats en ${pv.day} jours)`,
        [{ label: 'Voir le mois', nav: 'mois' }]);
    });

    // Dépenses inhabituelles par rapport à la moyenne
    let bravo = 0;
    if (pv && pv.enCours) pv.lines.filter(x => !x.role).forEach(x => {
      const h = (hist[x.label] || []).filter(e => e.reel > 0);
      if (!h.length) return;
      const ref = h.slice(-3), moy = ref.reduce((s, e) => s + e.reel, 0) / ref.length;
      const base = ref.length >= 2 ? `ta moyenne des ${ref.length} derniers mois (${E0(moy)})` : `${moisNom(ref[0].k)} (${E0(moy)})`;
      const seuil = ref.length >= 2 ? 1.3 : 1.5;
      if (x.proj > moy * seuil && x.proj - moy >= 25 && !x.risque) add(`inhab|${ck}|${x.label}`, 'warn', 'activity', `<b>${x.label}</b> : dépense inhabituelle ce mois-ci`, `~${E0(x.proj)} attendus, soit +${pct(x.proj / moy - 1)} par rapport à ${base}`, [{ label: 'Voir le mois', nav: 'mois' }]);
      else if (pv.confiance > 0.6 && moy >= 50 && x.proj > 0 && x.proj < moy * 0.7 && x.sec === 'variable' && x.mode === 'rythme' && ref.some(e => e.n >= 3) && bravo < 2) { bravo++; add(`bravo|${ck}|${x.label}`, 'pos', 'check', `Bravo : <b>${x.label}</b> en baisse`, `~${E0(x.proj)} ce mois-ci contre ${E0(moy)} d’habitude (−${pct(1 - x.proj / moy)})`); }
    });

    // Hausses de prix sur les charges fixes
    const derniers = keys.filter(k => k <= ck).slice(-2);
    if (derniers.length === 2) {
      const [ka, kb] = derniers;
      lignesDepense(data.months[kb]).filter(({ l, sec }) => sec === 'fixed' && !l.role).forEach(({ l }) => {
        const vb = comp[kb].lines[l.id].reel, la = lignesDepense(data.months[ka]).find(x => x.l.label === l.label);
        if (!la) return;
        const va = comp[ka].lines[la.l.id].reel;
        if (va > 0 && vb > 0 && nbAchats(l.reel) <= 1 && nbAchats(la.l.reel) <= 1 && vb - va >= 1 && vb / va - 1 >= 0.02)
          add(`hausse|${kb}|${l.label}|${round2(vb)}`, 'warn', 'trendUp', `<b>${l.label}</b> augmente`, `${E0(va)} → ${fmtEur(vb)} (+${pct(vb / va - 1)}) entre ${moisNom(ka)} et ${moisNom(kb)} · ${E0((vb - va) * 12)} de plus par an`);
      });
    }
    (data.abonnements || []).forEach(a => (a.hist || []).filter(h => h.date >= addDaysIso(today, -120) && num(h.nouveau) > num(h.ancien)).slice(-1).forEach(h => {
      const f = (C.FREQ[a.frequence] || C.FREQ.mensuel).m;
      add(`aboh|${a.id}|${h.date}`, 'warn', 'trendUp', `Abonnement <b>${a.nom}</b> plus cher`, `${fmtEur(h.ancien)} → ${fmtEur(h.nouveau)} (+${pct(num(h.nouveau) / num(h.ancien) - 1)}) le ${C.isoFr(h.date)} · ${E0((num(h.nouveau) - num(h.ancien)) * f * 12)} de plus par an`, [{ label: 'Abonnements', nav: 'abonnements' }]);
    }));

    // Charges récurrentes pas encore dans les abonnements
    let sugg = 0;
    const recentes = keys.filter(k => k <= ck).slice(-3);
    if (recentes.length >= 2) {
      const last = data.months[recentes[recentes.length - 1]];
      lignesDepense(last).filter(({ l, sec }) => sec === 'fixed' && !l.role).forEach(({ l }) => {
        const vals = recentes.map(k => { const x = lignesDepense(data.months[k]).find(y => y.l.label === l.label); return x ? comp[k].lines[x.l.id].reel : 0; }).filter(v => v > 0);
        if (vals.length < 2 || sugg >= 6) return;
        const med = median(vals), der = vals[vals.length - 1];
        if (vals.some(v => Math.abs(v - med) > Math.max(1, med * 0.05)) || aboExiste(data, l.label, der)) return;
        sugg++;
        add(`recur|${l.label}`, 'info', 'repeat', `<b>${l.label}</b> revient chaque mois`, `${fmtEur(der)} par mois depuis ${vals.length} mois : l’ajouter aux abonnements & prélèvements pour suivre les échéances et repérer les hausses ?`, [{ label: 'Ajouter aux abonnements', action: 'ia-add-abo', params: { nom: l.label, montant: der, categorie: l.label, frequence: 'mensuel' } }]);
      });
    }
    recurrencesJournal(data).filter(x => !aboExiste(data, x.nom, x.montant)).slice(0, 3).forEach(x => add(`recurj|${norm(x.cat)}|${norm(x.nom)}`, 'info', 'repeat', `Dépense récurrente détectée : <b>${x.nom}</b>`, `${fmtEur(x.montant)} ${C.FREQ[x.freq].l.toLowerCase()} (${x.n} fois dans le journal, catégorie ${x.cat})`, [{ label: 'Ajouter aux abonnements', action: 'ia-add-abo', params: { nom: x.nom, montant: x.montant, categorie: x.cat, frequence: x.freq, prochaine: x.prochaine } }]));

    // Budgets qui dorment
    if (clos.length >= 3) {
      const l3 = clos.slice(-3);
      Object.entries(hist).forEach(([label, h]) => {
        const e = l3.map(k => h.find(x => x.k === k)).filter(Boolean);
        if (e.length === 3 && !e[0].role && e.every(x => x.prevu > 0 && x.reel === 0)) add(`dort|${label}|${l3[2]}`, 'info', 'clock', `<b>${label}</b> : budget jamais utilisé`, `${E0(e[2].prevu)} prévus chaque mois mais rien dépensé depuis 3 mois : de l’argent à réaffecter ?`, [{ label: 'Voir le mois', nav: 'mois' }]);
      });
    }

    // Grosse dépense isolée
    const parCat = {}; (data.depenses || []).filter(d => num(d.montant) > 0).forEach(d => { (parCat[d.cat] = parCat[d.cat] || []).push(num(d.montant)); });
    (data.depenses || []).filter(d => d.date >= addDaysIso(today, -30) && num(d.montant) >= 30).forEach(d => {
      const arr = parCat[d.cat] || [];
      if (arr.length >= 5 && num(d.montant) > 3 * median(arr)) add(`gros|${d.id}`, 'info', 'zap', `Grosse dépense en <b>${d.cat}</b>`, `${fmtEur(d.montant)} le ${C.isoFr(d.date)}${d.com ? ' (' + d.com + ')' : ''}, contre ${E0(median(arr))} d’habitude`, [{ label: 'Journal', nav: 'journal' }]);
    });

    const ordre = { neg: 0, warn: 1, info: 2, pos: 3 };
    out.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
    return { items: out, historique: clos.length, ignores: ign.size };
  }

  // ================= 16. Calendrier & défis =================
  function labelsFixes(data) {
    const s = new Set();
    Object.values(data.months || {}).forEach(m => (m.sections.fixed || []).forEach(l => s.add(l.label)));
    return s;
  }
  function estChoisie(d, fixes) { return num(d.montant) > 0 && !fixes.has(d.cat) && !/\(abonnement\)/i.test(d.com || ''); }
  function calendrier(data, debut, fin) {
    const fixes = labelsFixes(data), jours = {};
    (data.depenses || []).forEach(d => {
      if (!d.date || d.date < debut || d.date > fin) return;
      const j = jours[d.date] = jours[d.date] || { total: 0, choisi: 0, n: 0, items: [] };
      j.total += num(d.montant); j.n++; j.items.push(d);
      if (estChoisie(d, fixes)) j.choisi += num(d.montant);
    });
    return jours;
  }
  function statsCalendrier(data, today) {
    today = today || todayISO();
    const k = isoToKey(today), debut = k + '-01', fixes = labelsFixes(data);
    const choisis = new Set((data.depenses || []).filter(d => d.date && estChoisie(d, fixes)).map(d => d.date));
    let sans = 0, n = 0;
    for (let d = debut; d <= today; d = addDaysIso(d, 1)) { n++; if (!choisis.has(d)) sans++; }
    let serie = 0;
    const first = (data.depenses || []).map(d => d.date).filter(Boolean).sort()[0];
    if (first) for (let d = today; d >= first && !choisis.has(d) && serie < 400; d = addDaysIso(d, -1)) serie++;
    const sem = [0, 0, 0, 0, 0, 0, 0], semN = [0, 0, 0, 0, 0, 0, 0], d90 = addDaysIso(today, -90);
    for (let d = d90; d <= today; d = addDaysIso(d, 1)) semN[weekdayIso(d)]++;
    (data.depenses || []).filter(d => d.date && d.date >= d90 && d.date <= today && estChoisie(d, fixes)).forEach(d => { sem[weekdayIso(d.date)] += num(d.montant); });
    const moyJour = sem.map((v, i) => semN[i] ? v / semN[i] : 0);
    const nb = (data.depenses || []).filter(d => d.date && d.date >= d90).length;
    return { sansDepense: sans, joursEcoules: n, serie: first ? serie : 0, parJourSemaine: moyJour, saisies90: nb, aDesDonnees: !!first };
  }

  const TYPES_DEFI = {
    'sans-superflu': { nom: 'Semaine sans superflu', emoji: '🧘', desc: 'Aucune dépense dans les catégories choisies pendant 7 jours.' },
    'jours-sans': { nom: 'Jours sans dépense', emoji: '📅', desc: 'Atteindre un nombre de jours sans aucune dépense ce mois-ci (hors charges fixes et abonnements).' },
    'plafond': { nom: 'Plafond de catégorie', emoji: '🎯', desc: 'Garder une catégorie sous un montant jusqu’à la fin du mois.' },
    'weekend': { nom: 'Week-ends malins', emoji: '🌤️', desc: 'Dépenser moins d’un montant chaque week-end pendant 4 semaines.' }
  };
  function finDefi(d) {
    if (d.type === 'sans-superflu') return addDaysIso(d.debut, (num(d.jours) || 7) - 1);
    if (d.type === 'weekend') return addDaysIso(d.debut, (num(d.semaines) || 4) * 7 - 1);
    const k = isoToKey(d.debut); return k + '-' + String(daysInMonth(k)).padStart(2, '0');
  }
  function defiEtat(data, comp, d, today) {
    today = today || todayISO();
    const fin = finDefi(d), fixes = labelsFixes(data), jusque = today < fin ? today : fin;
    const dans = x => x.date && x.date >= d.debut && x.date <= jusque;
    const totalJours = Math.round((new Date(fin) - new Date(d.debut)) / 864e5) + 1;
    const ecoules = today < d.debut ? 0 : Math.min(totalJours, Math.round((new Date(jusque) - new Date(d.debut)) / 864e5) + 1);
    let statut = 'encours', progress = 0, texte = '', detail = '';
    if (d.type === 'sans-superflu') {
      const cats = d.cats || [], viol = (data.depenses || []).filter(x => dans(x) && cats.includes(x.cat) && num(x.montant) > 0);
      viol.sort((a, b) => a.date.localeCompare(b.date));
      if (viol.length) {
        statut = 'echoue'; detail = `Craqué le ${C.isoFr(viol[0].date)} (${viol[0].cat}, ${fmtEur(viol[0].montant)})`;
        const tenus = Math.round((new Date(viol[0].date) - new Date(d.debut)) / 864e5);
        progress = tenus / totalJours; texte = `${tenus} jour(s) tenu(s) sur ${totalJours}`;
      } else {
        if (today > fin) statut = 'reussi';
        const tenus = statut === 'reussi' ? totalJours : Math.max(0, ecoules - 1);
        progress = tenus / totalJours; texte = `${tenus} / ${totalJours} jours sans ${cats.join(', ')}`;
      }
    } else if (d.type === 'jours-sans') {
      const choisis = new Set((data.depenses || []).filter(x => dans(x) && estChoisie(x, fixes)).map(x => x.date));
      let sans = 0; for (let j = d.debut; j <= jusque && today >= d.debut; j = addDaysIso(j, 1)) if (!choisis.has(j) && j < today) sans++;
      const obj = num(d.objectif) || 10, restants = Math.max(0, Math.round((new Date(fin) - new Date(today)) / 864e5) + 1);
      if (sans >= obj) statut = 'reussi'; else if (today > fin || sans + restants < obj) statut = 'echoue';
      progress = Math.min(1, sans / obj); texte = `${sans} / ${obj} jours sans dépense`;
      detail = statut === 'encours' ? `${restants} jour(s) restants dans le mois · aujourd’hui compte s’il reste sans dépense` : '';
    } else if (d.type === 'plafond') {
      const k = isoToKey(d.debut), m = data.months[k], lim = num(d.montant) || 0;
      const l = m ? lignesDepense(m).find(x => x.l.label === d.cat) : null, reel = l && comp[k] ? comp[k].lines[l.l.id].reel : 0;
      if (reel > lim + 0.005) { statut = 'echoue'; detail = `${fmtEur(reel)} dépensés`; } else if (today > fin) statut = 'reussi';
      progress = lim ? Math.min(1, reel / lim) : 0; texte = `${d.cat} : ${E0(reel)} / ${E0(lim)}`;
      detail = detail || (statut === 'encours' ? `Il te reste ${fmtEur(Math.max(0, lim - reel))}` : '');
    } else if (d.type === 'weekend') {
      const lim = num(d.montant) || 0, sem = num(d.semaines) || 4; let ok = 0, rate = null;
      for (let w = 0; w < sem; w++) {
        const a = addDaysIso(d.debut, w * 7), b = addDaysIso(a, 6);
        let we = 0, fini = false;
        for (let j = a; j <= b; j = addDaysIso(j, 1)) { const wd = weekdayIso(j); if (wd === 6 || wd === 0) { we += (data.depenses || []).filter(x => x.date === j && estChoisie(x, fixes)).reduce((s, x) => s + num(x.montant), 0); if (wd === 0 && j < today) fini = true; } }
        if (we > lim + 0.005) { rate = { w: w + 1, we }; break; }
        if (fini) ok++;
      }
      if (rate) { statut = 'echoue'; detail = `Week-end ${rate.w} : ${fmtEur(rate.we)} dépensés`; } else if (ok >= sem) statut = 'reussi';
      progress = ok / sem; texte = `${ok} / ${sem} week-ends sous ${E0(lim)}`;
    }
    return { statut, progress: Math.max(0, Math.min(1, progress)), texte, detail, fin, joursRestants: Math.max(0, Math.round((new Date(fin) - new Date(today)) / 864e5)) };
  }

  // ================= 13. Rééquilibrage =================
  function reequilibrage(pf, montant, bande, mensuel) {
    bande = bande === undefined ? 0.05 : bande;
    const estime = pf.rows.every(r => r.val === null);
    const rows = pf.rows.map(r => ({ nom: r.nom, env: r.env, part: r.part, val: r.val === null ? (estime ? r.verse : 0) : r.val }));
    const total = rows.reduce((s, r) => s + r.val, 0), partTot = rows.reduce((s, r) => s + r.part, 0) || 1;
    montant = Math.max(0, num(montant));
    const T = total + montant;
    rows.forEach(r => { r.cible = r.part / partTot; r.poids = total ? r.val / total : null; r.short = Math.max(0, r.cible * T - r.val); r.ecart = r.poids === null ? null : r.poids - r.cible; r.hors = r.ecart !== null && Math.abs(r.ecart) > bande; });
    const S = rows.reduce((s, r) => s + r.short, 0);
    rows.forEach(r => { r.alloc = S <= montant ? r.short + (montant - S) * r.cible : (S ? montant * r.short / S : 0); r.apres = r.val + r.alloc; r.poidsApres = T ? r.apres / T : null; r.complet = r.cible * total - r.val; });
    let mois = 0;
    const m = num(mensuel);
    if (rows.some(r => r.hors) && m > 0) {
      mois = null;
      for (let n = 1; n <= 240; n++) { const Tn = total + n * m; if (rows.reduce((s, r) => s + Math.max(0, r.cible * Tn - r.val), 0) <= n * m + 0.01) { mois = n; break; } }
    }
    const maxEcart = rows.reduce((s, r) => Math.max(s, r.ecart === null ? 0 : Math.abs(r.ecart)), 0);
    return { rows, total, montant, bande, horsBande: rows.filter(r => r.hors).length, maxEcart, moisSansVendre: mois, estime, ecartApres: rows.reduce((s, r) => Math.max(s, r.poidsApres === null ? 0 : Math.abs(r.poidsApres - r.cible)), 0) };
  }

  // ================= 15. Objectifs : date prévue =================
  function finDeMoisIso(k) { return k + '-' + String(daysInMonth(k)).padStart(2, '0'); }
  function nper(reste, actuel, rythme, rendAnnuel) {
    if (reste <= 0) return 0;
    const r = Math.pow(1 + num(rendAnnuel), 1 / 12) - 1;
    if (rythme <= 0 && (r <= 0 || actuel <= 0)) return null;
    if (Math.abs(r) < 1e-9) return Math.ceil(reste / rythme);
    const cible = actuel + reste, x = (cible * r + rythme) / (actuel * r + rythme);
    if (x <= 0) return null;
    const n = Math.log(x) / Math.log(1 + r);
    return isFinite(n) && n >= 0 ? Math.ceil(n - 1e-9) : null;
  }
  function objectifProjection(data, o, today) {
    today = today || todayISO();
    const e = C.objectifEtat(data, o), ck = isoToKey(today);
    let rythme = null, source = null;
    const ids = o.comptes || [];
    if (ids.length) {
      const comptes = (data.comptes || []).filter(c => ids.includes(c.id)), pts = [];
      for (let i = 6; i >= 0; i--) {
        const k = addMonths(ck, -i), iso = i === 0 ? today : finDeMoisIso(k);
        const s = comptes.map(c => C.soldeAu(c, iso));
        if (s.every(Boolean)) pts.push({ k, v: s.reduce((a, x) => a + x.solde, 0) });
      }
      if (pts.length >= 2 && monthsBetween(pts[0].k, pts[pts.length - 1].k) >= 1) { rythme = (pts[pts.length - 1].v - pts[0].v) / monthsBetween(pts[0].k, pts[pts.length - 1].k); source = 'comptes'; }
    }
    if (num(o.versement) > 0) { rythme = num(o.versement); source = 'versement'; } // le versement prévu saisi l'emporte sur la tendance
    let mois = null, date = null, avance = null;
    if (e.reste <= 0) mois = 0;
    else if (rythme !== null) mois = nper(e.reste, e.actuel, rythme, o.rendement);
    if (mois !== null) date = addMonths(ck, mois);
    if (mois !== null && o.echeance && e.reste > 0) avance = monthsBetween(date, isoToKey(o.echeance));
    const besoin = e.mois && e.mois > 0 && e.reste > 0 ? C.effortMensuel(e.cible, e.mois / 12, o.rendement, e.actuel) : null;
    return { etat: e, rythme, source, mois, date, avance, besoin, manque: besoin !== null && rythme !== null ? Math.max(0, besoin - rythme) : null };
  }

  // ================= 15 bis. « Et si… » =================
  function capaciteEpargne(data, comp, today) {
    const ck = isoToKey(today || todayISO());
    const clos = monthKeys(data).filter(k => k < ck && comp[k] && comp[k].incR > 0).slice(-3);
    if (clos.length) {
      const avg = f => clos.reduce((s, k) => s + f(comp[k]), 0) / clos.length;
      return { cap: avg(r => r.incR - r.horsInvR), revenus: avg(r => r.incR), depenses: avg(r => r.horsInvR), mois: clos, source: 'reel' };
    }
    const r = comp[ck] || comp[monthKeys(data).slice(-1)[0]];
    return r ? { cap: r.incP - r.horsInvP, revenus: r.incP, depenses: r.horsInvP, mois: [], source: 'prevu' } : { cap: 0, revenus: 0, depenses: 0, mois: [], source: 'aucun' };
  }
  function mensualite(capital, tauxAnnuel, annees) {
    const n = Math.round(num(annees) * 12), r = num(tauxAnnuel) / 12;
    if (!n || !num(capital)) return 0;
    return Math.abs(r) < 1e-9 ? num(capital) / n : num(capital) * r / (1 - Math.pow(1 + r, -n));
  }
  function etSi(data, comp, p, today) {
    today = today || todayISO();
    const base = capaciteEpargne(data, comp, today), H = Math.max(12, Math.min(360, Math.round(num(p.horizon) || 60)));
    const mens = mensualite(p.creditMontant, p.creditTaux, p.creditDuree), nCred = Math.round(num(p.creditDuree) * 12), dCred = Math.max(0, Math.round(num(p.creditDebut) || 0));
    const dRev = num(p.revenus), dDep = num(p.depenses), achat = num(p.achat), mAchat = Math.max(0, Math.round(num(p.achatMois) || 0));
    const r = Math.pow(1 + num(p.rendement), 1 / 12) - 1, P0 = C.patrimoine(data, today).total;
    const serie = [{ m: 0, base: P0, scen: P0 }];
    let pb = P0, ps = P0, capMin = Infinity;
    for (let m = 1; m <= H; m++) {
      const credit = m > dCred && m <= dCred + nCred ? mens : 0;
      const cs = base.cap + dRev - dDep - credit; capMin = Math.min(capMin, cs);
      pb = pb * (1 + r) + base.cap;
      ps = ps * (1 + r) + cs - (m === mAchat || (mAchat === 0 && m === 1) ? achat : 0);
      serie.push({ m, base: pb, scen: ps });
    }
    const capScen = base.cap + dRev - dDep - (dCred === 0 ? mens : 0);
    const endet = (base.revenus + dRev) > 0 ? mens / (base.revenus + dRev) : null;
    const coutCredit = mens * nCred - num(p.creditMontant);
    const ecart = pb - ps, retard = base.cap > 0 ? ecart / base.cap : null;
    const ratio = base.cap > 0 ? capScen / base.cap : null;
    const objectifs = (data.objectifs || []).map(o => {
      const pr = objectifProjection(data, o, today);
      if (pr.rythme === null || pr.etat.reste <= 0 || ratio === null) return { o, pr, mois2: null };
      const mois2 = nper(pr.etat.reste, pr.etat.actuel, pr.rythme * ratio, o.rendement);
      return { o, pr, mois2, date2: mois2 === null ? null : addMonths(isoToKey(today), mois2) };
    });
    return { base, capScen, capMin, mens, nCred, coutCredit, endet, serie, H, P0, finBase: pb, finScen: ps, ecart, retard, objectifs };
  }

  // ================= 14. PER : économie d'impôt =================
  const PER_MIN_2026 = 4710, PER_MAX_2026 = 37680; // 10 % du PASS 2025 / 10 % de 8 PASS 2025
  function plafondPerEstime(revenuImposable) { return Math.round(Math.min(PER_MAX_2026, Math.max(PER_MIN_2026, num(revenuImposable) * 0.1))); }
  function per(f, p, today) {
    today = today || todayISO();
    const ri = Math.max(0, num(p.revenu)), plafond = p.plafond === null || p.plafond === undefined || p.plafond === '' ? plafondPerEstime(ri) : num(p.plafond);
    const v = Math.max(0, num(p.versement)), deduit = Math.min(v, plafond, ri);
    const sans = C.impotRevenu(f, ri), avec = C.impotRevenu(f, ri - deduit), eco = sans.net - avec.net;
    const b = (f.bareme || []).slice().sort((a, c) => num(a.seuil) - num(c.seuil));
    const tr = b.filter(t => ri > num(t.seuil)).slice(-1)[0] || b[0];
    const versementTranche = tr && num(tr.taux) > 0 ? ri - num(tr.seuil) : 0;
    const maxV = Math.max(1000, Math.min(plafond, ri) || 1000), pas = maxV / 40, courbe = [];
    for (let x = 0; x <= maxV + 0.5; x += pas) { const d = Math.min(x, plafond, ri); courbe.push({ v: Math.round(x), eco: sans.net - C.impotRevenu(f, ri - d).net }); }
    const an = Number(today.slice(0, 4)), finAn = an + '-12-31';
    return { ri, plafond, plafondEstime: p.plafond === null || p.plafond === undefined || p.plafond === '', versement: v, deduit, horsPlafond: Math.max(0, v - plafond), sans, avec, eco, cout: v - eco, taux: v ? eco / v : 0, tmi: sans.tmi, tmiApres: avec.tmi, versementTranche, courbe, joursAvantFin: Math.max(0, Math.round((new Date(finAn) - new Date(today)) / 864e5)), annee: an };
  }

  const Intel = { nbAchats, prevision, historiqueCategories, pointsAttention, recurrencesJournal, calendrier, statsCalendrier, TYPES_DEFI, finDefi, defiEtat, reequilibrage, nper, objectifProjection, capaciteEpargne, mensualite, etSi, per, plafondPerEstime, PER_MIN_2026, PER_MAX_2026, labelsFixes };
  Object.assign(C, Intel);
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis);
