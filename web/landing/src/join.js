import { initPage } from './page.js';

initPage();

// "S'inscrire" buttons: registration only happens in the mobile app, so they open an explanation instead of a form.
const modal = document.getElementById('signupModal');
if (modal) {
  const open = () => {
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
    document.documentElement.classList.add('has-modal');
  };
  const close = () => {
    if (typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
  };
  modal.addEventListener('close', () => document.documentElement.classList.remove('has-modal'));
  document.querySelectorAll('[data-signup]').forEach((btn) => btn.addEventListener('click', (e) => { e.preventDefault(); open(); }));
  modal.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', close));
  // A click on the dim backdrop (the dialog element itself, outside the panel) closes it.
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}
