// examples/lib/require-env.ts
//
// Shared env-validation helper for examples/. Asserts every key in `keys` is
// set to a non-empty string and returns a typed record. Prints a clear error
// and exits non-zero if any are missing.

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
