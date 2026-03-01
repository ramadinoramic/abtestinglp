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

// Abramowitz & Stegun approximation for standard normal CDF (accurate to ~4 decimal places).
// Used for z-test statistical significance without any npm dependency.
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

type RawClick = {
  id: string;
  variantId: string;
  country: string | null;
  device: string | null;
  ctaClicked: boolean;
  converted: boolean;
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

// GET /api/admin/stats?campaignId=xxx&days=30
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
    // Build date filter
    let dateFilter = '';
    if (days > 0) {
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      dateFilter = `&createdAt=gte.${from}`;
    }

    // Fetch clicks and variants in parallel
    const [clicksRes, variantsRes] = await Promise.all([
      fetch(
        `${url}/rest/v1/Click?campaignId=eq.${campaignId}${dateFilter}&select=id,variantId,country,device,ctaClicked,converted,createdAt,conversion:Conversion(payoutAmount,playerValue,eventType)`,
        { headers: supabaseHeaders(key!) }
      ),
      fetch(
        `${url}/rest/v1/Variant?campaignId=eq.${campaignId}&select=id,name,slug,trafficWeight,isControl`,
        { headers: supabaseHeaders(key!) }
      ),
    ]);

    const clicks: RawClick[] = clicksRes.ok ? await clicksRes.json() : [];
    const variants: RawVariant[] = variantsRes.ok ? await variantsRes.json() : [];

    // ── Overview ──────────────────────────────────────────────────────────────
    const totalClicks = clicks.length;
    const ctaClicks = clicks.filter((c) => c.ctaClicked).length;
    const conversions = clicks.filter((c) => c.converted).length;
    const totalPayout = clicks.reduce(
      (sum, c) => sum + parseFloat(c.conversion?.payoutAmount ?? '0'),
      0
    );

    const overview = {
      totalClicks,
      ctaClicks,
      ctr: totalClicks > 0 ? (ctaClicks / totalClicks) * 100 : 0,
      conversions,
      conversionRate: totalClicks > 0 ? (conversions / totalClicks) * 100 : 0,
      totalPayout,
    };

    // ── Per-variant breakdown ─────────────────────────────────────────────────
    const variantStats = variants.map((v) => {
      const vc = clicks.filter((c) => c.variantId === v.id);
      const vCta = vc.filter((c) => c.ctaClicked).length;
      const vConv = vc.filter((c) => c.converted).length;
      const vPayout = vc.reduce(
        (sum, c) => sum + parseFloat(c.conversion?.payoutAmount ?? '0'),
        0
      );
      return {
        id: v.id,
        name: v.name,
        slug: v.slug,
        trafficWeight: v.trafficWeight,
        isControl: v.isControl,
        clicks: vc.length,
        ctaClicks: vCta,
        ctr: vc.length > 0 ? (vCta / vc.length) * 100 : 0,
        conversions: vConv,
        conversionRate: vc.length > 0 ? (vConv / vc.length) * 100 : 0,
        payout: vPayout,
      };
    });

    // ── Country breakdown (top 5) ─────────────────────────────────────────────
    const countryMap: Record<string, number> = {};
    for (const c of clicks) {
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
    for (const c of clicks) {
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

    // ── Daily trend ───────────────────────────────────────────────────────────
    const dailyMap: Record<string, { clicks: number; conversions: number }> = {};
    for (const c of clicks) {
      const date = c.createdAt.slice(0, 10); // YYYY-MM-DD
      if (!dailyMap[date]) dailyMap[date] = { clicks: 0, conversions: 0 };
      dailyMap[date].clicks++;
      if (c.converted) dailyMap[date].conversions++;
    }
    const daily = Object.entries(dailyMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({ date, ...d }));

    // ── Statistical significance (z-test for two proportions) ─────────────────
    // Only computed when there are exactly 2 variants with enough data.
    let significance: { isSignificant: boolean; confidence: number; winner: string | null } = {
      isSignificant: false,
      confidence: 0,
      winner: null,
    };

    if (variantStats.length >= 2) {
      const [a, b] = variantStats;
      const nA = a.clicks, nB = b.clicks;
      const convA = a.conversions, convB = b.conversions;

      if (nA > 0 && nB > 0 && convA + convB > 0) {
        const p1 = convA / nA;
        const p2 = convB / nB;
        const pPool = (convA + convB) / (nA + nB);
        const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
        const z = se > 0 ? Math.abs(p1 - p2) / se : 0;
        const confidence = Math.round((2 * normalCDF(z) - 1) * 100);
        const isSignificant = confidence >= 95;
        const winner = isSignificant ? (p1 >= p2 ? a.name : b.name) : null;
        significance = { isSignificant, confidence, winner };
      }
    }

    return NextResponse.json({ overview, variants: variantStats, countries, devices, daily, significance });
  } catch (error) {
    console.error('[stats GET]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
