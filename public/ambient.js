/* ════════════════════════════════════════════════════════════════════════
   SpeedX — Ambient Effects (canvas particle field)
   Loaded by every page that wants the cyber-logistics "living system" feel.
   - 60-90 drifting dots, slow oceanic drift
   - Hairline strokes connect neighbors within range
   - Mouse moves within 150px gently repel (~5px)
   - NOTE: owner request — the ambient field runs on all devices,
     including ones with Reduce Motion enabled (the drift is deliberately
     slow and low-opacity).
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Always inject the ambient glow (CSS animates it).
  if (!document.querySelector('.tt-glow')) {
    const glow = document.createElement('div');
    glow.className = 'tt-glow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);
  }

  const NUM = 84;            // particle count
  const CONNECT_DIST = 130;   // px — line distance to neighbour
  const BASE_HUE = '#22D3EE'; // cyan
  const ALPHA_DOT = 0.10;
  const ALPHA_LINE = 0.04;

  const c = document.createElement('canvas');
  c.className = 'tt-particles';
  c.setAttribute('aria-hidden', 'true');
  document.body.appendChild(c);

  const ctx = c.getContext('2d');
  let w = 0, h = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
  let particles = [];
  let mouse = { x: -9999, y: -9999, active: false };
  let raf = null;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    particles = [];
    for (let i = 0; i < NUM; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.4 + 0.6,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function step() {
    ctx.clearRect(0, 0, w, h);

    // Update + draw dots
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      // Slow drift (ocean current)
      p.x += p.vx + Math.cos(p.phase + performance.now() * 0.00018) * 0.05;
      p.y += p.vy + Math.sin(p.phase + performance.now() * 0.00022) * 0.04;

      // Mouse repel (very subtle, ~5px shuffle)
      if (mouse.active) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 22500) { // 150px radius
          const dist = Math.sqrt(distSq) || 1;
          const push = (150 - dist) / 150; // 0..1
          p.x += (dx / dist) * push * 0.5;
          p.y += (dy / dist) * push * 0.5;
        }
      }

      // Wrap gently around viewport
      if (p.x < -20) p.x = w + 20;
      if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20;
      if (p.y > h + 20) p.y = -20;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = BASE_HUE;
      ctx.globalAlpha = ALPHA_DOT;
      ctx.fill();
    }

    // Hairline connections
    ctx.globalAlpha = ALPHA_LINE;
    ctx.strokeStyle = BASE_HUE;
    ctx.lineWidth = 0.6;
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < CONNECT_DIST * CONNECT_DIST) {
          const dist = Math.sqrt(distSq);
          ctx.globalAlpha = ALPHA_LINE * (1 - dist / CONNECT_DIST);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    raf = requestAnimationFrame(step);
  }

  function start() {
    if (raf) return;
    raf = requestAnimationFrame(step);
  }
  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  function bindMouse() {
    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    }, { passive: true });
    window.addEventListener('mouseleave', () => { mouse.active = false; mouse.x = -9999; mouse.y = -9999; });
    window.addEventListener('blur', () => { mouse.active = false; });
    // Touch — gentle repel on tap
    window.addEventListener('touchstart', (e) => {
      const t = e.touches[0]; if (!t) return;
      mouse.x = t.clientX; mouse.y = t.clientY; mouse.active = true;
    }, { passive: true });
    window.addEventListener('touchend', () => { mouse.active = false; }, { passive: true });
  }

  // Pause when tab hidden so we don't burn CPU in the background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  // Boot
  resize();
  seed();
  bindMouse();
  start();

  // React to resize without reseeding (preserves gentle flowing motion)
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { resize(); seed(); }, 220);
  });
})();
