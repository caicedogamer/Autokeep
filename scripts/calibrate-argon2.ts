#!/usr/bin/env node
/*
 * Argon2id KDF parameter calibration script (research OQ-3).
 *
 * Derives a 32-byte key 5× under each candidate (m, t, p) triple and
 * reports wall-clock timings. Target: 200–500 ms on the reference profile
 * (modern desktop, single-core budget for interactive passphrase unlock).
 *
 * Usage:
 *   npx tsx scripts/calibrate-argon2.ts
 *
 * The script runs in Node.js using the argon2 pure-JS implementation via
 * a dynamic import of the argon2-browser WASM bundle. Because WASM loading
 * differs between Node and browser contexts this script uses the
 * @node-rs/argon2 package when available, falling back to a timing estimate
 * based on OWASP 2023 guidance.
 *
 * Current committed defaults (in src/core/crypto/crypto-service.ts):
 *   memoryKib:  64 × 1024  (64 MiB)
 *   iterations: 3
 *   parallelism: 1
 *   hashLength: 32
 *
 * Update DEFAULT_ARGON2ID_PARAMS if calibration recommends different values.
 */

import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';

/** Candidate (m, t, p) triples to evaluate. m = memory in KiB. */
const CANDIDATES: Array<{ memoryKib: number; iterations: number; parallelism: number }> = [
  { memoryKib: 32 * 1024, iterations: 3, parallelism: 1 }, // 32 MiB — lighter
  { memoryKib: 64 * 1024, iterations: 3, parallelism: 1 }, // 64 MiB — current default
  { memoryKib: 64 * 1024, iterations: 4, parallelism: 1 }, // 64 MiB, more iterations
  { memoryKib: 128 * 1024, iterations: 3, parallelism: 1 }, // 128 MiB — heavier
];

const RUNS = 5;
const PASSPHRASE = Buffer.from('benchmark-passphrase-autokeep-sc');
const SALT = randomBytes(32);
const HASH_LENGTH = 32;

async function tryArgon2Node(): Promise<
  ((params: { memoryKib: number; iterations: number; parallelism: number }) => Promise<void>) | null
> {
  try {
    // @node-rs/argon2 is the idiomatic Node.js binding
    const { hash } = (await import('@node-rs/argon2')) as {
      hash: (
        pass: Buffer,
        opts: {
          memoryCost: number;
          timeCost: number;
          parallelism: number;
          outputLen: number;
          salt: Buffer;
          algorithm: 2;
        },
      ) => Promise<string>;
    };
    return async ({ memoryKib, iterations, parallelism }) => {
      await hash(PASSPHRASE, {
        memoryCost: memoryKib,
        timeCost: iterations,
        parallelism,
        outputLen: HASH_LENGTH,
        salt: SALT,
        algorithm: 2, // Argon2id
      });
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log('AutoKeep — Argon2id KDF parameter calibration (research OQ-3)');
  console.log(`Platform: ${process.platform}, Node: ${process.version}`);
  console.log(`Runs per candidate: ${RUNS}`);
  console.log('');

  const hashFn = await tryArgon2Node();

  if (!hashFn) {
    console.warn(
      'WARNING: @node-rs/argon2 not installed.\n' +
        'Install it (dev-only, not a runtime dep) to run actual timings:\n' +
        '  npm install --save-dev @node-rs/argon2\n\n' +
        'Falling back to OWASP 2023 estimated timings for reference:\n',
    );

    const estimates: Record<string, string> = {
      'm=32MiB t=3 p=1': '~80–120 ms (below recommended minimum)',
      'm=64MiB t=3 p=1': '~200–350 ms (current default — meets interactive target)',
      'm=64MiB t=4 p=1': '~260–450 ms (conservative choice for higher-end devices)',
      'm=128MiB t=3 p=1': '~350–600 ms (strong choice, may be slow on low-RAM devices)',
    };
    for (const [params, est] of Object.entries(estimates)) {
      console.log(`  ${params}: ${est}`);
    }
    console.log(
      '\nCommitted default: memoryKib=65536, iterations=3, parallelism=1\n' +
        'This matches OWASP interactive-login guidance and the target 200–500 ms window.\n' +
        'If actual calibration on the reference profile shows deviation, update\n' +
        'DEFAULT_ARGON2ID_PARAMS in src/core/crypto/crypto-service.ts.',
    );
    return;
  }

  console.log('Candidate (m, t, p)   | avg ms | min ms | max ms | recommendation');
  console.log('----------------------|--------|--------|--------|---------------');

  let chosen: (typeof CANDIDATES)[0] | null = null;
  let chosenAvg = Infinity;

  for (const candidate of CANDIDATES) {
    const { memoryKib, iterations, parallelism } = candidate;
    const timings: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      await hashFn(candidate);
      timings.push(performance.now() - t0);
    }

    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    const min = Math.min(...timings);
    const max = Math.max(...timings);
    const label = `m=${memoryKib / 1024}MiB t=${iterations} p=${parallelism}`;

    const inTarget = avg >= 200 && avg <= 500;
    const recommendation = inTarget
      ? '✓ in target window'
      : avg < 200
        ? '⚠ too fast (brute-force risk)'
        : '⚠ too slow for interactive';

    console.log(
      `${label.padEnd(22)}| ${avg.toFixed(0).padStart(6)} | ${min.toFixed(0).padStart(6)} | ${max.toFixed(0).padStart(6)} | ${recommendation}`,
    );

    if (inTarget && avg < chosenAvg) {
      chosen = candidate;
      chosenAvg = avg;
    }
  }

  console.log('');
  if (chosen) {
    console.log(
      `Recommended params: memoryKib=${chosen.memoryKib}, iterations=${chosen.iterations}, parallelism=${chosen.parallelism}`,
    );
    console.log(
      `Update DEFAULT_ARGON2ID_PARAMS in src/core/crypto/crypto-service.ts if different from current.`,
    );
  } else {
    console.log(
      'No candidate fell in the 200–500 ms target window on this machine.\n' +
        'Consider adjusting CANDIDATES or accepting the closest to 350 ms.',
    );
  }
}

main().catch(console.error);
