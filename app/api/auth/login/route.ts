import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (
      !process.env.ADMIN_USERNAME ||
      !process.env.ADMIN_PASSWORD ||
      !process.env.ADMIN_AUTH_SECRET
    ) {
      return NextResponse.json(
        { error: 'Auth not configured. Add ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_AUTH_SECRET to your environment variables.' },
        { status: 503 }
      );
    }

    if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set('admin_auth', process.env.ADMIN_AUTH_SECRET, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return res;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
