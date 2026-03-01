import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

export const runtime = 'edge';

interface CampaignVariant {
  id: string;
  slug: string;
  name: string;
  trafficWeight: number;
  theme: Record<string, string>;
  content: Record<string, string>;
}

interface CampaignData {
  id: string;
  slug: string;
  name: string;
  offerUrl: string;
  offerId: string;
  variants: CampaignVariant[];
}

interface ClickData {
  clickId: string;
  campaignId: string;
  variantId: string;
  variantSlug: string;
  ipAddress: string;
  userAgent: string;
  country?: string;
  device?: 'MOBILE' | 'DESKTOP' | 'TABLET';
  os?: string;
  browser?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  customParams?: Record<string, string>;
  timestamp: string;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const campaignSlug = searchParams.get('campaign');
    const forceVariant = searchParams.get('variant');

    if (!campaignSlug) {
      return NextResponse.json({ error: 'Missing campaign parameter' }, { status: 400 });
    }

    // Get user context
    const ipAddress =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const userAgent = request.headers.get('user-agent') || '';
    const referrer = request.headers.get('referer') || '';
    const country = request.headers.get('cf-ipcountry') || undefined;

    const device = detectDevice(userAgent);
    const os = detectOS(userAgent);
    const browser = detectBrowser(userAgent);

    // Fetch campaign
    const campaign = await getCampaign(campaignSlug);

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Select variant
    let selectedVariant;
    if (forceVariant) {
      selectedVariant =
        campaign.variants.find((v) => v.slug === forceVariant) || campaign.variants[0];
    } else {
      selectedVariant = selectVariant(campaign.variants);
    }

    // Generate click ID
    const clickId = nanoid(16);

    // Extract UTM parameters
    const utmSource = searchParams.get('utm_source') || undefined;
    const utmMedium = searchParams.get('utm_medium') || undefined;
    const utmCampaign = searchParams.get('utm_campaign') || undefined;
    const utmContent = searchParams.get('utm_content') || undefined;
    const utmTerm = searchParams.get('utm_term') || undefined;

    const customParams: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (!key.startsWith('utm_') && key !== 'campaign' && key !== 'variant') {
        customParams[key] = value;
      }
    });

    const clickData: ClickData = {
      clickId,
      campaignId: campaign.id,
      variantId: selectedVariant.id,
      variantSlug: selectedVariant.slug,
      ipAddress,
      userAgent,
      country,
      device,
      os,
      browser,
      referrer: referrer || undefined,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      customParams: Object.keys(customParams).length > 0 ? customParams : undefined,
      timestamp: new Date().toISOString(),
    };

    // Log click async, non-blocking
    logClickToDatabase(clickData).catch((err) => {
      console.error('Failed to log click:', err);
    });

    // Build landing page URL
    // If variant slug matches a static HTML landing page, serve it from /landing-pages/
    // Otherwise fall back to the built-in /lp route
    const isStaticPage =
      selectedVariant.theme &&
      (selectedVariant.theme as Record<string, string>).type === 'custom';

    let landingPageUrl: URL;
    if (isStaticPage) {
      landingPageUrl = new URL(
        `/landing-pages/${selectedVariant.slug}/index.html`,
        request.url
      );
    } else {
      landingPageUrl = new URL('/lp', request.url);
      landingPageUrl.searchParams.set('v', selectedVariant.slug);
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
    const fallbackUrl = new URL('/lp', request.url);
    return NextResponse.redirect(fallbackUrl, { status: 302 });
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function detectDevice(userAgent: string): 'MOBILE' | 'DESKTOP' | 'TABLET' {
  const ua = userAgent.toLowerCase();
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'TABLET';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|windows phone/i.test(ua)) return 'MOBILE';
  return 'DESKTOP';
}

function detectOS(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('mac os')) return 'macOS';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'iOS';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('linux')) return 'Linux';
  return 'Unknown';
}

function detectBrowser(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('chrome') && !ua.includes('edg')) return 'Chrome';
  if (ua.includes('safari') && !ua.includes('chrome')) return 'Safari';
  if (ua.includes('firefox')) return 'Firefox';
  if (ua.includes('edg')) return 'Edge';
  if (ua.includes('opera') || ua.includes('opr')) return 'Opera';
  return 'Unknown';
}

function selectVariant(variants: CampaignVariant[]): CampaignVariant {
  const random = Math.random() * 100;
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.trafficWeight;
    if (random <= cumulative) return variant;
  }
  return variants[0];
}

async function getCampaign(slug: string): Promise<CampaignData | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Return mock data when Supabase is not configured (development)
    return getMockCampaign(slug);
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/Campaign?slug=eq.${slug}&select=*,variants:Variant(*)&status=eq.ACTIVE`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    const data = await response.json();
    if (!data || data.length === 0) return getMockCampaign(slug);
    return data[0];
  } catch {
    return getMockCampaign(slug);
  }
}

function getMockCampaign(slug: string): CampaignData {
  return {
    id: 'camp_123',
    slug,
    name: 'Swiss Sports Q1 2024',
    offerUrl: 'https://www.gomedia1000.com/redirect.aspx',
    offerId: '4452',
    variants: [
      {
        id: 'var_a',
        slug: 'sports-athletes',
        name: 'Variant A - Sports Athletes',
        trafficWeight: 50,
        theme: { type: 'sports', primaryColor: '#3b82f6', ctaColor: '#84cc16' },
        content: { headline: 'Hier wettet die Schweiz', subheadline: '200% bis zu 400 CHF' },
      },
      {
        id: 'var_b',
        slug: 'casino-excitement',
        name: 'Variant B - Casino Excitement',
        trafficWeight: 50,
        theme: { type: 'casino', primaryColor: '#ef4444', ctaColor: '#10b981' },
        content: { headline: 'Dein Glück wartet', subheadline: '₺10,000 Bonus' },
      },
    ],
  };
}

async function logClickToDatabase(clickData: ClickData): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase credentials not configured — click not persisted');
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/Click`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id: clickData.clickId,
        campaignId: clickData.campaignId,
        variantId: clickData.variantId,
        ipAddress: clickData.ipAddress,
        userAgent: clickData.userAgent,
        country: clickData.country,
        device: clickData.device,
        os: clickData.os,
        browser: clickData.browser,
        referrer: clickData.referrer,
        utmSource: clickData.utmSource,
        utmMedium: clickData.utmMedium,
        utmCampaign: clickData.utmCampaign,
        utmContent: clickData.utmContent,
        utmTerm: clickData.utmTerm,
        customParams: clickData.customParams,
        createdAt: clickData.timestamp,
      }),
    });

    if (!response.ok) {
      throw new Error(`Database insert failed: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Database logging error:', error);
  }
}
