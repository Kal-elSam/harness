import net from "node:net";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const LOCAL_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export function classifyCustomBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(String(baseUrl));
  } catch {
    throw new Error("Custom provider baseUrl must be an absolute http(s) URL.");
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("Custom provider baseUrl must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Custom provider baseUrl must not contain embedded credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Custom provider baseUrl must not contain a query string or fragment.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) {
    throw new Error("Custom provider baseUrl must include a host.");
  }

  const local = isLocalHostname(hostname);
  if (!local && parsed.protocol !== "https:") {
    throw new Error("Remote custom providers must use https; http is allowed only for local/private endpoints.");
  }

  return {
    url: parsed,
    normalizedBaseUrl: parsed.toString().replace(/\/+$/, ""),
    hostname,
    local,
    credentialSafe: local || parsed.protocol === "https:"
  };
}

export function isValidEnvironmentName(name) {
  return typeof name === "string" && ENV_NAME_PATTERN.test(name);
}

function isLocalHostname(hostname) {
  if (LOCAL_HOSTNAMES.has(hostname)) return true;

  const version = net.isIP(hostname);
  if (version === 4) return isPrivateIpv4(hostname);
  if (version === 6) return isPrivateIpv6(hostname);
  return false;
}

function isPrivateIpv4(hostname) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }

  const [first, second] = octets;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254)
    || first === 127
    || first === 0;
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb");
}
