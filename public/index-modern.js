/* ════════════════════════════════════════════════════════════════════════
   SpeedX — Landing Page Choreography
   GSAP + ScrollTrigger via CDN. Honors prefers-reduced-motion.
   Degrades gracefully when GSAP is absent or blocked.
   Kept: navbar scroll state, hero word-fade, scroll reveals,
   back-to-top, easter egg. Removed: custom cursor, magnetic buttons,
   ripples, 3D tilt, preloader (design de-slop).
   ════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const REDUCED_MOTION =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gsap = window.gsap || null;
  const ScrollTrigger = window.ScrollTrigger || null;
  // Owner request: the site's signature motion plays even on devices with
  // Reduce Motion enabled, so GSAP choreography is NOT gated on the media
  // query. REDUCED_MOTION is kept for the non-essential niceties (e.g.
  // smooth-scroll behaviour on the back-to-top rocket).
  const hasGsap = !!gsap && !!ScrollTrigger;

  /* ─────────────────── boot ─────────────────── */
  document.addEventListener('DOMContentLoaded', boot, { once: true });

  function boot() {
    document.body.classList.add('hm-active');
    initNavbarScrollState();
    initHero();
    initDeepDiveReveals();
    initRocket();
    initEasterEgg();
    if (hasGsap) initScrollTrigger();
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

  /* ─────────────────── hero entry: word fade ─────────────────── */
  function initHero() {
    const headline = document.querySelector('.hm-headline');
    if (!headline) return;

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
        .fromTo(illu, { opacity: 0, y: 16 },
                   { opacity: 1, y: 0, duration: 0.7 }, '-=0.55');
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
  }

  function fadeInNow(el) {
    if (!el) return;
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  }

  /* ─────────────────── scroll-trigger reveals ─────────────────── */
  function initScrollTrigger() {
    gsap.registerPlugin(ScrollTrigger);

    /* reveal anything tagged .hm-reveal */
    document.querySelectorAll('.hm-reveal').forEach((el) => {
      gsap.fromTo(el,
        { opacity: 0, y: 20 },
        {
          opacity: 1, y: 0, duration: 0.6, ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true }
        }
      );
    });

    /* feature ledger rows stagger (section heads are already covered by .hm-reveal) */
    document.querySelectorAll('.hm-section').forEach((section) => {
      const kids = section.querySelectorAll('.hm-feature');
      if (!kids.length) return;
      gsap.fromTo(kids,
        { opacity: 0, y: 20 },
        {
          opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', stagger: 0.08,
          scrollTrigger: { trigger: section, start: 'top 80%', once: true }
        }
      );
    });

    /* deeper section: mockup lifts */
    const mockup = document.querySelector('.hm-deeper-mockup');
    if (mockup) {
      gsap.fromTo(mockup,
        { opacity: 0, y: 24 },
        {
          opacity: 1, y: 0, duration: 0.8, ease: 'power3.out',
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

  /* ─────────────────── back-to-top ─────────────────── */
  function initRocket() {
    const rocket = document.querySelector('.hm-rocket');
    if (!rocket) return;
    const showAt = 320;
    window.addEventListener('scroll', () => {
      if (window.scrollY > showAt) rocket.classList.add('is-shown');
      else rocket.classList.remove('is-shown');
    }, { passive: true });
    rocket.addEventListener('click', () => {
      rocket.classList.add('is-launched');
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
        setTimeout(() => rocket.classList.remove('is-launched'), 1400);
      }, 300);
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
