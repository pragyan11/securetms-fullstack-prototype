/* ════════════════════════════════════════════════════════════════════════
   SecureTMS — Landing Page Choreography
   GSAP + ScrollTrigger via CDN. Honors prefers-reduced-motion.
   Degrades gracefully when GSAP is absent or blocked.
   ════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const REDUCED_MOTION =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gsap = window.gsap || null;
  const ScrollTrigger = window.ScrollTrigger || null;
  const hasGsap = !!gsap && !!ScrollTrigger && !REDUCED_MOTION;

  /* ─────────────────── boot ─────────────────── */
  document.addEventListener('DOMContentLoaded', boot, { once: true });

  function boot() {
    document.body.classList.add('hm-active');
    /* Belt-and-suspenders safety net: remove the preloader after 2.5s regardless
       of which animation paths run, so a crashed GSAP / blank canvas never strands the user. */
    setTimeout(function () {
      var p = document.querySelector('.hm-preloader');
      if (p && p.parentNode) p.parentNode.removeChild(p);
    }, 2500);
    injectCursor();
    initNavbarScrollState();
    initMagneticButtons();
    initRipples();
    initFeatureTilt();
    initHero();
    initDeepDiveReveals();
    initRocket();
    initEasterEgg();
    if (hasGsap) initScrollTrigger();
    schedulePreloaderLeave();
  }

  /* ─────────────────── preloader ─────────────────── */
  function schedulePreloaderLeave() {
    const pre = document.querySelector('.hm-preloader');
    if (!pre) return;
    const delay = REDUCED_MOTION ? 200 : 1100;  /* let the logo draw once */
    setTimeout(() => {
      pre.classList.add('is-leaving');
      setTimeout(() => { pre.remove(); }, hasGsap ? 700 : 320);
    }, delay);
  }

  /* ─────────────────── custom cursor ─────────────────── */
  function injectCursor() {
    const root = document.createElement('div');
    root.className = 'hm-cursor';
    root.innerHTML = '<div class="hm-cursor-dot"></div><div class="hm-cursor-ring"></div>';
    document.body.appendChild(root);

    let mouseX = -100, mouseY = -100, dotX = -100, dotY = -100, ringX = -100, ringY = -100;
    const dot  = root.querySelector('.hm-cursor-dot');
    const ring = root.querySelector('.hm-cursor-ring');

    const step = () => {
      /* dot tracks 1:1, ring trails with spring */
      dotX += (mouseX - dotX) * 0.85;
      dotY += (mouseY - dotY) * 0.85;
      ringX += (mouseX - ringX) * 0.20;
      ringY += (mouseY - ringY) * 0.20;
      dot.style.transform  = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (!root.classList.contains('is-active')) root.classList.add('is-active');
    }, { passive: true });

    document.addEventListener('mouseleave', () => root.classList.remove('is-active'));
    document.addEventListener('mouseenter', () => root.classList.add('is-active'));

    document.addEventListener('mousedown', () => root.classList.add('is-clicking'));
    document.addEventListener('mouseup',   () => root.classList.remove('is-clicking'));

    /* expand on interactive elements */
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest('a, button, [data-ss-magnetic]');
      if (t && root.classList.contains('is-active')) {
        ring.style.width  = '56px';
        ring.style.height = '56px';
      }
    });
    document.addEventListener('mouseout', (e) => {
      const t = e.target.closest('a, button, [data-ss-magnetic]');
      if (t) {
        ring.style.width  = '40px';
        ring.style.height = '40px';
      }
    });
  }

  /* ─────────────────── navbar scroll state ─────────────────── */
  function initNavbarScrollState() {
    const nav = document.querySelector('.hm-nav');
    if (!nav) return;
    const onScroll = () => {
      if (window.scrollY > 50) nav.classList.add('is-scrolled');
      else nav.classList.remove('is-scrolled');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ─────────────────── magnetic buttons ─────────────────── */
  function initMagneticButtons() {
    const targets = document.querySelectorAll('[data-ss-magnetic]');
    if (REDUCED_MOTION || targets.length === 0) return;
    const radius = 10;
    targets.forEach((el) => {
      const rect = () => el.getBoundingClientRect();
      let fX = 0, fY = 0, tX = 0, tY = 0, rafId = null;
      const tick = () => {
        tX += (fX - tX) * 0.18;
        tY += (fY - tY) * 0.18;
        el.style.transform = `translate(${tX.toFixed(2)}px, ${tY.toFixed(2)}px)`;
        if (Math.abs(fX - tX) > 0.05 || Math.abs(fY - tY) > 0.05) rafId = requestAnimationFrame(tick);
        else rafId = null;
      };
      el.addEventListener('mousemove', (e) => {
        const r = rect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        fX = ((e.clientX - cx) / r.width) * radius;
        fY = ((e.clientY - cy) / r.height) * radius;
        if (!rafId) rafId = requestAnimationFrame(tick);
      });
      el.addEventListener('mouseleave', () => {
        fX = 0; fY = 0;
        if (!rafId) rafId = requestAnimationFrame(tick);
      });
    });
  }

  /* ─────────────────── ripple effect ─────────────────── */
  function initRipples() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.hm-btn');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const span = document.createElement('span');
      span.className = 'hm-ripple';
      span.style.left = x + 'px';
      span.style.top = y + 'px';
      btn.appendChild(span);
      setTimeout(() => span.remove(), 700);
    });
  }

  /* ─────────────────── 3D tilt on feature cards ─────────────────── */
  function initFeatureTilt() {
    if (REDUCED_MOTION) return;

    /* Skip on touch devices */
    const isTouch = window.matchMedia('(hover: none)').matches;
    if (isTouch) return;

    const cards = document.querySelectorAll('.hm-feature[data-tilt]');
    cards.forEach((card) => {
      let fX = 0, fY = 0, tX = 0, tY = 0, raf = null;
      const apply = () => {
        tX += (fX - tX) * 0.14;
        tY += (fY - tY) * 0.14;
        card.style.transform = `perspective(1000px) rotateX(${tY.toFixed(2)}deg) rotateY(${tX.toFixed(2)}deg)`;
        if (Math.abs(fX - tX) > 0.05 || Math.abs(fY - tY) > 0.05) raf = requestAnimationFrame(apply);
        else raf = null;
      };
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;  /* 0..1 */
        const y = (e.clientY - r.top) / r.height;
        fX = (x - 0.5) *  8;  /* rotateY range */
        fY = (0.5 - y) *  6;  /* rotateX range */
        if (!raf) raf = requestAnimationFrame(apply);
      });
      card.addEventListener('mouseleave', () => {
        fX = 0; fY = 0;
        if (!raf) raf = requestAnimationFrame(apply);
        /* clear after settle */
        setTimeout(() => { if (!raf) card.style.transform = ''; }, 320);
      });
    });
  }

  /* ─────────────────── hero entry: word fade + subline + parallax ─────────────────── */
  function initHero() {
    /* Word fade-up on the headline (works without GSAP too) */
    const headline = document.querySelector('.hm-headline');
    if (!headline) return;

    /* Wrap each non-amber word in a span so we can fade up individually */
    const words = headline.querySelectorAll('.hm-word-inner, .hm-word-amber');
    if (hasGsap && words.length) {
      gsap.set(words, { opacity: 0, y: 12 });
      const subline = document.querySelector('.hm-subline');
      const ctas = document.querySelectorAll('.hm-hero-cta .hm-btn');
      const eyebrow = document.querySelector('.hm-hero-eyebrow');
      const illu = document.querySelector('.hm-hero-illu');
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .to(eyebrow, { opacity: 1, y: 0, duration: 0.5 }, 0)
        .to(words, { opacity: 1, y: 0, duration: 0.6, stagger: 0.08 }, 0.10)
        .to(subline, { opacity: 1, y: 0, duration: 0.6 }, '-=0.35')
        .to(ctas,    { opacity: 1, y: 0, duration: 0.5, stagger: 0.06 }, '-=0.30')
        .fromTo(illu, { opacity: 0, scale: 0.95, filter: 'blur(6px)' },
                   { opacity: 1, scale: 1, filter: 'blur(0)', duration: 0.7 }, '-=0.55');
    } else if (!REDUCED_MOTION) {
      /* CSS-only fallback */
      headline.classList.add('is-word-fade');
      document.querySelectorAll('.hm-hero-eyebrow, .hm-subline, .hm-hero-cta .hm-btn, .hm-hero-illu')
        .forEach(el => { el.style.opacity = '0'; el.style.transform = 'translateY(12px)'; });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        headline.classList.remove('is-word-fade');
        document.querySelectorAll('.hm-hero-eyebrow').forEach(fadeInNow);
        document.querySelectorAll('.hm-subline').forEach(fadeInNow);
        document.querySelectorAll('.hm-hero-cta .hm-btn').forEach((el, i) =>
          setTimeout(() => fadeInNow(el), 320 + i * 50));
        fadeInNow(document.querySelector('.hm-hero-illu'));
      }));
    }

    /* Hero parallax on mousemove (CSS-only) */
    if (!REDUCED_MOTION) {
      const illu = document.querySelector('.hm-hero-illu');
      const aura = illu?.querySelector('.hm-aura');
      if (illu && aura) {
        const maxOffset = 10;
        illu.addEventListener('mousemove', (e) => {
          const r = illu.getBoundingClientRect();
          const x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
          const y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
          illu.style.transform = `translate(${(x * maxOffset).toFixed(1)}px, ${(y * maxOffset).toFixed(1)}px)`;
          aura.style.transform = `translate(${(-x * 6).toFixed(1)}px, ${(-y * 6).toFixed(1)}px)`;
        });
        illu.addEventListener('mouseleave', () => {
          illu.style.transform = '';
          aura.style.transform = '';
        });
      }
    }
  }

  function fadeInNow(el) {
    if (!el) return;
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  }

  /* ─────────────────── scroll-trigger reveals + parallax ─────────────────── */
  function initScrollTrigger() {
    gsap.registerPlugin(ScrollTrigger);

    /* reveal anything tagged .hm-reveal */
    document.querySelectorAll('.hm-reveal').forEach((el) => {
      gsap.fromTo(el,
        { opacity: 0, y: 30 },
        {
          opacity: 1, y: 0, duration: 0.7, ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true }
        }
      );
    });

    /* section eyebrow + title + lede staggers */
    document.querySelectorAll('.hm-section').forEach((section) => {
      const kids = section.querySelectorAll('.hm-section-eyebrow, .hm-section-title, .hm-section-lede, .hm-feature, .hm-deeper-list li');
      gsap.fromTo(kids,
        { opacity: 0, y: 24 },
        {
          opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.08,
          scrollTrigger: { trigger: section, start: 'top 80%', once: true }
        }
      );
    });

    /* deeper section: mockup lifts, list staggers */
    const mockup = document.querySelector('.hm-deeper-mockup');
    if (mockup) {
      gsap.fromTo(mockup,
        { opacity: 0, y: 30, rotateY: -8 },
        {
          opacity: 1, y: 0, rotateY: -3, duration: 0.9, ease: 'power3.out',
          scrollTrigger: { trigger: mockup, start: 'top 85%', once: true }
        }
      );
    }
  }

  function initDeepDiveReveals() {
    /* Reveal-on-scroll fallback when GSAP is unavailable */
    if (hasGsap) return;  /* GSAP path handles it */
    if (REDUCED_MOTION || !('IntersectionObserver' in window)) {
      document.querySelectorAll('.hm-reveal, .hm-section-eyebrow, .hm-section-title, .hm-section-lede')
        .forEach(el => el.classList.add('is-shown'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-shown');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    document.querySelectorAll('.hm-reveal, .hm-section-eyebrow, .hm-section-title, .hm-section-lede')
      .forEach(el => io.observe(el));
  }

  /* ─────────────────── back-to-top rocket ─────────────────── */
  function initRocket() {
    const rocket = document.querySelector('.hm-rocket');
    if (!rocket) return;
    const showAt = 320;
    window.addEventListener('scroll', () => {
      if (window.scrollY > showAt) rocket.classList.add('is-shown');
      else rocket.classList.remove('is-shown');
    }, { passive: true });
    rocket.addEventListener('click', () => {
      /* animate, then jump to top */
      rocket.classList.add('is-launched');
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
        setTimeout(() => rocket.classList.remove('is-launched'), 1400);
      }, 700);
    });
  }

  /* ─────────────────── easter egg pulse ─────────────────── */
  function initEasterEgg() {
    const eg = document.querySelector('.hm-eg');
    if (!eg) return;
    let pulse;
    eg.addEventListener('mouseenter', () => {
      pulse = setInterval(() => eg.classList.toggle('is-pulse'), 280);
    });
    eg.addEventListener('mouseleave', () => { clearInterval(pulse); eg.classList.remove('is-pulse'); });
  }
})();
