import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// 1×1 transparent GIF (43 bytes)
const GIF_1X1 = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  0x01, 0x00, 0x01, 0x00,              // width=1, height=1
  0x80, 0x00, 0x00,                    // GCT: 2 colors, no sort, 1-bit depth
  0xff, 0xff, 0xff,                    // color 0: white
  0x00, 0x00, 0x00,                    // color 1: black
  0x21, 0xf9, 0x04, 0x01,             // Graphics Control Extension: transparent
  0x00, 0x00, 0x00, 0x00,             // delay=0, transparent color index=0
  0x2c,                                // Image Descriptor
  0x00, 0x00, 0x00, 0x00,             // left=0, top=0
  0x01, 0x00, 0x01, 0x00,             // width=1, height=1
  0x00,                                // no local color table
  0x02,                                // LZW minimum code size
  0x02, 0x4c, 0x01,                   // compressed image data
  0x00,                                // block terminator
  0x3b,                                // GIF trailer
]);

// GET /api/pixel?cid=CLICKID&payout=OPTIONAL&currency=OPTIONAL&event=OPTIONAL
//
// Conversion tracking pixel — returns a 1×1 transparent GIF while recording
// a conversion server-side. Use when your affiliate network supports only
// pixel-based (image tag / cookie) conversion tracking instead of S2S postback.
//
// Place on your offer's thank-you / confirmation page:
//   <img src="https://yourdomain.com/api/pixel?cid=REPLACE&payout=35&event=ftd" width="1" height="1" />

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cid = searchParams.get('cid');
  const payout = searchParams.get('payout');
  const currency = searchParams.get('currency') || 'EUR';
  const event = searchParams.get('event') || 'ftd';

  // Always return the pixel immediately — conversion is recorded async
  if (cid) {
    recordConversion({ cid, payout, currency, event }).catch(() => {});
  }

  return new NextResponse(GIF_1X1, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(GIF_1X1.length),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ============================================================
// HELPERS
// ============================================================

type ConversionEvent = 'REGISTRATION' | 'FTD' | 'REDEPOSIT';

function mapEventType(event: string): ConversionEvent {
  switch (event.toLowerCase()) {
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

async function recordConversion({
  cid,
  payout,
  currency,
  event,
}: {
  cid: string;
  payout: string | null;
  currency: string;
  event: string;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  const headers = {
    'Content-Type': 'application/json',
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  // Verify click exists
  const clickRes = await fetch(
    `${supabaseUrl}/rest/v1/Click?id=eq.${cid}&select=id&limit=1`,
    { headers }
  );
  const clicks = await clickRes.json();
  if (!Array.isArray(clicks) || clicks.length === 0) return;

  // Insert conversion record (ignore duplicate — network may fire pixel twice)
  await fetch(`${supabaseUrl}/rest/v1/Conversion`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({
      clickId: cid,
      eventType: mapEventType(event),
      payoutAmount: payout ? parseFloat(payout) : null,
      currency,
      postbackData: { source: 'pixel', event },
      createdAt: new Date().toISOString(),
    }),
  });

  // Mark click as converted
  await fetch(`${supabaseUrl}/rest/v1/Click?id=eq.${cid}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ converted: true, updatedAt: new Date().toISOString() }),
  });
}
