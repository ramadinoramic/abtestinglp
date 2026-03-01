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

// POST /api/admin/campaigns - create a new campaign with 1-5 landers
export async function POST(request: NextRequest) {
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) {
    return NextResponse.json(
      { error: 'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your environment variables.' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { name, slug, offerUrl, offerId, adSpend, geoGate, landers } = body as {
      name: string;
      slug: string;
      offerUrl: string;
      offerId?: string;
      adSpend?: number;
      geoGate?: boolean;
      landers: { landingPage: string; weight: number }[];
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

    // Create campaign
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
        geoGate: geoGate ?? false,
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

    for (let i = 0; i < variantResults.length; i++) {
      if (!variantResults[i].ok) {
        console.error(`[campaigns POST] lander ${i + 1} creation failed:`, await variantResults[i].text());
      }
    }

    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    console.error('[campaigns POST] unexpected error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/admin/campaigns - update traffic weights for 1-5 variants OR generate short code
export async function PATCH(request: NextRequest) {
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const body = await request.json() as {
      variants?: { id: string; trafficWeight: number }[];
      generateShortCode?: { campaignId: string };
    };

    // Handle short code generation for existing campaigns
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
        const text = await res.text();
        console.error('[campaigns PATCH] variant update failed:', text);
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
