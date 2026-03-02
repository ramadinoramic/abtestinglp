import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { resolveTokens } from '@/lib/tokens';

export const runtime = 'edge';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface CampaignVariant {
  id: string;
  slug: string;
  name: string;
  trafficWeight: number;
  theme: Record<string, string>;
  content: Record<string, string>;
  cumulativeClicks: number;
  cumulativeConversions: number;
  geoTargets?: string;       // JSON array e.g. '["CH","AT","DE"]' — empty/null = all
  deviceTargets?: string;    // JSON array e.g. '["MOBILE","DESKTOP"]' — empty/null = all
  offerUrlOverride?: string; // per-variant offer URL; overrides campaign.offerUrl
}

interface CampaignData {
  id: string;
  slug: string;
  name: string;
  status: string;            // 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
  offerUrl: string;
  offerId: string;
  geoAllowList: string;      // JSON array e.g. '["CH","AT","DE"]' — empty = all
  optimizationMode: string;  // 'STATIC' | 'BANDIT'
  variants: CampaignVariant[];
}

// ─── IP Blocklist cache (5-min TTL, per edge instance) ────────────────────────

let blockedIpsCache: Set<string> | null = null;
let blocklistCacheExpiry = 0;
const BLOCKLIST_TTL_MS = 5 * 60 * 1000;

