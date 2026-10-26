type Env = Record<string, string | undefined>;

/** A Tailscale host: WireGuard already encrypts the traffic, so plain http is acceptable. */
function isTailscaleHttp(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname.endsWith(".ts.net");
  } catch {
    return false;
  }
}

/**
 * Reads a required variable, failing with a message that names it. Never includes the value.
 * `https: "or-tailscale"` also accepts http:// on a *.ts.net host.
 */
export function requireEnv(name: string, options: { https?: boolean | "or-tailscale" } = {}, env: Env = process.env): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}.`);
  if (options.https === "or-tailscale") {
    if (!value.startsWith("https://") && !isTailscaleHttp(value)) {
      throw new Error(`${name} must start with https:// (http:// is allowed only for Tailscale *.ts.net hosts)`);
    }
  } else if (options.https && !value.startsWith("https://")) {
    throw new Error(`${name} must start with https://`);
  }
  return value;
}

export function requirePositiveInt(name: string, env: Env = process.env): number {
  const value = requireEnv(name, {}, env);
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive whole number.`);
  return Number(value);
}

export function optionalEnv(name: string, fallback: string, env: Env = process.env): string {
  return env[name]?.trim() || fallback;
}
