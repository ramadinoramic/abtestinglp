'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type Campaign = {
  id: string;
  name: string;
  slug: string;
  shortCode?: string | null;
  variants?: { id: string; slug: string }[];
};

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={copy}
      className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors whitespace-nowrap"
    >
      {copied ? '✓ Copied' : (label ?? 'Copy')}
    </button>
  );
}

function QrModal({ url, onClose }: { url: string; onClose: () => void }) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl p-6 flex flex-col items-center gap-4 max-w-xs w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm text-gray-300 font-medium text-center break-all">{url}</div>
        <img src={qrSrc} alt="QR Code" className="rounded-lg bg-white p-2" width={240} height={240} />
        <div className="flex gap-2">
          <CopyButton text={url} label="Copy URL" />
          <a
            href={qrSrc}
            download="qr-code.png"
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
          >
            Download QR
          </a>
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Token reference data
const URL_TOKENS = [
  { token: '{clickid}', description: 'Unique click ID generated at tracking time', example: 'xK9mQ2pLnR4vT8wY' },
  { token: '{country}', description: 'ISO 3166-1 alpha-2 country code', example: 'CH' },
  { token: '{device}', description: 'Device type', example: 'mobile · desktop · tablet' },
  { token: '{browser}', description: 'Browser name', example: 'chrome · safari · firefox' },
  { token: '{os}', description: 'Operating system', example: 'ios · android · windows' },
  { token: '{language}', description: 'Browser language', example: 'en · de · fr' },
  { token: '{ip}', description: 'Visitor IP address', example: '92.107.x.x' },
  { token: '{referrer}', description: 'URL-encoded referring page', example: 'https%3A%2F%2Ffacebook.com%2F' },
  { token: '{referrerdomain}', description: 'Referring domain only', example: 'facebook.com' },
  { token: '{utm_source}', description: 'UTM source', example: 'facebook' },
  { token: '{utm_medium}', description: 'UTM medium', example: 'cpc' },
  { token: '{utm_campaign}', description: 'UTM campaign', example: 'summer2025' },
  { token: '{utm_content}', description: 'UTM content', example: 'image-carousel' },
  { token: '{utm_term}', description: 'UTM term', example: 'sports-betting' },
  { token: '{vibe}', description: 'Ad creative identifier', example: 'luxury_chalet' },
  { token: '{cost}', description: 'Per-click cost from traffic source (?cost=0.08)', example: '0.08' },
  { token: '{externalid}', description: 'Traffic source click ID (?externalid=FB_xxx)', example: 'IwAR2xyz...' },
  { token: '{var1} … {var10}', description: 'Custom numbered variables (?var1=abc)', example: 'abc123' },
  { token: '{var:name}', description: 'Named custom variable (?myvar=val)', example: 'val' },
  { token: '{cachebuster}', description: 'Random string to prevent caching', example: 'a3f9k2' },
];

