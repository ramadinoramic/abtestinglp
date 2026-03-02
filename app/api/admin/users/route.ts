import { NextRequest, NextResponse } from 'next/server';
import { hashPassword } from '@/lib/auth';
import { getSupabaseConfig, supabaseHeaders } from '@/lib/supabase';

function requireOwner(request: NextRequest): NextResponse | null {
  const role = request.headers.get('x-admin-role');
  if (role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden: OWNER role required' }, { status: 403 });
  }
  return null;
}

// GET /api/admin/users — list all admin users (no password hashes)
export async function GET(request: NextRequest) {
  const denied = requireOwner(request);
  if (denied) return denied;

  const { url, key, configured } = getSupabaseConfig();
  if (!configured) return NextResponse.json({ users: [] });

  try {
    const res = await fetch(
      `${url}/rest/v1/AdminUser?select=id,username,role,createdAt&order=createdAt.asc`,
      { headers: supabaseHeaders(key!) }
    );
    const data = await res.json();
    return NextResponse.json({ users: Array.isArray(data) ? data : [] });
  } catch (error) {
    console.error('[users GET]', error);
    return NextResponse.json({ users: [] });
  }
}

// POST /api/admin/users — create a new admin user
export async function POST(request: NextRequest) {
  const denied = requireOwner(request);
  if (denied) return denied;

  const { url, key, configured } = getSupabaseConfig();
  if (!configured) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  try {
    const { username, password, role } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ error: 'username and password required' }, { status: 400 });
    }
    if (!['OWNER', 'ANALYST'].includes(role)) {
      return NextResponse.json({ error: 'role must be OWNER or ANALYST' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();

    const res = await fetch(`${url}/rest/v1/AdminUser`, {
      method: 'POST',
      headers: { ...supabaseHeaders(key!), Prefer: 'return=representation' },
      body: JSON.stringify({
        id,
        username: username.trim(),
        passwordHash,
        salt: '',  // salt is embedded in the pbkdf2 hash string
        role,
        createdAt: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (text.includes('unique') || text.includes('duplicate')) {
        return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
      }
      return NextResponse.json({ error: text }, { status: 400 });
    }

    const data = await res.json();
    const user = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    console.error('[users POST]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/admin/users?userId=xxx — delete an admin user
export async function DELETE(request: NextRequest) {
  const denied = requireOwner(request);
  if (denied) return denied;

  const { url, key, configured } = getSupabaseConfig();
  if (!configured) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

    // Prevent self-deletion
    const requestingUserId = request.headers.get('x-admin-user-id');
    if (requestingUserId && requestingUserId === userId) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    await fetch(`${url}/rest/v1/AdminUser?id=eq.${userId}`, {
      method: 'DELETE',
      headers: supabaseHeaders(key!),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[users DELETE]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/admin/users — change a user's password
export async function PATCH(request: NextRequest) {
  const denied = requireOwner(request);
  if (denied) return denied;

  const { url, key, configured } = getSupabaseConfig();
  if (!configured) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  try {
    const { userId, newPassword } = await request.json();
    if (!userId || !newPassword) {
      return NextResponse.json({ error: 'userId and newPassword required' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const passwordHash = await hashPassword(newPassword);
    const res = await fetch(`${url}/rest/v1/AdminUser?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { ...supabaseHeaders(key!), Prefer: 'return=minimal' },
      body: JSON.stringify({ passwordHash }),
    });

    if (!res.ok) return NextResponse.json({ error: 'Failed to update password' }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[users PATCH]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
