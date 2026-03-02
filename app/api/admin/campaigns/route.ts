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

function requireOwner(request: NextRequest): NextResponse | null {
  const role = request.headers.get('x-admin-role');
  if (role && role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden: OWNER role required' }, { status: 403 });
  }
  return null;
}

// GET /api/admin/campaigns - list all campaigns with variants
export async function GET() {
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) {
    return NextResponse.json({ campaigns: [] });
  }
  try {
    const res = await fetch(
      `${url}/rest/v1/Campaign?select=*,variants:Variant(*)&order=createdAt.desc`,
      { headers: supabaseHeaders(key!) }
    );
    const data = await res.json();
    return NextResponse.json({ campaigns: Array.isArray(data) ? data : [] });
  } catch (error) {
    console.error('[campaigns GET]', error);
    return NextResponse.json({ campaigns: [] });
  }
}

// POST /api/admin/campaigns
// Two modes:
//   1. Normal create: { name, slug, offerUrl, offerId, adSpend, geoAllowList, optimizationMode, landers[] }
//   2. Clone:         { clone: true, sourceCampaignId, newName, newSlug }
export async function POST(request: NextRequest) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) {
    return NextResponse.json(
      { error: 'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your environment variables.' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();

    // ── Clone mode ────────────────────────────────────────────────────────────
    if (body.clone) {
      return handleClone(url!, key!, body);
    }

    // ── Normal create ─────────────────────────────────────────────────────────
    const {
      name, slug, offerUrl, offerId, adSpend, geoAllowList,
      optimizationMode, landers,
    } = body as {
      name: string;
      slug: string;
      offerUrl: string;
      offerId?: string;
      adSpend?: number;
      geoAllowList?: string;
      optimizationMode?: string;
      landers: {
        landingPage: string;
        weight: number;
        geoTargets?: string[];
        deviceTargets?: string[];
        offerUrlOverride?: string;
      }[];
    };

    if (!name || !slug || !offerUrl) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!Array.isArray(landers) || landers.length < 1 || landers.length > 5) {
      return NextResponse.json({ error: '1 to 5 landers required' }, { status: 400 });
    }
    const totalWeight = landers.reduce((s, l) => s + (l.weight ?? 0), 0);
    if (Math.abs(totalWeight - 100) > 1) {
      return NextResponse.json({ error: 'Traffic weights must sum to 100' }, { status: 400 });
    }
    for (const l of landers) {
      if (!l.landingPage) {
        return NextResponse.json({ error: 'Each lander must have a landing page selected' }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const campaignId = crypto.randomUUID();
    const shortCode = Math.random().toString(36).slice(2, 8);

    const campaignRes = await fetch(`${url}/rest/v1/Campaign`, {
      method: 'POST',
      headers: { ...supabaseHeaders(key!), Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: campaignId,
        name,
        slug,
        status: 'ACTIVE',
        trafficSource: 'meta',
        offerUrl,
        offerId: offerId || '',
        adSpend: adSpend ?? null,
        geoAllowList: geoAllowList ?? '[]',
        optimizationMode: optimizationMode ?? 'STATIC',
        shortCode,
        updatedAt: now,
      }),
    });

    if (!campaignRes.ok) {
      const errText = await campaignRes.text();
      console.error('[campaigns POST] create campaign failed:', errText);
      let errJson;
      try { errJson = JSON.parse(errText); } catch { errJson = errText; }
      return NextResponse.json({ error: errJson }, { status: 400 });
    }

    const campaign = { id: campaignId, name, slug, status: 'ACTIVE', offerUrl, offerId: offerId || '', shortCode };

    // Create all variants in parallel
    const variantResults = await Promise.all(
      landers.map((lander, i) =>
        fetch(`${url}/rest/v1/Variant`, {
          method: 'POST',
          headers: { ...supabaseHeaders(key!), Prefer: 'return=minimal' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            campaignId,
            name: `Lander ${i + 1} - ${lander.landingPage}`,
            slug: lander.landingPage,
            theme: { type: 'custom', landingPage: lander.landingPage },
            content: { landingPage: lander.landingPage },
            trafficWeight: lander.weight,
            isControl: i === 0,
            updatedAt: now,
          }),
        })
      )
    );

    const variantErrors: string[] = [];
    for (let i = 0; i < variantResults.length; i++) {
      if (!variantResults[i].ok) {
        const errText = await variantResults[i].text();
        console.error(`[campaigns POST] lander ${i + 1} creation failed:`, errText);
        variantErrors.push(`Lander ${i + 1}: ${errText}`);
      }
    }
    if (variantErrors.length > 0) {
      return NextResponse.json({ error: 'Variant creation failed', details: variantErrors }, { status: 500 });
    }

    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    console.error('[campaigns POST] unexpected error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/admin/campaigns
// Handles: weight updates, short code generation, campaign settings update
export async function PATCH(request: NextRequest) {
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const body = await request.json() as {
      variants?: { id: string; trafficWeight: number }[];
      generateShortCode?: { campaignId: string };
      reactivate?: { campaignId: string };
      updateSettings?: {
        campaignId: string;
        optimizationMode?: string;
        adSpend?: number | null;
        autoPauseEnabled?: boolean;
        autoPauseThreshold?: number | null;
        autoPauseWindow?: number | null;
      };
    };

    // Re-activate a campaign that was auto-paused
    if (body.reactivate) {
      const { campaignId } = body.reactivate;
      if (!campaignId) return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
      const res = await fetch(`${url}/rest/v1/Campaign?id=eq.${campaignId}`, {
        method: 'PATCH',
        headers: { ...supabaseHeaders(key!), Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'ACTIVE', autoPausedAt: null, updatedAt: new Date().toISOString() }),
      });
      if (!res.ok) return NextResponse.json({ error: 'Failed to re-activate campaign' }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    // Generate short code
    if (body.generateShortCode) {
      const { campaignId } = body.generateShortCode;
      if (!campaignId) return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
      const shortCode = Math.random().toString(36).slice(2, 8);
      const res = await fetch(`${url}/rest/v1/Campaign?id=eq.${campaignId}`, {
        method: 'PATCH',
        headers: { ...supabaseHeaders(key!), Prefer: 'return=representation' },
        body: JSON.stringify({ shortCode, updatedAt: new Date().toISOString() }),
      });
      if (!res.ok) return NextResponse.json({ error: 'Failed to generate short code' }, { status: 400 });
      return NextResponse.json({ success: true, shortCode });
    }

    // Update campaign settings (optimizationMode, scheduling, adSpend)
    if (body.updateSettings) {
      const { campaignId, ...settings } = body.updateSettings;
      if (!campaignId) return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
      const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (settings.optimizationMode !== undefined) patch.optimizationMode = settings.optimizationMode;
      if (settings.adSpend !== undefined) patch.adSpend = settings.adSpend;
      if (settings.autoPauseEnabled !== undefined) patch.autoPauseEnabled = settings.autoPauseEnabled;
      if (settings.autoPauseThreshold !== undefined) patch.autoPauseThreshold = settings.autoPauseThreshold;
      if (settings.autoPauseWindow !== undefined) patch.autoPauseWindow = settings.autoPauseWindow;
      const res = await fetch(`${url}/rest/v1/Campaign?id=eq.${campaignId}`, {
        method: 'PATCH',
        headers: { ...supabaseHeaders(key!), Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return NextResponse.json({ error: 'Failed to update settings' }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    // Update variant traffic weights
    const { variants } = body;
    if (!Array.isArray(variants) || variants.length < 1 || variants.length > 5) {
      return NextResponse.json({ error: '1 to 5 variants required' }, { status: 400 });
    }
    const total = variants.reduce((s, v) => s + v.trafficWeight, 0);
    if (Math.abs(total - 100) > 1) {
      return NextResponse.json({ error: 'Traffic weights must sum to 100' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const patches = variants.map((v) =>
      fetch(`${url}/rest/v1/Variant?id=eq.${v.id}`, {
        method: 'PATCH',
        headers: { ...supabaseHeaders(key!), Prefer: 'return=minimal' },
        body: JSON.stringify({ trafficWeight: v.trafficWeight, updatedAt: now }),
      })
    );
    const results = await Promise.all(patches);
    for (const res of results) {
      if (!res.ok) {
        console.error('[campaigns PATCH] variant update failed:', await res.text());
        return NextResponse.json({ error: 'Failed to update variant' }, { status: 400 });
      }
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[campaigns PATCH]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/admin/campaigns?id=xxx
export async function DELETE(request: NextRequest) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    await fetch(`${url}/rest/v1/Campaign?id=eq.${id}`, {
      method: 'DELETE',
      headers: supabaseHeaders(key!),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[campaigns DELETE]', error);
    return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 });
  }
}

// ─── Clone handler ────────────────────────────────────────────────────────────

async function handleClone(
  url: string,
  key: string,
  body: { sourceCampaignId: string; newName: string; newSlug: string }
): Promise<NextResponse> {
  const { sourceCampaignId, newName, newSlug } = body;
  if (!sourceCampaignId || !newName || !newSlug) {
    return NextResponse.json({ error: 'Missing sourceCampaignId, newName, or newSlug' }, { status: 400 });
  }

  const headers = supabaseHeaders(key);

  // Fetch source campaign + variants
  const [srcCampaignRes, srcVariantsRes] = await Promise.all([
    fetch(`${url}/rest/v1/Campaign?id=eq.${sourceCampaignId}&select=*&limit=1`, { headers }),
    fetch(`${url}/rest/v1/Variant?campaignId=eq.${sourceCampaignId}&select=*`, { headers }),
  ]);

  const srcCampaigns = await srcCampaignRes.json();
  const srcVariants = await srcVariantsRes.json();

  if (!Array.isArray(srcCampaigns) || srcCampaigns.length === 0) {
    return NextResponse.json({ error: 'Source campaign not found' }, { status: 404 });
  }

  const src = srcCampaigns[0];
  const now = new Date().toISOString();
  const newCampaignId = crypto.randomUUID();
  const newShortCode = Math.random().toString(36).slice(2, 8);

  // Create cloned campaign
  const cloneRes = await fetch(`${url}/rest/v1/Campaign`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: newCampaignId,
      name: newName,
      slug: newSlug,
      status: 'ACTIVE',
      trafficSource: src.trafficSource,
      offerUrl: src.offerUrl,
      offerId: src.offerId,
      adSpend: null,
      geoAllowList: src.geoAllowList ?? '[]',
      optimizationMode: src.optimizationMode ?? 'STATIC',
      shortCode: newShortCode,
      updatedAt: now,
    }),
  });

  if (!cloneRes.ok) {
    const text = await cloneRes.text();
    return NextResponse.json({ error: text }, { status: 400 });
  }

  // Clone variants
  if (Array.isArray(srcVariants) && srcVariants.length > 0) {
    await Promise.all(
      srcVariants.map((v) =>
        fetch(`${url}/rest/v1/Variant`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            campaignId: newCampaignId,
            name: v.name,
            slug: v.slug,
            theme: v.theme,
            content: v.content,
            trafficWeight: v.trafficWeight,
            isControl: v.isControl,
            creativeMetadata: v.creativeMetadata ?? null,
            geoTargets: v.geoTargets ?? '[]',
            deviceTargets: v.deviceTargets ?? '[]',
            offerUrlOverride: v.offerUrlOverride ?? null,
            cumulativeClicks: 0,
            cumulativeConversions: 0,
            updatedAt: now,
          }),
        })
      )
    );
  }

  return NextResponse.json({
    success: true,
    campaign: { id: newCampaignId, name: newName, slug: newSlug, shortCode: newShortCode },
  });
}
