import { NextRequest, NextResponse } from 'next/server';

// GET /api/admin/me — returns current user's role
// Role is injected by middleware as x-admin-role header
export function GET(request: NextRequest) {
  const role = request.headers.get('x-admin-role') ?? 'OWNER';
  const userId = request.headers.get('x-admin-user-id') ?? null;
  return NextResponse.json({ role, userId });
}
