# AB Testing Platform — Feature Overview

A Next.js 16 affiliate marketing tracker built on Supabase.
All admin routes are protected by `proxy.ts` (Next.js 16 convention for edge middleware).

---

## Core Tracking

| Feature | File |
|---------|------|
| Click tracking endpoint | `app/api/track/route.ts` |
| Short-code redirect | `app/go/[code]/route.ts` |
| CTA click + offer redirect | `app/api/click/route.ts` |
| Conversion postback | `app/api/postback/route.ts` |
| Landing page (dynamic) | `app/lp/page.tsx` |
| Static landing pages | `public/landing-pages/<name>/index.html` |

**How tracking works:**
`/api/track?campaign=<slug>` → selects variant → logs click → redirects to
- `/landing-pages/<slug>/index.html` for custom/static landers (`theme.type === 'custom'`)
- `/lp?v=<slug>` for built-in dynamic landers (sports / casino themes)

---

## Traffic Splitting

| Feature | Detail |
|---------|--------|
| Static A/B split | Weighted random — `trafficWeight` per variant |
| Multi-Armed Bandit | Thompson Sampling — `optimizationMode: 'BANDIT'` on Campaign |
| Up to 5 landers | 1–5 variants per campaign |

---

## Variant-Level Targeting (Geo / Device)

Each lander row supports:

| Field | Description |
|-------|-------------|
| `geoTargets` | JSON array of ISO-3166 country codes — blank = all countries |
| `deviceTargets` | JSON array of `MOBILE` / `DESKTOP` / `TABLET` — blank = all |
| `offerUrlOverride` | Per-variant offer URL overriding the campaign-level URL |

Filtering: `filterVariantsByTargeting()` in track route — **safety net** ensures empty result falls back to full list.

---

## Campaign-Level Geo Allow List

- `geoAllowList` — JSON array of allowed country codes (e.g. `["CH","AT","DE"]`)
- Blank = all countries allowed
- Unmatched visitors are redirected to `/geo-blocked`
- Configured from the Create Campaign form as a comma-separated input

SQL migration:
```sql
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "geoAllowList" TEXT DEFAULT '[]';
```

---

## IP Blocklist

| File | Purpose |
|------|---------|
| `app/api/admin/blocklist/route.ts` | GET/POST/DELETE |
| `app/admin/blocklist/page.tsx` | Management UI |

- 5-minute TTL cache per edge instance in `getBlockedIps()`
- Blocked IPs receive HTTP 403, are not logged as clicks
- OWNER role required to add/remove IPs

---

## Multi-Admin RBAC

| Role | Permissions |
|------|------------|
| OWNER | Full access: create/delete campaigns, blocklist, user management |
| ANALYST | Read-only: view campaigns, stats, analytics |

### Auth mechanism (backwards-compatible)

| Cookie format | Used for |
|--------------|---------|
| `ADMIN_AUTH_SECRET` | Env-var super-admin (no DB needed) |
| `db:{userId}:{role}:{hmac}` | DB users (HMAC = SHA-256 of userId:role:secret) |

Files:
- `proxy.ts` — dual-format cookie verification; injects `x-admin-role` + `x-admin-user-id` headers
- `lib/auth.ts` — PBKDF2 password hashing + SHA-256 token helpers (zero npm deps, `crypto.subtle`)
- `app/api/admin/users/route.ts` — CRUD for AdminUser table (OWNER only)
- `app/api/admin/me/route.ts` — returns current role + userId
- `app/admin/users/page.tsx` — user management UI

SQL migration:
```sql
CREATE TABLE IF NOT EXISTS "AdminUser" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "username"     TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "salt"         TEXT NOT NULL DEFAULT '',
  "role"         TEXT NOT NULL DEFAULT 'ANALYST',
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AdminUser_username_key" UNIQUE ("username")
);
```

---

## Auto-Pause on Performance Drop

Campaign-level setting:

| Field | Description |
|-------|-------------|
| `autoPauseEnabled` | Boolean toggle |
| `autoPauseThreshold` | Conv rate % below which to pause |
| `autoPauseWindow` | Look-back window in hours (default 24) |
| `autoPausedAt` | Set when auto-pause fires |

Logic in `app/api/admin/stats/route.ts`:
- Evaluated lazily when stats are fetched
- Triggers if ≥50 non-bot clicks in window AND conv rate < threshold
- Sets `status = PAUSED`, `autoPausedAt = now` (non-blocking)
- Campaign card shows "Auto-paused" amber badge
- OWNER can click "Re-activate" to restore

SQL migration:
```sql
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "autoPauseEnabled" BOOLEAN DEFAULT FALSE;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "autoPauseThreshold" FLOAT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "autoPauseWindow" INTEGER DEFAULT 24;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "autoPausedAt" TIMESTAMPTZ;
```

