import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const cookie = request.cookies.get('admin_auth');
  const secret = process.env.ADMIN_AUTH_SECRET;

  if (secret && cookie?.value === secret) {
    return NextResponse.next();
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
