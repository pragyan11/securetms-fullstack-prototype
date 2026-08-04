/*════════════════════════════════════════════════════════════════════════════
SpeedX — registration page script.
Owns: the bulletproof segmented role selector on register.html, feeding both
the visible CSS highlight and the hidden <input name="role"> that gets POSTed
to the server.
═══════════════════════════════════════════════════════════════════════════*/
'use strict';

(function () {
  function select(value, opts = {}) {
    const group  = document.getElementById('regRoleGroup');
    const hidden = document.getElementById('regRole');
    const inviteRow = document.getElementById('inviteTokenRow');
    if (!group || !hidden) return;
    const next = String(value || '').trim();
    if (!['Customer', 'Driver', 'Admin'].includes(next)) return;
    hidden.value = next;

    if (inviteRow) {
      inviteRow.style.display = next === 'Admin' ? '' : 'none';
    }

    const buttons = Array.from(group.querySelectorAll('.seg-option'));
    buttons.forEach((b) => {
      const isOn = b.dataset.value === next;
      b.classList.toggle('is-selected', isOn);
      b.setAttribute('aria-checked', String(isOn));
      b.setAttribute('tabindex', isOn ? '0' : '-1');
    });

    if (opts.focus) {
      const target = buttons.find((b) => b.dataset.value === next);
      if (target) target.focus({ preventScroll: false });
    }
  }

  function wire(group, hidden) {
    const buttons = Array.from(group.querySelectorAll('.seg-option'));
    buttons.forEach((b) => {
      b.addEventListener('click', (e) => { e.preventDefault(); select(b.dataset.value); });
      b.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        const i = buttons.indexOf(active);
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          select(buttons[(i + 1) % buttons.length].dataset.value, { focus: true });
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          select(buttons[(i - 1 + buttons.length) % buttons.length].dataset.value, { focus: true });
        } else if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          select(b.dataset.value);
        }
      });
    });
  }

  function bootRegisterPage() {
    const group  = document.getElementById('regRoleGroup');
    const hidden = document.getElementById('regRole');
    if (!group || !hidden) return;
    wire(group, hidden);
    select(hidden.value || 'Customer');
  }
  window.onReady(bootRegisterPage);
})();
