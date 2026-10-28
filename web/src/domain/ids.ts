// Same id rules as the Android app (app/.../data/Ids.kt).

/** Random id in [2^40, 2^53): unique across devices and exact in JavaScript numbers. */
export function newId(): number {
  const lo = 2 ** 40;
  const span = 2 ** 53 - lo;
  const r = crypto.getRandomValues(new Uint32Array(2));
  const f = (r[0] * 2 ** 21 + (r[1] >>> 11)) / 2 ** 53; // 53 random bits in [0, 1)
  return lo + Math.floor(f * span);
}

/** FNV-1a 64-bit over [bytes]. */
function fnv1a64(bytes: Uint8Array): bigint {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

/** Tag id from its name: FNV-1a 64-bit over the trimmed lowercase UTF-8 name, cut to 52 bits, + 1. */
export function tagIdFor(name: string): number {
  return Number(fnv1a64(new TextEncoder().encode(name.trim().toLowerCase())) & ((1n << 52n) - 1n)) + 1;
}

/**
 * The event an old futsal entry becomes (item 240): FNV-1a 64-bit over the entry's UTF-8 id, put in
 * [newId]'s range [2^40, 2^53), so every device converting the same entry makes the same event.
 */
export function futsalItemId(entryId: string): number {
  const lo = 2n ** 40n;
  return Number(lo + (fnv1a64(new TextEncoder().encode(entryId)) % (2n ** 53n - lo)));
}
