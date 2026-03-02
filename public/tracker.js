/**
 * AB Test Tracker
 * Drop <script src="/tracker.js" async></script> at the bottom of every landing page.
 *
 * CTA button setup (two options — use either):
 *
 * Option A — recommended, works without JS:
 *   <a id="cta-btn" href="/api/click?cid=REPLACE_WITH_CLICK_ID">Get Bonus</a>
 *   The tracker replaces REPLACE_WITH_CLICK_ID with the real ?c= value automatically.
 *
 * Option B — legacy fallback (still supported):
 *   <button id="cta-btn" data-offer-url="https://offer.com/">Get Bonus</button>
 *   Tracker intercepts the click and redirects via /api/click for server-side tracking.
 */
(function () {
  var params = new URLSearchParams(window.location.search);
  var clickId = params.get('c') || '';
  var variant = params.get('v') || '';

  // ── 1. Track page view (impression) ────────────────────────────────────────
  if (clickId) {
    fetch('/api/track-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clickId: clickId,
        event: 'page_view',
        variant: variant,
        timestamp: new Date().toISOString(),
      }),
    }).catch(function () {});
  }

  // ── 2. Wire up CTA button ───────────────────────────────────────────────────
  var ctaBtn = document.getElementById('cta-btn');
  if (!ctaBtn) return;

  // Option A: button/link already points to /api/click — patch in the real cid
  var existingHref = ctaBtn.getAttribute('href') || '';
  if (existingHref.indexOf('/api/click') !== -1 && clickId) {
    if (existingHref.indexOf('REPLACE_WITH_CLICK_ID') !== -1) {
      ctaBtn.setAttribute(
        'href',
        existingHref.replace('REPLACE_WITH_CLICK_ID', encodeURIComponent(clickId))
      );
    } else if (existingHref.indexOf('cid=') === -1) {
      ctaBtn.setAttribute(
        'href',
        existingHref +
          (existingHref.indexOf('?') !== -1 ? '&' : '?') +
          'cid=' + encodeURIComponent(clickId)
      );
    }
    // href is set — browser follows it naturally, no JS redirect needed
    return;
  }

  // Option B: legacy button — intercept click and use /api/click for server-side tracking
  ctaBtn.addEventListener('click', function (e) {
    e.preventDefault();

    if (clickId) {
      window.location.href = '/api/click?cid=' + encodeURIComponent(clickId);
    } else {
      // No click ID (direct visit without tracking link) — fall back to offer URL if set
      var offerUrl = params.get('offer') || ctaBtn.getAttribute('data-offer-url') || '';
      if (offerUrl) {
        window.location.href = offerUrl;
      } else {
        console.warn('[tracker] No offer URL available. Set data-offer-url on #cta-btn.');
      }
    }
  });
})();
