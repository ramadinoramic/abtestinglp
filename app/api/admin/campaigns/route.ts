import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function supabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

// GET /api/admin/campaigns - list all campaigns with variants
export async function GET() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Campaign?select=*,variants:Variant(*)&order=createdAt.desc`,
      { headers: supabaseHeaders() }
    );
    const data = await res.json();
    return NextResponse.json({ campaigns: data });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 });
  }
}

// POST /api/admin/campaigns - create a new campaign with variants
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, slug, offerUrl, offerId, variantA, variantB, splitA, splitB } = body;

    if (!name || !slug || !offerUrl || !variantA || !variantB) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Create campaign
    const campaignRes = await fetch(`${SUPABASE_URL}/rest/v1/Campaign`, {
      method: 'POST',
      headers: { ...supabaseHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify({
        name,
        slug,
        status: 'ACTIVE',
        trafficSource: 'meta',
        offerUrl,
        offerId: offerId || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    });

    if (!campaignRes.ok) {
      const err = await campaignRes.json();
      return NextResponse.json({ error: err }, { status: 400 });
    }

    const [campaign] = await campaignRes.json();

    // Create variant A
    await fetch(`${SUPABASE_URL}/rest/v1/Variant`, {
      method: 'POST',
      headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        campaignId: campaign.id,
        name: `Variant A - ${variantA}`,
        slug: variantA,
        theme: { type: 'custom', landingPage: variantA },
        content: { landingPage: variantA },
        trafficWeight: splitA ?? 50,
        isControl: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    });

    // Create variant B
    await fetch(`${SUPABASE_URL}/rest/v1/Variant`, {
      method: 'POST',
      headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        campaignId: campaign.id,
        name: `Variant B - ${variantB}`,
        slug: variantB,
        theme: { type: 'custom', landingPage: variantB },
        content: { landingPage: variantB },
        trafficWeight: splitB ?? 50,
        isControl: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    });

    return NextResponse.json({ success: true, campaign });
  } catch {
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }
}

// DELETE /api/admin/campaigns?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    await fetch(`${SUPABASE_URL}/rest/v1/Campaign?id=eq.${id}`, {
      method: 'DELETE',
      headers: supabaseHeaders(),
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 });
  }
}
