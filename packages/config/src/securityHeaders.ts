/**
 * Security headers configuration for Sonolect web + API.
 *
 * Exports a Fastify-compatible plugin config object and individual header maps
 * so they can be consumed by any HTTP server layer (Fastify, Express, static
 * hosting, Tauri dev-server, etc.).
 */

/* ── Types ─────────────────────────────────────────────────────────── */

export interface CspDirectives {
  "default-src": string[];
  "script-src": string[];
  "style-src": string[];
  "img-src": string[];
  "font-src": string[];
  "connect-src": string[];
  "media-src": string[];
  "object-src": string[];
  "frame-ancestors": string[];
  "base-uri": string[];
  "form-action": string[];
  "upgrade-insecure-requests"?: true;
}

export interface SecurityHeadersOptions {
  /** Additional domains allowed in connect-src (e.g. API origins). */
  extraConnectSrc?: string[];
  /** Additional domains allowed in script-src (e.g. analytics). */
  extraScriptSrc?: string[];
  /** Additional domains allowed in img-src. */
  extraImgSrc?: string[];
  /** Set to false in dev to disable upgrade-insecure-requests. */
  upgradeInsecureRequests?: boolean;
  /** HSTS max-age in seconds. Default 63072000 (2 years). */
  hstsMaxAge?: number;
  /** Include HSTS subDomains directive. Default true. */
  hstsIncludeSubDomains?: boolean;
  /** Include HSTS preload directive. Default true. */
  hstsPreload?: boolean;
}

/* ── CSP builder ───────────────────────────────────────────────────── */

export function buildCspDirectives(
  options: SecurityHeadersOptions = {},
): CspDirectives {
  const {
    extraConnectSrc = [],
    extraScriptSrc = [],
    extraImgSrc = [],
    upgradeInsecureRequests = true,
  } = options;

  const directives: CspDirectives = {
    "default-src": ["'self'"],
    "script-src": ["'self'", ...extraScriptSrc],
    "style-src": ["'self'", "'unsafe-inline'"], // Inline styles needed for many UI libs
    "img-src": ["'self'", "data:", "blob:", ...extraImgSrc],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      "https://*.googleapis.com",
      "https://*.firebaseio.com",
      "wss://*.firebaseio.com",
      "https://*.cloudfunctions.net",
      ...extraConnectSrc,
    ],
    "media-src": ["'self'", "blob:", "data:"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };

  if (upgradeInsecureRequests) {
    directives["upgrade-insecure-requests"] = true;
  }

  return directives;
}

/** Serialise CspDirectives into a single header value string. */
export function serializeCsp(directives: CspDirectives): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(directives)) {
    if (value === true) {
      parts.push(key);
    } else if (Array.isArray(value)) {
      parts.push(`${key} ${value.join(" ")}`);
    }
  }
  return parts.join("; ");
}

/* ── Header map ────────────────────────────────────────────────────── */

export function buildSecurityHeaders(
  options: SecurityHeadersOptions = {},
): Record<string, string> {
  const {
    hstsMaxAge = 63_072_000,
    hstsIncludeSubDomains = true,
    hstsPreload = true,
  } = options;

  const hstsParts = [`max-age=${hstsMaxAge}`];
  if (hstsIncludeSubDomains) hstsParts.push("includeSubDomains");
  if (hstsPreload) hstsParts.push("preload");

  return {
    "Content-Security-Policy": serializeCsp(buildCspDirectives(options)),
    "Strict-Transport-Security": hstsParts.join("; "),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-XSS-Protection": "0", // Disabled; CSP is the modern replacement
    "Permissions-Policy":
      "camera=(), microphone=(self), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  };
}

/* ── Fastify plugin config ─────────────────────────────────────────── */

/**
 * Returns an options object suitable for `@fastify/helmet` or can be spread
 * into a custom Fastify `onSend` hook.
 *
 * Usage with @fastify/helmet:
 * ```ts
 * import helmet from "@fastify/helmet";
 * import { fastifySecurityConfig } from "@sonolect/config/securityHeaders";
 * app.register(helmet, fastifySecurityConfig());
 * ```
 */
export function fastifySecurityConfig(options: SecurityHeadersOptions = {}) {
  const csp = buildCspDirectives(options);

  return {
    contentSecurityPolicy: {
      directives: {
        ...csp,
        // Helmet expects string values rather than arrays for some directives
      },
    },
    hsts: {
      maxAge: options.hstsMaxAge ?? 63_072_000,
      includeSubDomains: options.hstsIncludeSubDomains ?? true,
      preload: options.hstsPreload ?? true,
    },
    frameguard: { action: "deny" as const },
    noSniff: true,
    referrerPolicy: {
      policy: "strict-origin-when-cross-origin" as const,
    },
    xssFilter: false, // CSP replaces X-XSS-Protection
    permissionsPolicy: {
      features: {
        camera: [],
        microphone: ["self"],
        geolocation: [],
        payment: [],
      },
    },
    crossOriginOpenerPolicy: { policy: "same-origin" as const },
    crossOriginEmbedderPolicy: { policy: "require-corp" as const },
  };
}
