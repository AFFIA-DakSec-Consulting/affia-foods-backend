// "Télécharger l'appli" buttons: the apps are not in the stores yet, so they open an explanation dialog.
export function initDownload() {
  const modal = document.getElementById('downloadModal');
  if (!modal) return;
  const close = () => (typeof modal.close === 'function' ? modal.close() : modal.removeAttribute('open'));
  document.querySelectorAll('[data-download]').forEach((btn) => btn.addEventListener('click', () => {
    const name = btn.dataset.download;
    modal.querySelector('#dlApp').textContent = name;
    modal.querySelector('#dlAppB').textContent = name;
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
    document.documentElement.classList.add('has-modal');
  }));
  modal.addEventListener('close', () => document.documentElement.classList.remove('has-modal'));
  modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}
