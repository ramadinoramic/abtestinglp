import { NextRequest, NextResponse } from 'next/server';

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key, configured: !!(url && key) };
}

function supabaseHeaders(key: string) {
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

// ─── Statistical helpers ──────────────────────────────────────────────────────

// Abramowitz & Stegun approximation for standard normal CDF (~4 decimal places).
function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

// Gamma distribution sampler — Marsaglia & Tsang method.
function gammaSample(shape: number): number {
  if (shape < 1) {
    return gammaSample(1 + shape) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(alpha: number, beta: number): number {
  const x = gammaSample(alpha);
  const y = gammaSample(beta);
  return x / (x + y);
}

// Monte Carlo: P(challenger has higher true conversion rate than control).
// Uses Beta-Binomial model with Jeffrey's prior (alpha=0.5, beta=0.5).
function bayesianProbBetterThan(
  convControl: number, nControl: number,
  convChallenger: number, nChallenger: number,
  samples = 1500
): number {
  if (nControl === 0 || nChallenger === 0) return 0.5;
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const sControl = betaSample(convControl + 0.5, nControl - convControl + 0.5);
    const sChallenger = betaSample(convChallenger + 0.5, nChallenger - convChallenger + 0.5);
    if (sChallenger > sControl) wins++;
  }
  return wins / samples;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type RawClick = {
  id: string;
  variantId: string;
  country: string | null;
  device: string | null;
  language: string | null;
  ctaClicked: boolean;
  landed: boolean;
  converted: boolean;
  isBot: boolean;
  vibe: string | null;
  createdAt: string;
  conversion: { payoutAmount: string | null; playerValue: string | null; eventType: string } | null;
};

type RawVariant = {
  id: string;
  name: string;
  slug: string;
  trafficWeight: number;
  isControl: boolean;
};

type RawCampaign = {
  name: string;
  adSpend: number | null;
  status: string;
  autoPauseEnabled: boolean | null;
  autoPauseThreshold: number | null;
  autoPauseWindow: number | null;
  autoPausedAt: string | null;
};

// ─── GET /api/admin/stats?campaignId=xxx&days=30 ──────────────────────────────

export async function GET(request: NextRequest) {
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaignId');
  if (!campaignId) {
    return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
  }

  const days = parseInt(searchParams.get('days') ?? '30', 10);

  try {
    let dateFilter = '';
    if (days > 0) {
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      dateFilter = `&createdAt=gte.${from}`;
    }

    const [clicksRes, variantsRes, campaignRes] = await Promise.all([
      fetch(
        `${url}/rest/v1/Click?campaignId=eq.${campaignId}${dateFilter}` +
          `&select=id,variantId,country,device,language,ctaClicked,landed,converted,isBot,vibe,createdAt,` +
          `conversion:Conversion(payoutAmount,playerValue,eventType)`,
        { headers: supabaseHeaders(key!) }
      ),
      fetch(
        `${url}/rest/v1/Variant?campaignId=eq.${campaignId}&select=id,name,slug,trafficWeight,isControl`,
        { headers: supabaseHeaders(key!) }
      ),
      fetch(
        `${url}/rest/v1/Campaign?id=eq.${campaignId}&select=name,adSpend,status,autoPauseEnabled,autoPauseThreshold,autoPauseWindow,autoPausedAt`,
        { headers: supabaseHeaders(key!) }
      ),
    ]);

    const clicks: RawClick[] = clicksRes.ok ? await clicksRes.json() : [];
    const variants: RawVariant[] = variantsRes.ok ? await variantsRes.json() : [];
    const campaignData: RawCampaign[] = campaignRes.ok ? await campaignRes.json() : [];
    const campaign = campaignData[0] ?? null;
    const adSpend: number | null = campaign?.adSpend ?? null;
    const campaignName: string = campaign?.name ?? '';

    // ── Filter bots ───────────────────────────────────────────────────────────
    const realClicks = clicks.filter((c) => !c.isBot);
    const botClicks = clicks.length - realClicks.length;

    // ── Overview ──────────────────────────────────────────────────────────────
    const totalClicks = realClicks.length;
    const impressions = realClicks.filter((c) => c.landed).length;
    const ctaClicks = realClicks.filter((c) => c.ctaClicked).length;
    const conversions = realClicks.filter((c) => c.converted).length;
    const totalPayout = realClicks.reduce(
      (sum, c) => sum + parseFloat(c.conversion?.payoutAmount ?? '0'),
      0
    );
    const roi = adSpend && adSpend > 0 ? ((totalPayout - adSpend) / adSpend) * 100 : null;

    const overview = {
      totalClicks,
      impressions,
      landingRate: totalClicks > 0 ? (impressions / totalClicks) * 100 : 0,
      ctaClicks,
      ctr: (impressions > 0 ? impressions : totalClicks) > 0
        ? (ctaClicks / (impressions > 0 ? impressions : totalClicks)) * 100
        : 0,
      conversions,
      conversionRate: totalClicks > 0 ? (conversions / totalClicks) * 100 : 0,
      totalPayout,
      adSpend,
      roi,
      botClicks,
    };

    // ── Per-variant breakdown ─────────────────────────────────────────────────
    const variantStats = variants.map((v) => {
      const vc = realClicks.filter((c) => c.variantId === v.id);
      const vImpressions = vc.filter((c) => c.landed).length;
      const vCta = vc.filter((c) => c.ctaClicked).length;
      const vConv = vc.filter((c) => c.converted).length;
      const vPayout = vc.reduce(
        (sum, c) => sum + parseFloat(c.conversion?.payoutAmount ?? '0'),
        0
      );
      const vBase = vImpressions > 0 ? vImpressions : vc.length;
      return {
        id: v.id,
        name: v.name,
        slug: v.slug,
        trafficWeight: v.trafficWeight,
        isControl: v.isControl,
        clicks: vc.length,
        impressions: vImpressions,
        ctaClicks: vCta,
        ctr: vBase > 0 ? (vCta / vBase) * 100 : 0,
        conversions: vConv,
        conversionRate: vc.length > 0 ? (vConv / vc.length) * 100 : 0,
        payout: vPayout,
      };
    });

    // ── Country breakdown (top 5) ─────────────────────────────────────────────
    const countryMap: Record<string, number> = {};
    for (const c of realClicks) {
      const country = c.country || 'Unknown';
      countryMap[country] = (countryMap[country] ?? 0) + 1;
    }
    const countries = Object.entries(countryMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([country, count]) => ({
        country,
        clicks: count,
        pct: totalClicks > 0 ? Math.round((count / totalClicks) * 100) : 0,
      }));

    // ── Device breakdown ──────────────────────────────────────────────────────
    const deviceMap: Record<string, number> = {};
    for (const c of realClicks) {
      const device = c.device || 'Unknown';
      deviceMap[device] = (deviceMap[device] ?? 0) + 1;
    }
    const devices = Object.entries(deviceMap)
      .sort((a, b) => b[1] - a[1])
      .map(([device, count]) => ({
        device,
        clicks: count,
        pct: totalClicks > 0 ? Math.round((count / totalClicks) * 100) : 0,
      }));

    // ── Language breakdown (top 6) ────────────────────────────────────────────
    const languageMap: Record<string, number> = {};
    for (const c of realClicks) {
      if (c.language) languageMap[c.language] = (languageMap[c.language] ?? 0) + 1;
    }
    const languages = Object.entries(languageMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([language, count]) => ({
        language,
        clicks: count,
        pct: totalClicks > 0 ? Math.round((count / totalClicks) * 100) : 0,
      }));

    // ── Daily trend ───────────────────────────────────────────────────────────
    const dailyMap: Record<string, { clicks: number; conversions: number }> = {};
    for (const c of realClicks) {
      const date = c.createdAt.slice(0, 10);
      if (!dailyMap[date]) dailyMap[date] = { clicks: 0, conversions: 0 };
      dailyMap[date].clicks++;
      if (c.converted) dailyMap[date].conversions++;
    }
    const daily = Object.entries(dailyMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({ date, ...d }));

    // ── Vibe breakdown ────────────────────────────────────────────────────────
    const vibeMap: Record<string, { clicks: number; impressions: number; ctaClicks: number; conversions: number; payout: number }> = {};
    for (const c of realClicks) {
      const vk = c.vibe || '(no vibe)';
      if (!vibeMap[vk]) vibeMap[vk] = { clicks: 0, impressions: 0, ctaClicks: 0, conversions: 0, payout: 0 };
      vibeMap[vk].clicks++;
      if (c.landed) vibeMap[vk].impressions++;
      if (c.ctaClicked) vibeMap[vk].ctaClicks++;
      if (c.converted) vibeMap[vk].conversions++;
      vibeMap[vk].payout += parseFloat(c.conversion?.payoutAmount ?? '0');
    }
    const vibes = Object.entries(vibeMap)
      .filter(([k]) => k !== '(no vibe)')
      .map(([vibe, d]) => {
        const base = d.impressions > 0 ? d.impressions : d.clicks;
        return {
          vibe,
          clicks: d.clicks,
          impressions: d.impressions,
          ctaClicks: d.ctaClicks,
          ctr: base > 0 ? (d.ctaClicks / base) * 100 : 0,
          conversions: d.conversions,
          conversionRate: d.clicks > 0 ? (d.conversions / d.clicks) * 100 : 0,
          payout: d.payout,
        };
      })
      .sort((a, b) => b.conversions - a.conversions);

    // ── Statistical significance (z-test) + Bayesian ─────────────────────────
    let significance: {
      isSignificant: boolean;
      confidence: number;
      winner: string | null;
      leader: string | null;
      bayesian: { probChallengerWins: number; controlName: string; challengerName: string } | null;
    } = {
      isSignificant: false,
      confidence: 0,
      winner: null,
      leader: null,
      bayesian: null,
    };

    if (variantStats.length >= 2) {
      const sorted = [...variantStats].sort((a, b) => b.conversionRate - a.conversionRate);
      const best = sorted[0];
      const second = sorted[1];

      significance.leader = best.name;

      const nA = best.clicks, nB = second.clicks;
      const convA = best.conversions, convB = second.conversions;

      if (nA > 0 && nB > 0 && convA + convB > 0) {
        const p1 = convA / nA;
        const p2 = convB / nB;
        const pPool = (convA + convB) / (nA + nB);
        const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
        const z = se > 0 ? Math.abs(p1 - p2) / se : 0;
        const confidence = Math.round((2 * normalCDF(z) - 1) * 100);
        const isSignificant = confidence >= 95;
        significance.isSignificant = isSignificant;
        significance.confidence = confidence;
        significance.winner = isSignificant ? best.name : null;
      }

      // Bayesian: compare control vs best challenger
      const control = variantStats.find((v) => v.isControl) ?? sorted[sorted.length - 1];
      const challenger = sorted.find((v) => v.id !== control.id) ?? sorted[0];
      const probChallengerWins = bayesianProbBetterThan(
        control.conversions, control.clicks,
        challenger.conversions, challenger.clicks
      );
      significance.bayesian = {
        probChallengerWins: Math.round(probChallengerWins * 100),
        controlName: control.name,
        challengerName: challenger.name,
      };

      // Significance webhook (optional env var)
      const webhookUrl = process.env.SIGNIFICANCE_WEBHOOK_URL;
      if (webhookUrl && significance.isSignificant && significance.winner) {
        const isSlack = webhookUrl.includes('hooks.slack.com');
        const body = isSlack
          ? JSON.stringify({ text: `Test complete! Campaign *${campaignName}* — *${significance.winner}* wins with ${significance.confidence}% confidence.` })
          : JSON.stringify({ campaignId, campaignName, winner: significance.winner, confidence: significance.confidence });
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }).catch(() => {});
      }
    } else if (variantStats.length === 1) {
      significance.leader = variantStats[0].name;
    }

    // ── Auto-pause lazy evaluation ─────────────────────────────────────────────
    let autoPaused = false;
    if (
      campaign?.autoPauseEnabled &&
      campaign.status === 'ACTIVE' &&
      typeof campaign.autoPauseThreshold === 'number'
    ) {
      const windowHours = campaign.autoPauseWindow ?? 24;
      const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);
      const windowClicks = realClicks.filter((c) => new Date(c.createdAt) >= windowStart);
      const windowConversions = windowClicks.filter((c) => c.converted).length;
      const windowConvRate = windowClicks.length > 0
        ? (windowConversions / windowClicks.length) * 100
        : 0;

      // Only trigger if we have enough data (>=50 clicks) and the rate is below threshold
      // Also skip if autoPausedAt was set within last 60s (race condition guard)
      const recentlyPaused = campaign.autoPausedAt &&
        Date.now() - new Date(campaign.autoPausedAt).getTime() < 60_000;

      if (
        !recentlyPaused &&
        windowClicks.length >= 50 &&
        windowConvRate < campaign.autoPauseThreshold
      ) {
        autoPaused = true;
        // Non-blocking: update campaign status
        fetch(`${url}/rest/v1/Campaign?id=eq.${campaignId}`, {
          method: 'PATCH',
          headers: { ...supabaseHeaders(key!), Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'PAUSED', autoPausedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
        }).catch(() => {});
      }
    }

    return NextResponse.json({
      overview,
      variants: variantStats,
      countries,
      devices,
      languages,
      daily,
      vibes,
      significance,
      autoPaused,
    });
  } catch (error) {
    console.error('[stats GET]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
