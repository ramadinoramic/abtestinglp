import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseConfig, supabaseHeaders } from '@/lib/supabase';

function requireOwner(request: NextRequest): NextResponse | null {
  const role = request.headers.get('x-admin-role');
  if (role && role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden: OWNER role required' }, { status: 403 });
  }
  return null;
}

// Simple IPv4 + IPv6 format validation
function isValidIp(ip: string): boolean {
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return ip.split('.').every((n) => parseInt(n) <= 255);
  }
  // IPv6 (basic check)
  if (/^[0-9a-fA-F:]+$/.test(ip) && ip.includes(':')) return true;
  return false;
}

// GET /api/admin/blocklist — list all blocked IPs
export async function GET() {
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) {
    return NextResponse.json({ blockedIps: [] });
  }
  try {
    const res = await fetch(
      `${url}/rest/v1/BlockedIp?order=createdAt.desc`,
      { headers: supabaseHeaders(key!) }
    );
    const data = await res.json();
    return NextResponse.json({ blockedIps: Array.isArray(data) ? data : [] });
  } catch (error) {
    console.error('[blocklist GET]', error);
    return NextResponse.json({ blockedIps: [] });
  }
}

// POST /api/admin/blocklist — block an IP
export async function POST(request: NextRequest) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const { ip, reason } = await request.json();
    if (!ip || !isValidIp(ip)) {
      return NextResponse.json({ error: 'Invalid IP address' }, { status: 400 });
    }

    const res = await fetch(`${url}/rest/v1/BlockedIp`, {
      method: 'POST',
      headers: { ...supabaseHeaders(key!), Prefer: 'return=representation' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        ip: ip.trim(),
        reason: reason || null,
        createdAt: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      // Unique constraint violation = already blocked
      if (text.includes('unique') || text.includes('duplicate')) {
        return NextResponse.json({ error: 'IP already blocked' }, { status: 409 });
      }
      return NextResponse.json({ error: text }, { status: 400 });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, blockedIp: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    console.error('[blocklist POST]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/admin/blocklist?ip=x.x.x.x — unblock an IP
export async function DELETE(request: NextRequest) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const ip = searchParams.get('ip');
    if (!ip) return NextResponse.json({ error: 'Missing ip parameter' }, { status: 400 });

    await fetch(`${url}/rest/v1/BlockedIp?ip=eq.${encodeURIComponent(ip)}`, {
      method: 'DELETE',
      headers: supabaseHeaders(key!),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[blocklist DELETE]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
