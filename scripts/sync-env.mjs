// Copy root .env to each app's directory so Next.js (which only loads .env from
// its own app directory) and the worker (which loads via tsx --env-file) both
// see the same secrets. The root .env is the single source of truth — edit only
// it; this script keeps the app-level copies in sync.
//
// Runs before `pnpm dev` via the `predev` hook. No-op if destinations are newer.
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, '.env');

if (!existsSync(src)) {
  console.warn(`[sync-env] No root .env at ${src} — skipping`);
  process.exit(0);
}

const targets = [
  join(root, 'apps', 'web', '.env'),
  join(root, 'apps', 'worker', '.env'),
];

const srcMtime = statSync(src).mtimeMs;
let copied = 0;
for (const dst of targets) {
  if (existsSync(dst) && statSync(dst).mtimeMs >= srcMtime) continue;
  copyFileSync(src, dst);
  copied++;
  console.log(`[sync-env] ${src} → ${dst}`);
}
if (copied === 0) {
  // All targets up to date — silent exit
}
