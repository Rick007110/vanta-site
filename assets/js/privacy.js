// Vanta privacy page: NL / EN toggle. Default from ?lang=, then a saved choice, then the browser language; fallback EN.
const TITLES = { nl: 'Privacy · Vanta', en: 'Privacy · Vanta' };
const KEY = 'vanta-lang';
const valid = (l) => (l === 'nl' || l === 'en' ? l : null);
function saved() { try { return valid(localStorage.getItem(KEY)); } catch { return null; } }
function initial() {
  const q = valid(new URLSearchParams(location.search).get('lang'));
  if (q) return q;
  const s = saved();
  if (s) return s;
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
  return String(langs[0] || '').toLowerCase().startsWith('nl') ? 'nl' : 'en';
}
function apply(lang, store) {
  const root = document.documentElement;
  root.dataset.lang = lang; root.lang = lang; document.title = TITLES[lang];
  document.querySelectorAll('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === lang)));
  if (store) { try { localStorage.setItem(KEY, lang); } catch { /* storage unavailable */ } }
}
document.querySelectorAll('[data-set-lang]').forEach((b) => b.addEventListener('click', () => apply(b.dataset.setLang, true)));
apply(initial(), false);