---

## Analytics

| Page | URL |
|------|-----|
| Per-campaign stats | `/admin` (inline expand) |
| Cross-campaign analytics | `/admin/analytics` |
| Short-link hub | `/admin/links` |

Stats include:
- Overview: clicks, impressions, CTR, conversions, conv rate, payout, ROI, bot clicks
- Per-variant stats with Bayesian significance
- Breakdown by country, device, browser, OS, language
- Daily chart (30-day)
- Funnel chart
- Vibe segments

---

## Token Substitution in Offer URLs

Tokens resolved in `lib/tokens.ts`:

| Token | Value |
|-------|-------|
| `{clickid}` | Nanoid click ID |
| `{country}` | ISO country code from CF header |
| `{device}` | MOBILE / DESKTOP / TABLET |
| `{ip}` | Visitor IP |
| `{browser}`, `{os}` | Detected from User-Agent |
| `{language}` | Primary Accept-Language tag |
| `{utm_source}` … `{utm_term}` | UTM params |
| `{cost}`, `{externalid}` | Traffic source params |

---

## Bot Detection & Rate Limiting

- UA pattern matching against 25+ known bots/crawlers
- In-memory rate limit: 30 req/min per IP (per edge instance)
- Bots are tracked but flagged `isBot: true` and excluded from conversion stats

---

## Shared Libraries

| File | Purpose |
|------|---------|
| `lib/supabase.ts` | `getSupabaseConfig()` + `supabaseHeaders()` helpers |
| `lib/auth.ts` | PBKDF2 hashing, SHA-256 token gen/verify (crypto.subtle) |
| `lib/tokens.ts` | Offer URL token resolution |

---

## Database Schema (Supabase / PostgreSQL)

Models: `Campaign`, `Variant`, `Click`, `Conversion`, `BlockedIp`, `AdminUser`

See `prisma/schema.prisma` for full schema.

### Full SQL migration (run once on fresh Supabase project)

```sql
-- Geo/device routing per variant
ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "geoTargets" TEXT DEFAULT '[]';
ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "deviceTargets" TEXT DEFAULT '[]';
ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "offerUrlOverride" TEXT;

-- IP blocklist
CREATE TABLE IF NOT EXISTS "BlockedIp" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "ip"        TEXT NOT NULL,
  "reason"    TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "BlockedIp_ip_key" UNIQUE ("ip")
);
CREATE INDEX IF NOT EXISTS "BlockedIp_ip_idx" ON "BlockedIp"("ip");

-- Admin users
CREATE TABLE IF NOT EXISTS "AdminUser" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "username"     TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "salt"         TEXT NOT NULL DEFAULT '',
  "role"         TEXT NOT NULL DEFAULT 'ANALYST',
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AdminUser_username_key" UNIQUE ("username")
);

-- Auto-pause
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "autoPauseEnabled" BOOLEAN DEFAULT FALSE;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "autoPauseThreshold" FLOAT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "autoPauseWindow" INTEGER DEFAULT 24;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "autoPausedAt" TIMESTAMPTZ;

-- Geo allow list (campaign-level)
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "geoAllowList" TEXT DEFAULT '[]';
```

---

## File Map

```
app/
  admin/
    page.tsx                  — main dashboard (create, list, stats)
    analytics/page.tsx        — cross-campaign analytics
    blocklist/page.tsx        — IP blocklist management
    links/page.tsx            — short-link / UTM hub
    users/page.tsx            — admin user management (OWNER only)
  api/
    track/route.ts            — main click tracking (edge)
    click/route.ts            — CTA click + offer redirect
    postback/route.ts         — conversion postback
    admin/
      campaigns/route.ts      — campaign CRUD
      stats/route.ts          — stats + auto-pause
      landing-pages/route.ts  — list public/landing-pages folders
      blocklist/route.ts      — IP blocklist CRUD
      users/route.ts          — admin user CRUD
      me/route.ts             — current user role
    auth/
      login/route.ts          — login (env-var + DB users)
      logout/route.ts         — clear cookie
  go/[code]/route.ts          — short-code redirect
  lp/page.tsx                 — dynamic landing page (built-in themes)
  login/page.tsx              — login UI
  geo-blocked/page.tsx        — geo-block landing
lib/
  auth.ts                     — PBKDF2, SHA-256, token helpers
  supabase.ts                 — Supabase config/headers helper
  tokens.ts                   — offer URL token resolution
proxy.ts                      — Next.js 16 edge proxy (auth + header injection)
prisma/schema.prisma          — database schema
public/landing-pages/         — static HTML lander folders
```
