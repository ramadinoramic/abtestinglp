/**
 * URL Token Resolver
 *
 * Replaces {token} placeholders in offer URLs at click time.
 * Works identically to Voluum / Binom token system.
 *
 * Usage:
 *   import { resolveTokens } from '@/lib/tokens';
 *   const url = resolveTokens(campaign.offerUrl, { clickId, country, device, ... });
 */

export interface TokenContext {
  clickId: string;
  country?: string;
  device?: string;       // MOBILE | DESKTOP | TABLET
  browser?: string;
  os?: string;
  ip?: string;
  referrer?: string;
  language?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  vibe?: string;
  cost?: string;        // per-click cost from traffic source (?cost=0.05)
  externalId?: string;  // traffic source click ID (?externalid=FB_CID_123)
  customParams?: Record<string, string>;
}

export function resolveTokens(template: string, ctx: TokenContext): string {
  if (!template) return template;

  const cachebuster = Math.random().toString(36).slice(2, 10);

  return template
    // Core tracking
    .replace(/{clickid}/gi, encodeURIComponent(ctx.clickId))
    .replace(/{cachebuster}/gi, cachebuster)

    // Geo / device
    .replace(/{country}/gi, ctx.country || '')
    .replace(/{device}/gi, (ctx.device || '').toLowerCase())
    .replace(/{browser}/gi, (ctx.browser || '').toLowerCase())
    .replace(/{os}/gi, (ctx.os || '').toLowerCase())
    .replace(/{ip}/gi, ctx.ip || '')
    .replace(/{language}/gi, ctx.language || '')

    // Referrer (URL-encoded)
    .replace(/{referrer}/gi, encodeURIComponent(ctx.referrer || ''))
    .replace(/{referrerdomain}/gi, (() => {
      try { return new URL(ctx.referrer || '').hostname; } catch { return ''; }
    })())

    // UTM params
    .replace(/{utm_source}/gi, encodeURIComponent(ctx.utmSource || ''))
    .replace(/{utm_medium}/gi, encodeURIComponent(ctx.utmMedium || ''))
    .replace(/{utm_campaign}/gi, encodeURIComponent(ctx.utmCampaign || ''))
    .replace(/{utm_content}/gi, encodeURIComponent(ctx.utmContent || ''))
    .replace(/{utm_term}/gi, encodeURIComponent(ctx.utmTerm || ''))

    // Ad creative
    .replace(/{vibe}/gi, encodeURIComponent(ctx.vibe || ''))

    // Traffic source cost + external click ID
    .replace(/{cost}/gi, ctx.cost || '')
    .replace(/{externalid}/gi, encodeURIComponent(ctx.externalId || ''))

    // Named custom vars: {var1}–{var10}
    .replace(/{var(\d+)}/gi, (_, n) =>
      encodeURIComponent(ctx.customParams?.[`var${n}`] || '')
    )

    // Named vars with arbitrary name: {var:myname}
    .replace(/{var:([^}]+)}/gi, (_, name) =>
      encodeURIComponent(ctx.customParams?.[name] || '')
    );
}
