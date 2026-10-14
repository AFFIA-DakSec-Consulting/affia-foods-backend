import { initPage } from './page.js';

initPage();

// Copy the address.
const btn = document.getElementById('copyMail');
if (btn) {
  const label = btn.querySelector('span');
  btn.addEventListener('click', async () => {
    const mail = btn.dataset.mail;
    try {
      await navigator.clipboard.writeText(mail);
    } catch {
      const t = document.createElement('textarea');
      t.value = mail; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      t.remove();
    }
    btn.classList.add('is-done');
    label.textContent = 'Copié';
    setTimeout(() => { btn.classList.remove('is-done'); label.textContent = 'Copier l’adresse'; }, 1800);
  });
}
