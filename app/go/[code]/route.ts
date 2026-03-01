import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// GET /go/[code] — resolve short link and redirect to tracking route
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return new NextResponse('Service unavailable', { status: 503 });
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/Campaign?shortCode=eq.${code}&select=slug&limit=1`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      return new NextResponse('Short link not found', { status: 404 });
    }

    const slug: string = data[0].slug;

    // Forward any query params (utm_*, vibe, variant, etc.) to the track route
    const trackUrl = new URL(`/api/track`, request.url);
    trackUrl.searchParams.set('campaign', slug);
    // Copy all incoming params except none (forward everything)
    request.nextUrl.searchParams.forEach((value, key) => {
      trackUrl.searchParams.set(key, value);
    });

    return NextResponse.redirect(trackUrl, { status: 307 });
  } catch {
    return new NextResponse('Internal error', { status: 500 });
  }
}
