'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface BlockedIp {
  id: string;
  ip: string;
  reason: string | null;
  createdAt: string;
}

export default function BlocklistPage() {
  const [blockedIps, setBlockedIps] = useState<BlockedIp[]>([]);
  const [loading, setLoading] = useState(true);
  const [ipInput, setIpInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadBlocklist = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/blocklist');
      const data = await res.json();
      setBlockedIps(data.blockedIps || []);
    } catch {
      setError('Failed to load blocklist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBlocklist();
  }, [loadBlocklist]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/blocklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: ipInput.trim(), reason: reasonInput.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to block IP');
      } else {
        setSuccess(`${ipInput.trim()} has been blocked`);
        setIpInput('');
        setReasonInput('');
        loadBlocklist();
      }
    } catch {
      setError('Network error');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(ip: string) {
    if (!confirm(`Unblock ${ip}?`)) return;
    setError('');
    try {
      const res = await fetch(`/api/admin/blocklist?ip=${encodeURIComponent(ip)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to unblock IP');
      } else {
        setSuccess(`${ip} has been unblocked`);
        loadBlocklist();
      }
    } catch {
      setError('Network error');
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="text-gray-400 hover:text-white text-sm">
            ← Admin
          </Link>
          <h1 className="text-lg font-semibold">IP Blocklist</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Add IP form */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Block an IP Address</h2>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="flex gap-3">
              <input
                type="text"
                value={ipInput}
                onChange={(e) => setIpInput(e.target.value)}
                placeholder="e.g. 1.2.3.4 or 2001:db8::1"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
              <input
                type="text"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                placeholder="Reason (optional)"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={adding || !ipInput.trim()}
                className="bg-red-600 hover:bg-red-700 disabled:bg-red-900 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
              >
                {adding ? 'Blocking…' : 'Block IP'}
              </button>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">{success}</p>}
          </form>
        </div>

        {/* Blocklist table */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">
              Blocked IPs ({blockedIps.length})
            </h2>
            <button
              onClick={loadBlocklist}
              className="text-xs text-gray-400 hover:text-white"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">Loading…</div>
          ) : blockedIps.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">
              No IPs are currently blocked.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-800">
                <tr className="text-gray-400 text-xs">
                  <th className="text-left px-6 py-3">IP Address</th>
                  <th className="text-left px-6 py-3">Reason</th>
                  <th className="text-left px-6 py-3">Blocked</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {blockedIps.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-800/40">
                    <td className="px-6 py-3 font-mono text-red-300">{entry.ip}</td>
                    <td className="px-6 py-3 text-gray-400">{entry.reason || '—'}</td>
                    <td className="px-6 py-3 text-gray-500">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() => handleDelete(entry.ip)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Unblock
                      </button>
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
