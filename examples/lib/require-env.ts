// examples/lib/require-env.ts
//
// Shared env-validation helpers for examples/. `requireEnv` asserts every key
// is set to a non-empty string and returns a typed record. `optionalEnv`
// returns the env value if non-empty, else the supplied fallback.

export function requireEnv<const T extends readonly string[]>(keys: T): Record<T[number], string> {
  const missing: string[] = [];
  const out: Record<string, string> = {};
  for (const key of keys) {
    const v = process.env[key];
    if (!v) missing.push(key);
    else out[key] = v;
  }
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}. See .env.example.`);
    process.exit(1);
  }
  return out as Record<T[number], string>;
}

export function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}
