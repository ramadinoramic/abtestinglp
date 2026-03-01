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

// POST /api/admin/campaigns - create a new campaign with variants
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
    const { name, slug, offerUrl, offerId, variantA, variantB, splitA, splitB } = body;

    if (!name || !slug || !offerUrl || !variantA || !variantB) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Create campaign (return=minimal to avoid empty-body parsing issues)
    const campaignRes = await fetch(`${url}/rest/v1/Campaign`, {
      method: 'POST',
      headers: { ...supabaseHeaders(key!), Prefer: 'return=minimal' },
      body: JSON.stringify({
        name,
        slug,
        status: 'ACTIVE',
        trafficSource: 'meta',
        offerUrl,
        offerId: offerId || '',
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

    // Fetch the campaign back by slug to get its generated ID
    const fetchRes = await fetch(
      `${url}/rest/v1/Campaign?slug=eq.${encodeURIComponent(slug)}&select=id,slug,name,status,offerUrl,offerId,createdAt`,
      { headers: supabaseHeaders(key!) }
    );
    const rows = await fetchRes.json();
    const campaign = Array.isArray(rows) ? rows[0] : null;

    if (!campaign?.id) {
      console.error('[campaigns POST] could not fetch campaign after insert, rows:', rows);
      return NextResponse.json({ error: 'Campaign created but could not retrieve ID. Check Supabase logs.' }, { status: 500 });
    }

    // Create variant A
    const varARes = await fetch(`${url}/rest/v1/Variant`, {
      method: 'POST',
      headers: { ...supabaseHeaders(key!), Prefer: 'return=minimal' },
      body: JSON.stringify({
        campaignId: campaign.id,
        name: `Variant A - ${variantA}`,
        slug: variantA,
        theme: { type: 'custom', landingPage: variantA },
        content: { landingPage: variantA },
        trafficWeight: splitA ?? 50,
        isControl: true,
        updatedAt: now,
      }),
    });
    if (!varARes.ok) {
      console.error('[campaigns POST] variant A creation failed:', await varARes.text());
    }

    // Create variant B
    const varBRes = await fetch(`${url}/rest/v1/Variant`, {
      method: 'POST',
      headers: { ...supabaseHeaders(key!), Prefer: 'return=minimal' },
      body: JSON.stringify({
        campaignId: campaign.id,
        name: `Variant B - ${variantB}`,
        slug: variantB,
        theme: { type: 'custom', landingPage: variantB },
        content: { landingPage: variantB },
        trafficWeight: splitB ?? 50,
        isControl: false,
        updatedAt: now,
      }),
    });
    if (!varBRes.ok) {
      console.error('[campaigns POST] variant B creation failed:', await varBRes.text());
    }

    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    console.error('[campaigns POST] unexpected error:', error);
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
