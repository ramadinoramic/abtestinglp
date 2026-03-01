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

interface StatsData {
  overview: {
    totalClicks: number;
    ctaClicks: number;
    ctr: number;
    conversions: number;
    conversionRate: number;
    totalPayout: number;
  };
  variants: {
    id: string;
    name: string;
    slug: string;
    trafficWeight: number;
    isControl: boolean;
    clicks: number;
    ctaClicks: number;
    ctr: number;
    conversions: number;
    conversionRate: number;
    payout: number;
  }[];
  countries: { country: string; clicks: number; pct: number }[];
  devices: { device: string; clicks: number; pct: number }[];
  daily: { date: string; clicks: number; conversions: number }[];
  significance: { isSignificant: boolean; confidence: number; winner: string | null };
}

const BASE_URL =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'https://abtestinglp.vercel.app';

function fmt(n: number, decimals = 1) {
  return n.toLocaleString('en', { maximumFractionDigits: decimals });
}

function Bar({ pct, color = 'bg-blue-500' }: { pct: number; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-800 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function AdminPage() {
  const [landingPages, setLandingPages] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [error, setError] = useState('');

  // Stats state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, StatsData>>({});
  const [statsDays, setStatsDays] = useState<Record<string, number>>({});
  const [statsLoading, setStatsLoading] = useState<Record<string, boolean>>({});

  // Edit split state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSplit, setEditSplit] = useState(50);
  const [editSaving, setEditSaving] = useState(false);

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
    if (expandedId === id) setExpandedId(null);
  }

  async function loadStats(campaignId: string, days: number) {
    setStatsLoading((prev) => ({ ...prev, [campaignId]: true }));
    try {
      const res = await fetch(`/api/admin/stats?campaignId=${campaignId}&days=${days}`);
      const data = await res.json();
      setStats((prev) => ({ ...prev, [campaignId]: data }));
    } finally {
      setStatsLoading((prev) => ({ ...prev, [campaignId]: false }));
    }
  }

  function toggleStats(campaignId: string) {
    if (expandedId === campaignId) {
      setExpandedId(null);
    } else {
      setExpandedId(campaignId);
      const days = statsDays[campaignId] ?? 30;
      loadStats(campaignId, days);
    }
  }

  function changeStatsDays(campaignId: string, days: number) {
    setStatsDays((prev) => ({ ...prev, [campaignId]: days }));
    loadStats(campaignId, days);
  }

  function openEditSplit(camp: Campaign) {
    const varA = camp.variants[0];
    setEditSplit(varA?.trafficWeight ?? 50);
    setEditingId(camp.id);
  }

  async function handleEditSave(camp: Campaign) {
    if (camp.variants.length < 2) return;
    setEditSaving(true);
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variants: [
            { id: camp.variants[0].id, trafficWeight: editSplit },
            { id: camp.variants[1].id, trafficWeight: 100 - editSplit },
          ],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCampaigns((prev) =>
          prev.map((c) =>
            c.id === camp.id
              ? {
                  ...c,
                  variants: c.variants.map((v, i) => ({
                    ...v,
                    trafficWeight: i === 0 ? editSplit : 100 - editSplit,
                  })),
                }
              : c
          )
        );
        setEditingId(null);
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
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
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">AB Test Dashboard</h1>
            <p className="text-gray-400 mt-1">Create campaigns, select landing pages, get your tracking link.</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors mt-1"
          >
            Log out
          </button>
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
                const isExpanded = expandedId === camp.id;
                const campStats = stats[camp.id];
                const isStatsLoading = statsLoading[camp.id] ?? false;
                const days = statsDays[camp.id] ?? 30;

                return (
                  <div key={camp.id}>
                    {/* Campaign row */}
                    <div className="p-5">
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
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => toggleStats(camp.id)}
                            className={`text-xs px-3 py-1.5 rounded border transition-colors whitespace-nowrap ${
                              isExpanded
                                ? 'bg-blue-900/40 border-blue-700 text-blue-300'
                                : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                            }`}
                          >
                            Stats {isExpanded ? '▲' : '▾'}
                          </button>
                          <button
                            onClick={() => editingId === camp.id ? setEditingId(null) : openEditSplit(camp)}
                            className={`text-xs px-3 py-1.5 rounded border transition-colors whitespace-nowrap ${
                              editingId === camp.id
                                ? 'bg-orange-900/40 border-orange-700 text-orange-300'
                                : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                            }`}
                          >
                            Edit split
                          </button>
                          <button
                            onClick={() => handleDelete(camp.id, camp.name)}
                            className="text-red-500 hover:text-red-400 text-sm px-3 py-1 rounded border border-red-900 hover:border-red-700"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Edit split panel */}
                    {editingId === camp.id && camp.variants.length >= 2 && (
                      <div className="border-t border-gray-800 bg-gray-950 px-5 py-4">
                        <p className="text-xs text-gray-400 mb-3">
                          Adjust traffic split — changes take effect immediately for new visitors.
                        </p>
                        <div className="flex items-center gap-3 mb-1 text-sm text-white">
                          <span className="text-blue-400 font-medium">{camp.variants[0].slug}</span>
                          <span className="text-gray-500">{editSplit}%</span>
                          <span className="text-gray-600 mx-1">/</span>
                          <span className="text-purple-400 font-medium">{camp.variants[1].slug}</span>
                          <span className="text-gray-500">{100 - editSplit}%</span>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={90}
                          value={editSplit}
                          onChange={(e) => setEditSplit(Number(e.target.value))}
                          className="w-full accent-blue-500 mb-3"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEditSave(camp)}
                            disabled={editSaving}
                            className="text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white px-4 py-1.5 rounded transition-colors"
                          >
                            {editSaving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-1.5 rounded transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Stats panel */}
                    {isExpanded && (
                      <div className="border-t border-gray-800 bg-gray-950 px-5 py-4">
                        {/* Date range tabs */}
                        <div className="flex items-center gap-2 mb-4">
                          <span className="text-xs text-gray-500 mr-1">Range:</span>
                          {([7, 30, 0] as const).map((d) => (
                            <button
                              key={d}
                              onClick={() => changeStatsDays(camp.id, d)}
                              className={`text-xs px-3 py-1 rounded transition-colors ${
                                days === d
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                              }`}
                            >
                              {d === 0 ? 'All time' : `${d}d`}
                            </button>
                          ))}
                        </div>

                        {isStatsLoading ? (
                          <div className="text-gray-500 text-sm py-4 text-center">Loading stats...</div>
                        ) : !campStats ? (
                          <div className="text-gray-600 text-sm py-4 text-center">No data yet.</div>
                        ) : (
                          <>
                            {/* Overview metric cards */}
                            <div className="grid grid-cols-5 gap-3 mb-5">
                              {[
                                { label: 'Clicks', value: campStats.overview.totalClicks.toLocaleString() },
                                { label: 'CTA Rate', value: `${fmt(campStats.overview.ctr)}%` },
                                { label: 'Conversions', value: campStats.overview.conversions.toLocaleString() },
                                { label: 'Conv Rate', value: `${fmt(campStats.overview.conversionRate)}%` },
                                { label: 'Payout', value: `€${fmt(campStats.overview.totalPayout, 2)}` },
                              ].map((m) => (
                                <div key={m.label} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                                  <div className="text-xs text-gray-500 mb-1">{m.label}</div>
                                  <div className="text-lg font-semibold text-white">{m.value}</div>
                                </div>
                              ))}
                            </div>

                            {/* Variant comparison */}
                            {campStats.variants.length > 0 && (
                              <div className="mb-5">
                                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Variant Performance</h4>
                                <div className="space-y-3">
                                  {campStats.variants.map((v) => {
                                    const isWinner = campStats.significance.winner === v.name;
                                    return (
                                      <div key={v.id} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm text-white font-medium">{v.name}</span>
                                            <span className="text-xs text-gray-500">({v.trafficWeight}% traffic)</span>
                                            {isWinner && campStats.significance.isSignificant && (
                                              <span className="text-xs bg-green-900 text-green-400 px-2 py-0.5 rounded-full">Winner</span>
                                            )}
                                          </div>
                                          <div className="flex gap-4 text-xs text-gray-400">
                                            <span>{v.clicks.toLocaleString()} clicks</span>
                                            <span>CTR: {fmt(v.ctr)}%</span>
                                            <span>{v.conversions} conv ({fmt(v.conversionRate)}%)</span>
                                            <span>€{fmt(v.payout, 2)}</span>
                                          </div>
                                        </div>
                                        <Bar
                                          pct={Math.round(v.conversionRate)}
                                          color={isWinner ? 'bg-green-500' : 'bg-blue-500'}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Statistical significance */}
                                <div className={`mt-2 text-xs px-3 py-2 rounded-lg ${
                                  campStats.significance.isSignificant
                                    ? 'bg-green-900/30 border border-green-800 text-green-400'
                                    : campStats.significance.confidence >= 80
                                    ? 'bg-yellow-900/30 border border-yellow-800 text-yellow-400'
                                    : 'bg-gray-900 border border-gray-800 text-gray-500'
                                }`}>
                                  {campStats.significance.isSignificant
                                    ? `Winner: ${campStats.significance.winner} — ${campStats.significance.confidence}% confidence (statistically significant)`
                                    : campStats.significance.confidence >= 80
                                    ? `Trending: ${campStats.significance.winner ?? 'no winner yet'} — ${campStats.significance.confidence}% confidence (needs 95% to be significant)`
                                    : campStats.significance.confidence > 0
                                    ? `Not enough data — ${campStats.significance.confidence}% confidence so far (needs 95%)`
                                    : 'Not enough conversion data to compute significance'}
                                </div>
                              </div>
                            )}

                            {/* Country + Device breakdown */}
                            <div className="grid grid-cols-2 gap-4">
                              {campStats.countries.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Top Countries</h4>
                                  <div className="space-y-2">
                                    {campStats.countries.map((c) => (
                                      <div key={c.country}>
                                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                                          <span>{c.country}</span>
                                          <span>{c.clicks.toLocaleString()}</span>
                                        </div>
                                        <Bar pct={c.pct} color="bg-purple-500" />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {campStats.devices.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Devices</h4>
                                  <div className="space-y-2">
                                    {campStats.devices.map((d) => (
                                      <div key={d.device}>
                                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                                          <span>{d.device}</span>
                                          <span>{d.clicks.toLocaleString()}</span>
                                        </div>
                                        <Bar pct={d.pct} color="bg-teal-500" />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
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
