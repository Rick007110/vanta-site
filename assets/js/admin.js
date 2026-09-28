// Vanta admin dashboard. Signs in with Discord through Supabase Auth, then only talks to the public.vanta_admin_*
// functions; the database checks on every call that the signed-in Discord account is an admin.
import { SUPABASE_URL, SUPABASE_KEY, REPO } from './config.js';
import { t, lang, onLangChange } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => Number(v || 0).toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-US');
const DEMO = new URLSearchParams(location.search).has('demo') && ['localhost', '127.0.0.1'].includes(location.hostname);

const STATUSES = ['open', 'fixed', 'cant_reproduce', 'duplicate'];
const REQ_STATUSES = ['open', 'planned', 'in_progress', 'added', 'rejected'];
const statusLabel = (k) => (STATUSES.includes(k) ? t(`ad.s.${k}`) : k);
const reqLabel = (k) => (REQ_STATUSES.includes(k) ? t(`ad.rs.${k}`) : k);
const ERRORS = ['forbidden', 'not_found', 'invalid_status', 'invalid_fixed_in_version', 'cannot_ban_admin', 'user_not_found', 'rate_limited', 'note_too_long', 'name_too_long', 'invalid_discord_id'];

let sb = null;
let me = null;
const state = { reports: null, requests: null, stats: null, latestVersion: '' };

