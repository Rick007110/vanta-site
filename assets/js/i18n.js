// Tiny i18n for the Vanta site. English is the default; Dutch only when the visitor picks it (saved in localStorage).
//   data-i18n="key"             -> textContent
//   data-i18n-html="key"        -> innerHTML (our own strings only, never user data)
//   data-i18n-attr="attr:key;…" -> attributes (aria-label, alt, placeholder, content, title)
//   [data-set-lang="en|nl"]     -> language switch buttons (aria-pressed is kept in sync)
import en from './i18n/en.js';
import nl from './i18n/nl.js';

const DICTS = { en, nl };
const KEY = 'vanta-lang';
const listeners = new Set();

function saved() { try { const l = localStorage.getItem(KEY); return l === 'nl' ? 'nl' : 'en'; } catch { return 'en'; } }
export let lang = saved();

export function t(key, vars) {
  let s = (DICTS[lang] && DICTS[lang][key]) ?? en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
// plural helper: key.one / key.other
export const tn = (key, n, vars = {}) => t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...vars });

export function apply(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => { const [a, k] = pair.split(':').map((x) => x.trim()); if (a && k) el.setAttribute(a, t(k)); });
  });
  const html = document.documentElement;
  html.lang = lang; html.dataset.lang = lang;
  const title = document.querySelector('meta[name="i18n-title"]');
  if (title) document.title = t(title.content);
  document.querySelectorAll('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === lang)));
}

export function setLang(next, store = true) {
  lang = next === 'nl' ? 'nl' : 'en';
  if (store) { try { localStorage.setItem(KEY, lang); } catch { /* storage unavailable */ } }
  apply();
  listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.error(e); } });
}
export const onLangChange = (fn) => listeners.add(fn);

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-set-lang]');
  if (b) { e.preventDefault(); if (b.dataset.setLang !== lang) setLang(b.dataset.setLang); }
});
apply();
