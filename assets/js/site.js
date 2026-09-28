// Vanta landing page: latest release download, live game count, top requests, hotkey demo, menu and reveals.
import { SUPABASE_URL, SUPABASE_KEY, REPO } from './config.js';
import { t, tn, onLangChange } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const RELEASES = `https://github.com/${REPO}/releases/latest`;

// ---------- cached JSON fetch (sessionStorage, keeps GitHub's anonymous rate limit happy) ----------
async function cachedJson(key, url, ttlMs, init) {
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  } catch { /* storage unavailable */ }
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
  return data;
}

// ---------- latest release ----------
let zipMb = 0;
function renderSize() {
  const size = $('[data-size]');
  if (size) size.textContent = zipMb ? t('dl.zipSize', { mb: zipMb }) : t('dl.zip');
}
async function release() {
  const root = document.documentElement;
  try {
    const r = await cachedJson('vanta-release-v2', `https://api.github.com/repos/${REPO}/releases/latest`, 2 * 60e3,
      { headers: { Accept: 'application/vnd.github+json' } });
    const assets = r.assets || [];
    const zip = assets.find((a) => /^Vanta-v[\w.+-]+\.zip$/i.test(a.name));
    const sha = assets.find((a) => /^Vanta-v[\w.+-]+\.zip\.sha256$/i.test(a.name));
    const tag = String(r.tag_name || '').trim();
    if (tag) $$('[data-version]').forEach((el) => { el.textContent = tag.startsWith('v') ? tag : `v${tag}`; });
    if (r.html_url) $$('[data-release-link]').forEach((a) => { a.href = r.html_url; });
    if (zip && zip.browser_download_url) {
      $$('[data-download]').forEach((a) => { a.href = zip.browser_download_url; a.setAttribute('download', ''); });
      zipMb = zip.size ? Math.round(zip.size / 1048576) : 0;
    }
    const shaLink = $('[data-sha]');
    if (shaLink) shaLink.href = sha ? sha.browser_download_url : (r.html_url || RELEASES);
    root.dataset.release = zip ? 'asset' : 'page';
    renderSize();
  } catch {
    // Fallback: every download button points at the releases/latest page.
    $$('[data-download]').forEach((a) => { a.href = RELEASES; a.removeAttribute('download'); });
    root.dataset.release = 'fallback';
  }
}

// ---------- live game + cheat count from the catalogue index ----------
async function games() {
  const numEl = $('[data-game-count]');
  if (!numEl) return;
  let target = Number(numEl.textContent) || 0, cheats = null;
  try {
    const idx = await cachedJson('vanta-games-v2', `https://raw.githubusercontent.com/${REPO}/main/games/index.json`, 5 * 60e3);
    const list = (idx.games || []).filter((g) => !g.antiCheat && !g.onlineOnly);
    if (list.length) {
      target = list.length;
      cheats = list.reduce((n, g) => n + (Number(g.cheatCount) || 0), 0);
    }
  } catch { /* keep the numbers from the HTML */ }
  gameCount = target;
  if (cheats) $('[data-cheat-count]').textContent = String(cheats);
  numEl.textContent = String(target);
  renderGameWord();
}
let gameCount = 6;
function renderGameWord() { const w = $('[data-game-word]'); if (w) w.textContent = t(`lib.games.${gameCount === 1 ? 'one' : 'other'}`); }

// ---------- most requested games (public RPC; section stays hidden when unavailable) ----------
async function requests() {
  const box = $('[data-requests]'), list = $('[data-requests-list]');
  if (!box || !list) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vanta_game_requests`, {
      method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_limit: 6 }), signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return;
    const items = ((await res.json()) || {}).items || [];
    const open = items.filter((r) => r.votes > 0).slice(0, 6);
    if (!open.length) return;
    list.replaceChildren(...open.map((r) => {
      const li = document.createElement('li'); li.className = 'req';
      const img = document.createElement('img');
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.width = 231; img.height = 87;
      img.src = /^https:\/\/([a-z0-9-]+\.)*(steamstatic\.com|akamaihd\.net)\//.test(r.cover_url || '') ? r.cover_url
        : `https://cdn.cloudflare.steamstatic.com/steam/apps/${Number(r.appid)}/capsule_231x87.jpg`;
      img.onerror = () => img.remove();
      const row = document.createElement('div');
      const name = document.createElement('span'); name.textContent = r.name; name.title = r.name;
      const votes = document.createElement('span'); votes.className = 'votes';
      votes.dataset.votes = String(r.votes); votes.textContent = tn('req.votes', r.votes);
      row.append(name, votes); li.append(img, row);
      return li;
    }));
    box.hidden = false;
  } catch { /* offline or not set up yet */ }
}

// ---------- nav: scrolled state + mobile menu ----------
function nav() {
  const el = $('[data-nav]');
  if (!el) return;
  const on = () => el.classList.toggle('is-scrolled', scrollY > 8);
  on(); addEventListener('scroll', on, { passive: true });

  const btn = $('[data-menu-toggle]'), menu = $('[data-menu]');
  if (!btn || !menu) return;
  const set = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    menu.hidden = !open; el.classList.toggle('is-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
  matchMedia('(min-width: 900px)').addEventListener('change', (m) => { if (m.matches) set(false); });
}

// ---------- hotkey demo: click a switch, or press F1-F4 while the card is on screen ----------
function demo() {
  const card = $('[data-demo]');
  if (!card) return;
  const sws = $$('.sw', card), log = $('[data-demo-log]', card), time = $('[data-demo-time]', card), count = $('[data-demo-count]', card);
  const now = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  time.textContent = now();
  let last = { key: 'demo.c1', on: true };
  const renderLog = () => { log.textContent = t(last.on ? 'demo.on' : 'demo.off', { name: t(last.key) }); };
  renderLog(); onLangChange(renderLog);
  const flip = (sw) => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    const row = sw.closest('li');
    last = { key: $('.demo-name', row).dataset.i18n, on }; renderLog(); time.textContent = now();
    count.textContent = `${sws.filter((s) => s.getAttribute('aria-checked') === 'true').length}/${sws.length}`;
    row.classList.add('is-flash', 'is-press');
    setTimeout(() => row.classList.remove('is-press'), 120);
    setTimeout(() => row.classList.remove('is-flash'), 500);
  };
  sws.forEach((sw) => sw.addEventListener('click', () => flip(sw)));

  let visible = false;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.6 }).observe(card);
  }
  addEventListener('keydown', (e) => {
    if (!visible || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const sw = sws.find((s) => s.dataset.key === e.key);
    if (!sw) return;
    e.preventDefault(); flip(sw);
  });
}

// ---------- reveals: small fade-in when a block scrolls into view ----------
function reveals() {
  if (reduceMotion || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('js');
  // stagger siblings inside lists
  $$('.facts-list, .rules, .steps, .duo').forEach((l) => $$('.reveal', l).forEach((el, i) => el.style.setProperty('--d', `${i * 80}ms`)));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  $$('.reveal').forEach((el) => io.observe(el));
}

nav(); demo(); reveals();
renderSize(); renderGameWord();
release(); games(); requests();
onLangChange(() => {
  renderSize(); renderGameWord();
  $$('[data-votes]').forEach((v) => { v.textContent = tn('req.votes', Number(v.dataset.votes)); });
});
