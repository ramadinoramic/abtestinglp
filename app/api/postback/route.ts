import { NextRequest, NextResponse } from 'next/server';

type ConversionEvent = 'REGISTRATION' | 'FTD' | 'REDEPOSIT';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const clickId = searchParams.get('clickid') || searchParams.get('click_id');
    const event = searchParams.get('event') || 'ftd';
    const payout = searchParams.get('payout');
    const playerValue = searchParams.get('player_value');
    const playerId = searchParams.get('player_id');
    const currency = searchParams.get('currency') || 'EUR';

    if (!clickId) {
      return NextResponse.json({ error: 'Missing click_id parameter' }, { status: 400 });
    }

    // Find click in database
    const clickData = await findClickById(clickId);

    if (!clickData) {
      console.error(`Click not found for ID: ${clickId}`);
      return NextResponse.json({ error: 'Click not found', clickId }, { status: 404 });
    }

    // Save conversion
    await saveConversion({
      clickId,
      eventType: mapEventType(event),
      payoutAmount: payout ? parseFloat(payout) : null,
      playerValue: playerValue ? parseFloat(playerValue) : null,
      currency,
      playerId,
      rawPostbackData: Object.fromEntries(searchParams.entries()),
    });

    // Mark click as converted
    await updateClickConversion(clickId);

    // Non-blocking: increment variant's cumulative conversions for MAB
    incrementVariantConversions(clickData.variantId).catch(() => {});

    console.log('Conversion received:', {
      clickId,
      variant: clickData.variantSlug,
      event,
      payout,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Conversion recorded',
        clickId,
        event,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Postback processing error:', error);
    // Always return 200 to prevent retries from the affiliate network
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 200 });
  }
}

// Support POST as well (some networks send POST)
export async function POST(request: NextRequest) {
  return GET(request);
}

// ============================================
// HELPERS
// ============================================

function mapEventType(event: string): ConversionEvent {
  const normalized = event.toLowerCase();
  switch (normalized) {
    case 'registration':
    case 'reg':
    case 'signup':
      return 'REGISTRATION';
    case 'redeposit':
    case 'repeat_deposit':
      return 'REDEPOSIT';
    default:
      return 'FTD';
  }
}

async function findClickById(
  clickId: string
): Promise<{ id: string; campaignId: string; variantId: string; variantSlug: string } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) return null;

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/Click?id=eq.${clickId}&select=*,variant:Variant(slug),campaign:Campaign(id)`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    const data = await response.json();
    if (!data || data.length === 0) return null;

    return {
      id: data[0].id,
      campaignId: data[0].campaign?.id,
      variantId: data[0].variantId,
      variantSlug: data[0].variant?.slug,
    };
  } catch (error) {
    console.error('Error finding click:', error);
    return null;
  }
}

async function saveConversion(data: {
  clickId: string;
  eventType: ConversionEvent;
  payoutAmount: number | null;
  playerValue: number | null;
  currency: string;
  playerId: string | null;
  rawPostbackData: Record<string, string>;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase not configured');

  const response = await fetch(`${supabaseUrl}/rest/v1/Conversion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      clickId: data.clickId,
      eventType: data.eventType,
      payoutAmount: data.payoutAmount,
      playerValue: data.playerValue,
      currency: data.currency,
      playerId: data.playerId,
      postbackData: data.rawPostbackData,
      createdAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) throw new Error(`Failed to save conversion: ${response.statusText}`);
  return response.json();
}

async function incrementVariantConversions(variantId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey || !variantId) return;

  const headers = {
    'Content-Type': 'application/json',
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };
  const res = await fetch(
    `${supabaseUrl}/rest/v1/Variant?id=eq.${variantId}&select=cumulativeConversions`,
    { headers }
  );
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return;
  const current = rows[0].cumulativeConversions ?? 0;
  await fetch(`${supabaseUrl}/rest/v1/Variant?id=eq.${variantId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ cumulativeConversions: current + 1 }),
  });
}

async function updateClickConversion(clickId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) return;

  await fetch(`${supabaseUrl}/rest/v1/Click?id=eq.${clickId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      converted: true,
      updatedAt: new Date().toISOString(),
    }),
  });
}
