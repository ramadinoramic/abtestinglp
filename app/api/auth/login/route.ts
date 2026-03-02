import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, buildDbCookie } from '@/lib/auth';
import { getSupabaseConfig, supabaseHeaders } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!process.env.ADMIN_AUTH_SECRET) {
      return NextResponse.json(
        { error: 'Auth not configured. Add ADMIN_AUTH_SECRET to your environment variables.' },
        { status: 503 }
      );
    }

    const secret = process.env.ADMIN_AUTH_SECRET;

    // ── 1. Env-var super-admin (backwards-compatible) ─────────────────────────
    if (
      process.env.ADMIN_USERNAME &&
      process.env.ADMIN_PASSWORD &&
      username === process.env.ADMIN_USERNAME &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const res = NextResponse.json({ success: true, role: 'OWNER' });
      res.cookies.set('admin_auth', secret, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
      return res;
    }

    // ── 2. DB user lookup ─────────────────────────────────────────────────────
    const { url, key, configured } = getSupabaseConfig();
    if (configured) {
      try {
        const userRes = await fetch(
          `${url}/rest/v1/AdminUser?username=eq.${encodeURIComponent(username)}&select=id,passwordHash,role&limit=1`,
          { headers: supabaseHeaders(key!) }
        );
        if (userRes.ok) {
          const users = await userRes.json();
          if (Array.isArray(users) && users.length > 0) {
            const user = users[0];
            const valid = await verifyPassword(password, user.passwordHash);
            if (valid) {
              const cookieVal = await buildDbCookie(user.id, user.role, secret);
              const res = NextResponse.json({ success: true, role: user.role });
              res.cookies.set('admin_auth', cookieVal, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 60 * 60 * 24 * 7,
              });
              return res;
            }
          }
        }
      } catch {
        // DB unavailable — fall through to error
      }
    }

    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
