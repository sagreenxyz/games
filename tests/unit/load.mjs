/**
 * Load browser scripts from public/ into an isolated vm context so the pure
 * game logic can be unit-tested in Node without a browser.
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

export function loadScripts(...files) {
  const ctx = {
    console, structuredClone, crypto, URLSearchParams,
    location: { search: '', pathname: '/', origin: 'http://localhost' },
    document: { readyState: 'complete', getElementById: () => null, addEventListener() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(readFileSync(join(publicDir, f), 'utf8'), ctx, { filename: f });
  return ctx;
}

/** Seeded PRNG (mulberry32) for reproducible shuffles in tests. */
export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