// ---------------------------------------------------------------- views
function view(name) {
  $$('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== name; });
}
function toast(text, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`; el.textContent = text; el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  $('[data-toasts]').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3500);
}
function errText(e) {
  const code = (e && (e.message || e.code)) || 'error';
  return ERRORS.includes(code) ? t(`ad.err.${code}`) : code;
}

// ---------------------------------------------------------------- dialog (confirm / prompt)
function ask({ title, body = '', ok = t('ad.ok'), danger = false, input = null }) {
  const dlg = $('[data-dialog]');
  $('[data-bind=dlg-title]').textContent = title;
  $('[data-bind=dlg-body]').textContent = body;
  const okBtn = $('[data-bind=dlg-ok]');
  okBtn.textContent = ok; okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  const field = $('[data-bind=dlg-field]'), inp = $('[data-bind=dlg-input]');
  field.hidden = !input;
  if (input) { $('[data-bind=dlg-label]').textContent = input.label; inp.value = input.value || ''; inp.placeholder = input.placeholder || ''; }
  return new Promise((resolve) => {
    const onClose = () => { dlg.removeEventListener('close', onClose); resolve(dlg.returnValue === 'ok' ? (input ? inp.value.trim() : true) : null); };
    dlg.returnValue = '';
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    if (input) { inp.focus(); inp.select(); }
  });
}
// light dismiss for browsers without closedby support
$('[data-dialog]').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close('cancel'); });

// ---------------------------------------------------------------- RPC
async function rpc(fn, args = {}) {
  if (DEMO) return demoRpc(fn, args);
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || error.message === 'forbidden' || error.code === 'PGRST301' || error.code === 'PGRST303') {
      await denied(); throw error;
    }
    throw error;
  }
  return data;
}

// ---------------------------------------------------------------- auth flow
async function boot() {
  if (DEMO) { me = { name: 'Demo admin', avatar: '' }; return enter(); }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: 'vanta-admin-auth' },
  });
  const params = new URLSearchParams(location.search);
  const oauthError = params.get('error_description') || params.get('error');
  const { data: { session } } = await sb.auth.getSession();
  if ([...params.keys()].some((k) => ['code', 'error', 'error_code', 'error_description', 'state'].includes(k))) {
    history.replaceState(null, '', location.pathname);
  }
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') view('login'); });
  if (!session) {
    view('login');
    if (oauthError) showLoginError(oauthError);
    return;
  }
  const u = session.user || {}, m = u.user_metadata || {};
  me = { name: (m.custom_claims && m.custom_claims.global_name) || m.full_name || m.user_name || 'Admin',
         avatar: /^https:\/\/cdn\.discordapp\.com\//.test(m.avatar_url || '') ? m.avatar_url : '' };
  const { data: isAdmin, error } = await sb.rpc('vanta_is_admin');
  if (error) {
    if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) { view('setup'); return; }
    view('setup');
    setupMsg(t('ad.setupcheck', { e: error.message || error.code || 'error' }));
    return;
  }
  if (isAdmin !== true) return denied();
  enter();
}

function setupMsg(text) {
  const el = $('[data-bind=setup-msg]');
  el.removeAttribute('data-i18n-html'); el.textContent = text;
}
function showLoginError(text) {
  const el = $('[data-bind=login-error]');
  el.textContent = t('ad.signinfail', { e: text }); el.hidden = false;
}

async function login() {
  const btn = $('[data-action=login]');
  btn.disabled = true;
  const redirectTo = location.origin + location.pathname;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo, scopes: 'identify' } });
  if (error) { btn.disabled = false; showLoginError(error.message); }
}

async function denied() {
  view('denied');
  if (sb) { try { await sb.auth.signOut({ scope: 'local' }); } catch { /* ignore */ } }
}

async function logout() {
  if (sb) { try { await sb.auth.signOut({ scope: 'local' }); } catch { /* ignore */ } }
  view('login');
}

function enter() {
  view('app');
  $('[data-bind=me-name]').textContent = me.name;
  const av = $('[data-bind=me-avatar]');
  av.replaceChildren();
  if (me.avatar) { const img = new Image(); img.src = me.avatar; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.onerror = () => img.remove(); av.append(img); }
  latestVersion();
  loadReports(); loadStats(true);
}

async function latestVersion() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.ok) state.latestVersion = String((await r.json()).tag_name || '').replace(/^v/, '');
  } catch { /* optional */ }
}

// ---------------------------------------------------------------- tabs
function selectTab(name, focus = false) {
  $$('[role=tab]').forEach((t) => {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  });
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  if (name === 'requests' && !state.requests) loadRequests();
  if (name === 'stats' && !state.statsRendered) loadStats();
}
$('.tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = $$('[role=tab]'), i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault(); selectTab(tabs[n].dataset.tab, true);
});

// ---------------------------------------------------------------- helpers
const ago = (unix) => {
  if (!unix) return t('ad.ago.none');
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 90) return t('ad.ago.now');
  if (s < 3600) return t('ad.ago.min', { n: Math.round(s / 60) });
  if (s < 86400) return t('ad.ago.h', { n: Math.round(s / 3600) });
  return t('ad.ago.d', { n: Math.round(s / 86400) });
};
const skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
const empty = (t) => `<div class="empty">${esc(t)}</div>`;
const coverUrl = (r) => /^https:\/\/([a-z0-9-]+\.)*(steamstatic\.com|akamaihd\.net)\//.test(r.cover_url || '') ? r.cover_url
  : `https://cdn.cloudflare.steamstatic.com/steam/apps/${Number(r.appid)}/capsule_231x87.jpg`;

// ---------------------------------------------------------------- reports
async function loadReports() {
  const list = $('[data-list=reports]');
  list.innerHTML = skeleton();
  try {
    state.reports = await rpc('vanta_admin_reports', {
      p_game: $('[data-filter=report-game]').value || null, p_status: $('[data-filter=report-status]').value, p_limit: 200,
    });
    fillGames(state.reports.games || []);
    const open = (state.reports.counts || {}).open || 0;
    const badge = $('[data-bind=open-count]');
    badge.hidden = !open; badge.textContent = String(open);
    renderReports();
  } catch (e) { list.innerHTML = empty(t('ad.loadfail.rep', { e: errText(e) })); }
}
function fillGames(games) {
  const sel = $('[data-filter=report-game]'), cur = sel.value;
  sel.replaceChildren(new Option(t('ad.allgames'), ''), ...games.map((g) => new Option(g.open ? t('ad.gameopen', { name: g.game_name || g.game_id, n: g.open }) : (g.game_name || g.game_id), g.game_id)));
  sel.value = games.some((g) => g.game_id === cur) ? cur : '';
}
// Only cheats with at least one "doesn't work" report are listed. Report states (one per game version) are grouped per
// game + cheat; "works" reports only add to the works count of such a group and never become an entry of their own.
const STATUS_RANK = { open: 0, fixed: 1, cant_reproduce: 2, duplicate: 3 };
function groupReports(items) {
  const groups = new Map();
  for (const s of items) {
    const key = `${s.game_id}\u0000${s.cheat_id}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, cheat_id: s.cheat_id, cheat_name: s.cheat_name, game_id: s.game_id, game_name: s.game_name, states: [], broken: 0, works: 0 }));
    g.states.push(s); g.broken += Number(s.broken) || 0; g.works += Number(s.works) || 0;
  }
  return [...groups.values()].filter((g) => g.broken > 0).map((g) => {
    const bad = g.states.filter((s) => Number(s.broken) > 0);
    const status = bad.map((s) => s.status).sort((a, b) => (STATUS_RANK[a] ?? 9) - (STATUS_RANK[b] ?? 9))[0];
    const uniq = (a) => [...new Set(a.filter(Boolean))];
    return Object.assign(g, {
      bad, status, score: Math.max(...bad.map((s) => Number(s.score) || 0)),
      ids: bad.map((s) => Number(s.id)),
      fixed_in_version: uniq(bad.map((s) => s.fixed_in_version)).join(', '),
      game_versions: uniq(bad.map((s) => s.game_version)), fingerprints: uniq(bad.map((s) => String(s.fingerprint || '').slice(0, 28))),
      newest_fingerprint: bad.some((s) => s.newest_fingerprint), vanta_versions: uniq(bad.flatMap((s) => s.vanta_versions || [])),
      last_report: Math.max(...bad.map((s) => Number(s.last_report) || 0)),
      notes: bad.flatMap((s) => (s.notes || []).map((n) => Object.assign({ game_version: s.game_version }, n))).sort((a, b) => (b.updated || 0) - (a.updated || 0)),
      reporters: bad.flatMap((s) => (s.reporters || []).filter((r) => r.status === 'broken').map((r) => Object.assign({ game_version: s.game_version }, r))),
    });
  }).sort((a, b) => b.score - a.score || b.broken - a.broken);
}
function renderReports() {
  const list = $('[data-list=reports]');
  const q = $('[data-filter=report-q]').value.trim().toLowerCase();
  state.reportGroups = groupReports(state.reports.items || []);
  const items = state.reportGroups.filter((s) => !q || [s.cheat_name, s.cheat_id, s.game_name, s.game_id, ...s.notes.map((n) => n.note)]
    .some((v) => String(v || '').toLowerCase().includes(q)));
  if (!items.length) { list.innerHTML = empty(q ? t('ad.empty.search') : t('ad.empty.rep')); return; }
  list.innerHTML = items.map((s) => {
    const hot = s.status === 'open' && Number(s.score) >= 1;
    const reporters = s.reporters;
    const multi = s.game_versions.length > 1;
    return `<article class="rcard" data-status="${esc(s.status)}"${hot ? ' data-hot' : ''} data-key="${esc(s.key)}" data-id="${s.ids[0]}">
      <div class="rhead">
        <div class="score${hot ? ' hot' : ''}" title="${esc(t('ad.score.t'))}"><span>${esc(Number(s.score || 0).toFixed(1))}<small>${esc(t('ad.score'))}</small></span></div>
        <div class="rtitle">
          <h3>${esc(s.cheat_name || s.cheat_id)}</h3>
          <p>${esc(s.game_name || s.game_id)}${s.game_versions.length ? ` · ${esc(s.game_versions.join(', '))}` : ''}</p>
          <p class="rcount"><b class="bad">${esc(t('ad.broken', { n: num(s.broken) }))}</b><span aria-hidden="true"> · </span><b class="good">${esc(t('ad.works', { n: num(s.works) }))}</b></p>
          <div class="chips">
            ${s.newest_fingerprint ? `<span class="chip">${esc(t('ad.newest'))}</span>` : ''}
            ${multi ? `<span class="chip">${esc(t('ad.versions', { n: s.game_versions.length }))}</span>` : ''}
            ${s.vanta_versions.length ? `<span class="chip">${esc(t('ad.vanta', { v: s.vanta_versions.join(', ') }))}</span>` : ''}
            <span class="chip">${esc(t('ad.last', { t: ago(s.last_report) }))}</span>
            ${s.fingerprints.map((f) => `<span class="chip mono" title="${esc(t('ad.fp'))}">${esc(f)}</span>`).join('')}
          </div>
        </div>
        <span class="status" data-s="${esc(s.status)}">${esc(statusLabel(s.status))}${s.status === 'fixed' && s.fixed_in_version ? ` · ${esc(s.fixed_in_version)}` : ''}</span>
      </div>
      ${s.notes.length ? `<div class="notes">${s.notes.map((n) => `<blockquote>${esc(n.note)}<span>Vanta ${esc(n.vanta_version)}${multi && n.game_version ? ` · ${esc(n.game_version)}` : ''} · ${esc(ago(n.updated))}</span></blockquote>`).join('')}</div>` : ''}
      <div class="ractions">
        ${s.status !== 'fixed' ? `<button class="btn btn-sm btn-primary" type="button" data-act="fixed">${esc(t('ad.a.fixed'))}</button>` : ''}
        ${s.status !== 'cant_reproduce' ? `<button class="btn btn-sm" type="button" data-act="cant_reproduce">${esc(t('ad.a.cnr'))}</button>` : ''}
        ${s.status !== 'duplicate' ? `<button class="btn btn-sm" type="button" data-act="duplicate">${esc(t('ad.a.dup'))}</button>` : ''}
        ${s.status !== 'open' ? `<button class="btn btn-sm" type="button" data-act="open">${esc(t('ad.a.reopen'))}</button>` : ''}
      </div>
      ${reporters.length ? `<details class="reporters"><summary>${esc(t(reporters.length === 1 ? 'ad.reporters.one' : 'ad.reporters.other', { n: reporters.length }))}</summary><ul>${reporters.map((r) => `
        <li><span class="who">${esc(r.username)}</span><span class="id">${esc(r.discord_id || t('ad.nodiscord'))}</span>
          <span class="chip bad">${esc(t('ad.doesnt'))}</span>${multi && r.game_version ? `<span class="id">${esc(r.game_version)}</span>` : ''}<span class="id">${esc(ago(r.updated))}</span>
          ${r.discord_id ? `<button class="btn btn-sm btn-danger" type="button" data-ban="${esc(r.discord_id)}" data-name="${esc(r.username)}">${esc(t('ad.ban'))}</button>` : ''}
          ${r.note ? `<span class="note">${esc(r.note)}</span>` : ''}</li>`).join('')}</ul></details>` : ''}
    </article>`;
  }).join('');
}
$('[data-list=reports]').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]'), ban = e.target.closest('[data-ban]');
  if (act) {
    const card = act.closest('[data-key]'), status = act.dataset.act;
    const s = (state.reportGroups || []).find((x) => x.key === card.dataset.key);
    if (!s) return;
    let version = null;
    if (status === 'fixed') {
      version = await ask({ title: t('ad.fix.title', { name: s.cheat_name || s.cheat_id }), body: t('ad.fix.body'), ok: t('ad.fix.ok'), input: { label: t('ad.fix.label'), value: state.latestVersion, placeholder: '0.3.2' } });
      if (version === null) return;
    }
    act.disabled = true;
    try {
      // one status for the whole cheat: apply it to every game-version state that has "doesn't work" reports
      for (const id of s.ids) await rpc('vanta_admin_set_report_status', { p_state_id: id, p_status: status, p_fixed_in_version: version || null });
      toast(status === 'open' ? t('ad.reopened') : version ? t('ad.markedin', { s: statusLabel(status).toLowerCase(), v: version }) : t('ad.marked', { s: statusLabel(status).toLowerCase() }));
      loadReports();
    } catch (err) { act.disabled = false; toast(errText(err), 'err'); loadReports(); }
  } else if (ban) {
    const ok = await ask({ title: t('ad.ban.title', { name: ban.dataset.name }), body: t('ad.ban.body'), ok: t('ad.ban.ok'), danger: true });
    if (!ok) return;
    try { await rpc('vanta_admin_ban', { p_discord_id: ban.dataset.ban, p_banned: true }); toast(t('ad.banned', { name: ban.dataset.name })); loadReports(); state.statsRendered = false; }
    catch (err) { toast(errText(err), 'err'); }
  }
});

// ---------------------------------------------------------------- requests
async function loadRequests() {
  const list = $('[data-list=requests]');
  list.innerHTML = skeleton();
  try {
    state.requests = await rpc('vanta_admin_requests', { p_status: $('[data-filter=request-status]').value, p_limit: 300 });
    renderRequests();
  } catch (e) { list.innerHTML = empty(t('ad.loadfail.req', { e: errText(e) })); }
}
function renderRequests() {
  const list = $('[data-list=requests]');
  const q = $('[data-filter=request-q]').value.trim().toLowerCase();
  const items = (state.requests.items || []).filter((r) => !q || String(r.name).toLowerCase().includes(q) || String(r.appid) === q);
  if (!items.length) { list.innerHTML = empty(q ? t('ad.req.empty.search') : t('ad.req.empty')); return; }
  list.innerHTML = items.map((r) => `<article class="qrow" data-appid="${Number(r.appid)}">
      <div class="qcover"><img src="${esc(coverUrl(r))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></div>
      <div class="qmain">
        <h3>${esc(r.name)} <span class="status" data-s="${esc(r.status)}">${esc(reqLabel(r.status))}</span>
          <a href="https://store.steampowered.com/app/${Number(r.appid)}/" target="_blank" rel="noopener noreferrer">${esc(t('ad.req.app', { id: Number(r.appid) }))}</a></h3>
        <p>${esc(t('ad.req.requested', { t: ago(r.created) }))}${r.requested_by ? esc(t('ad.req.by', { name: r.requested_by.username }) + (r.requested_by.banned ? t('ad.req.bannedtag') : '')) : ''}${r.votes_all !== r.votes ? esc(t('ad.req.bannedvotes', { n: num(r.votes_all - r.votes) })) : ''}</p>
        <div class="qedit">
          <select data-field="status" aria-label="${esc(t('ad.req.status'))}">${REQ_STATUSES.map((k) => `<option value="${k}"${k === r.status ? ' selected' : ''}>${esc(reqLabel(k))}</option>`).join('')}</select>
          <textarea data-field="note" maxlength="500" rows="1" placeholder="${esc(t('ad.req.note.ph'))}" aria-label="${esc(t('ad.req.note'))}">${esc(r.note || '')}</textarea>
          <div class="ractions"><button class="btn btn-sm btn-primary" type="button" data-req="save">${esc(t('ad.save'))}</button><button class="btn btn-sm btn-danger" type="button" data-req="delete" aria-label="${esc(t('ad.delete.aria'))}">${esc(t('ad.delete'))}</button></div>
        </div>
      </div>
      <div class="qvotes"><b>${num(r.votes)}</b><span>${esc(t('ad.req.votes', { n: num(r.votes_7d) }))}</span></div>
    </article>`).join('');
}
$('[data-list=requests]').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-req]'); if (!b) return;
  const row = b.closest('[data-appid]'), appid = Number(row.dataset.appid);
  const r = (state.requests.items || []).find((x) => Number(x.appid) === appid) || {};
  if (b.dataset.req === 'delete') {
    const ok = await ask({ title: t('ad.del.title', { name: r.name }), body: t('ad.del.body'), ok: t('ad.delete'), danger: true });
    if (!ok) return;
    try { await rpc('vanta_admin_delete_request', { p_appid: appid }); toast(t('ad.deleted')); loadRequests(); } catch (err) { toast(errText(err), 'err'); }
    return;
  }
  b.disabled = true;
  try {
    await rpc('vanta_admin_set_request', { p_appid: appid, p_status: $('[data-field=status]', row).value, p_note: $('[data-field=note]', row).value });
    toast(t('ad.saved', { name: r.name })); loadRequests();
  } catch (err) { b.disabled = false; toast(errText(err), 'err'); }
});

// ---------------------------------------------------------------- stats
async function loadStats(quiet = false) {
  const box = $('[data-list=stats]');
  if (!quiet) box.innerHTML = skeleton(2);
  try {
    const [st, banned] = await Promise.all([rpc('vanta_admin_stats', { p_days: Number($('[data-filter=stats-days]').value) }), rpc('vanta_admin_banned')]);
    state.stats = st; state.banned = banned.items || [];
    renderStats(); state.statsRendered = true;
  } catch (e) { if (!quiet) box.innerHTML = empty(t('ad.loadfail.stats', { e: errText(e) })); }
}
function renderStats() {
  const s = state.stats, d = s.days;
  const k = (v, label, accent) => `<div class="kpi${accent ? ' accent' : ''}"><b>${num(v)}</b><span>${esc(label)}</span></div>`;
  const daily = s.daily || [];
  const max = Math.max(1, ...daily.map((x) => Math.max(x.reports, x.votes)));
  const h = (v) => `${Math.round((v / max) * 100)}%`;
  $('[data-list=stats]').innerHTML = `
    <div class="kpis">
      ${k(s.users, t('ad.k.users'), true)}${k(s.new_users, t('ad.k.new', { d }))}${k(s.reports_period, t('ad.k.reports', { d }))}${k(s.broken_period, t('ad.k.broken', { d }))}
      ${k(s.open, t('ad.k.open'), true)}${k(s.fixed_period, t('ad.k.fixed', { d }))}${k(s.usage_period, t('ad.k.usage', { d }))}
      ${k(s.requests_active, t('ad.k.reqs'), true)}${k(s.votes_period, t('ad.k.votes', { d }))}${k(s.banned, t('ad.k.banned'))}
    </div>
    <div class="stats-grid">
      <div class="box">
        <h3>${esc(t('ad.chart.h'))}</h3>
        <div class="legend"><span><i style="background:var(--c-reports)"></i>${esc(t('ad.chart.reports'))}</span><span><i style="background:var(--c-broken)"></i>${esc(t('ad.chart.broken'))}</span><span><i style="background:var(--c-votes)"></i>${esc(t('ad.chart.votes'))}</span></div>
        <div class="chart" aria-hidden="true">${daily.map((x) => `<div class="bar" title="${esc(t('ad.chart.tip', { day: x.day, r: x.reports, b: x.broken, v: x.votes }))}"><i class="r" style="block-size:${h(x.reports)};--b:${x.reports ? Math.round((x.broken / x.reports) * 100) : 0}%"></i><i class="v" style="block-size:${h(x.votes)}"></i></div>`).join('')}</div>
        <div class="chart-x" aria-hidden="true">${daily.map((x) => `<span>${esc(String(x.day).slice(8, 10))}</span>`).join('')}</div>
        <table class="sr-only"><caption>${esc(t('ad.chart.cap'))}</caption><thead><tr><th>${esc(t('ad.th.day'))}</th><th>${esc(t('ad.th.reports'))}</th><th>${esc(t('ad.th.broken'))}</th><th>${esc(t('ad.th.votes'))}</th></tr></thead>
          <tbody>${daily.map((x) => `<tr><td>${esc(x.day)}</td><td>${x.reports}</td><td>${x.broken}</td><td>${x.votes}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="box">
        <h3>${esc(t('ad.top.h'))}</h3>
        ${(s.top_requests || []).length ? `<table><thead><tr><th>${esc(t('ad.th.game'))}</th><th class="num">${esc(t('ad.th.votes'))}</th><th class="num">${esc(t('ad.th.7d'))}</th></tr></thead><tbody>${s.top_requests.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${num(r.votes)}</td><td class="num">+${num(r.votes_7d)}</td></tr>`).join('')}</tbody></table>` : `<p class="muted">${esc(t('ad.none.req'))}</p>`}
      </div>
      <div class="box span">
        <h3>${esc(t('ad.pg.h'))}</h3>
        ${(s.games || []).length ? `<div class="table-scroll"><table><thead><tr><th>${esc(t('ad.th.game'))}</th><th class="num">${esc(t('ad.th.open'))}</th><th class="num">${esc(t('ad.th.repd', { d }))}</th><th class="num">${esc(t('ad.th.used', { d }))}</th></tr></thead><tbody>${s.games.map((g) => `<tr><td>${esc(g.game_name || g.game_id)}</td><td class="num">${num(g.open)}</td><td class="num">${num(g.reports_period)}</td><td class="num">${num(g.usage_period)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">${esc(t('ad.none.rep'))}</p>`}
      </div>
      <div class="box span">
        <h3>${esc(t('ad.ban.h'))}</h3>
        ${state.banned.length ? `<div class="table-scroll"><table><thead><tr><th>${esc(t('ad.th.user'))}</th><th>${esc(t('ad.th.discord'))}</th><th>${esc(t('ad.th.since'))}</th><th></th></tr></thead><tbody>${state.banned.map((b) => `<tr><td>${esc(b.username)}</td><td class="mono">${esc(b.discord_id || '—')}</td><td>${esc(ago(b.since))}</td><td class="num">${b.discord_id ? `<button class="btn btn-sm" type="button" data-unban="${esc(b.discord_id)}" data-name="${esc(b.username)}">${esc(t('ad.unban'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">${esc(t('ad.none.ban'))}</p>`}
      </div>
    </div>`;
}
$('[data-list=stats]').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-unban]'); if (!b) return;
  const ok = await ask({ title: t('ad.unban.title', { name: b.dataset.name }), body: t('ad.unban.body'), ok: t('ad.unban') });
  if (!ok) return;
  try { await rpc('vanta_admin_ban', { p_discord_id: b.dataset.unban, p_banned: false }); toast(t('ad.unbanned', { name: b.dataset.name })); loadStats(); } catch (err) { toast(errText(err), 'err'); }
});

// ---------------------------------------------------------------- wiring
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]'); if (!a) return;
  const act = a.dataset.action;
  if (act === 'login') login();
  else if (act === 'logout') logout();
  else if (act === 'show-login') view('login');
  else if (act === 'reload') location.reload();
  else if (act === 'refresh-reports') loadReports();
  else if (act === 'refresh-requests') loadRequests();
  else if (act === 'refresh-stats') loadStats();
});
$$('[role=tab]').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
$('[data-filter=report-game]').addEventListener('change', loadReports);
$('[data-filter=report-status]').addEventListener('change', loadReports);
$('[data-filter=report-q]').addEventListener('input', () => state.reports && renderReports());
$('[data-filter=request-status]').addEventListener('change', loadRequests);
$('[data-filter=request-q]').addEventListener('input', () => state.requests && renderRequests());
$('[data-filter=stats-days]').addEventListener('change', () => loadStats());
// language switch: re-render whatever is already loaded (English is the default, Dutch only when picked)
onLangChange(() => {
  if (state.reports) { fillGames(state.reports.games || []); renderReports(); }
  if (state.requests) renderRequests();
  if (state.stats && state.statsRendered) renderStats();
});

// ---------------------------------------------------------------- local preview data (?demo=1 on localhost only)
function demoRpc(fn) {
  const now = Math.floor(Date.now() / 1000);
  const rep = (id, cheat, game, score, broken, works, status, notes = []) => ({ id, cheat_id: cheat.toLowerCase().replace(/\W+/g, '_'), cheat_name: cheat, game_id: 'demo-' + game.toLowerCase().replace(/\W+/g, '-'), game_name: game, game_version: 'build 1.4.2', fingerprint: 'sha1:9f2c41d0a7be', status, fixed_in_version: status === 'fixed' ? '0.3.2' : null, score, broken, works, newest_fingerprint: id < 3, vanta_versions: ['0.3.1'], last_report: now - id * 5400, notes: notes.map((n, i) => ({ note: n, vanta_version: '0.3.1', updated: now - (i + 1) * 7200 })), reporters: [{ username: 'player_one', discord_id: '400000000000000011', status: 'broken', updated: now - 3600, note: notes[0] || null }, { username: 'nightowl', discord_id: '400000000000000012', status: 'works', updated: now - 86000, note: null }] });
  const data = {
    vanta_admin_reports: { items: [rep(1, 'Infinite ammo', 'Demo Shooter', 4.8, 6, 1, 'open', ['Ammo still drops after the latest patch', 'Crashes when reloading']), rep(2, 'God mode', 'Demo Shooter', 2.1, 3, 2, 'open', ['Fall damage still kills']), rep(3, 'Money multiplier', 'Demo RPG', 0.7, 1, 4, 'open'), rep(4, 'Infinite ammo', 'Demo Shooter', 0.9, 1, 3, 'open', ['Only the pistol still loses ammo']), rep(5, 'No reload', 'Demo Shooter', 0, 0, 7, 'open')], games: [{ game_id: 'demo-shooter', game_name: 'Demo Shooter', open: 2 }, { game_id: 'demo-rpg', game_name: 'Demo RPG', open: 1 }], counts: { open: 3, fixed: 5 } },
    vanta_admin_requests: { items: [
      { appid: 1245620, name: 'Example Request One', status: 'planned', note: 'Next up after the current update', votes: 42, votes_7d: 9, votes_all: 42, created: now - 86400 * 12, requested_by: { username: 'player_one', banned: false } },
      { appid: 1091500, name: 'Example Request Two', status: 'open', note: null, votes: 17, votes_7d: 4, votes_all: 18, created: now - 86400 * 5, requested_by: { username: 'nightowl', banned: false } },
      { appid: 292030, name: 'Example Request Three', status: 'in_progress', note: null, votes: 9, votes_7d: 2, votes_all: 9, created: now - 86400 * 30, requested_by: null }] },
    vanta_admin_stats: { days: 7, users: 128, new_users: 14, reports: 311, reports_period: 46, broken_period: 19, open: 7, fixed_period: 4, usage_period: 2840, banned: 1, requests: 23, requests_active: 18, requests_period: 5, votes: 402, votes_period: 61,
      top_requests: [{ name: 'Example Request One', votes: 42, votes_7d: 9 }, { name: 'Example Request Two', votes: 17, votes_7d: 4 }, { name: 'Example Request Three', votes: 9, votes_7d: 2 }],
      games: [{ game_id: 'demo-shooter', game_name: 'Demo Shooter', open: 5, reports_period: 31, usage_period: 1900 }, { game_id: 'demo-rpg', game_name: 'Demo RPG', open: 2, reports_period: 15, usage_period: 940 }],
      daily: Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.now() - (13 - i) * 864e5); return { day: d.toISOString().slice(0, 10), reports: 3 + ((i * 7) % 9), broken: 1 + ((i * 3) % 4), votes: 2 + ((i * 5) % 8) }; }) },
    vanta_admin_banned: { items: [{ username: 'spam_account', discord_id: '400000000000000099', since: now - 86400 * 3 }] },
  };
  return Promise.resolve(data[fn] || { ok: true });
}

boot().catch((e) => { view('setup'); setupMsg(t('ad.startfail', { e: e && e.message ? e.message : e })); });
