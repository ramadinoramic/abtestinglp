/**
 * AB Test Tracker
 * Drop <script src="/tracker.js"></script> at the bottom of every landing page.
 * Make sure your CTA button has id="cta-btn"
 */
(function () {
  const params = new URLSearchParams(window.location.search);
  const clickId = params.get('c') || '';
  const variant = params.get('v') || '';

  // Track page view
  if (clickId) {
    fetch('/api/track-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clickId,
        event: 'page_view',
        variant,
        timestamp: new Date().toISOString(),
      }),
    }).catch(function () {});
  }

  // Track CTA click and redirect
  var ctaBtn = document.getElementById('cta-btn');
  if (ctaBtn) {
    ctaBtn.addEventListener('click', function (e) {
      e.preventDefault();

      // Prefer the offer URL injected by the tracker route (set at campaign level in admin),
      // fall back to the data-offer-url attribute on the button (for manual/legacy pages).
      var offerUrl = params.get('offer') || ctaBtn.getAttribute('data-offer-url') || '';

      if (!offerUrl) {
        console.warn('[tracker] No data-offer-url on #cta-btn');
        return;
      }

      if (clickId) {
        fetch('/api/track-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clickId,
            event: 'cta_click',
            timestamp: new Date().toISOString(),
          }),
        })
          .catch(function () {})
          .finally(function () {
            window.location.href = offerUrl;
          });
      } else {
        window.location.href = offerUrl;
      }
    });
  }
})();
