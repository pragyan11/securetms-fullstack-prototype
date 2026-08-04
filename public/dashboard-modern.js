/*════════════════════════════════════════════════════════════════════════════
SpeedX — DEPRECATED / NO-OP STUB.

This file used to drive the cyber-physical dashboard choreography (palette,
bento mirroring, avatar menu, GSAP timeline, dot-matrix fleet grid, etc.) and
referenced markup that was rewritten out of dashboard.html:
  - .sidebar-link       (now .nav-link)
  - #fleetMap           (now #liveMap)
  - #recentActivity     (no longer exists)
  - ssAvatar / ssAvatarMenu / ssAvatarName / ssAvatarInitials
  - ssBento_kpi*        (no longer exists)
  - ssPalette / ssPaletteTrigger / ssPaletteInput / ssPaletteList

The feature parity for those surfaces now lives in dashboard-page.js (vanilla,
no framework) and dashboard-modern.css (visual layer only). If you genuinely
want GSAP-driven choreography back, port it to the new markup; do not
reinstate this file against the new DOM.

This stub exists so that no <script src="dashboard-modern.js"> reference can
accidentally inject an invisible palette modal or throw null-reference errors.
═══════════════════════════════════════════════════════════════════════════*/
'use strict';
(function () { /* intentional no-op */ })();
