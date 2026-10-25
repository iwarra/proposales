type Env = Record<string, string | undefined>;

/** Reads a required variable, failing with a message that names it. Never includes the value. */
export function requireEnv(name: string, options: { https?: boolean } = {}, env: Env = process.env): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}.`);
  if (options.https && !value.startsWith("https://")) throw new Error(`${name} must start with https://`);
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
