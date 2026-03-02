import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const cookieVal = request.cookies.get('admin_auth')?.value ?? '';
  const secret = process.env.ADMIN_AUTH_SECRET ?? '';

  let authed = false;
  let role = 'OWNER';
  let userId = '';

  if (secret) {
    // ── Legacy: env-var super-admin ───────────────────────────────────────────
    if (timingSafeEqual(cookieVal, secret)) {
      authed = true;
      role = 'OWNER';
    }

    // ── DB user: cookie format = "db:{userId}:{role}:{hmac}" ─────────────────
    if (!authed && cookieVal.startsWith('db:')) {
      const parts = cookieVal.split(':');
      if (parts.length === 4) {
        const [, uid, r, hmac] = parts;
        if (uid && r && hmac && ['OWNER', 'ANALYST'].includes(r)) {
          const expected = await sha256Hex(`${uid}:${r}:${secret}`);
          if (timingSafeEqual(hmac, expected)) {
            authed = true;
            role = r;
            userId = uid;
          }
        }
      }
    }
  }

  if (authed) {
    // Forward role + userId to downstream route handlers via request headers
    const reqHeaders = new Headers(request.headers);
    reqHeaders.set('x-admin-role', role);
    if (userId) reqHeaders.set('x-admin-user-id', userId);
    return NextResponse.next({ request: { headers: reqHeaders } });
  }

  // API routes → 401 JSON (don't redirect, callers handle HTTP errors)
  if (pathname.startsWith('/api/admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Page routes → redirect to /login, preserve intended destination
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('redirect', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
