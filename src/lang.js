// Language switcher (FR / EN / SN). The site is French only for now: the choice is remembered and shown,
// the content itself is not translated yet.
const LABEL = { fr: 'Français', en: 'English', sn: 'Wolof' };
const KEY = 'affia_lang';

export function initLang() {
  initMenu();
  const read = () => { try { return localStorage.getItem(KEY) || 'fr'; } catch { return 'fr'; } };
  const save = (code) => { try { localStorage.setItem(KEY, code); } catch { /* storage blocked: keep it for this page only */ } };

  document.querySelectorAll('[data-lang]').forEach((root) => {
    const btn = root.querySelector('.lang__btn');
    const items = root.querySelectorAll('[data-lang-code]');
    const show = (code) => {
      const item = root.querySelector(`[data-lang-code="${code}"]`) || items[0];
      btn.querySelector('svg').replaceWith(item.querySelector('svg').cloneNode(true));
      btn.querySelector('span').textContent = code.toUpperCase();
      btn.setAttribute('aria-label', `Langue : ${LABEL[code] || code}`);
      items.forEach((i) => i.toggleAttribute('aria-current', i === item));
      document.documentElement.lang = code === 'sn' ? 'wo' : code;
    };
    const setOpen = (open) => { root.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', String(open)); };

    show(read());
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!root.classList.contains('is-open')); });
    items.forEach((item) => item.addEventListener('click', (e) => {
      e.preventDefault();
      const code = item.dataset.langCode;
      save(code); show(code); setOpen(false); btn.focus();
    }));
    document.addEventListener('click', (e) => { if (!root.contains(e.target)) setOpen(false); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOpen(false); btn.focus(); } });
  });
}

// "Sur nous" dropdown of the main menu: opens on hover (mouse) or click/tap, closes on outside click, Escape or navigation.
export function initMenu() {
  document.querySelectorAll('[data-dd]').forEach((root) => {
    const btn = root.querySelector('.nav__ddbtn');
    const setOpen = (open) => { root.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!root.classList.contains('is-open')); });
    if (window.matchMedia('(hover: hover)').matches) {
      root.addEventListener('pointerenter', () => setOpen(true));
      root.addEventListener('pointerleave', () => setOpen(false));
    }
    root.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('click', (e) => { if (!root.contains(e.target)) setOpen(false); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOpen(false); btn.focus(); } });
  });
}
