'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Campaign {
  id: string;
  name: string;
  slug: string;
  status: string;
  offerUrl: string;
  offerId: string;
  adSpend?: number | null;
  geoAllowList?: string;
  shortCode?: string | null;
  optimizationMode?: string;
  autoPauseEnabled?: boolean;
  autoPauseThreshold?: number | null;
  autoPauseWindow?: number | null;
  autoPausedAt?: string | null;
  createdAt: string;
  variants: { id: string; name: string; slug: string; trafficWeight: number }[];
}

interface StatsData {
  overview: {
    totalClicks: number;
    impressions: number;
    landingRate: number;
    ctaClicks: number;
    ctr: number;
    conversions: number;
    conversionRate: number;
    totalPayout: number;
    adSpend?: number | null;
    roi?: number | null;
    botClicks?: number;
  };
  vibes: {
    vibe: string;
    clicks: number;
    impressions: number;
    ctaClicks: number;
    ctr: number;
    conversions: number;
    conversionRate: number;
    payout: number;
  }[];
  variants: {
    id: string;
    name: string;
    slug: string;
    trafficWeight: number;
    isControl: boolean;
    clicks: number;
    impressions: number;
    ctaClicks: number;
    ctr: number;
    conversions: number;
    conversionRate: number;
    payout: number;
  }[];
  countries: { country: string; clicks: number; pct: number }[];
  devices: { device: string; clicks: number; pct: number }[];
  daily: { date: string; clicks: number; conversions: number }[];
  significance: { isSignificant: boolean; confidence: number; winner: string | null; leader: string | null };
}

interface LanderRow {
  landingPage: string;
  weight: number;
  geoTargets?: string[];
  deviceTargets?: string[];
  offerUrlOverride?: string;
  showTargeting?: boolean;
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

const VARIANT_COLORS = ['text-blue-400', 'text-purple-400', 'text-teal-400', 'text-orange-400', 'text-pink-400'];

export default function AdminPage() {
  const [landingPages, setLandingPages] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [generatedShortCode, setGeneratedShortCode] = useState('');
  const [error, setError] = useState('');

  // Stats state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, StatsData>>({});
  const [statsDays, setStatsDays] = useState<Record<string, number>>({});
  const [statsLoading, setStatsLoading] = useState<Record<string, boolean>>({});

  // Edit split state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWeights, setEditWeights] = useState<{ id: string; slug: string; weight: number }[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  // Clone state
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneSlug, setCloneSlug] = useState('');
  const [cloning, setCloning] = useState(false);

  // RBAC state
  const [myRole, setMyRole] = useState<string>('OWNER');
  const isOwner = myRole === 'OWNER';

