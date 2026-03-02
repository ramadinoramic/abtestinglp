import { NextRequest, NextResponse } from 'next/server';
import { resolveTokens } from '@/lib/tokens';

export const runtime = 'edge';

// GET /api/click?cid=CLICKID
//
// Server-side CTA handler. Landing page CTAs point here instead of building
// the offer URL client-side. This:
//   1. Looks up the stored click + campaign offer URL
//   2. Resolves {token} placeholders using the click's tracked data
//   3. Marks ctaClicked = true (non-blocking)
//   4. 307-redirects the user to the resolved offer URL
//
// Works even without JavaScript — a plain <a href="/api/click?cid=CLICKID"> is enough.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cid = searchParams.get('cid');

  if (!cid) {
    return new NextResponse('Missing cid parameter', { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return new NextResponse('Service unavailable', { status: 503 });
  }

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  };

  try {
    // Fetch click record with all data needed for token resolution
    const clickRes = await fetch(
      `${supabaseUrl}/rest/v1/Click?id=eq.${cid}` +
        `&select=id,campaignId,country,device,browser,os,ipAddress,referrer,` +
        `utmSource,utmMedium,utmCampaign,utmContent,utmTerm,vibe,language,cost,externalId,customParams` +
        `&limit=1`,
      { headers }
    );

    const clicks = await clickRes.json();
    if (!Array.isArray(clicks) || clicks.length === 0) {
      // Click not found — send to homepage rather than a hard error
      return NextResponse.redirect(new URL('/', request.url), { status: 302 });
    }

    const click = clicks[0];

    // Fetch campaign to get offerUrl
    const campaignRes = await fetch(
      `${supabaseUrl}/rest/v1/Campaign?id=eq.${click.campaignId}&select=offerUrl&limit=1`,
      { headers }
    );

    const campaigns = await campaignRes.json();
    const offerUrl: string = campaigns?.[0]?.offerUrl;

    if (!offerUrl) {
      return new NextResponse('No offer URL configured for this campaign', { status: 400 });
    }

    // Resolve tokens in the offer URL using stored click data
    const resolvedUrl = resolveTokens(offerUrl, {
      clickId: cid,
      country: click.country ?? undefined,
      device: click.device ?? undefined,
      browser: click.browser ?? undefined,
      os: click.os ?? undefined,
      ip: click.ipAddress ?? undefined,
      referrer: click.referrer ?? undefined,
      language: click.language ?? undefined,
      utmSource: click.utmSource ?? undefined,
      utmMedium: click.utmMedium ?? undefined,
      utmCampaign: click.utmCampaign ?? undefined,
      utmContent: click.utmContent ?? undefined,
      utmTerm: click.utmTerm ?? undefined,
      vibe: click.vibe ?? undefined,
      cost: click.cost ?? undefined,
      externalId: click.externalId ?? undefined,
      customParams: click.customParams ?? undefined,
    });

    // Non-blocking: mark CTA as clicked
    fetch(`${supabaseUrl}/rest/v1/Click?id=eq.${cid}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ ctaClicked: true, updatedAt: new Date().toISOString() }),
    }).catch(() => {});

    return NextResponse.redirect(resolvedUrl, {
      status: 307,
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });
  } catch {
    return new NextResponse('Internal error', { status: 500 });
  }
}