async function getBlockedIps(): Promise<Set<string>> {
  const now = Date.now();
  if (blockedIpsCache && now < blocklistCacheExpiry) return blockedIpsCache;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return new Set();

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/BlockedIp?select=ip`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (!res.ok) return blockedIpsCache ?? new Set();
    const rows = await res.json();
    blockedIpsCache = new Set(Array.isArray(rows) ? rows.map((r: { ip: string }) => r.ip) : []);
    blocklistCacheExpiry = now + BLOCKLIST_TTL_MS;
    return blockedIpsCache;
  } catch {
    return blockedIpsCache ?? new Set();
  }
}

// ─── Rate Limiting (in-memory, per-instance) ──────────────────────────────────
// For distributed rate limiting at scale, replace with Upstash Redis.

const ipHits = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT = 30;   // max requests per window
const WINDOW_MS = 60_000; // 60 seconds

function isRateLimited(ip: string): boolean {
  // Clean up stale entries periodically
  if (ipHits.size > 10_000) {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [k, v] of ipHits) {
      if (v.windowStart < cutoff) ipHits.delete(k);
    }
  }

  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    ipHits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// ─── Bot Detection ────────────────────────────────────────────────────────────

const BOT_UA_PATTERNS = [
  /googlebot/i, /google-inspectiontool/i, /facebookexternalhit/i, /facebot/i,
  /bingbot/i, /twitterbot/i, /linkedinbot/i, /slackbot/i, /whatsapp/i,
  /ahrefsbot/i, /semrushbot/i, /mj12bot/i, /dotbot/i, /yandexbot/i,
  /baiduspider/i, /applebot/i, /petalbot/i, /headlesschrome/i, /phantomjs/i,
  /puppeteer/i, /selenium/i, /webdriver/i, /datadog/i, /pingdom/i,
  /uptimerobot/i, /python-requests/i, /go-http-client/i, /java\/\d/i,
  /curl\//i, /wget\//i,
];

function isKnownBot(userAgent: string): boolean {
  if (!userAgent || userAgent.trim() === '') return true;
  return BOT_UA_PATTERNS.some((p) => p.test(userAgent));
}

// ─── Thompson Sampling (Multi-Armed Bandit) ───────────────────────────────────

function gammaSample(shape: number): number {
  if (shape < 1) {
    return gammaSample(1 + shape) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      // Box-Muller normal sample
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

function selectVariantBandit(variants: CampaignVariant[]): CampaignVariant {
  // Thompson Sampling: each variant draws from Beta(conversions+1, clicks-conversions+1)
  let bestVariant = variants[0];
  let bestSample = -1;
  for (const v of variants) {
    const alpha = (v.cumulativeConversions ?? 0) + 1;
    const beta = Math.max((v.cumulativeClicks ?? 0) - (v.cumulativeConversions ?? 0) + 1, 1);
    const sample = betaSample(alpha, beta);
    if (sample > bestSample) {
      bestSample = sample;
      bestVariant = v;
    }
  }
  return bestVariant;
}

// ─── Weighted Random (static A/B split) ──────────────────────────────────────

function selectVariant(variants: CampaignVariant[]): CampaignVariant {
  const random = Math.random() * 100;
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.trafficWeight;
    if (random <= cumulative) return variant;
  }
  return variants[0];
}

// ─── Geo/Device targeting filter ─────────────────────────────────────────────

/**
 * Filter variants to only those matching the visitor's country + device.
 * Safety net: if ALL variants are filtered out, return the full original list
 * so the visitor always gets a destination.
 */
function filterVariantsByTargeting(
  variants: CampaignVariant[],
  country?: string,
  device?: string
): CampaignVariant[] {
  const filtered = variants.filter((v) => {
    // Parse geoTargets
    let geoList: string[] = [];
    try { geoList = v.geoTargets ? JSON.parse(v.geoTargets) : []; } catch { geoList = []; }
    if (geoList.length > 0 && country && !geoList.includes(country.toUpperCase())) return false;

    // Parse deviceTargets
    let deviceList: string[] = [];
    try { deviceList = v.deviceTargets ? JSON.parse(v.deviceTargets) : []; } catch { deviceList = []; }
    if (deviceList.length > 0 && device && !deviceList.includes(device.toUpperCase())) return false;

    return true;
  });

  return filtered.length > 0 ? filtered : variants; // safety net
}

// ─── Device / OS / Browser detection ─────────────────────────────────────────

function detectDevice(ua: string): 'MOBILE' | 'DESKTOP' | 'TABLET' {
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'TABLET';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|windows phone/i.test(ua)) return 'MOBILE';
  return 'DESKTOP';
}

function detectOS(ua: string): string {
  const u = ua.toLowerCase();
  if (u.includes('windows')) return 'Windows';
  if (u.includes('mac os')) return 'macOS';
  if (u.includes('iphone') || u.includes('ipad')) return 'iOS';
  if (u.includes('android')) return 'Android';
  if (u.includes('linux')) return 'Linux';
  return 'Unknown';
}

function detectBrowser(ua: string): string {
  const u = ua.toLowerCase();
  if (u.includes('chrome') && !u.includes('edg')) return 'Chrome';
  if (u.includes('safari') && !u.includes('chrome')) return 'Safari';
  if (u.includes('firefox')) return 'Firefox';
  if (u.includes('edg')) return 'Edge';
  if (u.includes('opera') || u.includes('opr')) return 'Opera';
  return 'Unknown';
}

function detectLanguage(acceptLanguage: string): string {
  // Extract primary language tag: "en-US,en;q=0.9" → "en"
  const primary = acceptLanguage.split(',')[0]?.split(';')[0]?.trim();
  return primary?.slice(0, 5) || 'Unknown';
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function getCampaign(slug: string): Promise<CampaignData | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return getMockCampaign(slug);

  try {
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

    // Fetch campaign by slug only — check status in code to avoid enum/case issues with PostgREST
    const campRes = await fetch(
      `${supabaseUrl}/rest/v1/Campaign?slug=eq.${encodeURIComponent(slug)}&select=*`,
      { headers }
    );
    const campData = await campRes.json();
    if (!Array.isArray(campData) || campData.length === 0) return null;
    const campaign = campData[0];
    // Only serve ACTIVE campaigns (case-insensitive to handle any DB enum/text variations)
    if (campaign.status && String(campaign.status).toUpperCase() !== 'ACTIVE') return null;

    // Fetch variants separately by campaignId (no ordering — avoids issues with column existence)
    const varRes = await fetch(
      `${supabaseUrl}/rest/v1/Variant?campaignId=eq.${campaign.id}&select=*`,
      { headers }
    );
    const varData = await varRes.json();
    const variants = Array.isArray(varData) ? varData : [];

    return { ...campaign, variants };
  } catch {
    return null;
  }
}

async function logClick(payload: Record<string, unknown>): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  await fetch(`${supabaseUrl}/rest/v1/Click`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
}

async function incrementVariantClicks(variantId: string, campaignId: string): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  // Use Supabase RPC or raw SQL increment — Supabase REST doesn't support atomic increments
  // directly, so we use a workaround: fetch current value and PATCH with +1.
  // For high-traffic, upgrade to a Postgres function via RPC.
  const res = await fetch(
    `${supabaseUrl}/rest/v1/Variant?id=eq.${variantId}&campaignId=eq.${campaignId}&select=cumulativeClicks`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return;
  const current = rows[0].cumulativeClicks ?? 0;

  await fetch(`${supabaseUrl}/rest/v1/Variant?id=eq.${variantId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ cumulativeClicks: current + 1 }),
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const campaignSlug = searchParams.get('campaign');
    const forceVariant = searchParams.get('variant');
    const debugMode = searchParams.get('debug') === '1';

    if (!campaignSlug) {
      return NextResponse.json({ error: 'Missing campaign parameter' }, { status: 400 });
    }

    // Debug mode: return raw Supabase query results (no redirect, no click logged)
    if (debugMode) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabaseConfigured = !!(supabaseUrl && supabaseKey);

      if (!supabaseConfigured) {
        return NextResponse.json({ queriedSlug: campaignSlug, supabaseConfigured: false });
      }

      const dbHeaders = { apikey: supabaseKey!, Authorization: `Bearer ${supabaseKey!}` };

      // Step 1: fetch campaign
      const campRes = await fetch(
        `${supabaseUrl}/rest/v1/Campaign?slug=eq.${encodeURIComponent(campaignSlug)}&select=*`,
        { headers: dbHeaders }
      );
      const campData = await campRes.json();
      const campaign = Array.isArray(campData) && campData.length > 0 ? campData[0] : null;

      // Step 2: fetch variants if campaign found
      let varQueryStatus: number | null = null;
      let varData: unknown = null;
      if (campaign) {
        const varRes = await fetch(
          `${supabaseUrl}/rest/v1/Variant?campaignId=eq.${campaign.id}&select=id,slug,campaignId,trafficWeight`,
          { headers: dbHeaders }
        );
        varQueryStatus = varRes.status;
        varData = await varRes.json();
      }

      const variants = Array.isArray(varData) ? varData : [];
      const selectedVariant = (variants as CampaignVariant[])[0];
      const themeObj = selectedVariant?.theme
        ? (typeof selectedVariant.theme === 'string' ? JSON.parse(selectedVariant.theme as string) : selectedVariant.theme) as Record<string, string>
        : null;

      return NextResponse.json({
        queriedSlug: campaignSlug,
        supabaseConfigured,
        campaignQueryStatus: campRes.status,
        campaignFound: !!campaign,
        campaignId: campaign?.id,
        campaignSlug: campaign?.slug,
        campaignStatus: campaign?.status,
        variantQueryStatus,
        variantRawResponse: varData,   // show exactly what Supabase returned
        variantsCount: variants.length,
        isStaticPage: themeObj?.type === 'custom',
        wouldRedirectTo: campaign && selectedVariant
          ? (themeObj?.type === 'custom'
            ? `/landing-pages/${selectedVariant.slug}/index.html`
            : `/lp?v=${selectedVariant.slug}`)
          : null,
      });
    }

    // Collect request context
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const userAgent = request.headers.get('user-agent') || '';
    const referrer = request.headers.get('referer') || '';
    const country = request.headers.get('cf-ipcountry') || undefined;
    const acceptLanguage = request.headers.get('accept-language') || '';

    const device = detectDevice(userAgent);
    const os = detectOS(userAgent);
    const browser = detectBrowser(userAgent);
    const language = acceptLanguage ? detectLanguage(acceptLanguage) : undefined;
    const bot = isKnownBot(userAgent);

    // Rate limit real traffic only (bots are logged but not rate-limited — they're already marked)
    if (!bot && isRateLimited(ipAddress)) {
      return new NextResponse('Too Many Requests', { status: 429 });
    }

    // IP blocklist check (fail-open: if DB unreachable, allow the request)
    if (!bot && ipAddress !== 'unknown') {
      const blocked = await getBlockedIps();
      if (blocked.has(ipAddress)) {
        return new NextResponse(null, { status: 403 });
      }
    }

    // Fetch campaign
    const campaign = await getCampaign(campaignSlug);
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // ── Geo allow list ────────────────────────────────────────────────────────
    if (!bot && country) {
      let allowList: string[] = [];
      try { allowList = campaign.geoAllowList ? JSON.parse(campaign.geoAllowList) : []; } catch { allowList = []; }
      if (allowList.length > 0 && !allowList.includes(country.toUpperCase())) {
        return NextResponse.redirect(new URL('/geo-blocked', request.url), {
          status: 302,
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
        });
      }
    }

    // ── Variant selection (with geo/device targeting filter) ──────────────────
    if (!campaign.variants || campaign.variants.length === 0) {
      return NextResponse.json({ error: 'Campaign has no variants' }, { status: 404 });
    }

    const eligibleVariants = forceVariant
      ? campaign.variants
      : filterVariantsByTargeting(campaign.variants, country, device);

    let selectedVariant: CampaignVariant | undefined;
    if (forceVariant) {
      selectedVariant =
        campaign.variants.find((v) => v.slug === forceVariant) || campaign.variants[0];
    } else if (campaign.optimizationMode === 'BANDIT') {
      selectedVariant = selectVariantBandit(eligibleVariants);
    } else {
      selectedVariant = selectVariant(eligibleVariants);
    }

    if (!selectedVariant) {
      return NextResponse.json({ error: 'No eligible variant for this request' }, { status: 404 });
    }

    // ── Click ID + params ─────────────────────────────────────────────────────
    const clickId = nanoid(16);

    const utmSource = searchParams.get('utm_source') || undefined;
    const utmMedium = searchParams.get('utm_medium') || undefined;
    const utmCampaign = searchParams.get('utm_campaign') || undefined;
    const utmContent = searchParams.get('utm_content') || undefined;
    const utmTerm = searchParams.get('utm_term') || undefined;
    const vibe = searchParams.get('vibe') || undefined;
    const cost = searchParams.get('cost') || undefined;
    const externalId =
      searchParams.get('externalid') || searchParams.get('extid') || undefined;

    // Capture remaining custom params (exclude all reserved keys)
    const RESERVED = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'campaign', 'variant', 'vibe', 'cost', 'externalid', 'extid',
    ]);
    const customParams: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (!RESERVED.has(key)) customParams[key] = value;
    });

    // ── Token resolution ──────────────────────────────────────────────────────
    // Per-variant offerUrlOverride takes precedence over campaign-level offerUrl
    const offerUrlTemplate = selectedVariant.offerUrlOverride || campaign.offerUrl || '';
    const resolvedOfferUrl = resolveTokens(offerUrlTemplate, {
      clickId,
      country,
      device,
      browser,
      os,
      ip: ipAddress,
      referrer: referrer || undefined,
      language,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      vibe,
      cost,
      externalId,
      customParams,
    });

    // ── Async: log click ──────────────────────────────────────────────────────
    logClick({
      id: clickId,
      campaignId: campaign.id,
      variantId: selectedVariant.id,
      ipAddress,
      userAgent,
      country,
      device,
      os,
      browser,
      language,
      referrer: referrer || undefined,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      vibe,
      cost,
      externalId,
      isBot: bot,
      customParams: Object.keys(customParams).length > 0 ? customParams : undefined,
      createdAt: new Date().toISOString(),
    }).catch((err) => console.error('Failed to log click:', err));

    // ── Async: increment variant clicks for MAB ───────────────────────────────
    if (campaign.optimizationMode === 'BANDIT' && !bot) {
      incrementVariantClicks(selectedVariant.id, campaign.id).catch(() => {});
    }

    // ── Build lander redirect URL ─────────────────────────────────────────────
    // theme can be a JSON object (jsonb column) or a JSON string (text column) — handle both
    const themeObj: Record<string, string> =
      typeof selectedVariant.theme === 'string'
        ? JSON.parse(selectedVariant.theme as string)
        : (selectedVariant.theme as Record<string, string>);
    const isStaticPage = themeObj?.type === 'custom';

    let landingPageUrl: URL;
    if (isStaticPage) {
      landingPageUrl = new URL(
        `/landing-pages/${selectedVariant.slug}/index.html`,
        request.url
      );
      // Pass resolved offer URL so static lander can use /api/click?cid= or ?offer=
      if (resolvedOfferUrl) {
        landingPageUrl.searchParams.set('offer', resolvedOfferUrl);
      }
    } else {
      landingPageUrl = new URL('/lp', request.url);
      landingPageUrl.searchParams.set('v', selectedVariant.slug);
      if (resolvedOfferUrl) {
        landingPageUrl.searchParams.set('offer', resolvedOfferUrl);
      }
    }
    landingPageUrl.searchParams.set('c', clickId);

    const processingTime = Date.now() - startTime;

    return NextResponse.redirect(landingPageUrl, {
      status: 302,
      headers: {
        'X-Processing-Time': `${processingTime}ms`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Click tracking error:', error);
    return NextResponse.json({ error: 'Internal tracking error' }, { status: 500 });
  }
}

// ─── Mock campaign (dev/fallback) ─────────────────────────────────────────────

function getMockCampaign(slug: string): CampaignData {
  return {
    id: 'camp_123',
    slug,
    name: 'Swiss Sports Q1 2024',
    status: 'ACTIVE',
    offerUrl: 'https://www.gomedia1000.com/redirect.aspx?clickid={clickid}',
    offerId: '4452',
    geoAllowList: '[]',
    optimizationMode: 'STATIC',
    variants: [
      {
        id: 'var_a',
        slug: 'sports-athletes',
        name: 'Variant A - Sports Athletes',
        trafficWeight: 50,
        cumulativeClicks: 0,
        cumulativeConversions: 0,
        geoTargets: '[]',
        deviceTargets: '[]',
        theme: { type: 'sports', primaryColor: '#3b82f6', ctaColor: '#84cc16' },
        content: { headline: 'Hier wettet die Schweiz', subheadline: '200% bis zu 400 CHF' },
      },
      {
        id: 'var_b',
        slug: 'casino-excitement',
        name: 'Variant B - Casino Excitement',
        trafficWeight: 50,
        cumulativeClicks: 0,
        cumulativeConversions: 0,
        geoTargets: '[]',
        deviceTargets: '[]',
        theme: { type: 'casino', primaryColor: '#ef4444', ctaColor: '#10b981' },
        content: { headline: 'Dein Glück wartet', subheadline: '₺10,000 Bonus' },
      },
    ],
  };
}
