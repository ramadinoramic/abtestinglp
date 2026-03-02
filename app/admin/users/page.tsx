'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface AdminUser {
  id: string;
  username: string;
  role: 'OWNER' | 'ANALYST';
  createdAt: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string>('');
  const [myUserId, setMyUserId] = useState<string | null>(null);

  // Create form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'OWNER' | 'ANALYST'>('ANALYST');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, meRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/me'),
      ]);
      const usersData = await usersRes.json();
      const meData = await meRes.json();
      setUsers(usersData.users || []);
      setMyRole(meData.role ?? 'OWNER');
      setMyUserId(meData.userId ?? null);
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create user');
      } else {
        setSuccess(`User "${username.trim()}" created`);
        setUsername('');
        setPassword('');
        setRole('ANALYST');
        loadUsers();
      }
    } catch {
      setError('Network error');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(user: AdminUser) {
    if (!confirm(`Delete user "${user.username}"?`)) return;
    setError('');
    try {
      const res = await fetch(`/api/admin/users?userId=${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to delete user');
      } else {
        setSuccess(`User "${user.username}" deleted`);
        loadUsers();
      }
    } catch {
      setError('Network error');
    }
  }

  if (myRole && myRole !== 'OWNER') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">Access Denied</p>
          <p className="text-gray-400 text-sm mb-6">Only OWNER accounts can manage users.</p>
          <Link href="/admin" className="text-blue-400 hover:text-blue-300 text-sm">← Back to Admin</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="text-gray-400 hover:text-white text-sm">
            ← Admin
          </Link>
          <h1 className="text-lg font-semibold">Admin Users</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Info box */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 text-sm text-gray-400">
          <strong className="text-gray-200">OWNER</strong> — full access (create/delete campaigns, blocklist management, user management)<br />
          <strong className="text-gray-200">ANALYST</strong> — read-only: view campaigns and analytics; cannot create, delete, or manage users
        </div>

        {/* Create user form */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Add Admin User</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min 8 chars)"
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
                minLength={8}
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'OWNER' | 'ANALYST')}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ANALYST">ANALYST</option>
                <option value="OWNER">OWNER</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={creating || !username.trim() || !password}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              {creating ? 'Creating…' : 'Create User'}
            </button>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">{success}</p>}
          </form>
        </div>

        {/* Users list */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-300">Users ({users.length})</h2>
          </div>

          {loading ? (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">Loading…</div>
          ) : users.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">
              No DB users yet. The env-var super-admin still works.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-800">
                <tr className="text-gray-400 text-xs">
                  <th className="text-left px-6 py-3">Username</th>
                  <th className="text-left px-6 py-3">Role</th>
                  <th className="text-left px-6 py-3">Created</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-800/40">
                    <td className="px-6 py-3 font-medium text-white">
                      {user.username}
                      {user.id === myUserId && (
                        <span className="ml-2 text-xs text-gray-500">(you)</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        user.role === 'OWNER'
                          ? 'bg-yellow-900/40 text-yellow-300'
                          : 'bg-blue-900/40 text-blue-300'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {user.id !== myUserId && (
                        <button
                          onClick={() => handleDelete(user)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
