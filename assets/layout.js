(() => {
  const nav = document.getElementById('site-nav');
  const btn = document.querySelector('.nav-toggle');

  // Mobile toggle
  function setOpen(open) {
    if (!nav || !btn) return;
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  }
  if (btn && nav) {
    btn.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
    // close on outside click
    document.addEventListener('click', (e) => {
      if (!nav.classList.contains('open')) return;
      const t = e.target;
      if (t instanceof Element && (nav.contains(t) || btn.contains(t))) return;
      setOpen(false);
    });
    // close on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });
  }

  // Active link highlight
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('#site-nav a').forEach(a => {
    const href = (a.getAttribute('href') || '').replace('./','');
    const isActive = (href === path) || (href === 'index.html' && (path === '' || path === 'index.html'));
    a.classList.toggle('active', isActive);
  });
})();
