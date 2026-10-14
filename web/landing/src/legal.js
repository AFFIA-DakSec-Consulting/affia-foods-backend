import '@fontsource-variable/bricolage-grotesque/index.css';
import '@fontsource-variable/plus-jakarta-sans/index.css';
import './styles.css';
import { miniLoader } from './loader.js';
import { initLang } from './lang.js';

miniLoader();
initLang();

// Legal pages are static on purpose: no scroll-jacking, just a nav that tucks away while reading.
const nav = document.getElementById('nav');
let last = window.scrollY;
window.addEventListener(
  'scroll',
  () => {
    const y = window.scrollY;
    nav.classList.toggle('is-hidden', y > last && y > 120);
    last = y;
  },
  { passive: true },
);
