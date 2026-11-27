/* Budget & Investissements — app iPhone (web app installée sur l'écran d'accueil)
   Données : instantané chiffré envoyé par le PC via la feuille Google de l'utilisateur.
   Saisies : chiffrées sur l'iPhone, déposées dans la feuille Google, intégrées par le PC. */
(function () {
  'use strict';
  const APP_V = '1.2.0';
  const C = window.Calc;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const E = (v, d) => C.fmtEur(v, d === undefined ? 2 : d);
  const E0 = v => C.fmtEur(v, 0);
  const P = (v, d) => C.fmtPct(v, d === undefined ? 0 : d);
  const signe = v => (v > 0 ? '+' : '') + E0(v);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('bi.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bi.' + k, JSON.stringify(v)); } catch (e) { toast('Stockage plein sur l’iPhone', true); } },
    del(k) { localStorage.removeItem('bi.' + k); }
  };
  // IndexedDB : la clé de chiffrement (non exportable) y est conservée
  const idb = {
    db: null,
    open() { return this.db ? Promise.resolve(this.db) : new Promise((res, rej) => { const r = indexedDB.open('bi-iphone', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); }); },
    async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
    async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
    async del(k) { const db = await this.open(); return new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(); }); }
  };

  // ================= Chiffrement (compatible avec le PC) =================
  const b2u = b64 => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/')); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
  const u2b = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  async function deriver(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b2u(salt), iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function dechiffrer(key, env) {
    const o = typeof env === 'string' ? JSON.parse(env) : env;
    let buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b2u(o.iv) }, key, b2u(o.c));
    if (o.z) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  async function chiffrer(key, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return JSON.stringify({ v: 1, z: 0, iv: u2b(iv), c: u2b(c) });
  }

  // ================= État =================
  const st = {
    cfg: LS.get('cfg', null), key: null, snap: null, ver: LS.get('ver', null), ops: LS.get('ops', []),
    data: null, comp: null, sync: { at: LS.get('syncAt', null), serverAt: LS.get('serverAt', null), err: null, busy: false },
    route: 'accueil', params: {}, hist: [], month: null, form: { type: 'dep' }, q: '',
    ia: { msgs: LS.get('iaMsgs', []).slice(-40), etat: {} }
  };
  const standalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  function themeEffectif() { const t = LS.get('theme', 'auto'); return t === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'clair' : 'sombre') : t; }
  function appliquerTheme() {
    const t = themeEffectif(); document.documentElement.dataset.theme = t;
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'clair' ? '#f3f6fb' : '#0b1220';
    document.body.classList.toggle('discret', !!LS.get('discret', false));
  }
  try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (LS.get('theme', 'auto') === 'auto') appliquerTheme(); }); } catch (e) { /* */ }

  // Code de connexion : ?c=… (QR code du PC) ou collé à la main
  function lireCode(code) {
    try { const o = JSON.parse(decodeURIComponent(escape(atob(String(code).trim().replace(/-/g, '+').replace(/_/g, '/'))))); if (o && o.u && o.k && o.s) return o; } catch (e) { /* */ }
    return null;
  }
  function enregistrerCfg(cfg) {
    const avant = st.cfg;
    st.cfg = cfg; LS.set('cfg', cfg);
    if (!avant || avant.s !== cfg.s || avant.u !== cfg.u) { st.key = null; idb.del('key'); LS.del('snapEnc'); LS.del('ver'); st.ver = null; st.snap = null; }
  }

  // ================= Échanges avec la feuille Google =================
  async function api(body) {
    const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(st.cfg.u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ k: st.cfg.k }, body)), redirect: 'follow', signal: ctrl.signal });
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch (e) { throw new Error('Réponse inattendue de Google : vérifie que le script est bien déployé (accès « Tout le monde »).'); }
      if (j.ok === false) throw new Error(/inconnue/i.test(j.err || '') ? 'Le script Google est l’ancienne version : mets-le à jour depuis l’appli du PC (page Téléphone).' : (j.err || 'Erreur Google'));
      return j;
    } catch (e) { if (e.name === 'AbortError') throw new Error('Google ne répond pas (délai dépassé)'); throw e; } finally { clearTimeout(to); }
  }
  async function synchroniser(manuel) {
    if (st.sync.busy || !st.cfg || !st.key) return;
    if (!navigator.onLine) { st.sync.err = 'Hors ligne'; majStatut(); if (manuel) toast('Pas de connexion internet', true); return; }
    st.sync.busy = true; majStatut();
    try {
      const aEnvoyer = st.ops.filter(o => !o.sent);
      if (aEnvoyer.length) { await api({ api: 'op_push', ops: aEnvoyer.map(o => ({ id: o.id, data: o.enc })) }); aEnvoyer.forEach(o => { o.sent = true; }); LS.set('ops', st.ops); }
      const r = await api({ api: 'snap_get', since: st.ver || '' });
      if (r.ver && !r.same) {
        let snap;
        try { snap = JSON.parse(await dechiffrer(st.key, r.data)); } catch (e) { throw new Error('Impossible de lire les données : le mot de passe a peut-être changé sur le PC. Réglages › Se reconnecter.'); }
        st.snap = snap; st.ver = r.ver; LS.set('snapEnc', r.data); LS.set('ver', r.ver);
      }
      st.sync.serverAt = r.at || st.sync.serverAt; LS.set('serverAt', st.sync.serverAt);
      st.sync.at = Date.now(); LS.set('syncAt', st.sync.at); st.sync.err = null;
      nettoyerOps(); reconstruire();
      if (manuel) toast(r.ver ? 'Synchronisé ✓' : 'Connecté · en attente des données du PC');
    } catch (e) { st.sync.err = String(e.message || e); if (manuel) toast(st.sync.err, true); }
    st.sync.busy = false; rendre();
  }
  function nettoyerOps() {
    const faits = new Set((st.snap && st.snap.applied) || []);
    const avant = st.ops.length;
    st.ops = st.ops.filter(o => !(o.sent && faits.has(o.id)));
    if (st.ops.length !== avant) LS.set('ops', st.ops);
  }

  // ================= Données locales (instantané + saisies en attente) =================
  function reconstruire() {
    if (!st.snap) { st.data = null; st.comp = null; return; }
    const d = JSON.parse(JSON.stringify(st.snap.data || {}));
    ['depenses', 'comptes', 'abonnements', 'objectifs', 'voyages', 'defis', 'achats', 'tarifs', 'conges'].forEach(k => { d[k] = d[k] || []; });
    d.settings = Object.assign({ tol: 0.1, soldeTolere: 20 }, d.settings || {}); d.analyse = d.analyse || { ignores: [] };
    d.invest = d.invest || { plan: { lines: [] }, journal: [], valeurs: {}, historique: [] };
    d.invest.journal = d.invest.journal || []; d.invest.valeurs = d.invest.valeurs || {}; d.invest.historique = d.invest.historique || [];
    d.comptes.forEach(c => { c.releves = c.releves || []; });
    const faits = new Set(st.snap.applied || []);
    st.ops.forEach(o => { if (!faits.has(o.id)) try { appliquerLocal(d, o.op); } catch (e) { /* */ } });
    st.data = d; st.comp = C.computeAll(d);
    if (!st.month || !d.months[st.month]) st.month = moisCible(d);
  }
  function moisCible(d) { const ks = C.monthKeys(d).filter(k => !d.months[k].locked), ck = C.currentKey(); return ks.includes(ck) ? ck : (ks[ks.length - 1] || C.monthKeys(d).slice(-1)[0]); }
  function ligneInvest(m) { return m && ['income', 'schedule', 'fixed', 'variable'].map(s => (m.sections[s] || []).find(l => l.role === 'invest')).find(Boolean); }
  // Même logique que le PC (aperçu immédiat, le PC fait foi)
  function appliquerLocal(d, op) {
    const mt = C.round2(C.num(op.montant));
    if (op.t === 'dep' || op.t === 'rev' || op.t === 'vers') {
      let k = C.isoToKey(op.date);
      if (!d.months[k] || d.months[k].locked) k = moisCible(d);
      const m = d.months[k]; if (!m) return;
      if (op.t === 'vers') {
        d.invest.journal.push({ id: op.id, date: op.date, ligne: op.ligne, montant: mt, com: op.com || '' });
        const il = ligneInvest(m); if (il) il.reel = C.appendToExpr(il.reel, mt);
        return;
      }
      const secs = op.t === 'rev' ? ['income', 'schedule'] : ['fixed', 'variable'];
      let line = secs.flatMap(s => m.sections[s] || []).find(x => x.label === op.cat && !x.auto);
      if (!line) { line = { id: 'loc_' + op.id, label: op.cat, prevu: '', reel: '' }; m.sections[op.t === 'rev' ? 'schedule' : 'variable'].push(line); }
      if (line.reelSuitPrevu) { line.reel = line.prevu; delete line.reelSuitPrevu; }
      line.reel = C.appendToExpr(line.reel, mt);
      d.depenses.push({ id: op.id, date: op.date, mois: k, cat: line.label, montant: mt, com: op.com || '', saisi: op.at, source: 'iphone', pending: true });
    } else if (op.t === 'solde') {
      const c = d.comptes.find(x => x.id === op.compte); if (!c) return;
      c.releves = c.releves.filter(x => x.date !== op.date); c.releves.push({ date: op.date, solde: C.round2(C.num(op.solde)) });
    } else if (op.t === 'regle') {
      if (C.IA && op.motif && op.cat) C.IA.apprendre(d, op.motif, op.cat);
    } else if (op.t === 'abo') {
      const ab = d.abonnements.find(x => x.id === op.abo); if (!ab) return;
      const dt = ab.prochaine || C.todayISO(), k = d.months[C.isoToKey(dt)] ? C.isoToKey(dt) : moisCible(d), m = d.months[k];
      if (ab.categorie && m && !m.locked) { const l = ['fixed', 'variable'].flatMap(s => m.sections[s] || []).find(x => x.label === ab.categorie); if (l) { l.reel = C.appendToExpr(l.reel, C.num(ab.montant)); d.depenses.push({ id: op.id, date: dt, mois: k, cat: l.label, montant: C.num(ab.montant), com: ab.nom + ' (abonnement)', pending: true }); } }
      ab.prochaine = (C.FREQ[ab.frequence] || C.FREQ.mensuel).add(dt);
    }
  }
  async function ajouterOp(op) {
    op.id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    op.at = new Date().toISOString();
    const enc = await chiffrer(st.key, JSON.stringify(op));
    st.ops.push({ id: op.id, op, enc, sent: false }); LS.set('ops', st.ops);
    reconstruire(); synchroniser();
  }

  // ================= Interface =================
  const ICON = {
    accueil: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
    budget: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    invest: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
    plus2: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
  };
  const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  function toast(msg, err) {
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.remove(), err ? 4200 : 2400);
  }
  function aller(route, params, garder) { if (!garder) st.hist.push({ route: st.route, params: st.params }); st.route = route; st.params = params || {}; rendre(); window.scrollTo(0, 0); }
  function retour() { const h = st.hist.pop(); if (h) { st.route = h.route; st.params = h.params; } else st.route = 'accueil'; rendre(); }
  const ONGLETS = ['accueil', 'budget', 'invest', 'plus'];
  function nav() {
    const on = r => ONGLETS.includes(st.route) ? st.route === r : (r === 'plus' && !['saisir'].includes(st.route));
    return `<nav class="nav"><button class="${on('accueil') ? 'on' : ''}" data-tab="accueil">${svg(ICON.accueil)}Accueil</button><button class="${on('budget') ? 'on' : ''}" data-tab="budget">${svg(ICON.budget)}Budget</button>
      <button data-go="saisir" aria-label="Ajouter"><span class="plus">${svg(ICON.plus)}</span></button>
      <button class="${on('invest') ? 'on' : ''}" data-tab="invest">${svg(ICON.invest)}Invest</button><button class="${on('plus') ? 'on' : ''}" data-tab="plus">${svg(ICON.plus2)}Plus</button></nav>`;
  }
  function statutHtml() {
    const s = st.sync, att = st.ops.filter(o => !o.sent).length, env = st.ops.filter(o => o.sent).length;
    const quand = s.at ? depuis(s.at) : 'jamais';
    const cls = s.busy ? 'busy' : s.err ? (s.err === 'Hors ligne' ? 'off' : 'err') : '';
    const txt = s.busy ? 'Synchronisation…' : s.err === 'Hors ligne' ? `Hors ligne${att ? ` · ${att} à envoyer` : ''}` : s.err ? 'Erreur de synchro' : `${quand}${att ? ` · ${att} à envoyer` : env ? ` · ${env} en attente du PC` : ''}`;
    return `<button class="status ${cls}" data-a="sync" id="status"><i></i>${esc(txt)}</button>`;
  }
  function majStatut() { const el = $('#status'); if (el) el.outerHTML = statutHtml(); }
  function depuis(t) { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }
  const ICO_OEIL = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
  const ICO_OEIL_BARRE = '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a10.4 10.4 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
  const ICO_SOLEIL = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
 const ICO_IA = '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>';
  const ICO_LUNE = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>';
  function outils() {
    const disc = !!LS.get('discret', false);
    return `<button class="ibtn ia" data-go="assistant" aria-label="Assistant">${svg(ICO_IA)}</button><button class="ibtn" data-a="discret" aria-label="Masquer les montants">${svg(disc ? ICO_OEIL_BARRE : ICO_OEIL)}</button><button class="ibtn" data-a="basculer-theme" aria-label="Thème">${svg(themeEffectif() === 'clair' ? ICO_LUNE : ICO_SOLEIL)}</button>`;
  }
  function top(titre, back, droite) { return `<header class="top">${back ? `<button class="back" data-a="back">‹</button>` : ''}<h1>${titre}</h1>${droite || ''}${back ? '' : outils()}</header>${majDispo ? `<div class="banner" style="margin:0 16px 12px" data-a="appliquer-maj">✨ Nouvelle version de l’app (${esc(majDispo)}) : touche ici pour l’installer.</div>` : ''}`; }
  const barre = (pct, cls) => `<div class="bar"><i class="${cls || ''}" style="width:${Math.max(0, Math.min(100, pct * 100)).toFixed(1)}%"></i></div>`;
  const ring = (p, label, col) => `<div class="ring" style="background:conic-gradient(${col || 'var(--acc)'} ${(Math.max(0, Math.min(1, p)) * 100).toFixed(1)}%, var(--card2) 0)" data-l="${esc(label)}"></div>`;
  const PAL = ['#3b82f6', '#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb7185', '#2dd4bf', '#fb923c', '#a3e635'];

  // ---------- Accueil ----------
  function vueAccueil() {
    const d = st.data, ck = moisCible(d), r = st.comp[ck], pv = C.prevision(d, st.comp, ck), st0 = d.settings;
    const h = new Date().getHours(), salut = h < 5 ? 'Bonne nuit' : h < 18 ? 'Bonjour' : 'Bonsoir';
    const pctDep = r.expP ? r.expR / r.expP : 0, jr = C.joursRestants(ck);
    const pa = C.pointsAttention(d, st.comp).items.filter(x => x.niveau !== 'info').slice(0, 4);
    const dern = d.depenses.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.saisi || '').localeCompare(a.saisi || '')).slice(0, 6);
    const ab = C.abonnementsResume(d, 14).prochains.slice(0, 4);
    const pat = C.patrimoine(d), pf = C.portefeuille(d.invest);
    return top(`${salut}${st0.prenom ? ' ' + esc(st0.prenom) : ''}`, false) + `<div class="view">
      <div class="sub between"><span>${C.keyLong(ck)} · ${new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' })}</span>${statutHtml()}</div>
      <div class="card hero"><div class="muted" style="font-weight:600">Reste du mois</div><div class="big m ${r.remR < 0 ? 'neg' : ''}">${E0(r.remR)}</div>
        <div class="muted" style="font-size:13.5px">${r.remR >= r.remP ? `<span class="pos">▲ ${E0(r.remR - r.remP)}</span>` : `<span class="neg">▼ ${E0(r.remR - r.remP)}</span>`} vs prévu (${E0(r.remP)})</div>
        <div style="margin-top:14px">${barre(pctDep, pctDep > 1 ? 'over' : '')}<div class="between dim" style="font-size:12px;margin-top:6px"><span>${P(pctDep)} du budget dépensé</span><span>${jr ? jr + ' j restants' : 'mois terminé'}</span></div></div></div>
      ${pv && pv.joursRestants ? `<div class="grid2"><div class="mini"><div class="l">Fin de mois projetée</div><div class="v m ${pv.ecart < -C.num(st0.soldeTolere) ? 'warn' : ''}">${E0(pv.finProjetee)}</div><div class="dim" style="font-size:11.5px">${signe(pv.ecart)} vs prévu</div></div>
        <div class="mini"><div class="l">À dépenser par jour</div><div class="v m">${E(pv.parJour)}</div><div class="dim" style="font-size:11.5px">${E0(pv.budgetRestant)} de variable</div></div></div>` : ''}
      <div class="grid3"><div class="mini"><div class="l">Revenus</div><div class="v m pos">${E0(r.incR)}</div></div><div class="mini"><div class="l">Dépenses</div><div class="v m">${E0(r.expR)}</div></div><div class="mini"><div class="l">Épargne</div><div class="v m">${P(r.tauxEpargneR)}</div></div></div>
      <div class="ask" data-go="assistant"><span>${svg(ICO_IA)}</span><span class="dim">Demande à ton assistant… « combien en restos ? »</span></div>
      ${pa.length ? `<div class="card pa"><h2>Points d’attention</h2>${pa.map(x => `<div class="item"><div class="chip ${x.niveau === 'info' ? '' : x.niveau}">${{ neg: '!', warn: '⚠︎', pos: '✓', info: 'i' }[x.niveau]}</div><div class="t"><div style="font-size:14px">${x.titre}</div><div class="d" style="white-space:normal">${esc(x.detail)}</div></div></div>`).join('')}</div>` : ''}
      <div class="card"><h2>Dernières dépenses<span class="r"><button class="link" data-go="journal">Tout voir</button></span></h2>${dern.length ? dern.map(ligneDep).join('') : '<div class="empty">Aucune dépense pour l’instant.</div>'}</div>
      ${ab.length ? `<div class="card"><h2>Prélèvements à venir</h2>${ab.map(x => `<div class="item"><div class="chip ${x.retard ? 'warn' : ''}">↻</div><div class="t"><b>${esc(x.a.nom)}</b><div class="d">${x.retard ? 'en retard · ' : ''}${C.isoFr(x.date)}</div></div><div class="v m">${E(x.a.montant)}</div></div>`).join('')}</div>` : ''}
      <div class="grid2"><div class="mini" data-tab="invest"><div class="l">Portefeuille</div><div class="v m">${pf.valeur ? E0(pf.valeur) : E0(pf.verse)}</div><div class="dim" style="font-size:11.5px">${pf.valeur ? `<span class="${pf.pv >= 0 ? 'pos' : 'neg'}">${signe(pf.pv)}</span>` : 'versé'}</div></div>
        <div class="mini" data-go="comptes"><div class="l">Patrimoine net</div><div class="v m">${E0(pat.total)}</div><div class="dim" style="font-size:11.5px">${(d.comptes || []).filter(c => !c.archive).length} compte(s)</div></div></div>
      <div class="dim" style="font-size:11.5px;text-align:center;margin-top:8px">Données du PC du ${st.snap.at ? new Date(st.snap.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '?'}</div></div>`;
  }
  let revCache = null;
  function estRevenu(cat) {
    if (!revCache || revCache.d !== st.data) { const set = new Set(); Object.values(st.data.months || {}).forEach(m => ['income', 'schedule'].forEach(s => (m.sections[s] || []).forEach(l => set.add(l.label)))); revCache = { d: st.data, set }; }
    return revCache.set.has(cat);
  }
  function ligneDep(x) {
    const neg = C.num(x.montant) < 0 || estRevenu(x.cat);
    return `<div class="item ${x.pending ? 'pending' : ''}"><div class="chip ${neg ? 'pos' : ''}">${esc((x.cat || '?').slice(0, 1).toUpperCase())}</div><div class="t"><b>${esc(x.cat)}</b><div class="d">${C.isoFr(x.date)}${x.com ? ' · ' + esc(x.com) : ''}</div></div><div class="v m ${neg ? 'pos' : ''}">${estRevenu(x.cat) ? '+' : ''}${E(x.montant)}</div></div>`;
  }

  // ---------- Budget du mois ----------
  function vueBudget() {
    const d = st.data, ks = C.monthKeys(d), k = st.month, i = ks.indexOf(k), m = d.months[k], r = st.comp[k], tol = C.num(d.settings.tol);
    const sec = (titre, ids, rev) => {
      const ls = ids.flatMap(s => (m.sections[s] || []).map(l => ({ l, v: r.lines[l.id] }))).filter(x => x.v.prevu || x.v.reel);
      if (!ls.length) return '';
      const tp = ls.reduce((s, x) => s + x.v.prevu, 0), tr = ls.reduce((s, x) => s + x.v.reel, 0);
      return `<div class="card"><h2>${titre}<span class="r m">${E0(tr)} / ${E0(tp)}</span></h2>${ls.map(({ l, v }) => {
        const s = rev ? (v.reel >= v.prevu ? 'ok' : 'avenir') : C.statut(v.prevu, v.reel, tol), pct = v.prevu ? v.reel / v.prevu : (v.reel ? 1 : 0);
        return `<div class="item" data-a="ligne" data-id="${esc(l.id)}" style="display:block"><div class="between"><span style="font-weight:600">${esc(l.label)}${l.role === 'invest' ? ' <span class="tag">invest.</span>' : ''}</span><span class="m"><b>${E0(v.reel)}</b> <span class="dim">/ ${E0(v.prevu)}</span></span></div>
          <div style="margin-top:7px">${barre(pct, rev ? 'ok' : s === 'depasse' || s === 'nonprevu' ? 'over' : pct >= 0.995 ? 'ok' : pct > 0.85 ? 'w' : '')}</div></div>`;
      }).join('')}</div>`;
    };
    const rows = ['fixed', 'variable'].flatMap(s => (m.sections[s] || []).filter(l => !l.role).map(l => ({ label: l.label, v: r.lines[l.id].reel }))).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    const tot = rows.reduce((s, x) => s + x.v, 0), top6 = rows.slice(0, 6), autres = tot - top6.reduce((s, x) => s + x.v, 0);
    const parts = top6.concat(autres > 0.5 ? [{ label: 'Autres', v: autres }] : []); let acc = 0;
    const grad = parts.map((x, j) => { const a = acc / tot * 100; acc += x.v; return `${PAL[j % PAL.length]} ${a.toFixed(2)}% ${(acc / tot * 100).toFixed(2)}%`; }).join(',');
    return top('Budget') + `<div class="view">
      <div class="month-sw"><button data-a="mois" data-d="-1" ${i <= 0 ? 'disabled' : ''}>‹</button><b>${C.keyLong(k)}${m.locked ? ' 🔒' : ''}</b><button data-a="mois" data-d="1" ${i >= ks.length - 1 ? 'disabled' : ''}>›</button></div>
      <div class="grid3"><div class="mini"><div class="l">Revenus</div><div class="v m pos">${E0(r.incR)}</div></div><div class="mini"><div class="l">Dépenses</div><div class="v m">${E0(r.expR)}</div></div><div class="mini"><div class="l">Reste</div><div class="v m ${r.remR < 0 ? 'neg' : ''}">${E0(r.remR)}</div></div></div>
      ${tot ? `<div class="card"><h2>Où part l’argent</h2><div class="row" style="gap:16px"><div class="donut" style="background:conic-gradient(${grad})" data-l="${E0(tot)}"></div><div class="legend">${parts.map((x, j) => `<div><span class="d" style="background:${PAL[j % PAL.length]}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.label)}</span><span class="v m">${E0(x.v)}</span></div>`).join('')}</div></div></div>` : ''}
      ${sec('Dépenses variables', ['variable'])}${sec('Dépenses fixes', ['fixed'])}${sec('Revenus', ['income', 'schedule'], true)}</div>`;
  }
  function feuilleLigne(id) {
    const d = st.data, k = st.month, m = d.months[k], l = ['income', 'schedule', 'fixed', 'variable'].flatMap(s => m.sections[s] || []).find(x => x.id === id); if (!l) return;
    const v = st.comp[k].lines[id], its = d.depenses.filter(x => (x.mois || C.isoToKey(x.date)) === k && x.cat === l.label).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const rev = (m.sections.income || []).concat(m.sections.schedule || []).includes(l);
    feuille(`<h3>${esc(l.label)}</h3><div class="grid2"><div class="mini"><div class="l">Réel</div><div class="v m">${E(v.reel)}</div></div><div class="mini"><div class="l">Prévu</div><div class="v m">${E(v.prevu)}</div></div></div>
      ${its.length ? its.map(ligneDep).join('') : `<div class="empty">Pas de saisie datée${l.reel ? ` · détail : <span class="m">${esc(String(l.reel))}</span>` : ''}.</div>`}
      ${l.role || l.auto || m.locked ? '' : `<button class="btn primary" style="margin-top:14px" data-a="ajouter-ici" data-cat="${esc(l.label)}" data-t="${rev ? 'rev' : 'dep'}">+ Ajouter ${rev ? 'un revenu' : 'une dépense'} ici</button>`}`);
  }

  // ---------- Saisie ----------
  function catsDe(t) {
    const d = st.data, m = d.months[moisCible(d)]; if (!m) return [];
    const secs = t === 'rev' ? ['income', 'schedule'] : ['variable', 'fixed'];
    const labels = secs.flatMap(s => (m.sections[s] || []).filter(l => !l.auto && l.role !== 'invest' && !(t === 'rev' && l.reelSuitPrevu)).map(l => l.label));
    const freq = {}, lim = C.addDaysIso(C.todayISO(), -90);
    d.depenses.filter(x => x.date >= lim).forEach(x => { freq[x.cat] = (freq[x.cat] || 0) + 1; });
    const ordre = [...new Set(labels)];
    return ordre.sort((a, b) => (freq[b] || 0) - (freq[a] || 0) || ordre.indexOf(a) - ordre.indexOf(b));
  }
  function vueSaisir() {
    const f = st.form, d = st.data, t = f.type;
    const chips = (list, sel, attr) => `<div class="chipsel">${list.map(x => `<button class="${x.v === sel ? 'on' : ''}" data-a="${attr}" data-v="${esc(x.v)}">${esc(x.l)}</button>`).join('')}</div>`;
    let corps = '';
    if (t === 'dep' || t === 'rev') {
      const cats = catsDe(t); if (!f.cat || !cats.includes(f.cat)) f.cat = f.cat && cats.includes(f.cat) ? f.cat : cats[0];
      corps = `<label class="f">Catégorie</label>${chips(cats.map(c => ({ v: c, l: c })), f.cat, 'f-cat')}`;
    } else if (t === 'vers') {
      const ls = C.lignesPlan(d.invest.plan).map(l => l.nom); if (!ls.includes(f.ligne)) f.ligne = ls[0];
      corps = ls.length ? `<label class="f">Ligne du plan</label>${chips(ls.map(x => ({ v: x, l: x })), f.ligne, 'f-ligne')}` : '<div class="banner warn">Aucune ligne dans le plan d’investissement du PC.</div>';
    } else if (t === 'solde') {
      const cs = d.comptes.filter(c => !c.archive); if (!cs.some(c => c.id === f.compte)) f.compte = cs[0] && cs[0].id;
      const c = cs.find(x => x.id === f.compte), sa = c ? C.soldeAu(c) : null;
      corps = cs.length ? `<label class="f">Compte</label>${chips(cs.map(c => ({ v: c.id, l: c.nom })), f.compte, 'f-compte')}${sa ? `<div class="dim" style="font-size:12.5px;margin:-6px 0 12px">Dernier solde : <b class="m">${E(sa.solde)}</b> le ${C.isoFr(sa.date)}</div>` : ''}` : '<div class="banner warn">Aucun compte : ajoute-les dans « Comptes & patrimoine » sur le PC.</div>';
    }
    const lab = { dep: 'Montant de la dépense', rev: 'Montant reçu', vers: 'Montant versé', solde: 'Nouveau solde' }[t];
    return top('Ajouter', true) + `<div class="view">
      <div class="seg">${[['dep', 'Dépense'], ['rev', 'Revenu'], ['vers', 'Versement'], ['solde', 'Solde']].map(([k, l]) => `<button class="${t === k ? 'on' : ''}" data-a="f-type" data-v="${k}">${l}</button>`).join('')}</div>
      ${t === 'solde' ? '' : `<div class="phrase"><span>${svg(ICO_IA)}</span><input id="f-phrase" placeholder="En une phrase : « 23,50 sushi hier »" value="${esc(f.phrase || '')}" autocomplete="off" autocapitalize="off"></div>${f.phraseInfo ? `<div class="dim" style="font-size:12px;margin:-6px 0 10px 4px">${f.phraseInfo}</div>` : ''}`}
      <div class="amount-wrap"><label class="f" style="text-align:center;margin:0">${lab}</label><input class="amount m" id="f-mt" inputmode="decimal" placeholder="0,00 €" value="${esc(f.mt || '')}" autocomplete="off"></div>
      ${corps}
      <div class="grid2" style="margin-bottom:14px"><div><label class="f">Date</label><input type="date" id="f-date" value="${esc(f.date || C.todayISO())}"></div><div><label class="f">${t === 'solde' ? '&nbsp;' : 'Note'}</label>${t === 'solde' ? '' : `<input id="f-com" placeholder="facultatif" value="${esc(f.com || '')}">`}</div></div>
      <button class="btn primary" data-a="enregistrer">Enregistrer</button>
      <div class="dim" style="font-size:12px;text-align:center;margin-top:12px">Chiffré sur ton iPhone puis envoyé ; ton PC l’intègre au budget à sa prochaine synchro.${t === 'dep' ? ' Un montant négatif = remboursement.' : ''}</div></div>`;
  }
  async function enregistrer() {
    const f = st.form, raw = ($('#f-mt').value || '').replace(/\s/g, '').replace('€', '').replace(',', '.');
    let mt; try { mt = C.evalExpr(raw); } catch (e) { mt = NaN; }
    if (!isFinite(mt) || (f.type !== 'solde' && !mt)) return toast('Montant invalide', true);
    const date = $('#f-date').value || C.todayISO(), com = ($('#f-com') && $('#f-com').value.trim()) || '';
    let op;
    if (f.type === 'dep' || f.type === 'rev') { if (!f.cat) return toast('Choisis une catégorie', true); op = { t: f.type, date, montant: C.round2(mt), cat: f.cat, com }; }
    else if (f.type === 'vers') { if (!f.ligne) return toast('Choisis une ligne', true); op = { t: 'vers', date, montant: C.round2(mt), ligne: f.ligne, com }; }
    else { if (!f.compte) return toast('Choisis un compte', true); op = { t: 'solde', date, solde: C.round2(mt), compte: f.compte }; }
    // la phrase avait proposé une autre catégorie : l'assistant retient la correction
    if (f.phraseCat && op.cat && f.phraseCat !== op.cat && com) await ajouterOp({ t: 'regle', motif: com, cat: op.cat });
    await ajouterOp(op);
    toast({ dep: 'Dépense ajoutée', rev: 'Revenu ajouté', vers: 'Versement ajouté', solde: 'Solde mis à jour' }[f.type] + ' ✓');
    st.form = { type: f.type, cat: f.cat, ligne: f.ligne, compte: f.compte };
    retour();
  }

  // ---------- Investissements ----------
  function vueInvest() {
    const d = st.data, inv = d.invest, pf = C.portefeuille(inv), mk = st.snap.market || { q: {}, entries: [] }, pea = C.peaEtat(d);
    const objs = (d.objectifs || []).map(o => ({ o, pr: C.objectifProjection(d, o) }));
    return top('Investissements') + `<div class="view">
      <div class="card hero"><div class="muted" style="font-weight:600">Valeur du portefeuille</div><div class="big m">${pf.valeur ? E0(pf.valeur) : '–'}</div>
        <div class="muted" style="font-size:13.5px">${pf.valeur ? `<span class="${pf.pv >= 0 ? 'pos' : 'neg'}">${signe(pf.pv)}${pf.perf !== null ? ` (${P(pf.perf, 1)})` : ''}</span> · ` : ''}versé ${E0(pf.verse)}${inv.dateValo ? ` · valorisé le ${C.isoFr(inv.dateValo)}` : ''}</div></div>
      ${pf.rows.length ? `<div class="card"><h2>Lignes · poids actuel / cible</h2>${pf.rows.map(r => `<div class="item" style="display:block"><div class="between"><span style="font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.nom)} <span class="tag mute">${esc(r.env || '')}</span></span><span class="m" style="white-space:nowrap"><b>${r.val === null ? E0(r.verse) : E0(r.val)}</b></span></div>
        <div class="between dim dz" style="font-size:12px;margin:4px 0 6px"><span>${r.poids === null ? '–' : P(r.poids, 1)} / cible ${P(r.part)}</span><span class="${r.pv > 0 ? 'pos' : r.pv < 0 ? 'neg' : ''}">${r.pv === null ? '' : signe(r.pv)}</span></div>
        <div class="bar" style="position:relative"><i style="width:${Math.min(100, (r.poids || 0) * 100)}%"></i><span style="position:absolute;top:-2px;bottom:-2px;left:${(r.part * 100).toFixed(1)}%;width:2px;background:var(--txt);opacity:.6"></span></div></div>`).join('')}
        <div class="dim dz" style="font-size:12px;margin-top:8px">Versement conseillé ce mois-ci : ${pf.rows.filter(r => r.conseil > 0.5).map(r => `${esc(r.nom)} <b>${E0(r.conseil)}</b>`).join(' · ') || '–'}</div></div>` : ''}
      ${(mk.entries || []).length ? `<div class="card"><h2>Cours<span class="r dim" style="font-size:11.5px">${mk.at ? 'relevés par le PC ' + depuis(mk.at) : ''}</span></h2>${mk.entries.map(e => { const q = mk.q[e.symbol]; const ch = q && q.price && q.change !== null && q.change !== undefined ? q.change / (q.price - q.change) : null; return `<div class="item"><div class="t"><b>${esc(e.nom || e.symbol)}</b><div class="d">${esc(e.symbol)}${e.parts ? ` · ${C.fmtNum(e.parts, 2)} parts` : ''}</div></div><div class="v m">${q && q.price ? C.fmtNum(q.price, 2) + ' ' + (q.currency === 'EUR' || !q.currency ? '€' : esc(q.currency)) : '–'}<div class="${ch === null ? 'dim' : ch >= 0 ? 'pos' : 'neg'}" style="font-size:12px">${ch === null ? '' : (ch >= 0 ? '+' : '') + C.fmtNum(ch * 100, 2) + ' %'}</div></div></div>`; }).join('')}</div>` : ''}
      ${pea && pea.plafond && (pea.lignes || []).length ? `<div class="card"><h2>Plafond PEA</h2><div class="between" style="margin-bottom:8px"><span class="m"><b>${E0(pea.verse)}</b> <span class="dim">/ ${E0(pea.plafond)}</span></span><span>${P(pea.verse / pea.plafond, 1)}</span></div>${barre(pea.verse / pea.plafond)}</div>` : ''}
      <div class="card"><h2>Objectifs</h2>${objs.length ? objs.map(({ o, pr }) => { const e = pr.etat; return `<div class="item"><div>${ring(e.pct, P(e.pct), e.pct >= 1 ? 'var(--pos)' : null)}</div><div class="t"><b>${esc(o.emoji || '🎯')} ${esc(o.nom)}</b><div class="d m">${E0(e.actuel)} / ${E0(e.cible)}</div>
        <div class="dim" style="font-size:12px;white-space:normal">${e.pct >= 1 ? '<span class="pos">Atteint 🎉</span>' : pr.date ? `Atteint en ${C.keyLong(pr.date).toLowerCase()} au rythme de ${E0(pr.rythme)}/mois${pr.avance !== null ? (pr.avance >= 0 ? ` · <span class="pos">${pr.avance} mois d’avance</span>` : ` · <span class="warn">${-pr.avance} mois de retard</span>`) : ''}` : o.echeance && e.parMois ? `${E0(e.parMois)}/mois jusqu’au ${C.isoFr(o.echeance)}` : 'Indique un versement mensuel sur le PC pour la date prévue'}</div></div></div>`; }).join('') : '<div class="empty">Aucun objectif (à créer sur le PC).</div>'}</div></div>`;
  }

  // ---------- Assistant (IA locale) ----------
  function barresIA(ch) {
    if (!ch || !ch.items || !ch.items.length) return '';
    const max = Math.max(...ch.items.map(i => Math.max(i.v, i.ref || 0)), 1);
    return `<div class="ia-bars">${ch.items.map((i, j) => `<div class="ia-bar"><span class="l">${esc(i.l)}</span><span class="t"><i style="width:${(i.v / max * 100).toFixed(1)}%;background:${PAL[j % PAL.length]}"></i></span><span class="v m">${E0(i.v)}</span></div>`).join('')}</div>`;
  }
  // en mode discret, seuls les montants sont floutés (pas les catégories)
  const masquer = h => String(h || '').replace(/(^|[^\w,.])([-+−]?\d[\d\s\u00a0\u202f]*(?:[,.]\d+)?[\s\u00a0\u202f]?€)/g, '$1<span class="m">$2</span>');
  function bulle(m, i) {
    if (m.de === 'moi') return `<div class="bul moi">${esc(m.texte)}</div>`;
    const r = m.r || {};
    const actions = (r.actions || []).length && !m.fait ? `<div class="ia-acts">${r.actions.map((a, j) => `<button class="btn small ${a.secondaire ? '' : 'primary'}" data-a="ia-act" data-m="${i}" data-j="${j}">${a.secondaire ? esc(a.label) : '+ ' + esc(a.label)}</button>`).join('')}${r.saisie && r.saisie.type !== 'vers' ? `<button class="btn small" data-a="ia-autre" data-m="${i}">Autre…</button>` : ''}</div>` : m.fait ? `<div class="ia-ok">✓ ${masquer(esc(m.fait))}</div>` : '';
    const liste = (r.liste || []).length ? `<div class="ia-liste">${r.liste.map(x => `<div><span class="dim">${C.isoFr(x.d).slice(0, 5)}</span><span>${esc(x.l)}</span><b class="m">${E(x.v)}</b></div>`).join('')}</div>` : '';
    return `<div class="bul ia ${r.ton ? 't-' + r.ton : ''}"><div>${masquer(r.html)}</div>${barresIA(r.chart)}${liste}${actions}</div>`;
  }
  function vueAssistant() {
    const ms = st.ia.msgs, dern = ms.length ? ms[ms.length - 1] : null;
    const sugg = dern && dern.r && dern.r.suggestions ? dern.r.suggestions : ['Fais-moi un bilan', 'Combien il me reste ?', 'Où part mon argent ?', 'Donne-moi des conseils', 'Que sais-tu faire ?'];
    return top('Assistant', true, `<button class="ibtn" data-a="ia-effacer" aria-label="Effacer">${svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>')}</button>`) + `<div class="view ia-view">
      <div class="dim" style="font-size:12px;text-align:center;margin:-4px 0 12px">IA locale · calculée sur ton iPhone, rien n’est envoyé</div>
      <div id="ia-fil">${ms.length ? ms.map(bulle).join('') : `<div class="bul ia">Bonjour${st.data.settings.prenom ? ' ' + esc(st.data.settings.prenom) : ''} 👋 Pose-moi une question sur ton budget, ou écris une dépense comme « <b>12,90 kebab</b> » : je la classe et je l’envoie à ton PC.</div>`}</div></div>
      <div class="ia-bas"><div class="ia-sugg">${sugg.map(q => `<button data-a="ia-sugg" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="ia-in"><input id="ia-q" placeholder="Écris ou dicte ta question…" autocomplete="off" enterkeyhint="send"><button class="btn primary" data-a="ia-envoyer" aria-label="Envoyer">↑</button></div></div>`;
  }
  function demanderIA(q) {
    q = String(q || '').trim(); if (!q) return;
    st.ia.msgs.push({ de: 'moi', texte: q });
    let r; try { r = C.IA.repondre({ data: st.data, comp: st.comp, today: C.todayISO() }, q, st.ia.etat); } catch (e) { r = { html: 'Oups : ' + esc(e.message) }; }
    st.ia.etat = r.etat || st.ia.etat;
    st.ia.msgs.push({ de: 'ia', r: { html: r.html, chart: r.chart, liste: r.liste, actions: r.actions, saisie: r.saisie, suggestions: r.suggestions, ton: r.ton } });
    st.ia.msgs = st.ia.msgs.slice(-40); LS.set('iaMsgs', st.ia.msgs);
    rendre(); setTimeout(() => { window.scrollTo(0, document.body.scrollHeight); }, 30);
  }
  async function ajouterDepuisIA(s, propose) {
    const op = s.type === 'vers' ? { t: 'vers', date: s.date, montant: s.montant, ligne: s.ligne, com: s.com || '' } : { t: s.type, date: s.date, montant: s.montant, cat: s.cat, com: s.com || '' };
    if (propose && s.cat && propose.cat !== s.cat && s.com) await ajouterOp({ t: 'regle', motif: s.com, cat: s.cat });
    await ajouterOp(op);
    return s.type === 'vers' ? `Versement ${E(s.montant)} · ${s.ligne}` : `${s.cat} · ${E(s.montant)}`;
  }

  // ---------- Plus ----------
  function vuePlus() {
    const lien = (go, ic, t, d) => `<div class="item" data-go="${go}"><div class="chip">${ic}</div><div class="t"><b>${t}</b><div class="d">${d}</div></div><div class="dim">›</div></div>`;
    const d = st.data, ab = C.abonnementsResume(d, 30);
    return top('Plus') + `<div class="view"><div class="card">
      ${lien('journal', '≡', 'Journal des dépenses', `${d.depenses.length} saisie(s) datée(s)`)}
      ${lien('comptes', '🏦', 'Comptes & patrimoine', `${E0(C.patrimoine(d).total)} de patrimoine net`)}
      ${lien('abos', '↻', 'Abonnements', `${E0(ab.mensuel)} / mois · ${ab.prochains.length} dans les 30 j`)}
      ${lien('voyages', '✈︎', 'Voyages', `${(d.voyages || []).length} voyage(s)`)}
      ${lien('defis', '🏆', 'Défis', `${(d.defis || []).filter(x => !x.statut).length} en cours`)}
      ${lien('reglages', '⚙︎', 'Réglages', 'Synchronisation, thème, déconnexion')}</div></div>`;
  }
  function vueJournal() {
    const q = (st.q || '').toLowerCase().trim();
    const list = st.data.depenses.filter(x => !q || (x.cat + ' ' + (x.com || '') + ' ' + x.montant).toLowerCase().includes(q)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.saisi || '').localeCompare(a.saisi || '')).slice(0, 300);
    let jour = '', html = '';
    list.forEach(x => { if (x.date !== jour) { jour = x.date; html += `<div class="daygrp">${new Date(x.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>`; } html += ligneDep(x); });
    return top('Journal', true) + `<div class="view"><input class="search" id="q" type="search" placeholder="Rechercher (catégorie, note, montant)" value="${esc(st.q || '')}"><div class="card" style="padding-top:4px">${html || '<div class="empty">Rien trouvé.</div>'}</div></div>`;
  }
  function vueComptes() {
    const d = st.data, pat = C.patrimoine(d);
    return top('Comptes', true) + `<div class="view"><div class="card hero"><div class="muted" style="font-weight:600">Patrimoine net</div><div class="big m">${E0(pat.total)}</div>${pat.pfOn ? `<div class="muted" style="font-size:13px">dont portefeuille ${E0(pat.pfVal)}</div>` : ''}</div>
      <div class="card">${pat.comptes.length ? pat.comptes.map(x => `<div class="item" data-a="maj-solde" data-id="${esc(x.c.id)}"><div class="chip">${esc((x.c.nom || '?').slice(0, 1))}</div><div class="t"><b>${esc(x.c.nom)}</b><div class="d">${esc(x.c.banque || '')}${x.date ? ' · ' + C.isoFr(x.date) : ' · aucun solde'}</div></div><div class="v m ${x.valeur < 0 ? 'neg' : ''}">${x.solde === null ? '–' : E(x.valeur)}</div></div>`).join('') : '<div class="empty">Aucun compte (à créer sur le PC).</div>'}</div>
      <div class="dim" style="font-size:12px;text-align:center">Touche un compte pour mettre à jour son solde.</div></div>`;
  }
  function vueAbos() {
    const d = st.data, list = (d.abonnements || []).filter(a => a.actif !== false).sort((a, b) => (a.prochaine || '').localeCompare(b.prochaine || '')), ab = C.abonnementsResume(d, 30);
    return top('Abonnements', true) + `<div class="view"><div class="grid2"><div class="mini"><div class="l">Par mois</div><div class="v m">${E0(ab.mensuel)}</div></div><div class="mini"><div class="l">Par an</div><div class="v m">${E0(ab.annuel)}</div></div></div>
      <div class="card">${list.length ? list.map(a => { const late = a.prochaine && a.prochaine < C.todayISO(); return `<div class="item"><div class="chip ${late ? 'warn' : ''}">↻</div><div class="t"><b>${esc(a.nom)}</b><div class="d">${(C.FREQ[a.frequence] || C.FREQ.mensuel).l} · ${late ? 'en retard · ' : ''}${a.prochaine ? C.isoFr(a.prochaine) : '–'}</div></div><div class="v"><div class="m">${E(a.montant)}</div><button class="btn small" style="margin-top:4px" data-a="abo-paye" data-id="${esc(a.id)}">Payé</button></div></div>`; }).join('') : '<div class="empty">Aucun abonnement.</div>'}</div></div>`;
  }
  function vueVoyages() {
    const vs = (st.data.voyages || []).map(v => ({ v, e: C.voyageEtat(v) })).sort((a, b) => (b.v.debut || '').localeCompare(a.v.debut || ''));
    return top('Voyages', true) + `<div class="view">${vs.length ? vs.map(({ v, e }) => `<div class="card"><div class="between"><b style="font-size:16px">${esc(v.emoji || '✈️')} ${esc(v.nom)}</b><span class="tag ${e.statut === 'encours' ? 'pos' : e.statut === 'avenir' ? '' : 'mute'}">${{ idee: 'idée', avenir: e.dans !== null ? 'J-' + e.dans : 'à venir', encours: 'en cours', passe: 'passé' }[e.statut]}</span></div>
      <div class="dim" style="font-size:12.5px;margin:4px 0 10px">${v.debut ? C.isoFr(v.debut) : ''}${v.fin ? ' → ' + C.isoFr(v.fin) : ''}${e.jours ? ` · ${e.jours} jours` : ''}</div>
      <div class="between m" style="margin-bottom:6px"><span>${E0(e.reel)} <span class="dim">/ ${E0(e.budget)}</span></span><span>${P(e.pctBudget)}</span></div>${barre(e.pctBudget, e.pctBudget > 1 ? 'over' : '')}
      ${e.check.n ? `<div class="dim" style="font-size:12px;margin-top:8px">Checklist : ${e.check.fait}/${e.check.n}</div>` : ''}</div>`).join('') : '<div class="card"><div class="empty">Aucun voyage (à créer sur le PC).</div></div>'}</div>`;
  }
  function vueDefis() {
    const d = st.data, list = (d.defis || []).map(x => ({ x, e: C.defiEtat(d, st.comp, x) }));
    const enc = list.filter(y => y.e.statut === 'encours'), fin = list.filter(y => y.e.statut !== 'encours');
    const carte = ({ x, e }) => { const t = C.TYPES_DEFI[x.type] || { nom: x.type, emoji: '🎯' }; return `<div class="item" style="display:block"><div class="between"><b>${t.emoji} ${esc(t.nom)}</b>${e.statut === 'reussi' ? '<span class="tag pos">réussi 🏆</span>' : e.statut === 'echoue' ? '<span class="tag neg">raté</span>' : `<span class="tag">J-${e.joursRestants}</span>`}</div><div class="dim dz" style="font-size:12.5px;margin:4px 0 8px">${esc(e.texte)}${e.detail ? ' · ' + esc(e.detail) : ''}</div>${barre(e.progress, e.statut === 'echoue' ? 'over' : e.statut === 'reussi' ? 'ok' : '')}</div>`; };
    return top('Défis', true) + `<div class="view"><div class="card"><h2>En cours</h2>${enc.length ? enc.map(carte).join('') : '<div class="empty">Aucun défi en cours. Lance-en un depuis le PC (Analyses › Calendrier & défis).</div>'}</div>${fin.length ? `<div class="card"><h2>Terminés</h2>${fin.slice(0, 10).map(carte).join('')}</div>` : ''}</div>`;
  }
  function vueReglages() {
    const s = st.sync, t = LS.get('theme', 'auto');
    return top('Réglages', true) + `<div class="view">
      <div class="card"><h2>Synchronisation</h2>
        <div class="item"><div class="t"><b>Dernière synchro</b><div class="d">${s.at ? new Date(s.at).toLocaleString('fr-FR') : 'jamais'}</div></div></div>
        <div class="item"><div class="t"><b>Données du PC</b><div class="d">${st.snap && st.snap.at ? new Date(st.snap.at).toLocaleString('fr-FR') : 'pas encore reçues'}${st.snap && st.snap.app ? ' · appli PC ' + esc(st.snap.app) : ''}</div></div></div>
        <div class="item"><div class="t"><b>Saisies en attente</b><div class="d">${st.ops.filter(o => !o.sent).length} à envoyer · ${st.ops.filter(o => o.sent).length} envoyée(s), en attente du PC</div></div></div>
        ${s.err && s.err !== 'Hors ligne' ? `<div class="banner err" style="margin-top:10px">${esc(s.err)}</div>` : ''}
        <button class="btn primary" style="margin-top:10px" data-a="sync">Synchroniser maintenant</button></div>
      <div class="card"><h2>Apparence</h2><div class="seg" style="margin:0">${[['auto', 'Auto'], ['sombre', 'Sombre'], ['clair', 'Clair']].map(([k, l]) => `<button class="${t === k ? 'on' : ''}" data-a="theme" data-v="${k}">${l}</button>`).join('')}</div></div>
      <div class="card"><h2>Sécurité</h2><div class="dim" style="font-size:13px;margin-bottom:10px">Tes données sont chiffrées avec ton mot de passe avant de passer par Google. Sur cet iPhone, elles restent dans le stockage de l’app.</div>
        <button class="btn" data-a="verrouiller">Oublier le mot de passe</button><button class="btn danger" style="margin-top:8px" data-a="deconnecter">Déconnecter cet iPhone</button></div>
      <div class="card"><h2>Confidentialité</h2><div class="between"><span>Masquer les montants<div class="dim" style="font-size:12px">aussi avec l’œil en haut de l’écran</div></span><button class="btn small ${LS.get('discret', false) ? 'primary' : ''}" data-a="discret">${LS.get('discret', false) ? 'Activé' : 'Désactivé'}</button></div></div>
      <div class="card"><h2>Version de l’app</h2><div class="item"><div class="t"><b>Version installée : ${APP_V}</b><div class="d">${majDispo ? 'Nouvelle version disponible : ' + esc(majDispo) : 'Mise à jour automatique à chaque ouverture'}</div></div></div>
        <button class="btn ${majDispo ? 'primary' : ''}" style="margin-top:8px" data-a="${majDispo ? 'appliquer-maj' : 'verifier-maj'}">${majDispo ? 'Installer la version ' + esc(majDispo) : 'Vérifier les mises à jour'}</button></div>
      <div class="dim" style="font-size:12px;text-align:center">App iPhone ${APP_V} · Budget & Investissements</div></div>`;
  }

  // ---------- Écrans de connexion ----------
  function vueInstaller() {
    return `<div class="welcome"><img class="logo" src="apple-touch-icon.png" alt=""><h1>Installe l’app sur ton iPhone</h1>
      <p>Pour qu’elle fonctionne comme une vraie app (plein écran, hors ligne), ajoute-la d’abord à l’écran d’accueil :</p>
      <div class="steps"><div><b class="n">1</b><span>Touche le bouton <b>Partager</b> <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;color:var(--acc)"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/></svg> en bas de Safari (ou ••• puis Partager).</span></div><div><b class="n">2</b><span>Choisis <b>Sur l’écran d’accueil</b>, vérifie que <b>Ouvrir en tant qu’app web</b> est activé, puis <b>Ajouter</b>.</span></div><div><b class="n">3</b><span>Ouvre <b>Budget</b> depuis l’écran d’accueil et tape ton mot de passe.</span></div></div>
      ${st.cfg ? `<p style="font-size:13px">Si l’app installée te demande un code, colle celui-ci :</p><button class="btn" data-a="copier-code">Copier le code de connexion</button>` : ''}
      <button class="link" style="margin-top:6px" data-a="continuer-safari">Continuer dans Safari quand même</button></div>`;
  }
  function vueCode() {
    return `<div class="welcome"><img class="logo" src="apple-touch-icon.png" alt=""><h1>Connecter ton iPhone</h1>
      <p>Sur ton PC, ouvre <b>Budget & Investissements › Téléphone › Application iPhone</b> et scanne le QR code avec l’appareil photo, ou colle ici le <b>code de connexion</b> (bouton « Copier le code de connexion »).</p>
      <textarea id="code" rows="4" placeholder="Colle le code de connexion ici" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
      <button class="btn primary" data-a="valider-code">Continuer</button></div>`;
  }
  function vueMotDePasse() {
    return `<div class="welcome"><img class="logo" src="apple-touch-icon.png" alt=""><h1>Ton mot de passe</h1>
      <p>Celui que tu as choisi dans l’appli du PC (page Téléphone). Il déchiffre tes données ; il n’est jamais envoyé sur internet.</p>
      <input id="pass" type="password" placeholder="Mot de passe" autocomplete="current-password">
      <button class="btn primary" data-a="valider-pass" id="btn-pass">Déverrouiller</button>
      <button class="link" data-a="changer-code">Utiliser un autre code de connexion</button></div>`;
  }
  function vueAttente() {
    return `<div class="welcome"><img class="logo" src="apple-touch-icon.png" alt=""><h1>En attente du PC</h1>
      <p>La connexion fonctionne, mais ton PC n’a pas encore envoyé de données. Ouvre l’appli sur le PC (page Téléphone › Application iPhone › « Synchroniser maintenant »), puis touche le bouton ci-dessous.</p>
      ${st.sync.err ? `<div class="banner err">${esc(st.sync.err)}</div>` : ''}
      <button class="btn primary" data-a="sync">${st.sync.busy ? 'Synchronisation…' : 'Réessayer'}</button><button class="link" data-a="deconnecter">Recommencer la connexion</button></div>`;
  }

  // ---------- Rendu ----------
  function rendre() {
    appliquerTheme();
    const app = $('#app');
    if (ios && !standalone() && !LS.get('safariOk', false)) { app.innerHTML = vueInstaller(); return; }
    if (!st.cfg) { app.innerHTML = vueCode(); return; }
    if (!st.key) { app.innerHTML = vueMotDePasse(); return; }
    if (!st.data) { app.innerHTML = vueAttente(); return; }
    const V = { assistant: vueAssistant, accueil: vueAccueil, budget: vueBudget, saisir: vueSaisir, invest: vueInvest, plus: vuePlus, journal: vueJournal, comptes: vueComptes, abos: vueAbos, voyages: vueVoyages, defis: vueDefis, reglages: vueReglages }[st.route] || vueAccueil;
    let html;
    try { html = V(); } catch (e) { console.error(e); html = top('Oups', true) + `<div class="view"><div class="banner err">Affichage impossible : ${esc(e.message)}</div></div>`; }
    app.innerHTML = html + (st.route === 'saisir' || st.route === 'assistant' ? '' : nav());
    if (st.route === 'assistant') { setTimeout(() => { window.scrollTo(0, document.body.scrollHeight); }, 20); }
    if (st.route === 'saisir') { const i = $('#f-mt'); if (i && !st.form.mt && !st.form.phrase) setTimeout(() => i.focus(), 120); }
  }
  function feuille(html) {
    const b = document.createElement('div'); b.className = 'sheet-back'; b.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
    b.addEventListener('click', e => { if (e.target === b) b.remove(); });
    $('#sheet-root').appendChild(b); return b;
  }
  const fermerFeuilles = () => { $('#sheet-root').innerHTML = ''; };
  function confirmer(titre, texte, ok) {
    return new Promise(res => {
      const b = feuille(`<h3>${esc(titre)}</h3><p class="muted" style="margin:0 0 16px">${esc(texte)}</p><button class="btn primary" data-r="1">${esc(ok || 'Confirmer')}</button><button class="btn" style="margin-top:8px" data-r="0">Annuler</button>`);
      b.addEventListener('click', e => { const r = e.target.closest('[data-r]'); if (r) { b.remove(); res(r.dataset.r === '1'); } else if (e.target === b) res(false); });
    });
  }

  // ---------- Actions ----------
  function memForm() { const f = st.form, a = $('#f-mt'), d = $('#f-date'), c = $('#f-com'), p = $('#f-phrase'); if (a) f.mt = a.value; if (d) f.date = d.value; if (c) f.com = c.value; if (p) f.phrase = p.value; }
  const A = {
    back: retour,
    sync: () => synchroniser(true),
    mois: el => { const ks = C.monthKeys(st.data), i = ks.indexOf(st.month) + Number(el.dataset.d); if (ks[i]) { st.month = ks[i]; rendre(); } },
    ligne: el => feuilleLigne(el.dataset.id),
    'ajouter-ici': el => { fermerFeuilles(); st.form = { type: el.dataset.t, cat: el.dataset.cat, date: C.todayISO() }; aller('saisir'); },
    'f-type': el => { memForm(); st.form.type = el.dataset.v; rendre(); },
    'f-cat': el => { memForm(); st.form.cat = el.dataset.v; rendre(); },
    'f-ligne': el => { memForm(); st.form.ligne = el.dataset.v; rendre(); },
    'f-compte': el => { memForm(); st.form.compte = el.dataset.v; rendre(); },
    enregistrer,
    'ia-envoyer': () => { const q = $('#ia-q'); if (q) demanderIA(q.value); },
    'ia-sugg': el => demanderIA(el.dataset.q),
    'ia-effacer': () => { st.ia.msgs = []; st.ia.etat = {}; LS.set('iaMsgs', []); rendre(); },
    'ia-act': async el => {
      const m = st.ia.msgs[+el.dataset.m], a = m && m.r.actions[+el.dataset.j]; if (!a) return;
      m.fait = 'Ajouté · ' + await ajouterDepuisIA(a.saisie, m.r.saisie) + ' (envoyé au PC)'; LS.set('iaMsgs', st.ia.msgs); rendre(); toast('Ajouté ✓');
    },
    'ia-autre': el => {
      const m = st.ia.msgs[+el.dataset.m], s = m && m.r.saisie; if (!s) return;
      const cats = catsDe(s.type), b = feuille(`<h3>Quelle catégorie ?</h3><div class="dim" style="font-size:13px;margin-bottom:10px">Je retiendrai ton choix pour « ${esc(s.com || '')} ».</div><div class="chipsel">${cats.map(c => `<button data-c="${esc(c)}" class="${c === s.cat ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>`);
      b.addEventListener('click', async e => { const c = e.target.closest('[data-c]'); if (!c) return; b.remove(); m.fait = 'Ajouté · ' + await ajouterDepuisIA(Object.assign({}, s, { cat: c.dataset.c }), s) + ' (envoyé au PC)'; LS.set('iaMsgs', st.ia.msgs); rendre(); toast('Ajouté ✓ · catégorie retenue'); });
    },
    'maj-solde': el => { st.form = { type: 'solde', compte: el.dataset.id, date: C.todayISO() }; aller('saisir'); },
    'abo-paye': async el => { const a = st.data.abonnements.find(x => x.id === el.dataset.id); if (!a) return; if (!(await confirmer(`${a.nom} payé ?`, `${E(a.montant)} seront ajoutés au budget${a.categorie ? ` (« ${a.categorie} »)` : ''} et la prochaine échéance sera décalée.`, 'Oui, payé'))) return; await ajouterOp({ t: 'abo', abo: a.id, date: a.prochaine || C.todayISO() }); toast('Abonnement payé ✓'); rendre(); },
    theme: el => { LS.set('theme', el.dataset.v); rendre(); },
    'basculer-theme': () => { LS.set('theme', themeEffectif() === 'clair' ? 'sombre' : 'clair'); rendre(); toast(themeEffectif() === 'clair' ? 'Thème clair' : 'Thème sombre'); },
    discret: () => { const v = !LS.get('discret', false); LS.set('discret', v); rendre(); toast(v ? 'Montants masqués 🙈' : 'Montants visibles'); },
    'verifier-maj': () => verifierMaj(true),
    'appliquer-maj': () => appliquerMaj(),
    verrouiller: async () => { if (!(await confirmer('Oublier le mot de passe', 'Il faudra le retaper à la prochaine ouverture. Tes saisies en attente sont conservées.', 'Oublier'))) return; st.key = null; await idb.del('key'); st.data = null; rendre(); },
    deconnecter: async () => { if (!(await confirmer('Déconnecter cet iPhone', 'Les données et les saisies pas encore envoyées seront effacées de cet iPhone.', 'Déconnecter'))) return; ['cfg', 'ver', 'ops', 'snapEnc', 'syncAt', 'serverAt'].forEach(k => LS.del(k)); await idb.del('key'); location.replace(location.pathname); },
    'copier-code': async () => { try { await navigator.clipboard.writeText(new URLSearchParams(location.search).get('c') || ''); toast('Code copié'); } catch (e) { toast('Copie impossible', true); } },
    'continuer-safari': () => { LS.set('safariOk', true); rendre(); },
    'valider-code': () => { const c = lireCode($('#code').value.replace(/^.*[?&]c=/, '')); if (!c) return toast('Code invalide', true); enregistrerCfg(c); rendre(); },
    'changer-code': () => { st.cfg = null; LS.del('cfg'); rendre(); },
    'valider-pass': async () => {
      const pass = $('#pass').value; if (!pass) return;
      const b = $('#btn-pass'); b.disabled = true; b.textContent = 'Vérification…';
      try {
        const key = await deriver(pass, st.cfg.s);
        let r = null; try { r = navigator.onLine ? await api({ api: 'snap_get' }) : null; } catch (e) { st.sync.err = String(e.message || e); }
        if (r && r.ver) {
          let snap; try { snap = JSON.parse(await dechiffrer(key, r.data)); } catch (e) { b.disabled = false; b.textContent = 'Déverrouiller'; return toast('Mot de passe incorrect', true); }
          st.snap = snap; st.ver = r.ver; LS.set('snapEnc', r.data); LS.set('ver', r.ver); st.sync.at = Date.now(); LS.set('syncAt', st.sync.at); st.sync.err = null;
        } else if (LS.get('snapEnc', null)) {
          try { st.snap = JSON.parse(await dechiffrer(key, LS.get('snapEnc'))); } catch (e) { b.disabled = false; b.textContent = 'Déverrouiller'; return toast('Mot de passe incorrect', true); }
        }
        st.key = key; await idb.set('key', key);
        nettoyerOps(); reconstruire(); rendre();
        if (st.data) toast('Bienvenue ✓');
      } catch (e) { b.disabled = false; b.textContent = 'Déverrouiller'; toast(String(e.message || e), true); }
    }
  };
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-tab]'); if (t) { st.hist = []; st.route = t.dataset.tab; rendre(); window.scrollTo(0, 0); return; }
    const g = e.target.closest('[data-go]'); if (g) { if (g.dataset.go === 'saisir' && st.route !== 'saisir') st.form = { type: (st.form && st.form.type) || 'dep', cat: st.form && st.form.cat, date: C.todayISO() }; aller(g.dataset.go); return; }
    const a = e.target.closest('[data-a]'); if (a && A[a.dataset.a]) { e.preventDefault(); A[a.dataset.a](a); }
  });
  let phraseTimer = null;
  document.addEventListener('input', e => {
    if (e.target.id !== 'f-phrase') return;
    clearTimeout(phraseTimer);
    phraseTimer = setTimeout(() => {
      const v = e.target.value, s = C.IA.analyserSaisie(st.data, v, C.todayISO()); memForm(); st.form.phrase = v;
      if (s && v.trim()) {
        if (s.type !== st.form.type && st.form.type !== 'solde') st.form.type = s.type;
        if (s.montant) st.form.mt = (Number.isInteger(s.montant) ? String(s.montant) : s.montant.toFixed(2)).replace('.', ',');
        st.form.date = s.date; if (s.com) st.form.com = s.com;
        if (s.type === 'vers') { if (s.ligne) st.form.ligne = s.ligne; } else if (s.cat) { st.form.cat = s.cat; st.form.phraseCat = s.cat; }
        st.form.phraseInfo = `Compris : <b class="m">${s.montant ? E(s.montant) : '?'}</b> · ${esc(s.type === 'vers' ? s.ligne || '?' : s.cat || '?')} · ${C.isoFr(s.date)}${s.confiance < 0.5 ? ' · <span class="warn">vérifie la catégorie</span>' : ''}`;
      } else st.form.phraseInfo = '';
      rendre(); const p = $('#f-phrase'); if (p) { p.focus(); p.setSelectionRange(p.value.length, p.value.length); }
    }, 450);
  });
  document.addEventListener('input', e => { if (e.target.id === 'q') { st.q = e.target.value; const pos = e.target.selectionStart; rendre(); const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } } });
  document.addEventListener('keydown', e => { if (e.key === 'Enter') { if (e.target.id === 'ia-q') { e.preventDefault(); demanderIA(e.target.value); return; } if (e.target.id === 'pass') A['valider-pass'](); else if (e.target.id === 'f-mt' || e.target.id === 'f-com') { e.preventDefault(); enregistrer(); } } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) synchroniser(); });
  window.addEventListener('online', () => synchroniser());
  setInterval(() => { if (!document.hidden) synchroniser(); }, 90e3);
  setInterval(() => { if (!document.hidden && ['accueil'].includes(st.route)) majStatut(); }, 30e3);

  // ---------- Mise à jour automatique de l'app ----------
  let majDispo = null;
  async function verifierMaj(manuel) {
    if (location.protocol !== 'https:' && !manuel) return;
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
      const v = (await r.json()).v;
      if (v && v !== APP_V) {
        majDispo = v;
        if (st.route !== 'saisir' && !document.querySelector('.sheet-back')) return appliquerMaj(); // automatique quand rien n'est en cours
        rendre();
      } else if (manuel) toast('Tu as la dernière version (' + APP_V + ')');
    } catch (e) { if (manuel) toast('Vérification impossible (hors ligne ?)', true); }
  }
  async function appliquerMaj() {
    LS.set('majDe', APP_V);
    try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (e) { /* */ }
    try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.update())); } catch (e) { /* */ }
    location.reload();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) verifierMaj(); });

  // ---------- Démarrage ----------
  async function demarrer() {
    appliquerTheme();
    const c = new URLSearchParams(location.search).get('c');
    if (c) { const cfg = lireCode(c); if (cfg) enregistrerCfg(cfg); if (standalone()) history.replaceState(null, '', location.pathname); }
    if (st.cfg) { try { st.key = (await idb.get('key')) || null; } catch (e) { st.key = null; } }
    if (st.key && LS.get('snapEnc', null)) { try { st.snap = JSON.parse(await dechiffrer(st.key, LS.get('snapEnc'))); } catch (e) { st.snap = null; } }
    nettoyerOps(); reconstruire(); rendre();
    if (st.key) synchroniser();
    const de = LS.get('majDe', null); if (de && de !== APP_V) { LS.del('majDe'); setTimeout(() => toast('✅ App mise à jour : version ' + APP_V), 600); }
    verifierMaj();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__bi = { st, synchroniser, reconstruire }; // pour les tests
  demarrer();
})();
