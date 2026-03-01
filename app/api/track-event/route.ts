import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

interface TrackEventRequest {
  clickId: string;
  event: 'page_view' | 'cta_click' | 'scroll' | 'exit';
  variant?: string;
  scrollDepth?: number;
  timeOnPage?: number;
  timestamp: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: TrackEventRequest = await request.json();
    const { clickId, event, scrollDepth, timeOnPage, timestamp } = body;

    if (!clickId || !event) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      // Silently succeed in development when Supabase is not configured
      return NextResponse.json({ success: true });
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    switch (event) {
      case 'page_view':
        updateData.landed = true;
        break;
      case 'cta_click':
        updateData.ctaClicked = true;
        updateData.clickedAt = timestamp;
        break;
      case 'scroll':
        if (scrollDepth !== undefined) {
          updateData.scrollDepth = scrollDepth;
        }
        break;
      case 'exit':
        if (timeOnPage !== undefined) {
          updateData.timeOnPage = Math.round(timeOnPage);
        }
        break;
    }

    // Only write if there's something to update beyond the timestamp
    if (Object.keys(updateData).length > 1) {
      await fetch(`${supabaseUrl}/rest/v1/Click?id=eq.${clickId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(updateData),
      });
    }

    return NextResponse.json({ success: true, event });
  } catch (error) {
    console.error('Event tracking error:', error);
    // Always return 200 so client-side errors don't break the UX
    return NextResponse.json({ success: true });
  }
}
