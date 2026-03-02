'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface Campaign {
  id: string;
  name: string;
  slug: string;
  adSpend?: number | null;
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
  };
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
  languages: { language: string; clicks: number; pct: number }[];
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
  daily: { date: string; clicks: number; conversions: number }[];
  significance: {
    isSignificant: boolean;
    confidence: number;
    winner: string | null;
    leader: string | null;
    bayesian: { probChallengerWins: number; controlName: string; challengerName: string } | null;
  };
}

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

const VARIANT_COLORS = [
  { text: 'text-blue-400', bg: 'bg-blue-500', stroke: '#60a5fa' },
  { text: 'text-purple-400', bg: 'bg-purple-500', stroke: '#c084fc' },
  { text: 'text-teal-400', bg: 'bg-teal-500', stroke: '#2dd4bf' },
  { text: 'text-orange-400', bg: 'bg-orange-500', stroke: '#fb923c' },
  { text: 'text-pink-400', bg: 'bg-pink-500', stroke: '#f472b6' },
];

// ── SVG Trend Chart ────────────────────────────────────────────────────────────

function TrendChart({ daily }: { daily: { date: string; clicks: number; conversions: number }[] }) {
  const W = 800;
  const H = 160;
  const PAD = { top: 12, right: 16, bottom: 28, left: 44 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (daily.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-600 text-sm">
        No daily data available
      </div>
    );
  }

  const maxClicks = Math.max(...daily.map((d) => d.clicks), 1);
  const n = daily.length;

  function xPos(i: number) {
    return PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  }
  function yPos(val: number, max: number) {
    return PAD.top + innerH - (val / max) * innerH;
  }

  const clickPoints = daily.map((d, i) => `${xPos(i)},${yPos(d.clicks, maxClicks)}`).join(' ');
  const convPoints = daily.map((d, i) => `${xPos(i)},${yPos(d.conversions, maxClicks)}`).join(' ');

  // Y-axis labels
  const yLabels = [0, Math.round(maxClicks / 2), maxClicks];

  // X-axis labels: show first, last, and up to 4 evenly spaced
  const xLabelIndices: number[] = [];
  if (n <= 6) {
    for (let i = 0; i < n; i++) xLabelIndices.push(i);
  } else {
    xLabelIndices.push(0);
    const step = Math.floor((n - 1) / 4);
    for (let i = step; i < n - 1; i += step) xLabelIndices.push(i);
    xLabelIndices.push(n - 1);
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: 320 }}
        aria-label="Daily trend chart"
      >
        {/* Grid lines */}
        {yLabels.map((val) => {
          const y = yPos(val, maxClicks);
          return (
            <g key={val}>
              <line
                x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                stroke="#374151" strokeWidth={1} strokeDasharray="4 4"
              />
              <text
                x={PAD.left - 6} y={y + 4}
                textAnchor="end" fill="#6b7280" fontSize={10}
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {xLabelIndices.map((i) => (
          <text
            key={i}
            x={xPos(i)} y={H - 4}
            textAnchor="middle" fill="#6b7280" fontSize={9}
          >
            {daily[i].date.slice(5)} {/* MM-DD */}
          </text>
        ))}

        {/* Clicks area fill */}
        <polygon
          points={[
            `${xPos(0)},${PAD.top + innerH}`,
            ...daily.map((d, i) => `${xPos(i)},${yPos(d.clicks, maxClicks)}`),
            `${xPos(n - 1)},${PAD.top + innerH}`,
          ].join(' ')}
          fill="#60a5fa"
          fillOpacity={0.08}
        />

        {/* Clicks line */}
        <polyline
          points={clickPoints}
          fill="none"
          stroke="#60a5fa"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Conversions line */}
        <polyline
          points={convPoints}
          fill="none"
          stroke="#34d399"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dots for clicks */}
        {daily.map((d, i) => (
          <circle key={`c${i}`} cx={xPos(i)} cy={yPos(d.clicks, maxClicks)} r={3} fill="#60a5fa">
            <title>{daily[i].date}: {d.clicks} clicks</title>
          </circle>
        ))}

        {/* Dots for conversions */}
        {daily.map((d, i) => (
          <circle key={`cv${i}`} cx={xPos(i)} cy={yPos(d.conversions, maxClicks)} r={3} fill="#34d399">
            <title>{daily[i].date}: {d.conversions} conversions</title>
          </circle>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-5 mt-2 px-1">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-blue-400 rounded" />
          <span className="text-xs text-gray-400">Clicks</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-green-400 rounded" />
          <span className="text-xs text-gray-400">Conversions</span>
        </div>
      </div>
    </div>
  );
}

// ── Funnel Chart ───────────────────────────────────────────────────────────────

function FunnelChart({ overview }: { overview: StatsData['overview'] }) {
  const steps = [
    { label: 'Link Clicks', value: overview.totalClicks },
    { label: 'Impressions', value: overview.impressions },
    { label: 'CTA Clicks', value: overview.ctaClicks },
    { label: 'Conversions', value: overview.conversions },
  ];
  const max = steps[0].value || 1;

  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const pct = Math.round((step.value / max) * 100);
        const prevVal = i > 0 ? steps[i - 1].value : null;
        const continuedPct = prevVal && prevVal > 0 ? Math.round((step.value / prevVal) * 100) : null;
        return (
          <div key={step.label}>
            {i > 0 && continuedPct !== null && (
              <div className="flex items-center gap-2 my-1.5">
                <div className="flex-1 border-t border-dashed border-gray-700" />
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  continuedPct >= 50
                    ? 'text-green-400 bg-green-900/20 border-green-800'
                    : continuedPct >= 20
                    ? 'text-yellow-400 bg-yellow-900/20 border-yellow-800'
                    : 'text-red-400 bg-red-900/20 border-red-800'
                }`}>
                  {continuedPct}% continued ↓
                </span>
                <div className="flex-1 border-t border-dashed border-gray-700" />
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="text-xs text-gray-500 w-24 text-right shrink-0">{step.label}</div>
              <div className="flex-1 bg-gray-800 rounded h-6 overflow-hidden">
                <div
                  className="h-full bg-blue-600/50 border-r-2 border-blue-400/60 transition-all"
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-white w-20 text-right shrink-0">
                {step.value.toLocaleString()} <span className="text-gray-600 font-normal">({pct}%)</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component (inner, uses useSearchParams) ───────────────────────────────

function AnalyticsInner() {
  const searchParams = useSearchParams();
  const preselect = searchParams.get('campaign');

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    fetch('/api/admin/campaigns')
      .then((r) => r.json())
      .then((data) => {
        const camps: Campaign[] = data.campaigns || [];
        setCampaigns(camps);
        // Pre-select from query param or first campaign
        const initial = preselect && camps.find((c) => c.id === preselect)
          ? preselect
          : camps[0]?.id ?? '';
        setSelectedId(initial);
        setInitialLoad(false);
      });
  }, [preselect]);

  const loadStats = useCallback(async (campaignId: string, d: number) => {
    if (!campaignId) return;
    setLoading(true);
    setStats(null);
    try {
      const res = await fetch(`/api/admin/stats?campaignId=${campaignId}&days=${d}`);
      const data = await res.json();
      setStats(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialLoad && selectedId) {
      loadStats(selectedId, days);
    }
  }, [selectedId, days, initialLoad, loadStats]);

  const selectedCampaign = campaigns.find((c) => c.id === selectedId);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
                ← Campaigns
              </Link>
            </div>
            <h1 className="text-2xl font-bold text-white">Analytics</h1>
          </div>
          <div className="flex items-center gap-3 mt-1">
            {/* Campaign selector */}
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            >
              {campaigns.length === 0 && <option value="">No campaigns</option>}
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {/* Date range tabs */}
            <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800">
              {([7, 30, 0] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`text-xs px-3 py-1.5 rounded transition-colors ${
                    days === d ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {d === 0 ? 'All time' : `${d}d`}
                </button>
              ))}
            </div>

            {/* Export CSV */}
            {selectedId && (
              <a
                href={`/api/admin/export?campaignId=${selectedId}&days=${days}`}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 transition-colors whitespace-nowrap"
              >
                Export CSV
              </a>
            )}
          </div>
        </div>

        {/* No campaign selected */}
        {!selectedId && !initialLoad && (
          <div className="text-gray-500 text-center py-20">
            No campaigns yet. <Link href="/admin" className="text-blue-400 hover:text-blue-300">Create one →</Link>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-gray-500 text-center py-20">Loading...</div>
        )}

        {/* Stats */}
        {!loading && stats && selectedCampaign && (
          <div className="space-y-6">

            {/* Overview cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: 'Link Clicks', value: stats.overview.totalClicks.toLocaleString(), sub: 'tracking link hits' },
                { label: 'Impressions', value: stats.overview.impressions.toLocaleString(), sub: `${fmt(stats.overview.landingRate)}% landing rate` },
                { label: 'CTA Rate', value: `${fmt(stats.overview.ctr)}%`, sub: `${stats.overview.ctaClicks.toLocaleString()} CTA clicks` },
                { label: 'Conversions', value: stats.overview.conversions.toLocaleString(), sub: `${fmt(stats.overview.conversionRate)}% conv rate` },
              ].map((m) => (
                <div key={m.label} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <div className="text-xs text-gray-500 mb-1">{m.label}</div>
                  <div className="text-xl font-bold text-white">{m.value}</div>
                  {m.sub && <div className="text-xs text-gray-600 mt-0.5">{m.sub}</div>}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[
                { label: 'Revenue', value: `€${fmt(stats.overview.totalPayout, 2)}`, sub: stats.overview.adSpend ? `Spend: €${fmt(stats.overview.adSpend, 2)}` : 'No spend set', color: undefined },
                {
                  label: 'ROI',
                  value: stats.overview.roi != null ? `${fmt(stats.overview.roi, 1)}%` : '—',
                  sub: stats.overview.roi != null
                    ? stats.overview.roi >= 0 ? 'Profitable' : 'Loss'
                    : 'Set ad spend to track',
                  color: stats.overview.roi != null
                    ? stats.overview.roi >= 0 ? 'text-green-400' : 'text-red-400'
                    : 'text-gray-500',
                },
                { label: 'Conv Rate', value: `${fmt(stats.overview.conversionRate)}%`, sub: 'conversions / link clicks', color: undefined },
              ].map((m) => (
                <div key={m.label} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <div className="text-xs text-gray-500 mb-1">{m.label}</div>
                  <div className={`text-xl font-bold ${m.color ?? 'text-white'}`}>{m.value}</div>
                  {m.sub && <div className="text-xs text-gray-600 mt-0.5">{m.sub}</div>}
                </div>
              ))}
            </div>

            {/* Conversion Funnel */}
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Conversion Funnel</h3>
              <FunnelChart overview={stats.overview} />
            </div>

            {/* Daily trend chart */}
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Daily Trend</h3>
              <TrendChart daily={stats.daily} />
            </div>

            {/* Variant comparison table */}
            {stats.variants.length > 0 && (
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-300">Variant Comparison</h3>
                  {stats.variants.length === 1 && (
                    <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full">
                      Single lander — 100% traffic
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left text-xs text-gray-500 font-medium pb-2 pr-4">Metric</th>
                        {stats.variants.map((v, i) => {
                          const isWinner = stats.significance.winner === v.name;
                          const isLeader = stats.significance.leader === v.name;
                          return (
                            <th key={v.id} className="text-left text-xs pb-2 pr-4">
                              <div className="flex items-center gap-1.5">
                                <span className={VARIANT_COLORS[i]?.text ?? 'text-white'}>{v.slug}</span>
                                {isWinner && stats.significance.isSignificant && (
                                  <span className="text-xs bg-green-900 text-green-400 px-1.5 py-0.5 rounded-full">Winner</span>
                                )}
                                {isLeader && !stats.significance.isSignificant && stats.variants.length > 1 && (
                                  <span className="text-xs bg-yellow-900/50 text-yellow-400 px-1.5 py-0.5 rounded-full">Leading</span>
                                )}
                              </div>
                              <div className="text-gray-600 font-normal">{v.trafficWeight}% traffic</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {[
                        { label: 'Impressions', getValue: (v: StatsData['variants'][0]) => v.impressions.toLocaleString() },
                        { label: 'CTA Rate', getValue: (v: StatsData['variants'][0]) => `${fmt(v.ctr)}%` },
                        { label: 'Conversions', getValue: (v: StatsData['variants'][0]) => v.conversions.toLocaleString() },
                        { label: 'Conv Rate', getValue: (v: StatsData['variants'][0]) => `${fmt(v.conversionRate)}%` },
                        { label: 'Payout', getValue: (v: StatsData['variants'][0]) => `€${fmt(v.payout, 2)}` },
                      ].map((row) => (
                        <tr key={row.label}>
                          <td className="py-2.5 pr-4 text-xs text-gray-500">{row.label}</td>
                          {stats.variants.map((v, i) => (
                            <td key={v.id} className={`py-2.5 pr-4 text-sm ${VARIANT_COLORS[i]?.text ?? 'text-white'}`}>
                              {row.getValue(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Conv rate bars */}
                <div className="mt-4 space-y-2">
                  {stats.variants.map((v, i) => (
                    <div key={v.id}>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span className={VARIANT_COLORS[i]?.text ?? 'text-white'}>{v.slug}</span>
                        <span>Conv rate: {fmt(v.conversionRate)}%</span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${VARIANT_COLORS[i]?.bg ?? 'bg-blue-500'}`}
                          style={{ width: `${Math.min(v.conversionRate * 10, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Significance */}
                {stats.variants.length > 1 && (
                  <div className={`mt-4 text-xs px-3 py-2.5 rounded-lg ${
                    stats.significance.isSignificant
                      ? 'bg-green-900/30 border border-green-800 text-green-400'
                      : stats.significance.confidence >= 80
                      ? 'bg-yellow-900/30 border border-yellow-800 text-yellow-400'
                      : 'bg-gray-800/50 border border-gray-700 text-gray-500'
                  }`}>
                    {stats.significance.isSignificant
                      ? `Winner declared: ${stats.significance.winner} — ${stats.significance.confidence}% statistical confidence (≥95% threshold met)`
                      : stats.significance.confidence >= 80
                      ? `Trending: ${stats.significance.leader} is leading at ${stats.significance.confidence}% confidence. Need 95% to declare a winner.`
                      : stats.significance.confidence > 0
                      ? `Gathering data — ${stats.significance.confidence}% confidence so far. Need 95% to declare a winner.`
                      : 'Not enough conversion data to compute statistical significance yet.'}
                    {stats.significance.bayesian && (
                      <p className="mt-1 opacity-75">
                        Bayesian: <strong>{stats.significance.bayesian.challengerName}</strong> has{' '}
                        <strong>{Math.round(stats.significance.bayesian.probChallengerWins * 100)}%</strong>{' '}
                        probability of outperforming <strong>{stats.significance.bayesian.controlName}</strong>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Geo + Device */}
            <div className="grid grid-cols-2 gap-4">
              {stats.countries.length > 0 && (
                <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                  <h3 className="text-sm font-semibold text-gray-300 mb-4">Top Countries</h3>
                  <div className="space-y-3">
                    {stats.countries.map((c) => (
                      <div key={c.country}>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>{c.country}</span>
                          <span>{c.clicks.toLocaleString()} ({c.pct}%)</span>
                        </div>
                        <Bar pct={c.pct} color="bg-purple-500" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {stats.devices.length > 0 && (
                <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                  <h3 className="text-sm font-semibold text-gray-300 mb-4">Devices</h3>
                  <div className="space-y-3">
                    {stats.devices.map((d) => (
                      <div key={d.device}>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>{d.device}</span>
                          <span>{d.clicks.toLocaleString()} ({d.pct}%)</span>
                        </div>
                        <Bar pct={d.pct} color="bg-teal-500" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {stats.countries.length === 0 && stats.devices.length === 0 && (
                <div className="col-span-2 bg-gray-900 rounded-xl p-5 border border-gray-800 text-center text-gray-600 text-sm">
                  No geo or device data yet.
                </div>
              )}
            </div>

            {/* Language breakdown */}
            {stats.languages?.length > 0 && (
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Languages</h3>
                <div className="space-y-3">
                  {stats.languages.map((l) => (
                    <div key={l.language}>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>{l.language || 'Unknown'}</span>
                        <span>{l.clicks.toLocaleString()} ({l.pct}%)</span>
                      </div>
                      <Bar pct={l.pct} color="bg-orange-500" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Vibe breakdown */}
            {stats.vibes?.length > 0 && (
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Ad Vibe Performance</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left text-xs text-gray-500 font-medium pb-2 pr-4">Vibe</th>
                        <th className="text-left text-xs text-gray-500 font-medium pb-2 pr-4">Impressions</th>
                        <th className="text-left text-xs text-gray-500 font-medium pb-2 pr-4">CTA Rate</th>
                        <th className="text-left text-xs text-gray-500 font-medium pb-2 pr-4">Conversions</th>
                        <th className="text-left text-xs text-gray-500 font-medium pb-2 pr-4">Conv Rate</th>
                        <th className="text-left text-xs text-gray-500 font-medium pb-2">Payout</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {stats.vibes.map((v, i) => (
                        <tr key={v.vibe}>
                          <td className="py-2.5 pr-4">
                            <span className="text-purple-300 font-medium text-sm">{v.vibe}</span>
                            {i === 0 && <span className="ml-2 text-xs bg-purple-900/40 text-purple-400 px-1.5 py-0.5 rounded-full">Top</span>}
                          </td>
                          <td className="py-2.5 pr-4 text-sm text-gray-300">{v.impressions.toLocaleString()}</td>
                          <td className="py-2.5 pr-4 text-sm text-gray-300">{fmt(v.ctr)}%</td>
                          <td className="py-2.5 pr-4 text-sm text-gray-300">{v.conversions}</td>
                          <td className="py-2.5 pr-4 text-sm text-gray-300">{fmt(v.conversionRate)}%</td>
                          <td className="py-2.5 text-sm text-gray-300">€{fmt(v.payout, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-600 mt-3">Vibes are set via <code className="text-gray-500">?vibe=name</code> on your tracking link. Sorted by conversions.</p>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}

// ── Page wrapper with Suspense (required for useSearchParams) ──────────────────

export default function AnalyticsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Loading...
      </div>
    }>
      <AnalyticsInner />
    </Suspense>
  );
}
