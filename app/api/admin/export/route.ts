import { NextRequest, NextResponse } from 'next/server';

// GET /api/admin/export?campaignId=xxx&days=30
// Downloads a CSV with one row per click including conversion data.

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaignId');
  if (!campaignId) {
    return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
  }

  const days = parseInt(searchParams.get('days') ?? '0', 10);
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  try {
    let dateFilter = '';
    if (days > 0) {
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      dateFilter = `&createdAt=gte.${from}`;
    }

    // Fetch clicks with variant name and conversion data
    const [clicksRes, variantsRes, campaignRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/Click?campaignId=eq.${campaignId}${dateFilter}` +
          `&select=id,variantId,country,device,browser,os,language,referrer,` +
          `utmSource,utmMedium,utmCampaign,utmContent,utmTerm,vibe,cost,externalId,` +
          `isBot,ctaClicked,landed,converted,createdAt,` +
          `conversion:Conversion(eventType,payoutAmount,currency)` +
          `&order=createdAt.desc`,
        { headers }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/Variant?campaignId=eq.${campaignId}&select=id,name,slug`,
        { headers }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/Campaign?id=eq.${campaignId}&select=name,slug`,
        { headers }
      ),
    ]);

    const clicks = clicksRes.ok ? await clicksRes.json() : [];
    const variants = variantsRes.ok ? await variantsRes.json() : [];
    const campaigns = campaignRes.ok ? await campaignRes.json() : [];

    const variantMap: Record<string, string> = {};
    for (const v of variants) variantMap[v.id] = v.name;

    const campaignName: string = campaigns[0]?.name ?? campaignId;
    const campaignSlug: string = campaigns[0]?.slug ?? campaignId;

    // Build CSV
    const CSV_COLUMNS = [
      'date', 'clickId', 'campaign', 'variant',
      'country', 'device', 'browser', 'os', 'language',
      'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
      'vibe', 'cost', 'externalId', 'referrer',
      'isBot', 'landed', 'ctaClicked', 'converted',
      'conversionEvent', 'payout', 'currency',
    ];

    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows: string[] = [CSV_COLUMNS.join(',')];

    for (const c of clicks) {
      rows.push([
        escape(c.createdAt?.slice(0, 10)),
        escape(c.id),
        escape(campaignName),
        escape(variantMap[c.variantId] ?? c.variantId),
        escape(c.country),
        escape(c.device),
        escape(c.browser),
        escape(c.os),
        escape(c.language),
        escape(c.utmSource),
        escape(c.utmMedium),
        escape(c.utmCampaign),
        escape(c.utmContent),
        escape(c.utmTerm),
        escape(c.vibe),
        escape(c.cost),
        escape(c.externalId),
        escape(c.referrer),
        escape(c.isBot ? '1' : '0'),
        escape(c.landed ? '1' : '0'),
        escape(c.ctaClicked ? '1' : '0'),
        escape(c.converted ? '1' : '0'),
        escape(c.conversion?.eventType ?? ''),
        escape(c.conversion?.payoutAmount ?? ''),
        escape(c.conversion?.currency ?? ''),
      ].join(','));
    }

    const csv = rows.join('\n');
    const filename = `${campaignSlug}-export-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store',
      },
    });
  } catch (error) {
    console.error('[export GET]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
