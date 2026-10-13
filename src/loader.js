// Brand loader for every page that does not run the full GSAP intro (legal pages, contact, 404, reduced-motion visitors).
// Same look as the home loader, pure CSS, gone after ~1.7 s.
export function miniLoader() {
  let el = document.querySelector('.loader');
  if (!el) {
    el = document.createElement('div');
    el.className = 'loader';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<svg class="loader__mark" viewBox="0 0 200 150"><use href="#kmark" /></svg>' +
      '<div class="loader__word">AFFIA FOODS</div>' +
      '<p class="loader__by">Propulsé par <b>DakSec Consulting</b></p>';
    document.body.prepend(el);
  }
  el.classList.add('loader--mini');
  el.addEventListener('animationend', (e) => { if (e.animationName === 'loaderOut') el.remove(); });
  setTimeout(() => el.remove(), 3000);
}
