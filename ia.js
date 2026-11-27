/* v2.6 — IA locale de Budget & Investissements (PC + iPhone)
   Tout tourne sur l'appareil, sans internet :
   - compréhension du français (intentions, périodes, catégories, montants, dates, comptes, objectifs)
   - classifieur de catégories appris sur ton journal (Bayes naïf + lexique + règles apprises)
   - réponses calculées sur tes vraies données (aucun chiffre inventé), conseils personnalisés, bilan
   - saisie en une phrase (« 23,50 sushi hier ») et lecture de relevés bancaires */
(function (root) {
  'use strict';
  const C = root.Calc || (typeof require === 'function' ? require('./calc.js') : null);
  const { num, round2, fmtEur, addMonths, keyParts, daysInMonth, isoToKey, todayISO, addDaysIso, weekdayIso, currentKey, monthKeys, keyLong, isoFr } = C;
  const E = (v, d) => fmtEur(v, d === undefined ? 0 : d), E2 = v => fmtEur(v, 2);
  const P = v => C.fmtPct(v, 0);
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const b = s => '<b>' + s + '</b>';
  const pick = (arr, seed) => arr[Math.abs(seed || 0) % arr.length];

  // ================= Texte =================
  const norm = s => String(s || '').toLowerCase().replace(/[’`]/g, "'").normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/\s+/g, ' ').trim();
  const STOP = new Set('le la les l de des du d un une et en au aux a pour par sur avec mon ma mes ton ta tes son sa ses ce cet cette ces c j je tu il elle on nous vous ils elles qui que qu quoi est es suis ai as avons avez ont y dans ou se s me m te t ne n pas plus moins tres bien fait faire mais donc si ca cela ceci tout tous toute toutes chez the of and for to in at from by on my your its eur euro euros e'.split(' '));
  const tokens = s => norm(s).replace(/\(telephone\)|\(iphone\)|\(abonnement\)/g, ' ').replace(/\btotal ?energies?\b/g, 'totalenergies').replace(/\bmc ?do(nald'?s?)?\b/g, 'mcdo').replace(/\bleroy ?merlin\b/g, 'leroymerlin').replace(/\bbasic ?fit\b/g, 'basicfit').replace(/\buber ?eats\b/g, 'ubereats').split(/[^a-z0-9]+/).filter(t => t && t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
  const proche = (a, b2) => a === b2 || (a.length >= 4 && b2.length >= 4 && (a.startsWith(b2) || b2.startsWith(a))) || (a.length >= 5 && b2.length >= 5 && a.slice(0, 5) === b2.slice(0, 5));

  // ================= Lexique (français + anglais, enseignes courantes) =================
  const CONCEPTS = {
    restaurant: 'bouffe manger resto restos restau restaurant restaurants sushi sushis kebab tacos mcdo mcdonald mcdonalds burger burgerking kfc pizza pizzas pizzeria brasserie dejeuner diner ubereats uber-eats deliveroo justeat cafe cafes starbucks boulangerie sandwich bistrot creperie repas brunch bar apero poke ramen thai indien chinois japonais traiteur snack',
    courses: 'bouffe nourriture courses course supermarche carrefour leclerc lidl auchan intermarche monoprix franprix casino aldi picard biocoop grocery groceries epicerie superu hyper drive primeur marche netto spar cora',
    carburant: 'essence carburant gasoil gazole diesel sp95 sp98 e10 plein station esso bp shell avia fuel gas totalenergies',
    transport: 'transport transports metro bus tram tramway rtm ratp sncf train tgv ouigo navigo ticket tickets taxi bolt heetch trottinette velib velov covoiturage blablacar public uber',
    parking: 'parking parkings stationnement indigo horodateur parcmetre',
    loyer: 'loyer rent appartement appartment apartment logement bail',
    energie: 'edf engie electricite electricity gaz eau energie chauffage facture bill',
    telephone: 'forfait telephone phone mobile free sfr orange bouygues sosh internet box fibre subscription',
    assurance: 'assurance assurances maif macif axa matmut allianz gmf groupama insurance',
    sante: 'pharmacie medecin docteur dentiste orthodontiste mutuelle sante health hopital kine opticien lunettes dental braces medicament ordonnance',
    sport: 'salle gym fitness basicfit sport piscine musculation yoga escalade crossfit',
    loisirs: 'cinema netflix spotify disney deezer canal jeu jeux steam playstation xbox nintendo concert sortie sorties plaisir pleasure loisir loisirs livre livres fnac bowling musee spectacle',
    cadeaux: 'cadeau cadeaux anniversaire gift gifts noel fete',
    voyages: 'voyage voyages hotel airbnb booking avion vol vols ryanair easyjet vacances travel sejour camping valise',
    voiture: 'garage vidange pneu pneus reparation controle technique norauto feuvert midas speedy entretien maintenance car voiture carrosserie lavage peage autoroute',
    amendes: 'amende amendes pv contravention fine fines radar fourriere',
    dettes: 'credit pret debts debt dette dettes echeance mensualite',
    imprevus: 'imprevu imprevus urgence divers',
    vetements: 'vetement vetements zara uniqlo kiabi chaussures habits shopping clothes primark',
    maison: 'ikea leroy merlin castorama bricolage meuble maison deco darty boulanger electromenager',
    parents: 'parents maman papa mere pere famille transaction',
    investissement: 'etf pea bourse investissement investments investment versement cto crypto bitcoin',
    revenu: 'income revenu revenus virement caf apl freelance second',
    salaire: 'salaire salary monthly paycheck',
    remboursement: 'remboursement remboursements rembourse refund refunds',
    prime: 'prime primes bonus'
  };
  const KW = {}; Object.entries(CONCEPTS).forEach(([c, s]) => s.split(' ').forEach(w => { (KW[w] = KW[w] || []).push(c); }));
  const conceptsDe = txt => { const out = {}; tokens(txt).forEach(t => { (KW[t] || []).forEach(c => { out[c] = (out[c] || 0) + 1; }); if (!KW[t]) Object.keys(KW).forEach(w => { if (w.length >= 5 && proche(t, w)) KW[w].forEach(c => { out[c] = (out[c] || 0) + 0.6; }); }); }); return out; };

  // ================= Catégories de l'utilisateur =================
  function lignes(data, k) {
    const m = data.months[k]; if (!m) return [];
    return ['income', 'schedule', 'fixed', 'variable'].flatMap(sec => (m.sections[sec] || []).map(l => ({ l, sec, rev: sec === 'income' || sec === 'schedule' })));
  }
  function categories(data) {
    const vus = new Map();
    monthKeys(data).slice(-4).reverse().forEach(k => lignes(data, k).forEach(({ l, sec, rev }) => { if (!vus.has(l.label)) vus.set(l.label, { label: l.label, sec, rev, role: l.role || null, auto: !!l.auto, concepts: conceptsDe(l.label) }); }));
    return [...vus.values()];
  }
  // Trouve les catégories citées dans une phrase (« restos », « l'essence », « assurances »…)
  function trouverCategories(data, txt, opts) {
    const cats = categories(data).filter(c => opts && opts.rev !== undefined ? c.rev === opts.rev : true), tk = tokens(txt), cc = conceptsDe(txt), res = [];
    cats.forEach(c => {
      let s = 0;
      const lt = tokens(c.label);
      if (norm(txt).includes(norm(c.label))) s += 5;
      lt.forEach(a => tk.forEach(t => { if (proche(a, t)) s += a === t ? 3 : 2; }));
      Object.keys(cc).forEach(k => { if (c.concepts[k]) s += 2.2 * Math.min(1, cc[k]); });
      if (s > 0) res.push({ c, s });
    });
    if (!res.length) return [];
    const max = Math.max(...res.map(x => x.s));
    return res.filter(x => x.s >= max * 0.5 && x.s >= 1.4).sort((a, z) => z.s - a.s).map(x => x.c);
  }

  // ================= Classifieur appris (Bayes naïf + lexique + règles) =================
  let cache = { sig: null, model: null };
  function modele(data) {
    const deps = data.depenses || [], regles = (data.ia && data.ia.regles) || [];
    const sig = deps.length + ':' + (deps.length ? deps[deps.length - 1].id : '') + ':' + regles.length + ':' + monthKeys(data).slice(-1)[0];
    if (cache.sig === sig) return cache.model;
    const cats = categories(data).filter(c => !c.auto), counts = {}, totals = {}, docs = {}, vocab = new Set();
    const add = (cat, toks, w) => { counts[cat] = counts[cat] || {}; toks.forEach(t => { counts[cat][t] = (counts[cat][t] || 0) + w; totals[cat] = (totals[cat] || 0) + w; vocab.add(t); }); };
    cats.forEach(c => {
      docs[c.label] = 0.5;
      add(c.label, tokens(c.label), 4);
      Object.keys(c.concepts).forEach(k => add(c.label, CONCEPTS[k].split(' '), 0.35));
    });
    deps.forEach(d => { if (!counts[d.cat]) return; const t = tokens(d.com); if (t.length) { add(d.cat, t, 1); docs[d.cat] += 1; } else docs[d.cat] += 0.3; });
    (data.abonnements || []).forEach(a => { if (a.categorie && counts[a.categorie]) add(a.categorie, tokens(a.nom), 1.5); });
    const model = { cats, counts, totals, docs, V: vocab.size || 1, N: Object.values(docs).reduce((s, x) => s + x, 0), regles, vocab: [...vocab] };
    cache = { sig, model };
    return model;
  }
  function classer(data, txt, opts) {
    opts = opts || {};
    const M = modele(data), tk = tokens(txt), n = norm(txt);
    const cands = M.cats.filter(c => (opts.rev ? c.rev : !c.rev) && (opts.invest || c.role !== 'invest'));
    if (!cands.length) return [];
    for (const r of M.regles) if (r.motif && n.includes(norm(r.motif)) && cands.some(c => c.label === r.cat)) return [{ cat: r.cat, p: 0.97, regle: true }].concat(cands.filter(c => c.label !== r.cat).slice(0, 2).map(c => ({ cat: c.label, p: 0.01 })));
    const connait = t => M.cats.some(c => (M.counts[c.label] || {})[t]);
    const connus = tk.map(t => connait(t) ? t : (t.length >= 5 ? M.vocab.find(v => v.length >= 5 && proche(v, t)) : null)).filter(Boolean);
    const scores = cands.map(c => {
      const cn = M.counts[c.label] || {}, tot = M.totals[c.label] || 0;
      let s = 0.3 * Math.log((M.docs[c.label] || 0.5) / M.N); // a priori atténué : une catégorie fréquente ne doit pas tout écraser
      connus.forEach(t => { s += Math.log(((cn[t] || 0) + 0.1) / (tot + 0.1 * M.V)); });
      return { cat: c.label, s };
    });
    const mx = Math.max(...scores.map(x => x.s)), ex = scores.map(x => ({ cat: x.cat, e: Math.exp(x.s - mx) })), sum = ex.reduce((s, x) => s + x.e, 0);
    const out = ex.map(x => ({ cat: x.cat, p: connus.length ? x.e / sum : 0 })).sort((a, z) => z.p - a.p);
    // confiance = marge entre les deux premières catégories (plus parlant qu'une probabilité diluée sur 25 catégories)
    if (connus.length && out.length > 1) { const p1 = out[0].p, p2 = out[1].p; out.forEach(x => { x.p = x.p / (p1 + p2); }); }
    if (!connus.length) { const div = cands.find(c => c.concepts.imprevus) || cands.find(c => /divers|autre/i.test(c.label)); if (div) { out.splice(out.findIndex(x => x.cat === div.label), 1); out.unshift({ cat: div.label, p: 0 }); } }
    return out;
  }

  // ================= Nombres, dates, périodes =================
  const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const MOIS_RE = '(janv(?:ier)?|fevr?(?:ier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|aout|sept?(?:embre)?|oct(?:obre)?|nov(?:embre)?|dec(?:embre)?)';
  const MOIS_PREF = [['janv', 0], ['fev', 1], ['mars', 2], ['avr', 3], ['mai', 4], ['juin', 5], ['juil', 6], ['aout', 7], ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11]];
  const moisIdx = s => { s = norm(s); const f = MOIS_PREF.find(([p]) => s.startsWith(p)); return f ? f[1] : -1; };
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MOTS_NB = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100, mille: 1000 };
  const finMois = k => k + '-' + String(daysInMonth(k)).padStart(2, '0');
  const lundi = iso => addDaysIso(iso, -((weekdayIso(iso) + 6) % 7));

  // Retire les morceaux reconnus pour ne pas les relire comme des montants
  function extraireDate(txt, today) {
    let t = ' ' + norm(txt) + ' ', date = null, m;
    const ck = isoToKey(today), ty = Number(today.slice(0, 4));
    const take = (re, fn) => { if (date) return; const r = t.match(re); if (r) { const d = fn(r); if (d) { date = d; t = t.replace(r[0], ' '); } } };
    take(/\bavant[- ]hier\b/, () => addDaysIso(today, -2));
    take(/\bhier\b/, () => addDaysIso(today, -1));
    take(/\baujourd'?hui\b|\bce (?:matin|midi|soir)\b|\btout a l'?heure\b/, () => today);
    take(/\b(?:le |la )?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/, r => { const d = +r[1], mo = +r[2]; let y = r[3] ? +r[3] : ty; if (y < 100) y += 2000; if (mo < 1 || mo > 12 || d < 1 || d > 31) return null; let iso = C.monthKey(y, mo) + '-' + String(Math.min(d, daysInMonth(C.monthKey(y, mo)))).padStart(2, '0'); if (!r[3] && iso > today) iso = (y - 1) + iso.slice(4); return iso; });
    take(new RegExp('\\b(?:le )?(\\d{1,2}|1er) ' + MOIS_RE + '(?: (\\d{4}))?\\b'), r => { const d = parseInt(r[1], 10) || 1, mo = moisIdx(r[2]) + 1; let y = r[3] ? +r[3] : ty; let k = C.monthKey(y, mo), iso = k + '-' + String(Math.min(d, daysInMonth(k))).padStart(2, '0'); if (!r[3] && iso > today) iso = (y - 1) + iso.slice(4); return iso; });
    take(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?: dernier)?\b/, r => { const w = JOURS.indexOf(r[1]); let d = today; for (let i = 0; i < 7; i++) { if (weekdayIso(d) === w) return d; d = addDaysIso(d, -1); } return null; });
    take(/\ble (\d{1,2}|1er)\b(?! ?(?:€|euros?|e\b|derniers?|mois))/, r => { const d = parseInt(r[1], 10) || 1; if (d < 1 || d > 31) return null; let iso = ck + '-' + String(Math.min(d, daysInMonth(ck))).padStart(2, '0'); if (iso > today) { const pk = addMonths(ck, -1); iso = pk + '-' + String(Math.min(d, daysInMonth(pk))).padStart(2, '0'); } return iso; });
    return { date, reste: t.replace(/\s+/g, ' ').trim() };
  }
  function extrairePeriode(txt, today) {
    let t = ' ' + norm(txt) + ' ', per = null;
    const ck = isoToKey(today), ty = Number(today.slice(0, 4));
    const mois = (k, label) => ({ debut: k + '-01', fin: finMois(k), label: label || keyLong(k).toLowerCase(), keys: [k], type: 'mois' });
    const plage = (k1, k2, label) => { const keys = []; for (let k = k1; k <= k2; k = addMonths(k, 1)) keys.push(k); return { debut: k1 + '-01', fin: finMois(k2), label, keys, type: 'mois' }; };
    const take = (re, fn) => { if (per) return; const r = t.match(re); if (r) { const p = fn(r); if (p) { per = p; t = t.replace(r[0], ' '); } } };
    take(new RegExp('\\bentre ' + MOIS_RE + '(?: (\\d{4}))? et ' + MOIS_RE + '(?: (\\d{4}))?'), r => { const y2 = r[4] ? +r[4] : ty, k2 = C.monthKey(y2, moisIdx(r[3]) + 1); let k1 = C.monthKey(r[2] ? +r[2] : y2, moisIdx(r[1]) + 1); if (k1 > k2) k1 = addMonths(k1, -12); return plage(k1, k2, `de ${keyLong(k1).toLowerCase()} à ${keyLong(k2).toLowerCase()}`); });
    take(/\b(?:les |sur les |ces |durant les |pendant les )?(\d{1,2}|deux|trois|quatre|cinq|six|douze) derniers mois\b/, r => { const n = MOTS_NB[r[1]] || +r[1]; return plage(addMonths(ck, -(n - 1)), ck, `les ${n} derniers mois`); });
    take(/\bsur (\d{1,2}|six|douze|trois) mois\b/, r => { const n = MOTS_NB[r[1]] || +r[1]; return plage(addMonths(ck, -(n - 1)), ck, `les ${n} derniers mois`); });
    take(new RegExp('\\bdepuis (?:le debut de |debut )?' + MOIS_RE + '(?: (\\d{4}))?'), r => { let k = C.monthKey(r[2] ? +r[2] : ty, moisIdx(r[1]) + 1); if (k > ck) k = addMonths(k, -12); return plage(k, ck, `depuis ${keyLong(k).toLowerCase()}`); });
    take(/\b(?:depuis le debut de l'?annee|depuis janvier|cette annee|de l'?annee|en (\d{4}))\b/, r => { if (r[1]) { const y = +r[1]; return plage(y + '-01', y === ty ? ck : y + '-12', 'en ' + y); } return plage(ty + '-01', ck, 'cette année'); });
    take(/\b(?:l'?an dernier|l'?annee derniere|l'?annee passee)\b/, () => plage((ty - 1) + '-01', (ty - 1) + '-12', 'l’année dernière'));
    take(/\b(?:le |du |au )?mois (?:dernier|precedent|passe)\b/, () => mois(addMonths(ck, -1), 'le mois dernier'));
    take(/\b(?:ce mois(?:-ci| ci)?|du mois|le mois en cours|ce mois-la)\b/, () => mois(ck, 'ce mois-ci'));
    take(/\bmois prochain\b/, () => mois(addMonths(ck, 1), 'le mois prochain'));
    take(/\bcette semaine\b/, () => ({ debut: lundi(today), fin: today, label: 'cette semaine', type: 'jours' }));
    take(/\b(?:la )?semaine (?:derniere|passee|precedente)\b/, () => { const l = addDaysIso(lundi(today), -7); return { debut: l, fin: addDaysIso(l, 6), label: 'la semaine dernière', type: 'jours' }; });
    take(/\b(?:les )?(\d{1,2}|sept|quinze|trente) derniers jours\b/, r => { const n = MOTS_NB[r[1]] || +r[1]; return { debut: addDaysIso(today, -(n - 1)), fin: today, label: `les ${n} derniers jours`, type: 'jours' }; });
    take(/\baujourd'?hui\b/, () => ({ debut: today, fin: today, label: 'aujourd’hui', type: 'jours' }));
    take(/\bhier\b/, () => { const d = addDaysIso(today, -1); return { debut: d, fin: d, label: 'hier', type: 'jours' }; });
    take(new RegExp('\\b(?:en |au mois de |pour |de |d\')?' + MOIS_RE + '(?: (\\d{4}))?\\b'), r => { let k = C.monthKey(r[2] ? +r[2] : ty, moisIdx(r[1]) + 1); if (!r[2] && k > ck) k = addMonths(k, -12); return mois(k); });
    return { periode: per, reste: t.replace(/\s+/g, ' ').trim() };
  }
  function extraireMontant(txt) {
    const t = ' ' + norm(txt).replace(/(\d)\s+(\d{3})(?!\d)/g, '$1$2') + ' ';
    const re = /([+-])?\s?(\d+(?:[.,]\d{1,2})?)\s?(k€|k\b|€|euros?\b|eur\b|e\b)?/g;
    let m, best = null;
    while ((m = re.exec(t))) {
      const iDig = m.index + m[0].indexOf(m[2]), avant = t[iDig - 1] || ' ';
      if (/[a-z0-9]/.test(avant)) continue;
      let v = parseFloat(m[2].replace(',', '.')); if (/^k/.test(m[3] || '')) v *= 1000;
      const apres = t.slice(m.index + m[0].length, m.index + m[0].length + 12);
      if (/^\s?(derniers?|mois|jours?|ans?|annees?|semaines?|fois|parts?|%|pourcents?)\b/.test(apres)) continue;
      const score = (m[3] ? 3 : 0) + (/[.,]/.test(m[2]) ? 2 : 0) + (m[1] ? 1 : 0);
      if (!best || score > best.score) best = { v: m[1] === '-' ? -v : v, signe: m[1] || '', score, brut: m[0] };
    }
    if (!best) { const w = t.match(/\b(dix|vingt|trente|quarante|cinquante|soixante|cent|mille)\b(?: euros?)/); if (w) best = { v: MOTS_NB[w[1]], signe: '', score: 1, brut: w[0] }; }
    return best;
  }

  // ================= Saisie en une phrase =================
  // « 23,50 sushi avec Léa hier » · « +2190 salaire » · « versé 200 sur l'ETF World » · « essence 60 € le 12 »
  function analyserSaisie(data, phrase, today) {
    today = today || todayISO();
    const brut = String(phrase || '').trim(); if (!brut) return null;
    const d = extraireDate(brut, today), mt = extraireMontant(d.reste);
    const n = norm(brut);
    let type = 'dep';
    if (/\b(verse|versement|investi|investis|placer|place|achete des parts)\b/.test(n) && C.lignesPlan(data.invest.plan).length) type = 'vers';
    else if (mt && mt.signe === '+' || /\b(recu|recois|salaire|ma paie|ma paye|rembourse|remboursement|virement recu|gagne|prime|bonus)\b/.test(n)) type = 'rev';
    let com = d.reste;
    if (mt) com = com.replace(mt.brut.trim(), ' ');
    com = com.replace(/\b(j'?ai |ajoute[rz]? |note[rz]? |depense[rsz]? |paye[rsz]? |achete |pris |verse |recu |de |d'|pour |en |chez |au |a la |aux |sur l'?|sur )/g, ' ').replace(/\s+/g, ' ').trim();
    // garde la casse d'origine pour le commentaire
    const motsOrig = brut.split(/\s+/), motsCom = com.split(' ').filter(Boolean);
    const comOrig = motsOrig.filter(w => motsCom.includes(norm(w).replace(/[^a-z0-9'-]/g, ''))).join(' ').replace(/[€]/g, '').trim();
    const res = { type, montant: mt ? Math.abs(mt.v) : null, date: d.date || today, com: comOrig || com, confiance: 0, suggestions: [] };
    if (type === 'vers') {
      const ls = C.lignesPlan(data.invest.plan), tk = tokens(com);
      const sc = ls.map(l => ({ l, s: tokens(l.nom).reduce((s, a) => s + tk.filter(t => proche(a, t)).length, 0) })).sort((a, z) => z.s - a.s);
      res.ligne = sc[0] && sc[0].s > 0 ? sc[0].l.nom : null; res.suggestions = ls.map(l => l.nom); res.confiance = res.ligne ? 0.9 : 0.3;
      return res;
    }
    const direct = trouverCategories(data, com, { rev: type === 'rev' }).filter(c => !c.auto && c.role !== 'invest');
    const cl = classer(data, com, { rev: type === 'rev' });
    if (direct.length === 1) { res.cat = direct[0].label; res.confiance = 0.92; }
    else if (cl.length && cl[0].p > 0) { res.cat = cl[0].cat; res.confiance = Math.min(0.95, cl[0].p); }
    else { res.cat = (data.ui && data.ui.lastCat) || (cl[0] && cl[0].cat) || null; res.confiance = 0.1; }
    const seuilAlt = res.confiance >= 0.85 ? 0.2 : 0.08;
    res.suggestions = [...new Set([res.cat].concat(direct.map(c => c.label), cl.filter(x => x.p >= seuilAlt).slice(0, 3).map(x => x.cat)))].filter(Boolean).slice(0, 4);
    return res;
  }

  // ================= Données utiles =================
  function sommeMois(data, comp, keys, labels, w) {
    let s = 0; const parMois = [];
    keys.forEach(k => { if (!data.months[k] || !comp[k]) return; let x = 0; lignes(data, k).forEach(({ l }) => { if (labels.includes(l.label)) x += comp[k].lines[l.id][w || 'reel']; }); s += x; parMois.push({ k, v: x }); });
    return { total: s, parMois };
  }
  function journalEntre(data, debut, fin, labels) {
    return (data.depenses || []).filter(d => d.date && d.date >= debut && d.date <= fin && (!labels || labels.includes(d.cat)));
  }
  const moisClos = (data, comp, ck) => monthKeys(data).filter(k => k < ck && comp[k] && comp[k].incR > 0);
  const listeCats = cs => cs.map(c => b(esc(c.label))).join(' et ');
  const barres = (items, opts) => ({ type: 'bars', items: items.filter(x => x.v), max: opts && opts.max });

  // ================= Intentions =================
  const INTENTS = [
    ['peux_je', [/\b(est-ce que je peux|puis-je|je peux|peux-je|ai-je les moyens|j'?ai les moyens|me permettre|m'?offrir|me payer|raisonnable d'?acheter|craquer)\b/], 4],
    ['reste', [/\b(reste|rester|il me reste|combien me reste|reste a vivre|reste a depenser|encore depenser|disponible)\b/], 2.5],
    ['prevision', [/\b(prevision|projection|fin du mois|fin de mois|a la fin du mois|finir le mois|termine le mois|vais finir|je vais finir|rythme)\b/], 3],
    ['comparaison', [/\b(compar\w*|par rapport|vs|versus|evolution|plus que|moins que|augmente|baisse|difference)\b/], 2.6],
    ['moyenne', [/\b(moyenne|en moyenne|habituellement|d'?habitude|normalement|typique)\b/], 2.8],
    ['top', [/\b(ou part|ou va|plus grosses?|plus gros|principales?|top|poste|postes|repartition|le plus|classement)\b/], 2.4],
    ['epargne', [/\b(epargne|epargner|epargnes|economise|economiser|mis de cote|taux d'?epargne)\b/], 2.2],
    ['patrimoine', [/\b(patrimoine|fortune|combien j'?ai en tout|net worth|mes comptes|solde|soldes|livret|compte courant)\b/], 2.3],
    ['portefeuille', [/\b(portefeuille|investissements?|plus-value|plus value|moins-value|etf|bourse|placements?|performance|perf|actions|combien vaut)\b/], 2.3],
    ['pea', [/\b(pea|plafond)\b/], 3],
    ['objectif', [/\b(objectifs?|apport|atteindre|but)\b/], 2.6],
    ['abonnements', [/\b(abonnements?|prelevements?|abos?|souscriptions?)\b/], 3],
    ['recherche', [/\b(quand|derniere fois|dernier achat|cherche|chercher|trouve|retrouve|historique de|liste des|ou est)\b/], 1.8],
    ['conseil', [/\b(trop|conseils?|astuces?|economies|faire des economies|optimiser|ameliorer|reduire|aide-moi|que me conseilles|recommandes?|recommandation|comment (?:faire|economiser|mieux))\b/], 3],
    ['bilan', [/\b(bilan|resume|recap|recapitulatif|situation|comment ca va|ou j'?en suis|point sur|etat des lieux|synthese)\b/], 2.6],
    ['impots', [/\b(impots?|per\b|retraite|tmi|tranche|fiscal\w*)\b/], 2.6],
    ['voyage', [/\b(voyages?|vacances|sejour)\b/], 2],
    ['revenus', [/\b(gagne|gagner|revenus?|salaire|recu|rentrees?|touche)\b/], 2.1],
    ['depenses', [/\b(depense\w*|coute|coutent|claque|paye|budget|frais|sorti)\b/], 1.6],
    ['aide', [/\b(aide|help|que sais-tu|tu sais faire|que peux-tu|qu'?est-ce que tu peux|comment tu marches|exemples?)\b/], 3],
    ['salut', [/^(bonjour|salut|hello|coucou|bonsoir|hey|yo)\b/], 2],
    ['merci', [/^(merci|super|parfait|top merci|genial|cool|ok merci)\b/], 2]
  ];
  function detecterIntention(n) {
    const sc = {};
    INTENTS.forEach(([id, res, w]) => res.forEach(re => { if (re.test(n)) sc[id] = (sc[id] || 0) + w; }));
    if (sc.reste && sc.prevision) sc.reste -= 1;
    if (sc.recherche && /\bquand\b/.test(n) && /\b(atteindre|objectif|apport)\b/.test(n)) delete sc.recherche;
    if (sc.depenses && sc.top) sc.top += 0.5;
    if (sc.portefeuille && sc.pea) sc.pea += 1;
    const best = Object.entries(sc).sort((a, z) => z[1] - a[1])[0];
    return best ? best[0] : null;
  }
  const estQuestion = n => /\?/.test(n) || /^(combien|quel|quelle|quels|quelles|quand|est-ce|est ce|ou |comment|pourquoi|peux|puis|ai-je|suis-je|dois-je|vais-je|montre|affiche|donne|dis|liste|c'?est quoi|qu'?est)/.test(n);

  // ================= Réponses =================
  const SUGG = { base: ['Combien il me reste ce mois-ci ?', 'Où part mon argent ?', 'Donne-moi des conseils', 'Fais-moi un bilan'] };
  function repondre(ctx, question, etat) {
    const data = ctx.data, comp = ctx.comp, today = ctx.today || todayISO(), ck = isoToKey(today);
    etat = etat || {};
    const brut = String(question || '').trim(), n = norm(brut);
    if (!brut) return { html: 'Pose-moi une question sur ton budget ou tes investissements.', suggestions: SUGG.base };
    if (!data.months[ck] && !monthKeys(data).length) return { html: 'Je n’ai pas encore de données : crée ton premier mois dans « Budget du mois ».', suggestions: [] };
    const seed = brut.length;
    // 1. Ajout (« 23,50 sushi hier »)
    const mt = extraireMontant(brut);
    const intention0 = detecterIntention(n);
    const ajout = mt && !estQuestion(n) && !['peux_je', 'objectif', 'pea', 'impots'].includes(intention0) && (/^(ajoute|note|j'?ai (depense|paye|claque|achete|pris|recu|verse)|depense|achat|paye|recu|verse|\+|-)/.test(n) || /^\+?\d/.test(n) || /\d\s?(€|euros?)?\s*$/.test(n) || tokens(brut).length <= 6);
    if (ajout) {
      const s = analyserSaisie(data, brut, today);
      if (s && s.montant) {
        const quoi = s.type === 'vers' ? `un versement de ${b(E2(s.montant))} sur ${b(esc(s.ligne || '?'))}` : s.type === 'rev' ? `un revenu de ${b(E2(s.montant))} dans ${b(esc(s.cat || '?'))}` : `une dépense de ${b(E2(s.montant))} en ${b(esc(s.cat || '?'))}`;
        return {
          html: `Je prépare ${quoi}, le ${isoFr(s.date)}${s.com ? ` · « ${esc(s.com)} »` : ''}.${s.confiance < 0.5 && s.type !== 'vers' ? '<br><span class="dim">Je ne suis pas sûr de la catégorie : choisis la bonne ci-dessous.</span>' : ''}`,
          saisie: s, intent: 'ajout',
          actions: [{ type: 'ajouter', label: 'Ajouter', saisie: s }].concat((s.type === 'vers' ? [] : s.suggestions.filter(c => c !== s.cat).slice(0, 3)).map(c => ({ type: 'ajouter', label: c, saisie: Object.assign({}, s, { cat: c }), secondaire: true }))),
          etat: Object.assign({}, etat, { intent: 'ajout' })
        };
      }
    }
    // 2. Entités
    const pe = extrairePeriode(brut, today), periode = pe.periode;
    let cats = trouverCategories(data, pe.reste).filter(c => !c.auto);
    let intent = detecterIntention(n);
    // Questions de suite : « et le mois dernier ? », « et pour l'essence ? »
    const suite = /^(et|puis|aussi|meme chose|pareil)\b/.test(n) || (!intent && (periode || cats.length) && tokens(brut).length <= 4);
    // seules les questions « chiffrées » se prolongent (un bilan, un conseil ou l'aide ne se répètent pas sur une autre période)
    const PROLONGE = ['depenses', 'revenus', 'moyenne', 'comparaison', 'top', 'epargne', 'reste', 'prevision', 'recherche'];
    if (suite && PROLONGE.includes(etat.intent)) { if (!intent || ['depenses', 'revenus'].includes(intent)) intent = etat.intent; if (!cats.length && etat.cats && !/\b(total|tout|global)\b/.test(n)) cats = etat.cats.map(l => categories(data).find(c => c.label === l)).filter(Boolean); }
    if (['depenses', 'reste', 'peux_je', 'top', 'moyenne', 'comparaison', 'prevision'].includes(intent) && cats.some(c => !c.rev)) cats = cats.filter(c => !c.rev);
    if (!intent && (cats.length || periode)) intent = 'depenses';
    if (intent === 'depenses' && cats.length && cats.every(c => c.rev)) intent = 'revenus';
    if (intent === 'patrimoine' && /\bsolde\b/.test(n) && cats.length && !/(compte|livret)/.test(n)) intent = 'depenses';
    const per = periode || (suite && etat.periode) || null;
    const nouvelEtat = { intent, cats: cats.map(c => c.label), periode: per };
    const H = HANDLERS[intent] || HANDLERS.inconnu;
    const r = H({ data, comp, today, ck, n, brut, cats, per, mt, seed, market: ctx.market });
    r.intent = intent || 'inconnu'; r.etat = nouvelEtat;
    if (!r.suggestions) r.suggestions = SUGG.base;
    return r;
  }

  function periodeOuMois(per, ck) { return per || { debut: ck + '-01', fin: finMois(ck), label: 'ce mois-ci', keys: [ck], type: 'mois' }; }
  function moisDe(data, per) { return (per.keys || []).filter(k => data.months[k]); }

  const HANDLERS = {
    depenses(x) {
      const { data, comp, ck, cats } = x, per = periodeOuMois(x.per, ck);
      if (per.type === 'jours') {
        const labels = cats.length ? cats.map(c => c.label) : null, its = journalEntre(data, per.debut, per.fin, labels).filter(d => num(d.montant) > 0);
        const tot = its.reduce((s, d) => s + num(d.montant), 0);
        const parCat = {}; its.forEach(d => { parCat[d.cat] = (parCat[d.cat] || 0) + num(d.montant); });
        return { html: its.length ? `${per.label[0].toUpperCase() + per.label.slice(1)}, tu as dépensé ${b(E2(tot))}${cats.length ? ' en ' + listeCats(cats) : ''} (${its.length} achat${its.length > 1 ? 's' : ''} saisi${its.length > 1 ? 's' : ''}).` : `Aucune dépense datée ${per.label}${cats.length ? ' en ' + listeCats(cats) : ''}.<br><span class="dim">Les montants tapés directement dans les cases du mois n’ont pas de date : je ne compte ici que le journal.</span>`,
          chart: !cats.length && its.length ? barres(Object.entries(parCat).sort((a, z) => z[1] - a[1]).slice(0, 6).map(([l, v]) => ({ l, v }))) : null,
          liste: its.sort((a, z) => z.date.localeCompare(a.date)).slice(0, 8).map(d => ({ d: d.date, l: d.cat + (d.com ? ' · ' + d.com : ''), v: num(d.montant) })), suggestions: ['Et la semaine dernière ?', 'Où part mon argent ?'] };
      }
      const keys = moisDe(data, per);
      if (!keys.length) return { html: `Je n’ai pas de mois enregistré pour ${per.label}.`, suggestions: ['Combien j’ai dépensé ce mois-ci ?'] };
      if (cats.length) {
        const labels = cats.map(c => c.label), r = sommeMois(data, comp, keys, labels, 'reel'), p = sommeMois(data, comp, keys, labels, 'prevu');
        let html = `${per.label[0].toUpperCase() + per.label.slice(1)}, tu as dépensé ${b(E2(r.total))} en ${listeCats(cats)}`;
        html += p.total ? ` pour ${E(p.total)} prévus (${P(r.total / p.total)}).` : '.';
        if (keys.length === 1 && keys[0] === ck) {
          const pv = C.prevision(data, comp, ck, x.today), ls = pv ? pv.lines.filter(l => labels.includes(l.label)) : [];
          const proj = ls.reduce((s, l) => s + l.proj, 0), reste = p.total - r.total;
          if (reste > 0.5) html += `<br>Il te reste ${b(E(reste))} sur ce poste${pv && pv.joursRestants ? `, soit ${E(reste / pv.joursRestants)} par jour` : ''}.`;
          else if (reste < -0.5) html += `<br><span class="neg">Dépassement de ${E(-reste)}.</span>`;
          if (ls.some(l => l.mode === 'rythme') && pv.joursRestants) html += `<br>À ton rythme, tu finiras vers ${b(E(proj))}.`;
          const h = moisClos(data, comp, ck).slice(-3), moy = h.length ? sommeMois(data, comp, h, labels).total / h.length : null;
          if (moy) html += `<br><span class="dim">Ta moyenne sur ${h.length} mois : ${E(moy)}.</span>`;
        }
        return { html, chart: keys.length > 1 ? barres(r.parMois.map(m => ({ l: C.MOIS_COURT ? C.MOIS_COURT[keyParts(m.k).m - 1] : m.k, v: m.v }))) : null, suggestions: ['Et le mois dernier ?', `En moyenne combien en ${cats[0].label} ?`, 'Où part mon argent ?'] };
      }
      const tot = keys.reduce((s, k) => s + comp[k].expR, 0), cour = keys.reduce((s, k) => s + comp[k].courR, 0), prev = keys.reduce((s, k) => s + comp[k].expP, 0);
      const parCat = {}; keys.forEach(k => lignes(data, k).filter(z => !z.rev && !z.l.role).forEach(({ l }) => { parCat[l.label] = (parCat[l.label] || 0) + comp[k].lines[l.id].reel; }));
      const top = Object.entries(parCat).filter(z => z[1] > 0).sort((a, z) => z[1] - a[1]).slice(0, 6);
      return { html: `${per.label[0].toUpperCase() + per.label.slice(1)}, tu as dépensé ${b(E2(tot))} au total${prev ? ` (${P(tot / prev)} du prévu)` : ''}, dont ${b(E(cour))} de dépenses courantes (hors parents et investissement).${top.length ? `<br>Premier poste : ${b(esc(top[0][0]))} avec ${E(top[0][1])}.` : ''}`,
        chart: barres(top.map(([l, v]) => ({ l, v }))), suggestions: ['Et le mois dernier ?', 'Compare avec le mois dernier', 'Combien en restaurants ?'] };
    },
    revenus(x) {
      const { data, comp, ck, cats } = x, per = periodeOuMois(x.per, ck), keys = moisDe(data, per);
      if (!keys.length) return { html: `Je n’ai pas de mois enregistré pour ${per.label}.` };
      if (cats.length && cats.some(c => c.rev)) { const cs = cats.filter(c => c.rev), r = sommeMois(data, comp, keys, cs.map(c => c.label)); return { html: `${per.label[0].toUpperCase() + per.label.slice(1)}, ${listeCats(cs)} : ${b(E2(r.total))}.` }; }
      const inc = keys.reduce((s, k) => s + comp[k].incR, 0), incP = keys.reduce((s, k) => s + comp[k].incP, 0);
      const parL = {}; keys.forEach(k => lignes(data, k).filter(z => z.rev).forEach(({ l }) => { parL[l.label] = (parL[l.label] || 0) + comp[k].lines[l.id].reel; }));
      return { html: `${per.label[0].toUpperCase() + per.label.slice(1)}, tes revenus font ${b(E2(inc))}${incP ? ` (prévu ${E(incP)})` : ''}.`, chart: barres(Object.entries(parL).sort((a, z) => z[1] - a[1]).map(([l, v]) => ({ l, v }))), suggestions: ['Quel est mon taux d’épargne ?', 'Combien j’ai dépensé ce mois-ci ?'] };
    },
    reste(x) {
      const { data, comp, ck, cats } = x, r = comp[ck];
      if (!r) return { html: 'Le mois en cours n’existe pas encore.' };
      const pv = C.prevision(data, comp, ck, x.today);
      if (cats.length) {
        const labels = cats.map(c => c.label), re = sommeMois(data, comp, [ck], labels).total, p = sommeMois(data, comp, [ck], labels, 'prevu').total, reste = p - re;
        return { html: reste >= 0 ? `Pour ${listeCats(cats)}, il te reste ${b(E2(reste))} sur ${E(p)} prévus${pv && pv.joursRestants ? `, soit ${b(E(reste / pv.joursRestants))} par jour jusqu’à la fin du mois` : ''}.` : `Pour ${listeCats(cats)}, tu as déjà dépassé de ${b(E2(-reste))} (${E(re)} pour ${E(p)} prévus).`, suggestions: ['Combien il me reste au total ?', 'Où part mon argent ?'] };
      }
      let html = `Il te reste ${b(E(r.remR))} ce mois-ci (prévu : ${E(r.remP)}).`;
      if (pv && pv.joursRestants) html += `<br>Budget variable encore disponible : ${b(E(pv.budgetRestant))}, soit ${b(E(pv.parJour))} par jour pendant ${pv.joursRestants} jour${pv.joursRestants > 1 ? 's' : ''}.<br>À ton rythme, tu finiras le mois à ${b(E(pv.finProjetee))} (${pv.ecart >= 0 ? '+' : ''}${E(pv.ecart)} vs prévu).`;
      return { html, suggestions: ['Est-ce que je peux dépenser 100 € ?', 'Quelles catégories vont dépasser ?', 'Donne-moi des conseils'] };
    },
    prevision(x) {
      const { data, comp, ck } = x, pv = C.prevision(data, comp, ck, x.today);
      if (!pv) return { html: 'Le mois en cours n’existe pas encore : crée-le pour obtenir une prévision.' };
      let html = `À ton rythme actuel, tu termineras ${keyLong(ck).toLowerCase()} avec ${b(E(pv.finProjetee))}, soit ${pv.ecart >= 0 ? `<span class="pos">${E(pv.ecart)} de mieux</span>` : `<span class="neg">${E(-pv.ecart)} de moins</span>`} que prévu.`;
      if (pv.risques.length) html += `<br>À surveiller : ${pv.risques.slice(0, 3).map(l => `${b(esc(l.label))} (~${E(l.proj)} pour ${E(l.prevu)})`).join(', ')}.`;
      else html += '<br>Aucune catégorie ne devrait dépasser son budget. 👍';
      html += `<br><span class="dim">Prévision fiable à ${P(pv.confiance)} (jour ${pv.day} sur ${pv.dim}).</span>`;
      return { html, chart: barres(pv.lines.filter(l => l.sec === 'variable' && !l.role && l.proj > 0).sort((a, z) => z.proj - a.proj).slice(0, 6).map(l => ({ l: l.label, v: l.proj, ref: l.prevu }))), suggestions: ['Combien il me reste ?', 'Donne-moi des conseils'] };
    },
    peux_je(x) {
      const { data, comp, ck, cats } = x, montant = x.mt ? Math.abs(x.mt.v) : null, r = comp[ck];
      if (!montant) return { html: 'Dis-moi le montant, par exemple : « Est-ce que je peux dépenser 150 € en restaurant ? »' };
      if (!r) return { html: 'Le mois en cours n’existe pas encore.' };
      const pv = C.prevision(data, comp, ck, x.today), seuil = num(data.settings.seuilReste), apres = (pv ? pv.finProjetee : r.remR) - montant;
      const pc = C.precaution(data, comp, x.today);
      let budgetCat = null;
      // on ne juge sur le budget d'une catégorie que si elle en a un (sinon : budget variable du mois)
      if (cats.length) { const labels = cats.map(c => c.label), prevu = sommeMois(data, comp, [ck], labels, 'prevu').total; if (prevu > 0) budgetCat = prevu - sommeMois(data, comp, [ck], labels).total; }
      const dispo = budgetCat !== null ? budgetCat : (pv ? pv.budgetRestant : 0);
      let verdict, ton;
      if (montant <= dispo) { verdict = `Oui ✅ ${b(E(montant))} rentrent dans ${budgetCat !== null ? `ton budget ${listeCats(cats)} (il reste ${E(budgetCat)})` : `ton budget variable restant (${E(dispo)})`}.`; ton = 'pos'; }
      else if (apres >= seuil) { verdict = `C’est possible, mais ⚠️ ça dépasse ${budgetCat !== null ? `ton budget ${listeCats(cats)} de ${E(montant - Math.max(0, dispo))}` : `ton budget variable de ${E(montant - Math.max(0, dispo))}`}. Ton mois resterait positif : ${b(E(apres))} en fin de mois.`; ton = 'warn'; }
      else { verdict = `Plutôt non ❌ Après cet achat, tu finirais le mois à ${b(E(apres))}, sous ton seuil de sécurité (${E(seuil)}).`; ton = 'neg'; }
      let html = verdict;
      if (ton !== 'pos') html += pc.couverture >= num(data.settings.moisPrecaution) ? `<br>Ton épargne de précaution (${C.fmtNum(pc.couverture, 1)} mois) pourrait absorber l’achat, mais elle est faite pour les imprévus.` : `<br>Ton épargne de précaution ne couvre que ${C.fmtNum(pc.couverture, 1)} mois sur ${data.settings.moisPrecaution} visés : si ce n’est pas urgent, attends le mois prochain.`;
      return { html, ton, suggestions: ['Combien il me reste ?', 'Donne-moi des conseils'] };
    },
    top(x) {
      const { data, comp, ck } = x, per = periodeOuMois(x.per, ck), keys = moisDe(data, per);
      if (!keys.length) return { html: `Pas de données pour ${per.label}.` };
      const parCat = {}; keys.forEach(k => lignes(data, k).filter(z => !z.rev && z.l.role !== 'invest').forEach(({ l }) => { parCat[l.label] = (parCat[l.label] || 0) + comp[k].lines[l.id].reel; }));
      const tot = Object.values(parCat).reduce((s, v) => s + v, 0), top = Object.entries(parCat).filter(z => z[1] > 0).sort((a, z) => z[1] - a[1]);
      if (!top.length) return { html: `Aucune dépense ${per.label}.` };
      return { html: `${per.label[0].toUpperCase() + per.label.slice(1)} (hors investissement), ton argent part d’abord en ${b(esc(top[0][0]))} (${P(top[0][1] / tot)}), puis ${top.slice(1, 3).map(([l, v]) => `${b(esc(l))} (${P(v / tot)})`).join(' et ')}.`, chart: barres(top.slice(0, 8).map(([l, v]) => ({ l, v }))), suggestions: ['Compare avec le mois dernier', 'Donne-moi des conseils'] };
    },
    comparaison(x) {
      const { data, comp, ck, cats } = x;
      const a = x.per && x.per.keys && x.per.keys.length === 1 && x.per.label !== 'le mois dernier' ? x.per.keys[0] : ck, bk = addMonths(a, -1);
      if (!data.months[a] || !data.months[bk]) return { html: `Il me faut ${keyLong(a).toLowerCase()} et ${keyLong(bk).toLowerCase()} pour comparer.` };
      if (cats.length) {
        const labels = cats.map(c => c.label), va = sommeMois(data, comp, [a], labels).total, vb = sommeMois(data, comp, [bk], labels).total;
        return { html: `${listeCats(cats)} : ${b(E(va))} en ${keyLong(a).toLowerCase()} contre ${E(vb)} en ${keyLong(bk).toLowerCase()} (${va >= vb ? '<span class="neg">+' : '<span class="pos">'}${E(va - vb)}</span>).`, chart: barres([{ l: keyLong(bk), v: vb }, { l: keyLong(a), v: va }]) };
      }
      const ra = comp[a], rb = comp[bk], diff = {};
      lignes(data, a).filter(z => !z.rev && !z.l.role).forEach(({ l }) => { diff[l.label] = (diff[l.label] || 0) + comp[a].lines[l.id].reel; });
      lignes(data, bk).filter(z => !z.rev && !z.l.role).forEach(({ l }) => { diff[l.label] = (diff[l.label] || 0) - comp[bk].lines[l.id].reel; });
      const hausses = Object.entries(diff).filter(z => z[1] > 1).sort((p, q) => q[1] - p[1]).slice(0, 3), baisses = Object.entries(diff).filter(z => z[1] < -1).sort((p, q) => p[1] - q[1]).slice(0, 3);
      const enCours = a === ck ? ' <span class="dim">(le mois en cours n’est pas terminé)</span>' : '';
      return { html: `Dépenses courantes : ${b(E(ra.courR))} en ${keyLong(a).toLowerCase()} contre ${E(rb.courR)} en ${keyLong(bk).toLowerCase()} (${ra.courR >= rb.courR ? '<span class="neg">+' : '<span class="pos">'}${E(ra.courR - rb.courR)}</span>).${enCours}${hausses.length ? `<br>En hausse : ${hausses.map(([l, v]) => `${esc(l)} +${E(v)}`).join(', ')}.` : ''}${baisses.length ? `<br>En baisse : ${baisses.map(([l, v]) => `${esc(l)} −${E(-v)}`).join(', ')}.` : ''}`,
        chart: barres([{ l: keyLong(bk), v: rb.courR }, { l: keyLong(a), v: ra.courR }]) };
    },
    moyenne(x) {
      const { data, comp, ck, cats } = x, h = (x.per ? moisDe(data, x.per).filter(k => k < ck) : moisClos(data, comp, ck)).slice(-6);
      if (!h.length) return { html: 'Il me faut au moins un mois terminé pour calculer une moyenne.' };
      if (cats.length) { const r = sommeMois(data, comp, h, cats.map(c => c.label)); return { html: `En moyenne, tu dépenses ${b(E(r.total / h.length))} par mois en ${listeCats(cats)} (sur ${h.length} mois).`, chart: barres(r.parMois.map(m => ({ l: keyLong(m.k), v: m.v }))) }; }
      const moy = h.reduce((s, k) => s + comp[k].expR, 0) / h.length, cour = h.reduce((s, k) => s + comp[k].courR, 0) / h.length, inc = h.reduce((s, k) => s + comp[k].incR, 0) / h.length;
      return { html: `Sur ${h.length} mois : revenus moyens ${b(E(inc))}, dépenses ${b(E(moy))} dont ${E(cour)} de dépenses courantes.` };
    },
    epargne(x) {
      const { data, comp, ck } = x, r = comp[ck], h = moisClos(data, comp, ck).slice(-3), cible = num(data.settings.cibleEpargne);
      if (!r) return { html: 'Le mois en cours n’existe pas encore.' };
      const moy = h.length ? h.reduce((s, k) => s + comp[k].tauxEpargneR, 0) / h.length : null, epa = h.length ? h.reduce((s, k) => s + comp[k].incR - comp[k].horsInvR, 0) / h.length : null;
      const pc = C.precaution(data, comp, x.today);
      return { html: `Ce mois-ci, tu investis ${b(P(r.tauxEpargneR))} de tes revenus (${E(r.investR)}), pour une cible de ${P(cible)}.${moy !== null ? `<br>Moyenne sur ${h.length} mois : ${P(moy)} · capacité d’épargne réelle ${b(E(epa))} par mois.` : ''}<br>Épargne de précaution : ${C.fmtNum(pc.couverture, 1)} mois de dépenses sur ${data.settings.moisPrecaution} visés${pc.manque > 0 ? ` (il manque ${E(pc.manque)})` : ' ✅'}.`, suggestions: ['Donne-moi des conseils', 'Où en sont mes objectifs ?'] };
    },
    patrimoine(x) {
      const { data, n } = x, pat = C.patrimoine(data, x.today), cs = pat.comptes;
      const vise = cs.filter(z => tokens(z.c.nom).some(t => tokens(n).some(u => proche(t, u))));
      if (vise.length === 1) { const z = vise[0]; return { html: z.solde === null ? `Je n’ai pas encore de solde pour ${b(esc(z.c.nom))}.` : `${b(esc(z.c.nom))} : ${b(E2(z.valeur))} (relevé du ${isoFr(z.date)}).` }; }
      if (!cs.length && !pat.pfVal) return { html: 'Ajoute tes comptes dans « Comptes & patrimoine » pour que je puisse calculer ton patrimoine.' };
      return { html: `Ton patrimoine net est de ${b(E(pat.total))}${pat.pfOn && pat.pfVal ? `, dont ${E(pat.pfVal)} de portefeuille` : ''}.`, chart: barres(cs.filter(z => z.valeur).map(z => ({ l: z.c.nom, v: z.valeur })).concat(pat.pfVal ? [{ l: 'Portefeuille', v: pat.pfVal }] : [])), suggestions: ['Comment va mon portefeuille ?', 'Où en sont mes objectifs ?'] };
    },
    portefeuille(x) {
      const { data } = x, pf = C.portefeuille(data.invest, x.today);
      if (!pf.rows.length) return { html: 'Ton plan d’investissement n’a pas encore de lignes.' };
      const html = pf.valeur && !(pf.verse > 0) ? `Ton portefeuille vaut ${b(E(pf.valeur))}. <span class="dim">Saisis tes versements (journal des versements) pour suivre ta plus-value.</span>` : pf.valeur ? `Ton portefeuille vaut ${b(E(pf.valeur))} pour ${E(pf.verse)} versés : ${pf.pv >= 0 ? `<span class="pos">+${E(pf.pv)}</span>` : `<span class="neg">${E(pf.pv)}</span>`}${pf.perf !== null ? ` (${C.fmtPct(pf.perf, 1)})` : ''}.${data.invest.dateValo ? ` <span class="dim">Valorisé le ${isoFr(data.invest.dateValo)}.</span>` : ''}` : `Tu as versé ${b(E(pf.verse))}. Mets à jour les valeurs (ou associe tes ETF dans Marchés) pour connaître la plus-value.`;
      const ecart = pf.rows.filter(r => r.ecartPts !== null && Math.abs(r.ecartPts) > 5);
      return { html: html + (ecart.length ? `<br>À rééquilibrer : ${ecart.map(r => `${esc(r.nom)} ${r.ecartPts > 0 ? '+' : ''}${C.fmtNum(r.ecartPts, 1)} pt`).join(', ')}. Ce mois-ci, mets plutôt ${pf.rows.filter(r => r.conseil > 0.5).map(r => `${E(r.conseil)} sur ${esc(r.nom)}`).join(', ')}.` : ''), chart: barres(pf.rows.map(r => ({ l: r.nom, v: r.val === null ? r.verse : r.val }))), suggestions: ['Où en est mon PEA ?', 'Quel est mon taux d’épargne ?'] };
    },
    pea(x) {
      const p = C.peaEtat(x.data);
      if (!p.lignes.length) return { html: 'Aucune ligne de ton plan n’est rattachée au PEA.' };
      return { html: `Tu as versé ${b(E(p.verse))} sur ton PEA, soit ${b(C.fmtPct(p.verse / p.plafond, 1))} du plafond de ${E(p.plafond)}. Il te reste ${E(Math.max(0, p.plafond - p.verse))} de versements possibles.` };
    },
    objectif(x) {
      const { data, n } = x, objs = data.objectifs || [];
      if (!objs.length) return { html: 'Tu n’as pas encore d’objectif. Crée-en un dans Comptes & patrimoine › Objectifs (apport, voiture, voyage…).' };
      const vise = objs.filter(o => tokens(o.nom).some(t => tokens(n).some(u => proche(t, u))));
      const liste = (vise.length ? vise : objs).map(o => {
        const pr = C.objectifProjection(data, o, x.today), e = pr.etat;
        if (e.pct >= 1) return `${esc(o.emoji || '🎯')} ${b(esc(o.nom))} : atteint 🎉`;
        return `${esc(o.emoji || '🎯')} ${b(esc(o.nom))} : ${E(e.actuel)} / ${E(e.cible)} (${P(e.pct)})${pr.date ? `, atteint en ${keyLong(pr.date).toLowerCase()} au rythme de ${E(pr.rythme)}/mois${pr.avance !== null ? (pr.avance >= 0 ? ` <span class="pos">(${pr.avance} mois d’avance)</span>` : ` <span class="warn">(${-pr.avance} mois de retard : il faudrait ${E(pr.besoin)}/mois)</span>`) : ''}` : e.parMois ? `, il faut mettre ${E(e.parMois)}/mois` : ''}.`;
      });
      return { html: liste.join('<br>'), suggestions: ['Quel est mon taux d’épargne ?', 'Donne-moi des conseils'] };
    },
    abonnements(x) {
      const ab = C.abonnementsResume(x.data, 30), list = (x.data.abonnements || []).filter(a => a.actif !== false);
      if (!list.length) return { html: 'Tu n’as pas encore d’abonnement enregistré. Va dans « Analyses › Points d’attention » : je repère ceux qui reviennent chaque mois.' };
      const cher = list.slice().sort((a, z) => num(z.montant) * (C.FREQ[z.frequence] || C.FREQ.mensuel).m - num(a.montant) * (C.FREQ[a.frequence] || C.FREQ.mensuel).m);
      return { html: `Tes ${list.length} abonnements coûtent ${b(E(ab.mensuel))} par mois, soit ${b(E(ab.annuel))} par an.${ab.prochains.length ? `<br>Prochain : ${b(esc(ab.prochains[0].a.nom))} le ${isoFr(ab.prochains[0].date)} (${E2(ab.prochains[0].a.montant)}).` : ''}`, chart: barres(cher.slice(0, 6).map(a => ({ l: a.nom, v: num(a.montant) * (C.FREQ[a.frequence] || C.FREQ.mensuel).m }))) };
    },
    recherche(x) {
      const { data, brut, cats } = x;
      const mots = tokens(brut).filter(t => !/^(quand|derniere|dernier|fois|paye|payer|achete|cherche|chercher|trouve|retrouve|liste|historique|depense|depenses|achat|achats)$/.test(t));
      let its = (data.depenses || []).filter(d => { const tx = tokens(d.cat + ' ' + (d.com || '')); return mots.length && mots.every(m => tx.some(t => proche(t, m))); });
      if (!its.length && cats.length) its = (data.depenses || []).filter(d => cats.some(c => c.label === d.cat));
      its = its.sort((a, z) => (z.date || '').localeCompare(a.date || ''));
      if (!its.length) return { html: `Je ne trouve rien pour « ${esc(mots.join(' ') || brut)} » dans ton journal.`, suggestions: ['Combien j’ai dépensé ce mois-ci ?'] };
      const tot = its.reduce((s, d) => s + num(d.montant), 0);
      return { html: `Dernière fois : ${b(isoFr(its[0].date))} · ${esc(its[0].cat)}${its[0].com ? ' · ' + esc(its[0].com) : ''} · ${b(E2(its[0].montant))}.${its.length > 1 ? `<br>${its.length} opérations trouvées pour ${E2(tot)} au total.` : ''}`, liste: its.slice(0, 8).map(d => ({ d: d.date, l: d.cat + (d.com ? ' · ' + d.com : ''), v: num(d.montant) })) };
    },
    conseil(x) {
      const tips = conseils(x.data, x.comp, x.today);
      if (!tips.length) return { html: 'Tout est sous contrôle : budget respecté, épargne au niveau. Continue comme ça 👏' };
      return { html: 'Voici ce que je ferais à ta place :<br>' + tips.map((t, i) => `${i + 1}. ${t.html}`).join('<br>'), suggestions: ['Fais-moi un bilan', 'Où part mon argent ?'] };
    },
    bilan(x) { return { html: bilan(x.data, x.comp, x.today).html, suggestions: ['Donne-moi des conseils', 'Où part mon argent ?', 'Combien il me reste ?'] }; },
    impots(x) {
      const f = x.data.fiscal; if (!f || !f.scenarios || !f.scenarios.length) return { html: 'Renseigne ton salaire dans Simulateurs › Impôts & salaire.' };
      const s = C.scenarioSalaire(f, f.scenarios[0]), per = C.per(f, { revenu: s.ri, versement: 1000 }, x.today);
      return { html: `D’après ton scénario « ${esc(f.scenarios[0].nom)} », ton impôt annuel serait d’environ ${b(E(s.ir.net))} (tranche marginale ${P(s.ir.tmi)}, taux moyen ${C.fmtPct(s.ir.tauxMoyen, 1)}).<br>Un versement PER de 1 000 € te ferait économiser environ ${b(E(per.eco))} d’impôt${s.ir.tmi <= 0.11 ? ' : avec une tranche à 11 %, le PEA reste plus souple' : ''}.` };
    },
    voyage(x) {
      const vs = (x.data.voyages || []).map(v => ({ v, e: C.voyageEtat(v) })).filter(z => z.e.statut === 'avenir' || z.e.statut === 'encours').sort((a, z) => (a.v.debut || '').localeCompare(z.v.debut || ''));
      if (!vs.length) return { html: 'Aucun voyage à venir. Tu peux en préparer un dans la page Voyages (budget par poste, planning, checklist).' };
      const z = vs[0];
      return { html: `${esc(z.v.emoji || '✈️')} ${b(esc(z.v.nom))} ${z.e.statut === 'encours' ? 'est en cours' : `dans ${z.e.dans} jour${z.e.dans > 1 ? 's' : ''}`} : ${E(z.e.reel)} dépensés sur ${E(z.e.budget)} de budget (${P(z.e.pctBudget)}).` };
    },
    aide() {
      return { html: 'Je calcule tout sur ton appareil, avec tes vraies données. Tu peux me demander par exemple :<br>• « Combien j’ai dépensé en restos ce mois-ci ? »<br>• « Est-ce que je peux m’offrir un truc à 200 € ? »<br>• « Compare avec le mois dernier » · « Où part mon argent ? »<br>• « Où en sont mes objectifs ? » · « Comment va mon portefeuille ? »<br>• « Quand ai-je payé Netflix ? » · « Donne-moi des conseils »<br>Et pour ajouter une dépense, écris-la simplement : « 23,50 sushi hier ».', suggestions: ['Fais-moi un bilan', 'Combien il me reste ?', '12,90 kebab'] };
    },
    salut(x) { const h = new Date().getHours(), p = x.data.settings.prenom; return { html: `${h < 18 ? 'Bonjour' : 'Bonsoir'}${p ? ' ' + esc(p) : ''} 👋 ${bilan(x.data, x.comp, x.today).court}`, suggestions: ['Fais-moi un bilan', 'Combien il me reste ?', 'Donne-moi des conseils'] }; },
    merci(x) { return { html: pick(['Avec plaisir 🙂', 'Toujours là pour ça !', 'De rien, bonne gestion 💪'], x.seed) }; },
    inconnu(x) {
      const r = HANDLERS.recherche(x);
      if (!/Je ne trouve rien/.test(r.html)) return { html: 'Voici ce que j’ai trouvé dans ton journal :<br>' + r.html, liste: r.liste };
      return { html: 'Je n’ai pas bien compris 🤔 Essaie par exemple « combien j’ai dépensé en courses ce mois-ci ? », « où part mon argent ? » ou écris une dépense comme « 15 € parking ».', suggestions: SUGG.base.concat(['Que sais-tu faire ?']) };
    }
  };
  HANDLERS.depense = HANDLERS.depenses;

  // ================= Conseils personnalisés =================
  function conseils(data, comp, today) {
    today = today || todayISO();
    const ck = isoToKey(today), tips = [], h = moisClos(data, comp, ck).slice(-3), r = comp[ck];
    const fv10 = m => { const t = 0.06 / 12; return m * 12 * 0 + m * ((Math.pow(1 + t, 120) - 1) / t); };
    // 1. Catégories variables compressibles
    if (data.months[ck]) {
      const pv = C.prevision(data, comp, ck, today);
      const cand = lignes(data, ck).filter(z => z.sec === 'variable' && !z.l.role).map(({ l }) => {
        const moy = h.length ? sommeMois(data, comp, h, [l.label]).total / h.length : 0, proj = pv ? (pv.lines.find(x => x.id === l.id) || {}).proj || 0 : 0;
        const nbMois = h.filter(k => sommeMois(data, comp, [k], [l.label]).total > 0).length, frequent = C.nbAchats(l.reel) >= 3 || nbMois >= 2 || (data.depenses || []).filter(d => d.cat === l.label && d.date >= addDaysIso(today, -60)).length >= 4;
        return { label: l.label, ref: Math.max(moy, proj), frequent };
      }).filter(z => z.frequent && z.ref >= 60 && !/voyage|travel|imprevu/i.test(norm(z.label))).sort((a, z) => z.ref - a.ref).slice(0, 2);
      cand.forEach(z => { const eco = round2(z.ref * 0.2); tips.push({ impact: eco * 12, html: `Réduis ${b(esc(z.label))} de 20 % (≈ ${E(eco)} par mois sur ${E(z.ref)}) : ${b(E(eco * 12))} par an, soit environ ${E(fv10(eco))} dans 10 ans si tu les investis à 6 %.` }); });
      if (pv) pv.risques.slice(0, 1).forEach(l => tips.push({ impact: (l.proj - l.prevu) * 12, html: `${b(esc(l.label))} va dépasser son budget ce mois-ci (~${E(l.proj)} pour ${E(l.prevu)}) : lève le pied jusqu’au ${isoFr(C.addDaysIso(ck + '-01', pv.dim - 1))}.` }));
    }
    // 2. Abonnements
    const ab = C.abonnementsResume(data, 30);
    if (ab.annuel >= 200) tips.push({ impact: ab.annuel * 0.25, html: `Tes abonnements coûtent ${b(E(ab.annuel))} par an : fais le tri, en supprimer un quart rapporterait ${E(ab.annuel * 0.25)} par an.` });
    // 3. Taux d'épargne
    const cible = num(data.settings.cibleEpargne);
    if (r && r.incR && r.tauxEpargneR < cible) { const manque = (cible - r.tauxEpargneR) * r.incR; tips.push({ impact: manque * 12, html: `Ton taux d’épargne (${P(r.tauxEpargneR)}) est sous ta cible de ${P(cible)} : il manque ${b(E(manque))} par mois. Programme un virement automatique le jour de la paie.` }); }
    // 4. Précaution
    const pc = C.precaution(data, comp, today);
    if (pc.manque > 0 && pc.moyenne > 0) tips.push({ impact: pc.manque * 0.5, html: `Ton épargne de précaution couvre ${C.fmtNum(pc.couverture, 1)} mois sur ${data.settings.moisPrecaution} : complète-la de ${b(E(pc.manque))} (par exemple ${E(pc.manque / 6)} par mois pendant 6 mois) avant d’augmenter tes investissements risqués.` });
    // 5. Objectifs en retard
    (data.objectifs || []).forEach(o => { const pr = C.objectifProjection(data, o, today); if (pr.avance !== null && pr.avance < 0 && pr.manque) tips.push({ impact: pr.manque * 12, html: `Pour ${b(esc(o.nom))}, tu as ${-pr.avance} mois de retard : passe de ${E(pr.rythme)} à ${b(E(pr.besoin))} par mois pour tenir l’échéance du ${isoFr(o.echeance)}.` }); });
    // 6. Enveloppes
    const ls = C.lignesPlan(data.invest.plan), pea = C.peaEtat(data);
    if (ls.some(l => /cto/i.test(l.env || '')) && pea.lignes.length && pea.verse < pea.plafond * 0.9) tips.push({ impact: 50, html: `Tu as des lignes sur CTO alors que ton PEA n’est pas plein : tant que c’est possible, privilégie le PEA (pas d’impôt sur les plus-values après 5 ans, seulement les prélèvements sociaux).` });
    // 7. Charges fixes en hausse
    const pa = C.pointsAttention(data, comp, today).items.filter(i => /^hausse|^aboh/.test(i.key)).slice(0, 1);
    pa.forEach(i => tips.push({ impact: 30, html: i.titre.replace(/<\/?b>/g, s => s) + ' : ' + esc(i.detail) + '. Compare les offres concurrentes.' }));
    return tips.sort((a, z) => z.impact - a.impact).slice(0, 5);
  }

  // ================= Bilan =================
  function bilan(data, comp, today) {
    today = today || todayISO();
    const ck = isoToKey(today), r = comp[ck];
    if (!r) return { html: 'Le mois en cours n’existe pas encore.', court: '' };
    const pv = C.prevision(data, comp, ck, today), pa = C.pointsAttention(data, comp, today).items;
    const d7 = journalEntre(data, addDaysIso(today, -6), today).filter(d => num(d.montant) > 0), sem = d7.reduce((s, d) => s + num(d.montant), 0);
    const pf = C.portefeuille(data.invest, today), pat = C.patrimoine(data, today);
    const lignesB = [];
    lignesB.push(`📅 ${b(keyLong(ck))} : ${E(r.expR)} dépensés sur ${E(r.expP)} prévus (${P(r.expP ? r.expR / r.expP : 0)}), reste du mois ${b(E(r.remR))}.`);
    if (pv && pv.joursRestants) lignesB.push(`🔮 À ce rythme, fin de mois à ${b(E(pv.finProjetee))} (${pv.ecart >= 0 ? '+' : ''}${E(pv.ecart)} vs prévu) · ${E(pv.parJour)} par jour disponibles.`);
    lignesB.push(`🛒 7 derniers jours : ${E(sem)} de dépenses saisies${d7.length ? ` (${d7.length} achat${d7.length > 1 ? 's' : ''})` : ''}.`);
    lignesB.push(`💰 Épargne : ${P(r.tauxEpargneR)} des revenus investis ce mois-ci (cible ${P(num(data.settings.cibleEpargne))}).`);
    if (pf.valeur) lignesB.push(`📈 Portefeuille : ${E(pf.valeur)}${pf.verse > 0 ? ` (${pf.pv >= 0 ? '+' : ''}${E(pf.pv)})` : ''}${pat.total ? ` · patrimoine net ${E(pat.total)}` : ''}.`);
    const alertes = pa.filter(i => i.niveau === 'neg' || i.niveau === 'warn').slice(0, 2), bravo = pa.filter(i => i.niveau === 'pos').slice(0, 1);
    alertes.forEach(i => lignesB.push('⚠️ ' + i.titre + ' — ' + esc(i.detail)));
    bravo.forEach(i => lignesB.push('👏 ' + i.titre + ' — ' + esc(i.detail)));
    const ton = pv && pv.ecart >= -num(data.settings.soldeTolere) ? 'Ton mois se passe bien.' : 'Ton mois est un peu juste.';
    const court = `${ton} Il te reste ${E(r.remR)}${pv && pv.joursRestants ? `, soit ${E(pv.parJour)} par jour` : ''}.`;
    return { html: lignesB.join('<br>'), court, lignes: lignesB };
  }

  // ================= Relevés bancaires (CSV / OFX / QIF) =================
  function nombreFr(s) {
    s = String(s || '').trim().replace(/ | /g, ' ').replace(/[€\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
    const v = parseFloat(s); return isFinite(v) ? v : null;
  }
  function dateReleve(s) {
    s = String(s || '').trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
    m = s.match(/^(\d{4})(\d{2})(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }
  function decouperCsv(txt) {
    const lignesT = txt.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const seps = [';', ',', '\t'], sep = seps.map(s => ({ s, n: lignesT.slice(0, 10).reduce((a, l) => a + (l.split(s).length - 1), 0) })).sort((a, z) => z.n - a.n)[0].s;
    const parse = l => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); };
    return lignesT.map(parse);
  }
  function lireReleve(txt, nom) {
    txt = String(txt || ''); const ops = []; let solde = null, format;
    if (/<OFX>|<STMTTRN>/i.test(txt)) {
      format = 'OFX';
      (txt.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi) || []).forEach(bl => {
        const g = tag => { const m = bl.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : ''; };
        const d = dateReleve(g('DTPOSTED')), v = nombreFr(g('TRNAMT')), lib = [g('NAME'), g('MEMO')].filter(Boolean).join(' ').replace(/\s+/g, ' ');
        if (d && v !== null) ops.push({ date: d, libelle: lib, montant: v, fitid: g('FITID') });
      });
      const sb = txt.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)[\s\S]*?<DTASOF>([^<\r\n]+)/i); if (sb) solde = { solde: nombreFr(sb[1]), date: dateReleve(sb[2]) };
    } else if (/^!Type:/im.test(txt)) {
      format = 'QIF'; let cur = {};
      txt.split(/\r?\n/).forEach(l => { const c = l[0], v = l.slice(1).trim(); if (c === 'D') cur.date = dateReleve(v.replace(/'/g, '/')); else if (c === 'T' || c === 'U') cur.montant = nombreFr(v); else if (c === 'P') cur.libelle = v; else if (c === 'M') cur.libelle = (cur.libelle ? cur.libelle + ' ' : '') + v; else if (c === '^') { if (cur.date && cur.montant !== undefined && cur.montant !== null) ops.push({ date: cur.date, libelle: cur.libelle || '', montant: cur.montant }); cur = {}; } });
    } else {
      format = 'CSV';
      const rows = decouperCsv(txt); if (!rows.length) return { ops, format, erreur: 'Fichier vide' };
      let hi = rows.findIndex(r => r.some(c => /date/i.test(c)) && r.some(c => /(montant|debit|d[ée]bit|cr[ée]dit|amount|somme|valeur)/i.test(norm(c))));
      if (hi < 0) hi = -1;
      const head = hi >= 0 ? rows[hi].map(c => norm(c)) : [];
      const col = (res, sauf) => { for (const re of res) { const i = head.findIndex((h, j) => re.test(h) && !(sauf || []).includes(j)); if (i >= 0) return i; } return -1; };
      let cD = col([/^date (de )?(l'?)?operation/, /^date$/, /^date op/, /^dateop/, /^date/]), cL = col([/libelle/, /^label$/, /label/, /description/, /intitule/, /detail/, /^operation$/, /^nom/, /beneficiaire/], [cD]);
      const cM = col([/^montant/, /amount/, /^somme/, /^valeur$/]), cDeb = col([/debit/]), cCred = col([/credit/]), cCat = col([/categorie(?! parent)/, /category/]);
      if (cD < 0) cD = 0;
      if (cL < 0) cL = head.length ? head.findIndex((h, i) => i !== cD && i !== cM && i !== cDeb && i !== cCred) : 1;
      rows.slice(hi + 1).forEach(r => {
        const d = dateReleve(r[cD]); if (!d) return;
        let v = cM >= 0 ? nombreFr(r[cM]) : null;
        if (v === null && (cDeb >= 0 || cCred >= 0)) { const de = cDeb >= 0 ? nombreFr(r[cDeb]) : null, cr = cCred >= 0 ? nombreFr(r[cCred]) : null; v = cr ? Math.abs(cr) : de ? -Math.abs(de) : null; }
        if (v === null) { for (let i = r.length - 1; i >= 0; i--) { if (i === cD) continue; const t = nombreFr(r[i]); if (t !== null && /[.,]\d{2}$|^-?\d+$/.test(String(r[i]).trim())) { v = t; break; } } }
        if (v === null) return;
        ops.push({ date: d, libelle: String(r[cL] || '').replace(/\s+/g, ' ').trim(), montant: v, catBanque: cCat >= 0 ? r[cCat] : '' });
      });
    }
    return { ops, format, solde, nom };
  }
  // Nettoie un libellé bancaire (« CB CARREFOUR MARSEILLE 12/11 » → « Carrefour Marseille »)
  function nettoyerLibelle(l) {
    let s = String(l || '').replace(/\*\d+|\bCB\*\S*/gi, ' ').replace(/\b(CB|CARTE|PAIEMENT|PAIEMT|PRLV|PRELEVEMENT|SEPA|VIR|VIREMENT|INST|RETRAIT|DAB|FACTURE|ACHAT|X\d{4}|\d{2}\/\d{2}(\/\d{2,4})?|\d{6,})\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!s) s = String(l || '').trim();
    return s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).slice(0, 60);
  }
  function preparerImport(data, rel, today) {
    today = today || todayISO();
    const exist = (data.depenses || []).map(d => ({ date: d.date, v: round2(num(d.montant)), cat: d.cat }));
    return rel.ops.map((o, i) => {
      const rev = o.montant > 0, lib = nettoyerLibelle(o.libelle), mt = round2(Math.abs(o.montant));
      const virementInterne = /\b(vir(ement)?( sepa)?( inst)?|virement) (vers|de|recu|emis)?\b.*\b(livret|epargne|pea|compte|ldd|lep|assurance vie)\b/i.test(norm(o.libelle));
      const cl = classer(data, lib + ' ' + (o.catBanque || ''), { rev, invest: false }), direct = trouverCategories(data, lib, { rev }).filter(c => !c.auto && c.role !== 'invest');
      let cat = direct.length === 1 ? direct[0].label : cl[0] ? cl[0].cat : null, conf = direct.length === 1 ? 0.9 : cl[0] ? cl[0].p : 0;
      const doublon = exist.some(e => e.v === round2(rev ? mt : mt) && e.date && Math.abs((new Date(e.date) - new Date(o.date)) / 864e5) <= 3 && (!cat || e.cat === cat || true));
      return { i, date: o.date, libelle: o.libelle, com: lib, montant: mt, sens: rev ? 'rev' : 'dep', cat, confiance: conf, suggestions: [...new Set([cat].concat(cl.slice(0, 4).map(x => x.cat)))].filter(Boolean), doublon, interne: virementInterne, garder: !doublon && !virementInterne && !!cat && mt > 0 };
    });
  }
  function apprendre(data, motif, cat) {
    data.ia = data.ia || { regles: [] }; data.ia.regles = data.ia.regles || [];
    const mots = norm(motif).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(t => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t));
    const m = mots[0] && mots[0].length >= 4 ? mots[0] : mots.slice(0, 2).join(' ');
    if (!m) return null;
    data.ia.regles = data.ia.regles.filter(r => norm(r.motif) !== m);
    data.ia.regles.unshift({ motif: m, cat, le: todayISO() });
    data.ia.regles = data.ia.regles.slice(0, 300);
    cache.sig = null;
    return m;
  }

  const IA = { norm, tokens, CONCEPTS, categories, trouverCategories, classer, extraireDate, extrairePeriode, extraireMontant, analyserSaisie, repondre, conseils, bilan, lireReleve, nettoyerLibelle, preparerImport, apprendre, detecterIntention, nombreFr, dateReleve };
  C.IA = IA;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis);