export default function LinksPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [baseUrl, setBaseUrl] = useState('');
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [tokensOpen, setTokensOpen] = useState(false);

  // UTM Builder state
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [utmMedium, setUtmMedium] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [utmContent, setUtmContent] = useState('');
  const [vibe, setVibe] = useState('');
  const [useShortUrl, setUseShortUrl] = useState(false);
  const [showBuilderQr, setShowBuilderQr] = useState(false);

  useEffect(() => {
    setBaseUrl(window.location.origin);
    fetch('/api/admin/campaigns')
      .then((r) => r.json())
      .then((d) => setCampaigns(d.campaigns ?? []));
  }, []);

  const generateShortCode = useCallback(async (campaignId: string) => {
    setGeneratingFor(campaignId);
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generateShortCode: { campaignId } }),
      });
      const data = await res.json();
      if (data.shortCode) {
        setCampaigns((prev) =>
          prev.map((c) => (c.id === campaignId ? { ...c, shortCode: data.shortCode } : c))
        );
      }
    } finally {
      setGeneratingFor(null);
    }
  }, []);

  const trackingUrl = (slug: string) => `${baseUrl}/api/track?campaign=${slug}`;
  const shortUrl = (code: string) => `${baseUrl}/go/${code}`;

  // Build UTM preview URL
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);
  const builtUrl = (() => {
    if (!selectedCampaign) return '';
    const base =
      useShortUrl && selectedCampaign.shortCode
        ? shortUrl(selectedCampaign.shortCode)
        : trackingUrl(selectedCampaign.slug);
    const params = new URLSearchParams();
    if (utmSource) params.set('utm_source', utmSource);
    if (utmMedium) params.set('utm_medium', utmMedium);
    if (utmCampaign) params.set('utm_campaign', utmCampaign);
    if (utmContent) params.set('utm_content', utmContent);
    if (vibe) params.set('vibe', vibe);
    const qs = params.toString();
    return qs ? `${base}&${qs}` : base;
  })();

  const postbackUrl = `${baseUrl}/api/postback?clickid={CLICKID}&event={EVENT}&payout={PAYOUT}&currency={CURRENCY}`;
  const trackerScript = `<script src="${baseUrl}/tracker.js" async></script>`;

  const pixelImgTag = `<img src="${baseUrl}/api/pixel?cid={CLICKID}&payout={PAYOUT}&event={EVENT}" width="1" height="1" style="display:none" />`;
  const pixelScriptTag =
    `<script>\n  var i=new Image();\n  i.src="${baseUrl}/api/pixel?cid={CLICKID}&payout={PAYOUT}&event={EVENT}";\n</script>`;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {qrUrl && <QrModal url={qrUrl} onClose={() => setQrUrl(null)} />}

      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Links & Tools</h1>
          <p className="text-sm text-gray-400 mt-0.5">All your tracking links and integration tools in one place.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-sm text-gray-400 hover:text-white transition-colors">
            ← Campaigns
          </Link>
          <Link
            href="/admin/analytics"
            className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            Analytics
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">

        {/* ── Section 1: Campaign Links ──────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-1">Campaign Links</h2>
          <p className="text-sm text-gray-400 mb-4">
            Use the short URL in your ads — it&apos;s easier to share and still tracks everything.
          </p>
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Campaign</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Tracking URL</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Short URL</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      No campaigns yet
                    </td>
                  </tr>
                )}
                {campaigns.map((c) => {
                  const tUrl = trackingUrl(c.slug);
                  const sUrl = c.shortCode ? shortUrl(c.shortCode) : null;
                  return (
                    <tr key={c.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-900/30">
                      <td className="px-4 py-3">
                        <span className="font-medium text-white">{c.name}</span>
                        <span className="ml-2 text-xs text-gray-500">{c.slug}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-gray-300 break-all">
                          /api/track?campaign={c.slug}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {sUrl ? (
                          <span className="font-mono text-xs text-emerald-400">/go/{c.shortCode}</span>
                        ) : (
                          <button
                            onClick={() => generateShortCode(c.id)}
                            disabled={generatingFor === c.id}
                            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50"
                          >
                            {generatingFor === c.id ? 'Generating…' : '+ Generate'}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          <CopyButton text={tUrl} label="Copy" />
                          {sUrl && <CopyButton text={sUrl} label="Copy Short" />}
                          <button
                            onClick={() => setQrUrl(sUrl ?? tUrl)}
                            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
                          >
                            QR
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Section 2: Postback URL ───────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-1">S2S Postback URL</h2>
          <p className="text-sm text-gray-400 mb-4">
            Give this URL to your affiliate network. They call it server-to-server every time a conversion fires.
            Replace the tokens with your network&apos;s macros.
          </p>
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <code className="flex-1 font-mono text-xs text-emerald-300 break-all leading-relaxed">
                {postbackUrl}
              </code>
              <CopyButton text={postbackUrl} />
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Token</th>
                  <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Replace with</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {[
                  ['{CLICKID}', "Your network's click ID macro — passed to your offer as ?c={clickid}"],
                  ['{EVENT}', 'registration · ftd · redeposit'],
                  ['{PAYOUT}', 'Payout amount e.g. 35.00'],
                  ['{CURRENCY}', 'Currency code, default EUR'],
                  ['{PLAYER_ID}', '(Optional) Player ID from the network'],
                  ['{PLAYER_VALUE}', '(Optional) Player lifetime value'],
                ].map(([token, desc]) => (
                  <tr key={token} className="hover:bg-gray-900/30">
                    <td className="px-4 py-2.5">
                      <code className="font-mono text-xs text-amber-400">{token}</code>
                    </td>
                    <td className="px-4 py-2.5 text-gray-300 text-xs">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Section 3: Conversion Pixel ───────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-1">Conversion Tracking Pixel</h2>
          <p className="text-sm text-gray-400 mb-4">
            Use when your network doesn&apos;t support S2S postback. Place this on the offer&apos;s
            thank-you / confirmation page. The pixel fires a 1×1 transparent GIF and records the
            conversion silently.
          </p>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1.5">HTML img tag</p>
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 flex items-start gap-3">
                <code className="flex-1 font-mono text-xs text-blue-300 break-all leading-relaxed">
                  {pixelImgTag}
                </code>
                <CopyButton text={pixelImgTag} />
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1.5">JavaScript version</p>
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 flex items-start gap-3">
                <code className="flex-1 font-mono text-xs text-blue-300 break-all leading-relaxed whitespace-pre">
                  {pixelScriptTag}
                </code>
                <CopyButton text={pixelScriptTag} />
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Token</th>
                  <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Replace with</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {[
                  ['{CLICKID}', "Your platform's click ID — the ?c= value passed to your lander"],
                  ['{PAYOUT}', '(Optional) Payout amount e.g. 35.00'],
                  ['{CURRENCY}', '(Optional) Currency code, default EUR'],
                  ['{EVENT}', '(Optional) registration · ftd · redeposit — default ftd'],
                ].map(([token, desc]) => (
                  <tr key={token} className="hover:bg-gray-900/30">
                    <td className="px-4 py-2.5">
                      <code className="font-mono text-xs text-amber-400">{token}</code>
                    </td>
                    <td className="px-4 py-2.5 text-gray-300 text-xs">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Section 4: Tracker Script ─────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-1">Tracker Script</h2>
          <p className="text-sm text-gray-400 mb-4">
            Embed this on every landing page. It fires impression, CTA click, and scroll events back to the platform.
          </p>
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 flex items-start gap-3">
            <code className="flex-1 font-mono text-xs text-blue-300 break-all">{trackerScript}</code>
            <CopyButton text={trackerScript} />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            The script reads the <code className="text-gray-400">?c=</code> click ID from the URL automatically.
            CTA button must have <code className="text-gray-400">id=&quot;cta-btn&quot;</code>.
          </p>
        </section>

        {/* ── Section 5: URL Token Reference (collapsible) ─────────── */}
        <section>
          <button
            onClick={() => setTokensOpen((v) => !v)}
            className="flex items-center gap-2 text-lg font-semibold text-white hover:text-gray-300 transition-colors w-full text-left"
          >
            <span>{tokensOpen ? '▾' : '▸'}</span>
            Offer URL Token Reference
          </button>
          <p className="text-sm text-gray-400 mt-1 mb-3">
            Use these tokens in your Campaign&apos;s <strong className="text-gray-200">Offer URL</strong> field.
            They are replaced with real values at click time — just like Voluum.
          </p>

          {tokensOpen && (
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/60">
                    <th className="text-left px-4 py-2.5 text-gray-400 font-medium w-44">Token</th>
                    <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Description</th>
                    <th className="text-left px-4 py-2.5 text-gray-400 font-medium w-44">Example</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {URL_TOKENS.map(({ token, description, example }) => (
                    <tr key={token} className="hover:bg-gray-900/30">
                      <td className="px-4 py-2.5">
                        <code className="font-mono text-xs text-emerald-400">{token}</code>
                      </td>
                      <td className="px-4 py-2.5 text-gray-300 text-xs">{description}</td>
                      <td className="px-4 py-2.5">
                        <code className="font-mono text-xs text-gray-400">{example}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Section 6: UTM Link Builder ───────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-1">UTM Link Builder</h2>
          <p className="text-sm text-gray-400 mb-4">
            Build a complete tracking URL with UTM parameters. Copy or scan the QR code to test it.
          </p>
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Campaign</label>
                <select
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">— Select campaign —</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Vibe / Creative Tag</label>
                <input
                  type="text"
                  value={vibe}
                  onChange={(e) => setVibe(e.target.value)}
                  placeholder="e.g. luxury_chalet"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">UTM Source</label>
                <input
                  type="text"
                  value={utmSource}
                  onChange={(e) => setUtmSource(e.target.value)}
                  placeholder="e.g. facebook"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">UTM Medium</label>
                <input
                  type="text"
                  value={utmMedium}
                  onChange={(e) => setUtmMedium(e.target.value)}
                  placeholder="e.g. cpc"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">UTM Campaign</label>
                <input
                  type="text"
                  value={utmCampaign}
                  onChange={(e) => setUtmCampaign(e.target.value)}
                  placeholder="e.g. summer2025"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">UTM Content</label>
                <input
                  type="text"
                  value={utmContent}
                  onChange={(e) => setUtmContent(e.target.value)}
                  placeholder="e.g. image-carousel"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {selectedCampaign?.shortCode && (
              <label className="flex items-center gap-2 cursor-pointer w-fit">
                <div
                  onClick={() => setUseShortUrl((v) => !v)}
                  className={`w-9 h-5 rounded-full transition-colors ${useShortUrl ? 'bg-emerald-500' : 'bg-gray-600'} relative`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${useShortUrl ? 'translate-x-4' : ''}`}
                  />
                </div>
                <span className="text-sm text-gray-300">Use short URL</span>
              </label>
            )}

            {builtUrl && (
              <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-3 space-y-3">
                <div className="font-mono text-xs text-emerald-300 break-all leading-relaxed">{builtUrl}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <CopyButton text={builtUrl} label="Copy URL" />
                  <button
                    onClick={() => setShowBuilderQr((v) => !v)}
                    className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
                  >
                    {showBuilderQr ? 'Hide QR' : 'Show QR'}
                  </button>
                </div>
                {showBuilderQr && (
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(builtUrl)}`}
                    alt="QR"
                    className="rounded bg-white p-1"
                    width={160}
                    height={160}
                  />
                )}
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
