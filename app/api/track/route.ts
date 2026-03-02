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
}

interface CampaignData {
  id: string;
  slug: string;
  name: string;
  offerUrl: string;
  offerId: string;
  geoGate: boolean;
  optimizationMode: string;  // 'STATIC' | 'BANDIT'
  startsAt: string | null;
  endsAt: string | null;
  variants: CampaignVariant[];
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
    const res = await fetch(
      `${supabaseUrl}/rest/v1/Campaign` +
        `?slug=eq.${slug}&status=eq.ACTIVE` +
        `&select=*,variants:Variant(*)`,
      {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      }
    );
    const data = await res.json();
    if (!data || data.length === 0) return getMockCampaign(slug);
    return data[0];
  } catch {
    return getMockCampaign(slug);
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

    if (!campaignSlug) {
      return NextResponse.json({ error: 'Missing campaign parameter' }, { status: 400 });
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

    // Fetch campaign
    const campaign = await getCampaign(campaignSlug);
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // ── Scheduling check ──────────────────────────────────────────────────────
    const now = new Date();
    if (campaign.startsAt && now < new Date(campaign.startsAt)) {
      return new NextResponse('Campaign not yet active', { status: 404 });
    }
    if (campaign.endsAt && now > new Date(campaign.endsAt)) {
      return new NextResponse('Campaign has ended', { status: 410 });
    }

    // ── Geo-gate ──────────────────────────────────────────────────────────────
    if (campaign.geoGate && !bot && country && country !== 'CH') {
      return NextResponse.redirect(new URL('/geo-blocked', request.url), {
        status: 302,
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      });
    }

    // ── Variant selection ─────────────────────────────────────────────────────
    let selectedVariant: CampaignVariant;
    if (forceVariant) {
      selectedVariant =
        campaign.variants.find((v) => v.slug === forceVariant) || campaign.variants[0];
    } else if (campaign.optimizationMode === 'BANDIT') {
      selectedVariant = selectVariantBandit(campaign.variants);
    } else {
      selectedVariant = selectVariant(campaign.variants);
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
    const resolvedOfferUrl = resolveTokens(campaign.offerUrl || '', {
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
    const isStaticPage =
      selectedVariant.theme &&
      (selectedVariant.theme as Record<string, string>).type === 'custom';

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
    return NextResponse.redirect(new URL('/lp', request.url), { status: 302 });
  }
}

// ─── Mock campaign (dev/fallback) ─────────────────────────────────────────────

function getMockCampaign(slug: string): CampaignData {
  return {
    id: 'camp_123',
    slug,
    name: 'Swiss Sports Q1 2024',
    offerUrl: 'https://www.gomedia1000.com/redirect.aspx?clickid={clickid}',
    offerId: '4452',
    geoGate: false,
    optimizationMode: 'STATIC',
    startsAt: null,
    endsAt: null,
    variants: [
      {
        id: 'var_a',
        slug: 'sports-athletes',
        name: 'Variant A - Sports Athletes',
        trafficWeight: 50,
        cumulativeClicks: 0,
        cumulativeConversions: 0,
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
        theme: { type: 'casino', primaryColor: '#ef4444', ctaColor: '#10b981' },
        content: { headline: 'Dein Glück wartet', subheadline: '₺10,000 Bonus' },
      },
    ],
  };
}
