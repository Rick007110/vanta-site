// Vanta landing page: latest release download, live game count, top requests, subtle reveals.
import { SUPABASE_URL, SUPABASE_KEY, REPO } from './config.js';

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
async function release() {
  try {
    const r = await cachedJson('vanta-release', `https://api.github.com/repos/${REPO}/releases/latest`, 10 * 60e3,
      { headers: { Accept: 'application/vnd.github+json' } });
    const assets = r.assets || [];
    const zip = assets.find((a) => /^Vanta-v[\w.+-]+\.zip$/i.test(a.name));
    const sha = assets.find((a) => /^Vanta-v[\w.+-]+\.zip\.sha256$/i.test(a.name));
    const tag = String(r.tag_name || '').trim();
    if (tag) $$('[data-version]').forEach((el) => { el.textContent = tag.startsWith('v') ? tag : `v${tag}`; });
    if (r.html_url) $$('[data-release-link]').forEach((a) => { a.href = r.html_url; });
    if (zip && zip.browser_download_url) {
      $$('[data-download]').forEach((a) => { a.href = zip.browser_download_url; a.setAttribute('download', ''); });
      const mb = zip.size ? Math.round(zip.size / 1048576) : 0;
      const size = $('[data-size]');
      if (size && mb) size.textContent = `Portable .zip · ${mb} MB`;
    }
    const shaLink = $('[data-sha]');
    if (shaLink) shaLink.href = sha ? sha.browser_download_url : (r.html_url || RELEASES);
  } catch {
    // Fallback: every download button already points at the releases/latest page.
    $$('[data-download]').forEach((a) => { a.href = RELEASES; a.removeAttribute('download'); });
  }
}

// ---------- live game + cheat count from the catalogue index ----------
async function games() {
  const numEl = $('[data-game-count]');
  let target = Number(numEl.textContent) || 0, cheats = null;
  try {
    const idx = await cachedJson('vanta-games', `https://raw.githubusercontent.com/${REPO}/main/games/index.json`, 30 * 60e3);
    const list = (idx.games || []).filter((g) => !g.antiCheat && !g.onlineOnly);
    if (list.length) {
      target = list.length;
      cheats = list.reduce((n, g) => n + (Number(g.cheatCount) || 0), 0);
    }
  } catch { /* keep the numbers from the HTML */ }
  $('[data-game-word]').textContent = target === 1 ? 'game' : 'games';
  if (cheats) $('[data-cheat-count]').textContent = String(cheats);
  numEl.textContent = String(target);
}

// ---------- most requested games (public RPC; section stays hidden when unavailable) ----------
async function requests() {
  const box = $('[data-requests]'), list = $('[data-requests-list]');
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
      img.src = /^https:\/\/([a-z0-9-]+\.)*(steamstatic\.com|akamaihd\.net)\//.test(r.cover_url || '') ? r.cover_url
        : `https://cdn.cloudflare.steamstatic.com/steam/apps/${Number(r.appid)}/capsule_231x87.jpg`;
      img.onerror = () => img.remove();
      const row = document.createElement('div');
      const name = document.createElement('span'); name.textContent = r.name;
      const votes = document.createElement('span'); votes.className = 'votes';
      votes.textContent = `${r.votes} ${r.votes === 1 ? 'vote' : 'votes'}`;
      row.append(name, votes); li.append(img, row);
      return li;
    }));
    box.hidden = false;
  } catch { /* offline or not set up yet */ }
}

// ---------- nav state ----------
function nav() {
  const el = $('[data-nav]');
  const on = () => el.classList.toggle('is-scrolled', scrollY > 24);
  on(); addEventListener('scroll', on, { passive: true });
}

// ---------- reveals: small fade-in when a block scrolls into view ----------
function reveals() {
  if (reduceMotion || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('js');
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -6% 0px' });
  $$('.reveal').forEach((el) => io.observe(el));
}

nav(); reveals();
release(); games(); requests();
