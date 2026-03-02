/**
 * Auth helpers — password hashing + token generation.
 *
 * Uses Web Crypto API (crypto.subtle) which works in:
 *   - Next.js Edge Runtime (middleware, edge routes)
 *   - Next.js Node.js Runtime (API routes, server components)
 *
 * No npm dependencies required.
 */

// ─── Hex helpers ──────────────────────────────────────────────────────────────

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuf(hex: string): ArrayBuffer {
  const len = hex.length / 2;
  const ab = new ArrayBuffer(len);
  const view = new Uint8Array(ab);
  for (let i = 0; i < len; i++) {
    view[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return ab;
}

// ─── Constant-time comparison ─────────────────────────────────────────────────

/**
 * Compare two strings in constant time to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─── SHA-256 ──────────────────────────────────────────────────────────────────

/**
 * Returns the hex-encoded SHA-256 hash of the input string.
 * Fast, works in edge runtime.
 */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return bufToHex(buf);
}

// ─── Token generation / verification (for admin_auth cookie) ─────────────────

/**
 * Generate a DB-user auth token.
 * Format: sha256Hex(userId + ':' + role + ':' + secret)
 */
export async function generateToken(userId: string, role: string, secret: string): Promise<string> {
  return sha256Hex(`${userId}:${role}:${secret}`);
}

/**
 * Verify a DB-user auth token in constant time.
 */
export async function verifyToken(
  userId: string,
  role: string,
  provided: string,
  secret: string
): Promise<boolean> {
  const expected = await generateToken(userId, role, secret);
  return timingSafeEqual(provided, expected);
}

/**
 * Build the full cookie value for a DB user:
 *   db:{userId}:{role}:{hmac}
 */
export async function buildDbCookie(userId: string, role: string, secret: string): Promise<string> {
  const hmac = await generateToken(userId, role, secret);
  return `db:${userId}:${role}:${hmac}`;
}

/**
 * Parse and verify a DB cookie string.
 * Returns { userId, role } or null if invalid.
 */
export async function parseDbCookie(
  cookie: string,
  secret: string
): Promise<{ userId: string; role: string } | null> {
  if (!cookie.startsWith('db:')) return null;
  const parts = cookie.split(':');
  if (parts.length !== 4) return null;
  const [, userId, role, hmac] = parts;
  if (!userId || !role || !hmac) return null;
  if (!['OWNER', 'ANALYST'].includes(role)) return null;
  const valid = await verifyToken(userId, role, hmac, secret);
  if (!valid) return null;
  return { userId, role };
}

// ─── Password hashing (PBKDF2) ────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = 'SHA-256';
const SALT_BYTES = 16;

/**
 * Hash a password using PBKDF2.
 * Returns a string in the format: "pbkdf2:{saltHex}:{hashHex}"
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const saltHex = bufToHex(salt.buffer);

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    keyMaterial,
    256
  );
  const hashHex = bufToHex(bits);
  return `pbkdf2:${saltHex}:${hashHex}`;
}

/**
 * Verify a password against a stored PBKDF2 hash.
 * Constant-time comparison prevents timing attacks.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const [, saltHex, expectedHex] = parts;
  const salt = hexToBuf(saltHex);

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    keyMaterial,
    256
  );
  const actualHex = bufToHex(bits);
  return timingSafeEqual(actualHex, expectedHex);
}
