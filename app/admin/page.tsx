'use client';

import { useEffect, useState } from 'react';

interface Campaign {
  id: string;
  name: string;
  slug: string;
  status: string;
  offerUrl: string;
  offerId: string;
  createdAt: string;
  variants: { id: string; name: string; slug: string; trafficWeight: number }[];
}

const BASE_URL =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'https://abtestinglp.vercel.app';

export default function AdminPage() {
  const [landingPages, setLandingPages] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    slug: '',
    offerUrl: '',
    offerId: '',
    variantA: '',
    variantB: '',
    splitA: 50,
    splitB: 50,
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/landing-pages').then((r) => r.json()),
      fetch('/api/admin/campaigns').then((r) => r.json()),
    ]).then(([lpData, campData]) => {
      setLandingPages(lpData.landingPages || []);
      setCampaigns(campData.campaigns || []);
      setLoading(false);
    });
  }, []);

  function handleSplitA(val: number) {
    setForm((f) => ({ ...f, splitA: val, splitB: 100 - val }));
  }

  function slugify(str: string) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function handleNameChange(val: string) {
    setForm((f) => ({ ...f, name: val, slug: slugify(val) }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.variantA || !form.variantB) {
      setError('Please select both Variant A and Variant B.');
      return;
    }
    if (form.variantA === form.variantB) {
      setError('Variant A and Variant B must be different landing pages.');
      return;
    }
    setCreating(true);
    const res = await fetch('/api/admin/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setCreating(false);
    if (data.success) {
      const link = `${BASE_URL}/api/track?campaign=${form.slug}`;
      setGeneratedLink(link);
      const campRes = await fetch('/api/admin/campaigns').then((r) => r.json());
      setCampaigns(campRes.campaigns || []);
      setForm({ name: '', slug: '', offerUrl: '', offerId: '', variantA: '', variantB: '', splitA: 50, splitB: 50 });
    } else {
      setError(JSON.stringify(data.error));
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete campaign "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/admin/campaigns?id=${id}`, { method: 'DELETE' });
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">AB Test Dashboard</h1>
          <p className="text-gray-400 mt-1">Create campaigns, select landing pages, get your tracking link.</p>
        </div>

        {/* Create Campaign Form */}
        <div className="bg-gray-900 rounded-xl p-6 mb-8 border border-gray-800">
          <h2 className="text-xl font-semibold mb-6 text-white">Create New Campaign</h2>
          <form onSubmit={handleCreate} className="space-y-5">

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Campaign Name</label>
                <input
                  type="text"
                  required
                  placeholder="Swiss Sports Q2"
                  value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Slug (auto-generated)</label>
                <input
                  type="text"
                  required
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Offer URL</label>
                <input
                  type="url"
                  required
                  placeholder="https://your-network.com/click?affid=123"
                  value={form.offerUrl}
                  onChange={(e) => setForm((f) => ({ ...f, offerUrl: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Offer ID (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. 4452"
                  value={form.offerId}
                  onChange={(e) => setForm((f) => ({ ...f, offerId: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {landingPages.length === 0 ? (
              <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 text-yellow-300 text-sm">
                No landing pages found. Upload a folder to <code>public/landing-pages/your-page/</code> and redeploy.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Variant A <span className="text-blue-400">({form.splitA}%)</span>
                  </label>
                  <select
                    required
                    value={form.variantA}
                    onChange={(e) => setForm((f) => ({ ...f, variantA: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Select landing page...</option>
                    {landingPages.map((lp) => (
                      <option key={lp} value={lp}>{lp}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Variant B <span className="text-purple-400">({form.splitB}%)</span>
                  </label>
                  <select
                    required
                    value={form.variantB}
                    onChange={(e) => setForm((f) => ({ ...f, variantB: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Select landing page...</option>
                    {landingPages.map((lp) => (
                      <option key={lp} value={lp}>{lp}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Traffic Split — A: {form.splitA}% / B: {form.splitB}%
              </label>
              <input
                type="range"
                min={10}
                max={90}
                value={form.splitA}
                onChange={(e) => handleSplitA(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>A: 10%</span>
                <span>50/50</span>
                <span>A: 90%</span>
              </div>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={creating || landingPages.length === 0}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {creating ? 'Creating...' : 'Create Campaign & Generate Link'}
            </button>
          </form>

          {/* Generated Link */}
          {generatedLink && (
            <div className="mt-6 bg-green-900/30 border border-green-700 rounded-xl p-5">
              <p className="text-green-400 font-semibold mb-2">Your Meta Ad Tracking Link:</p>
              <div className="flex items-center gap-3">
                <code className="flex-1 bg-gray-950 rounded-lg px-4 py-3 text-green-300 text-sm break-all">
                  {generatedLink}
                </code>
                <button
                  onClick={() => copyToClipboard(generatedLink)}
                  className="bg-green-700 hover:bg-green-600 text-white px-4 py-3 rounded-lg text-sm font-medium whitespace-nowrap"
                >
                  Copy
                </button>
              </div>
              <p className="text-gray-500 text-xs mt-3">
                Paste this as the destination URL in your Meta ad. Add <code>&amp;utm_source=meta&amp;utm_campaign={"{{campaign.name}}"}</code> for UTM tracking.
              </p>
            </div>
          )}
        </div>

        {/* Active Campaigns */}
        <div className="bg-gray-900 rounded-xl border border-gray-800">
          <div className="p-6 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Active Campaigns</h2>
          </div>
          {campaigns.length === 0 ? (
            <div className="p-6 text-gray-500 text-center">No campaigns yet.</div>
          ) : (
            <div className="divide-y divide-gray-800">
              {campaigns.map((camp) => {
                const trackingLink = `${BASE_URL}/api/track?campaign=${camp.slug}`;
                return (
                  <div key={camp.id} className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-semibold text-white">{camp.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            camp.status === 'ACTIVE'
                              ? 'bg-green-900 text-green-400'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {camp.status}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {camp.variants?.map((v) => (
                            <span key={v.id} className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded">
                              {v.slug} ({v.trafficWeight}%)
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-blue-400 bg-gray-950 px-3 py-1.5 rounded truncate max-w-md">
                            {trackingLink}
                          </code>
                          <button
                            onClick={() => copyToClipboard(trackingLink)}
                            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded whitespace-nowrap"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(camp.id, camp.name)}
                        className="text-red-500 hover:text-red-400 text-sm px-3 py-1 rounded border border-red-900 hover:border-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-8 bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">How to add landing pages</h2>
          <ol className="space-y-3 text-sm text-gray-400">
            <li className="flex gap-3">
              <span className="text-blue-400 font-bold">1.</span>
              <span>Put your HTML folder in <code className="text-gray-300 bg-gray-800 px-1 rounded">public/landing-pages/your-page-name/</code></span>
            </li>
            <li className="flex gap-3">
              <span className="text-blue-400 font-bold">2.</span>
              <span>Make sure <code className="text-gray-300 bg-gray-800 px-1 rounded">index.html</code> is in that folder</span>
            </li>
            <li className="flex gap-3">
              <span className="text-blue-400 font-bold">3.</span>
              <span>Add <code className="text-gray-300 bg-gray-800 px-1 rounded">id="cta-btn"</code> and <code className="text-gray-300 bg-gray-800 px-1 rounded">data-offer-url="YOUR_OFFER_URL"</code> to your CTA button</span>
            </li>
            <li className="flex gap-3">
              <span className="text-blue-400 font-bold">4.</span>
              <span>Add <code className="text-gray-300 bg-gray-800 px-1 rounded">{"<script src=\"/tracker.js\"></script>"}</code> before <code className="text-gray-300 bg-gray-800 px-1 rounded">{"</body>"}</code></span>
            </li>
            <li className="flex gap-3">
              <span className="text-blue-400 font-bold">5.</span>
              <span>Commit and push to redeploy — your page will appear in the dropdown above</span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