  // Form state
  const [formBase, setFormBase] = useState({
    name: '', slug: '', offerUrl: '', offerId: '', adSpend: '', geoAllowList: '',
    optimizationMode: 'STATIC',
    autoPauseEnabled: false, autoPauseThreshold: '', autoPauseWindow: '24',
  });
  const [landers, setLanders] = useState<LanderRow[]>([{ landingPage: '', weight: 100 }]);

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/landing-pages').then((r) => r.json()),
      fetch('/api/admin/campaigns').then((r) => r.json()),
      fetch('/api/admin/me').then((r) => r.json()),
    ]).then(([lpData, campData, meData]) => {
      setLandingPages(lpData.landingPages || []);
      setCampaigns(campData.campaigns || []);
      setMyRole(meData.role ?? 'OWNER');
      setLoading(false);
    });
  }, []);

  function slugify(str: string) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function handleNameChange(val: string) {
    setFormBase((f) => ({ ...f, name: val, slug: slugify(val) }));
  }

  // ── Lander management ────────────────────────────────────────────────────

  function addLander() {
    if (landers.length >= 5) return;
    const n = landers.length + 1;
    const equal = Math.floor(100 / n);
    const remainder = 100 - equal * n;
    setLanders((prev) => [
      ...prev.map((l, i) => ({ ...l, weight: equal + (i === 0 ? remainder : 0) })),
      { landingPage: '', weight: equal },
    ]);
  }

  function removeLander(idx: number) {
    if (landers.length <= 1) return;
    const updated = landers.filter((_, i) => i !== idx);
    // redistribute weights equally after removal
    autoSplit(updated);
  }

  function autoSplit(rows?: LanderRow[]) {
    const base = rows ?? landers;
    const n = base.length;
    const equal = Math.floor(100 / n);
    const remainder = 100 - equal * n;
    setLanders(base.map((l, i) => ({ ...l, weight: equal + (i === 0 ? remainder : 0) })));
  }

  function setLanderPage(idx: number, page: string) {
    setLanders((prev) => prev.map((l, i) => (i === idx ? { ...l, landingPage: page } : l)));
  }

  function setLanderWeight(idx: number, val: number) {
    setLanders((prev) => prev.map((l, i) => (i === idx ? { ...l, weight: val } : l)));
  }

  function toggleLanderTargeting(idx: number) {
    setLanders((prev) => prev.map((l, i) => (i === idx ? { ...l, showTargeting: !l.showTargeting } : l)));
  }

  function setLanderGeo(idx: number, val: string) {
    const arr = val.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    setLanders((prev) => prev.map((l, i) => (i === idx ? { ...l, geoTargets: arr } : l)));
  }

  function toggleLanderDevice(idx: number, device: string) {
    setLanders((prev) => prev.map((l, i) => {
      if (i !== idx) return l;
      const cur = l.deviceTargets ?? [];
      const updated = cur.includes(device) ? cur.filter((d) => d !== device) : [...cur, device];
      return { ...l, deviceTargets: updated };
    }));
  }

  function setLanderOfferOverride(idx: number, val: string) {
    setLanders((prev) => prev.map((l, i) => (i === idx ? { ...l, offerUrlOverride: val } : l)));
  }

  const totalWeight = landers.reduce((s, l) => s + (l.weight || 0), 0);
  const weightOk = Math.abs(totalWeight - 100) <= 1;

  // ── Create campaign ───────────────────────────────────────────────────────

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!weightOk) {
      setError(`Traffic weights must sum to 100 (currently ${totalWeight}%).`);
      return;
    }
    for (const l of landers) {
      if (!l.landingPage) {
        setError('Please select a landing page for each lander.');
        return;
      }
    }
    const slugs = landers.map((l) => l.landingPage);
    if (new Set(slugs).size !== slugs.length) {
      setError('Each lander must use a different landing page.');
      return;
    }

    setCreating(true);
    const res = await fetch('/api/admin/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...formBase,
        adSpend: formBase.adSpend ? parseFloat(formBase.adSpend) : null,
        geoAllowList: JSON.stringify(
          formBase.geoAllowList.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
        ),
        optimizationMode: formBase.optimizationMode,
        autoPauseEnabled: formBase.autoPauseEnabled,
        autoPauseThreshold: formBase.autoPauseEnabled && formBase.autoPauseThreshold ? parseFloat(formBase.autoPauseThreshold) : null,
        autoPauseWindow: formBase.autoPauseEnabled ? parseInt(formBase.autoPauseWindow) || 24 : 24,
        landers,
      }),
    });
    const data = await res.json();
    setCreating(false);
    if (data.success) {
      const link = `${BASE_URL}/api/track?campaign=${formBase.slug}`;
      setGeneratedLink(link);
      setGeneratedShortCode(data.campaign?.shortCode ?? '');
      const campRes = await fetch('/api/admin/campaigns').then((r) => r.json());
      setCampaigns(campRes.campaigns || []);
      setFormBase({ name: '', slug: '', offerUrl: '', offerId: '', adSpend: '', geoAllowList: '', optimizationMode: 'STATIC', autoPauseEnabled: false, autoPauseThreshold: '', autoPauseWindow: '24' });
      setLanders([{ landingPage: '', weight: 100 }]);
    } else {
      setError(JSON.stringify(data.error));
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete campaign "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/admin/campaigns?id=${id}`, { method: 'DELETE' });
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  // ── Clone ─────────────────────────────────────────────────────────────────

  function openClone(camp: Campaign) {
    const newName = `${camp.name} (copy)`;
    setCloningId(camp.id);
    setCloneName(newName);
    setCloneSlug(slugify(newName));
  }

  async function handleClone(camp: Campaign) {
    setCloning(true);
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clone: true, sourceCampaignId: camp.id, newName: cloneName, newSlug: cloneSlug }),
      });
      const data = await res.json();
      if (data.success) {
        const campRes = await fetch('/api/admin/campaigns').then((r) => r.json());
        setCampaigns(campRes.campaigns || []);
        setCloningId(null);
        setCloneName('');
        setCloneSlug('');
      }
    } finally {
      setCloning(false);
    }
  }

  // ── Re-activate auto-paused campaign ─────────────────────────────────────

  async function handleReactivate(campaignId: string) {
    await fetch('/api/admin/campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reactivate: { campaignId } }),
    });
    const campRes = await fetch('/api/admin/campaigns').then((r) => r.json());
    setCampaigns(campRes.campaigns || []);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

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

  // ── Edit split ────────────────────────────────────────────────────────────

  function openEditSplit(camp: Campaign) {
    setEditWeights(camp.variants.map((v) => ({ id: v.id, slug: v.slug, weight: v.trafficWeight })));
    setEditingId(camp.id);
  }

  function setEditWeight(idx: number, val: number) {
    setEditWeights((prev) => prev.map((w, i) => (i === idx ? { ...w, weight: val } : w)));
  }

  function autoSplitEdit() {
    const n = editWeights.length;
    const equal = Math.floor(100 / n);
    const remainder = 100 - equal * n;
    setEditWeights((prev) => prev.map((w, i) => ({ ...w, weight: equal + (i === 0 ? remainder : 0) })));
  }

  const editTotal = editWeights.reduce((s, w) => s + (w.weight || 0), 0);
  const editOk = Math.abs(editTotal - 100) <= 1;

  async function handleEditSave(camp: Campaign) {
    if (!editOk) return;
    setEditSaving(true);
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variants: editWeights.map((w) => ({ id: w.id, trafficWeight: w.weight })) }),
      });
      const data = await res.json();
      if (data.success) {
        setCampaigns((prev) =>
          prev.map((c) =>
            c.id === camp.id
              ? { ...c, variants: c.variants.map((v, i) => ({ ...v, trafficWeight: editWeights[i]?.weight ?? v.trafficWeight })) }
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
          <div className="flex items-center gap-2 mt-1">
            <Link
              href="/admin/links"
              className="text-sm text-emerald-400 hover:text-emerald-300 border border-emerald-800 hover:border-emerald-600 px-3 py-1.5 rounded-lg transition-colors"
            >
              Links
            </Link>
            <Link
              href="/admin/analytics"
              className="text-sm text-blue-400 hover:text-blue-300 border border-blue-800 hover:border-blue-600 px-3 py-1.5 rounded-lg transition-colors"
            >
              Analytics
            </Link>
            <Link
              href="/admin/blocklist"
              className="text-sm text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600 px-3 py-1.5 rounded-lg transition-colors"
            >
              Blocklist
            </Link>
            {isOwner && (
              <Link
                href="/admin/users"
                className="text-sm text-yellow-400 hover:text-yellow-300 border border-yellow-800 hover:border-yellow-600 px-3 py-1.5 rounded-lg transition-colors"
              >
                Users
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              Log out
            </button>
          </div>
        </div>

        {/* Create Campaign Form — OWNER only */}
        {!isOwner && (
          <div className="bg-gray-900/50 rounded-xl p-4 mb-8 border border-gray-800 text-center text-gray-500 text-sm">
            You are logged in as <strong className="text-blue-400">ANALYST</strong>. Campaign creation and deletion are restricted to OWNER accounts.
          </div>
        )}
        {isOwner && <div className="bg-gray-900 rounded-xl p-6 mb-8 border border-gray-800">
          <h2 className="text-xl font-semibold mb-6 text-white">Create New Campaign</h2>
          <form onSubmit={handleCreate} className="space-y-5">

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Campaign Name</label>
                <input
                  type="text"
                  required
                  placeholder="Swiss Sports Q2"
                  value={formBase.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Slug (auto-generated)</label>
                <input
                  type="text"
                  required
                  value={formBase.slug}
                  onChange={(e) => setFormBase((f) => ({ ...f, slug: e.target.value }))}
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
                  value={formBase.offerUrl}
                  onChange={(e) => setFormBase((f) => ({ ...f, offerUrl: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Offer ID (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. 4452"
                  value={formBase.offerId}
                  onChange={(e) => setFormBase((f) => ({ ...f, offerId: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Ad Spend (optional, for ROI tracking)</label>
              <div className="relative w-48">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={formBase.adSpend}
                  onChange={(e) => setFormBase((f) => ({ ...f, adSpend: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-7 pr-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Geo allow list */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Allowed countries (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. CH, AT, DE — blank = all countries"
                value={formBase.geoAllowList}
                onChange={(e) => setFormBase((f) => ({ ...f, geoAllowList: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
              />
              <p className="text-xs text-gray-600 mt-1">ISO 3166-1 alpha-2 codes. Visitors from other countries are redirected to /geo-blocked.</p>
            </div>

            {/* Optimization Mode toggle */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">Optimization Mode</label>
              <div className="flex gap-3">
                {(['STATIC', 'BANDIT'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFormBase((f) => ({ ...f, optimizationMode: mode }))}
                    className={`text-sm px-4 py-2 rounded-lg border transition-colors ${
                      formBase.optimizationMode === mode
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {mode === 'STATIC' ? 'Static split' : 'Auto-optimize (MAB)'}
                  </button>
                ))}
              </div>
              {formBase.optimizationMode === 'BANDIT' && (
                <p className="text-xs text-gray-500 mt-1.5">
                  Thompson Sampling will auto-shift traffic to the winning variant over time.
                </p>
              )}
            </div>

            {/* Auto-pause section */}
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  className="relative cursor-pointer"
                  onClick={() => setFormBase((f) => ({ ...f, autoPauseEnabled: !f.autoPauseEnabled }))}
                >
                  <input type="checkbox" className="sr-only" readOnly checked={formBase.autoPauseEnabled} />
                  <div className={`w-10 h-5 rounded-full transition-colors ${formBase.autoPauseEnabled ? 'bg-amber-600' : 'bg-gray-700'}`} />
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${formBase.autoPauseEnabled ? 'translate-x-5' : ''}`} />
                </div>
                <span className="text-sm text-gray-300">Auto-pause if performance drops</span>
              </label>
              {formBase.autoPauseEnabled && (
                <div className="ml-0 grid grid-cols-2 gap-3 bg-amber-950/30 border border-amber-800/50 rounded-lg p-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Conv. rate threshold (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="e.g. 1.5"
                      value={formBase.autoPauseThreshold}
                      onChange={(e) => setFormBase((f) => ({ ...f, autoPauseThreshold: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Look-back window (hours)</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="24"
                      value={formBase.autoPauseWindow}
                      onChange={(e) => setFormBase((f) => ({ ...f, autoPauseWindow: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <p className="col-span-2 text-xs text-amber-400/70">
                    Pauses automatically when ≥50 clicks in the window and conv. rate &lt; threshold.
                  </p>
                </div>
              )}
            </div>

            {/* Landers section */}
            {landingPages.length === 0 ? (
              <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 text-yellow-300 text-sm">
                No landing pages found. Upload a folder to <code>public/landing-pages/your-page/</code> and redeploy.
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm text-gray-400">
                    Landing Page Rotation
                    <span className="ml-2 text-xs text-gray-600">(1–5 landers)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      weightOk ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
                    }`}>
                      {weightOk ? '✓ 100%' : `⚠ ${totalWeight}%`}
                    </span>
                    <button
                      type="button"
                      onClick={() => autoSplit()}
                      className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded transition-colors"
                    >
                      Auto-split
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {landers.map((lander, idx) => (
                    <div key={idx} className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-medium w-16 shrink-0 ${VARIANT_COLORS[idx]}`}>
                          {landers.length === 1 ? '100%' : `Lander ${idx + 1}`}
                        </span>
                        <select
                          value={lander.landingPage}
                          onChange={(e) => setLanderPage(idx, e.target.value)}
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 text-sm"
                        >
                          <option value="">Select landing page...</option>
                          {landingPages.map((lp) => (
                            <option key={lp} value={lp}>{lp}</option>
                          ))}
                        </select>
                        {landers.length > 1 && (
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number"
                              min={1}
                              max={99}
                              value={lander.weight}
                              onChange={(e) => setLanderWeight(idx, parseInt(e.target.value) || 0)}
                              className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-blue-500"
                            />
                            <span className="text-gray-500 text-sm">%</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleLanderTargeting(idx)}
                          className="text-xs text-purple-400 hover:text-purple-300 border border-purple-900 hover:border-purple-700 px-2 py-1 rounded shrink-0"
                          title="Geo/Device targeting"
                        >
                          {lander.showTargeting ? '▾ Targeting' : '▸ Targeting'}
                        </button>
                        {landers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLander(idx)}
                            className="text-red-500 hover:text-red-400 text-lg leading-none shrink-0 w-6 text-center"
                            title="Remove lander"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      {lander.showTargeting && (
                        <div className="ml-[76px] bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-3">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">
                              Countries (ISO codes, comma-separated — blank = all)
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. CH, AT, DE"
                              value={(lander.geoTargets ?? []).join(', ')}
                              onChange={(e) => setLanderGeo(idx, e.target.value)}
                              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">
                              Devices (blank = all)
                            </label>
                            <div className="flex gap-3">
                              {(['MOBILE', 'DESKTOP', 'TABLET'] as const).map((d) => (
                                <label key={d} className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={(lander.deviceTargets ?? []).includes(d)}
                                    onChange={() => toggleLanderDevice(idx, d)}
                                    className="accent-purple-500"
                                  />
                                  {d.charAt(0) + d.slice(1).toLowerCase()}
                                </label>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">
                              Offer URL override (optional — overrides campaign offer URL for this lander)
                            </label>
                            <input
                              type="text"
                              placeholder="https://offer.example.com/lp?click={clickid}"
                              value={lander.offerUrlOverride ?? ''}
                              onChange={(e) => setLanderOfferOverride(idx, e.target.value)}
                              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {landers.length < 5 && (
                  <button
                    type="button"
                    onClick={addLander}
                    className="mt-3 text-sm text-blue-400 hover:text-blue-300 border border-blue-900 hover:border-blue-700 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    + Add Lander
                  </button>
                )}
              </div>
            )}

            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={creating || landingPages.length === 0 || !weightOk}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {creating ? 'Creating...' : 'Create Campaign & Generate Link'}
            </button>
          </form>

          {/* Generated Link */}
          {generatedLink && (
            <div className="mt-6 bg-green-900/30 border border-green-700 rounded-xl p-5 space-y-3">
              <p className="text-green-400 font-semibold">Campaign created! Your tracking links:</p>
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
              {generatedShortCode && (
                <div className="flex items-center gap-3">
                  <code className="flex-1 bg-gray-950 rounded-lg px-4 py-3 text-emerald-300 text-sm break-all">
                    {BASE_URL}/go/{generatedShortCode}
                  </code>
                  <button
                    onClick={() => copyToClipboard(`${BASE_URL}/go/${generatedShortCode}`)}
                    className="bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-3 rounded-lg text-sm font-medium whitespace-nowrap"
                  >
                    Copy Short
                  </button>
                </div>
              )}
              <p className="text-gray-500 text-xs">
                Use the short URL in ads for a cleaner look. Both URLs track identically. Visit <Link href="/admin/links" className="text-emerald-400 hover:text-emerald-300">Links Hub</Link> for UTM builder &amp; postback URL.
              </p>
            </div>
          )}
        </div>}

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
                            {camp.variants?.length === 1 && (
                              <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full">
                                Single lander
                              </span>
                            )}
                            {camp.geoAllowList && (() => {
                              try {
                                const list: string[] = JSON.parse(camp.geoAllowList);
                                return list.length > 0 ? (
                                  <span className="text-xs bg-teal-900/40 text-teal-300 px-2 py-0.5 rounded-full">
                                    🌍 {list.join(', ')}
                                  </span>
                                ) : null;
                              } catch { return null; }
                            })()}
                            {camp.optimizationMode === 'BANDIT' && (
                              <span className="text-xs bg-purple-900/40 text-purple-300 px-2 py-0.5 rounded-full">
                                Auto MAB
                              </span>
                            )}
                            {camp.status === 'PAUSED' && camp.autoPausedAt && (
                              <span className="text-xs bg-amber-900/50 text-amber-300 px-2 py-0.5 rounded-full">
                                Auto-paused
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2 mb-3">
                            {camp.variants?.map((v, i) => (
                              <span key={v.id} className={`text-xs bg-gray-800 px-2 py-1 rounded ${VARIANT_COLORS[i] ?? 'text-gray-300'}`}>
                                {v.slug} ({v.trafficWeight}%)
                              </span>
                            ))}
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              <code className="text-xs text-blue-400 bg-gray-950 px-3 py-1.5 rounded truncate max-w-sm">
                                {trackingLink}
                              </code>
                              <button
                                onClick={() => copyToClipboard(trackingLink)}
                                className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded whitespace-nowrap"
                              >
                                Copy
                              </button>
                            </div>
                            {camp.shortCode && (
                              <div className="flex items-center gap-2">
                                <code className="text-xs text-emerald-400 bg-gray-950 px-3 py-1.5 rounded">
                                  {BASE_URL}/go/{camp.shortCode}
                                </code>
                                <button
                                  onClick={() => copyToClipboard(`${BASE_URL}/go/${camp.shortCode}`)}
                                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded whitespace-nowrap"
                                >
                                  Copy Short
                                </button>
                              </div>
                            )}
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
                          {isOwner && (
                            <button
                              onClick={() => cloningId === camp.id ? setCloningId(null) : openClone(camp)}
                              className={`text-xs px-3 py-1.5 rounded border transition-colors whitespace-nowrap ${
                                cloningId === camp.id
                                  ? 'bg-green-900/40 border-green-700 text-green-300'
                                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                              }`}
                            >
                              Clone
                            </button>
                          )}
                          {camp.status === 'PAUSED' && camp.autoPausedAt && isOwner && (
                            <button
                              onClick={() => handleReactivate(camp.id)}
                              className="text-amber-400 hover:text-amber-300 text-sm px-3 py-1 rounded border border-amber-800 hover:border-amber-600"
                            >
                              Re-activate
                            </button>
                          )}
                          {isOwner && (
                            <button
                              onClick={() => handleDelete(camp.id, camp.name)}
                              className="text-red-500 hover:text-red-400 text-sm px-3 py-1 rounded border border-red-900 hover:border-red-700"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Edit split panel */}
                    {editingId === camp.id && (
                      <div className="border-t border-gray-800 bg-gray-950 px-5 py-4">
                        <p className="text-xs text-gray-400 mb-3">
                          Adjust traffic split — changes take effect immediately for new visitors.
                        </p>
                        <div className="space-y-2 mb-3">
                          {editWeights.map((w, i) => (
                            <div key={w.id} className="flex items-center gap-3">
                              <span className={`text-xs font-medium w-32 truncate ${VARIANT_COLORS[i] ?? 'text-gray-300'}`}>
                                {w.slug}
                              </span>
                              <input
                                type="number"
                                min={editWeights.length === 1 ? 100 : 1}
                                max={editWeights.length === 1 ? 100 : 99}
                                value={w.weight}
                                onChange={(e) => setEditWeight(i, parseInt(e.target.value) || 0)}
                                disabled={editWeights.length === 1}
                                className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-center text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
                              />
                              <span className="text-gray-500 text-sm">%</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${editOk ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                            {editOk ? '✓ 100%' : `⚠ ${editTotal}%`}
                          </span>
                          {editWeights.length > 1 && (
                            <button
                              type="button"
                              onClick={autoSplitEdit}
                              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded transition-colors"
                            >
                              Auto-split
                            </button>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEditSave(camp)}
                            disabled={editSaving || !editOk}
                            className="text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded transition-colors"
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

                    {/* Clone panel */}
                    {cloningId === camp.id && (
                      <div className="border-t border-gray-800 bg-gray-950 px-5 py-4">
                        <p className="text-xs text-gray-400 mb-3">
                          Clone this campaign — copies all variants with fresh stats.
                        </p>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">New name</label>
                            <input
                              type="text"
                              value={cloneName}
                              onChange={(e) => { setCloneName(e.target.value); setCloneSlug(slugify(e.target.value)); }}
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Slug</label>
                            <input
                              type="text"
                              value={cloneSlug}
                              onChange={(e) => setCloneSlug(e.target.value)}
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleClone(camp)}
                            disabled={cloning || !cloneName || !cloneSlug}
                            className="text-xs bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded transition-colors"
                          >
                            {cloning ? 'Cloning...' : 'Clone campaign'}
                          </button>
                          <button
                            onClick={() => setCloningId(null)}
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
                          <Link
                            href={`/admin/analytics?campaign=${camp.id}`}
                            className="ml-auto text-xs text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            Full analytics →
                          </Link>
                        </div>

                        {isStatsLoading ? (
                          <div className="text-gray-500 text-sm py-4 text-center">Loading stats...</div>
                        ) : !campStats ? (
                          <div className="text-gray-600 text-sm py-4 text-center">No data yet.</div>
                        ) : (
                          <>
                            {/* Overview metric cards */}
                            <div className="grid grid-cols-3 gap-2 mb-5 sm:grid-cols-6">
                              {[
                                { label: 'Link Clicks', value: campStats.overview.totalClicks.toLocaleString(), sub: 'incl. bots' },
                                { label: 'Impressions', value: campStats.overview.impressions.toLocaleString(), sub: `${fmt(campStats.overview.landingRate)}% landed` },
                                { label: 'CTA Rate', value: `${fmt(campStats.overview.ctr)}%`, sub: 'of impressions' },
                                { label: 'Conversions', value: campStats.overview.conversions.toLocaleString(), sub: null },
                                { label: 'Conv Rate', value: `${fmt(campStats.overview.conversionRate)}%`, sub: null },
                                { label: 'Payout', value: `€${fmt(campStats.overview.totalPayout, 2)}`, sub: null },
                              ].map((m) => (
                                <div key={m.label} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                                  <div className="text-xs text-gray-500 mb-1">{m.label}</div>
                                  <div className="text-base font-semibold text-white">{m.value}</div>
                                  {m.sub && <div className="text-xs text-gray-600 mt-0.5">{m.sub}</div>}
                                </div>
                              ))}
                            </div>

                            {/* Variant comparison */}
                            {campStats.variants.length > 0 && (
                              <div className="mb-5">
                                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Variant Performance</h4>
                                <div className="space-y-3">
                                  {campStats.variants.map((v, vi) => {
                                    const isWinner = campStats.significance.winner === v.name;
                                    const isLeader = campStats.significance.leader === v.name;
                                    return (
                                      <div key={v.id} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="flex items-center gap-2">
                                            <span className={`text-sm font-medium ${VARIANT_COLORS[vi] ?? 'text-white'}`}>{v.name}</span>
                                            <span className="text-xs text-gray-500">({v.trafficWeight}% traffic)</span>
                                            {isWinner && campStats.significance.isSignificant && (
                                              <span className="text-xs bg-green-900 text-green-400 px-2 py-0.5 rounded-full">Winner</span>
                                            )}
                                            {isLeader && !campStats.significance.isSignificant && campStats.variants.length > 1 && (
                                              <span className="text-xs bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded-full">Leading</span>
                                            )}
                                          </div>
                                          <div className="flex gap-4 text-xs text-gray-400">
                                            <span>{v.impressions.toLocaleString()} impr</span>
                                            <span>CTR: {fmt(v.ctr)}%</span>
                                            <span>{v.conversions} conv ({fmt(v.conversionRate)}%)</span>
                                            <span>€{fmt(v.payout, 2)}</span>
                                          </div>
                                        </div>
                                        <Bar
                                          pct={Math.round(v.conversionRate)}
                                          color={isWinner ? 'bg-green-500' : isLeader ? 'bg-yellow-500' : 'bg-blue-500'}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Statistical significance */}
                                {campStats.variants.length > 1 && (
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
                                      ? `Trending: ${campStats.significance.leader ?? 'no leader yet'} — ${campStats.significance.confidence}% confidence (needs 95%)`
                                      : campStats.significance.confidence > 0
                                      ? `Not enough data — ${campStats.significance.confidence}% confidence so far (needs 95%)`
                                      : 'Not enough conversion data to compute significance'}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Vibe breakdown */}
                            {campStats.vibes?.length > 0 && (
                              <div className="mb-4">
                                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Ad Vibe Performance</h4>
                                <div className="space-y-2">
                                  {campStats.vibes.map((v) => (
                                    <div key={v.vibe} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                                      <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-sm text-purple-300 font-medium">{v.vibe}</span>
                                        <div className="flex gap-3 text-xs text-gray-400">
                                          <span>{v.impressions} impr</span>
                                          <span>CTR: {fmt(v.ctr)}%</span>
                                          <span>{v.conversions} conv ({fmt(v.conversionRate)}%)</span>
                                        </div>
                                      </div>
                                      <Bar pct={Math.round(v.conversionRate * 10)} color="bg-purple-500" />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Bot filter info */}
                            {(campStats.overview.botClicks ?? 0) > 0 && (
                              <div className="text-xs text-gray-600 mb-3">
                                {campStats.overview.botClicks} bot clicks filtered from stats
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
