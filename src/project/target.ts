export interface TargetInfo {
  /** The connection string with credentials and query parameters removed */
  display: string;
  /** True when every host is this machine or a private/dev network address */
  local: boolean;
}

const LOCAL_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "::1",
  "host.docker.internal",
]);

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (LOCAL_HOSTS.has(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  // Single-label names such as "mongo" or "db" are container/service names
  return !h.includes(".") && !h.includes(":");
}

/** Describes where a database connection string points, without revealing secrets. */
export function describeTarget(uri: string): TargetInfo {
  if (/^file:/i.test(uri)) return { display: uri, local: true };

  const match = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(uri.trim());
  if (!match) return { display: "(unrecognised connection string)", local: false };

  const scheme = match[1].toLowerCase();
  const rest = match[2];
  const end = rest.search(/[/?;]/);
  let authority = end >= 0 ? rest.slice(0, end) : rest;
  const tail = end >= 0 ? rest.slice(end) : "";
  const at = authority.lastIndexOf("@");
  if (at >= 0) authority = authority.slice(at + 1);
  const dbPath = tail.startsWith("/") ? tail.split(/[?;]/)[0] : "";

  const hosts = authority
    .split(",")
    .map((h) => (h.startsWith("[") ? h.slice(1, h.indexOf("]")) : h.replace(/:\d+$/, "")))
    .filter(Boolean);
  const hosted = scheme.includes("+srv") || scheme.startsWith("prisma");

  return {
    display: `${scheme}://${authority}${dbPath}`,
    local: !hosted && hosts.length > 0 && hosts.every(isLocalHost),
  };
}
