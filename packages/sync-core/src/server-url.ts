/**
 * The sync server URL is fixed at build time (desktop SONOLECT_SYNC_URL,
 * mobile EXPO_PUBLIC_SONOLECT_SYNC_URL). Without one, sync stays invisible.
 * Release builds accept only https; development builds may also use plain
 * http to this machine (127.0.0.1, localhost) or, from the Android emulator,
 * to its host (10.0.2.2).
 */
export const LOCAL_HTTP_HOSTS = ["127.0.0.1", "localhost", "10.0.2.2"] as const;

export type SyncServerUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: "missing" | "invalid" | "insecure" };

// scheme://host[:port][/path], no user info, query or fragment.
const URL_SHAPE =
  /^(https?):\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::(\d{1,5}))?(\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/i;

/**
 * Checks a configured sync server URL and returns it without a trailing
 * slash. `allowLocalHttp`: a development build.
 */
export function checkSyncServerUrl(
  raw: string | undefined | null,
  options: { allowLocalHttp: boolean },
): SyncServerUrlResult {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, reason: "missing" };
  const match = URL_SHAPE.exec(value);
  if (!match) return { ok: false, reason: "invalid" };
  const scheme = match[1]!.toLowerCase();
  const host = match[2]!.toLowerCase();
  const port = match[3];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65_535))
    return { ok: false, reason: "invalid" };
  if (host.startsWith(".") || host.endsWith(".") || host.includes(".."))
    return { ok: false, reason: "invalid" };
  if (scheme === "http") {
    const local = (LOCAL_HTTP_HOSTS as readonly string[]).includes(host);
    if (!options.allowLocalHttp || !local)
      return { ok: false, reason: "insecure" };
  }
  const path = (match[4] ?? "").replace(/\/+$/, "");
  return {
    ok: true,
    url: `${scheme}://${host}${port !== undefined ? `:${port}` : ""}${path}`,
  };
}
