/* ═══════════════════════════════════════════════════════════════════════════
   SpeedX — shared UI formatters + DOM helpers.
   Loaded by customer/driver/dashboard pages. Pure functions, no globals
   besides window.SecureTMS.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }

  function pillClass(s) {
    const k = String(s || '').toLowerCase();
    if (k === 'delivered' || k === 'completed') return 'is-delivered';
    if (k === 'in transit' || k === 'picked up' || k === 'confirmed') return 'is-in-transit';
    if (k === 'created' || k === 'pending' || k === 'awaiting assignment') return 'is-pending';
    if (k === 'cancelled' || k === 'maintenance' || k === 'error') return 'is-cancelled';
    return 'is-other';
  }

  function fmtDate(s) {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString(); } catch { return '—'; }
  }
  function fmtDateTime(s) {
    if (!s) return '—';
    try { return new Date(s).toLocaleString(); } catch { return '—'; }
  }

  /** Initials for the avatar chip. Always returns a non-empty string. */
  function initials(s, fallback = '??') {
    const str = (s == null ? '' : String(s)).trim();
    if (!str) return fallback;
    const parts = str.split(/\s+/).map(p => p && p[0]).filter(Boolean).slice(0, 2);
    return (parts.join('') || fallback).toUpperCase();
  }

  /** Field-cell: tiny labelled value block used in route + booking cards.
      Replaces the invalid <field> tag the rewrite left lying around. */
  function cell(label, value, opts = {}) {
    const mono = !!opts.mono;
    const bold = opts.bold !== false && !!value;
    const cls = mono ? 'font-mono' : '';
    const weight = value ? (bold ? 700 : 600) : 400;
    const color = value ? 'var(--text-hi)' : 'var(--text-dim)';
    const rendered = value ? escapeHtml(String(value)) : '—';
    return `
      <div>
        <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">${escapeHtml(label)}</div>
        <div class="${cls}" style="margin-top:4px;font-weight:${weight};color:${color};">${rendered}</div>
      </div>`;
  }

  /* Native CSS.escape (available everywhere we ship). Used to safely
     splice IDs into attribute selectors. Falls back to a regex that
     escapes any character we'd otherwise break on. */
  const cssEscape = (typeof CSS !== 'undefined' && CSS.escape)
    ? CSS.escape
    : (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);

  /* Show a banner-style empty state. opts = { icon?, title, message, hint?, cta?, success? } */
  function emptyState(opts) {
    const defaultIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/></svg>';
    return `
      <div class="empty-state is-illustrated ${opts.success ? 'is-success' : ''}">
        <div class="empty-state-illu">
          ${opts.icon || defaultIcon}
        </div>
        <div class="empty-state-title">${escapeHtml(opts.title || '')}</div>
        <div class="empty-state-msg">${opts.message || ''}</div>
        ${opts.hint ? `<div class="empty-state-hint">${opts.hint}</div>` : ''}
        ${opts.cta ? `<div style="margin-top:14px;"><button class="btn" type="button" data-empty-cta>${escapeHtml(opts.cta)}</button></div>` : ''}
      </div>`;
  }

  /* Display name resolver. Always returns a non-empty string. */
  function displayName(u, fallback) {
    if (!u) return fallback || 'Guest';
    return u.name || u.email || fallback || 'Guest';
  }

  window.SecureTMS = {
    escapeHtml, pillClass, fmtDate, fmtDateTime, initials, cssEscape, cell, emptyState, displayName
  };
})();
