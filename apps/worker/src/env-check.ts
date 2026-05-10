/**
 * Sanity check the .env file at worker startup.
 *
 * Catches the most common breakages we've seen:
 *
 *   1. UTF-8 BOM at the start of the file. Notepad on Windows adds this
 *      by default. Node's --env-file parser USUALLY handles BOM correctly,
 *      but the comment line containing the em-dash (see #2) interacts badly
 *      with the BOM in ways we've debugged the hard way. Either way, BOM
 *      is unwanted in a .env file.
 *
 *   2. Em-dash / en-dash characters anywhere. Notepad sometimes auto-
 *      "smartens" hyphens in comments to em-dashes (`—`), and that has
 *      tripped Node's env parser into eating the next variable as part of
 *      the previous comment. Replace with regular hyphens.
 *
 * If we detect either, we log a loud warning so the user knows what to do
 * — but we don't auto-fix at runtime (file mutation from the worker would
 * be surprising). We point them at a manual fix command.
 *
 * This runs once at startup, after config has loaded so we can show in the
 * normal log stream rather than crashing before logging is set up.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface EnvIssue {
  file:     string;
  problem:  string;
  fixHint:  string;
}

/** Inspects all known .env locations and emits warnings to the logger. */
export function checkEnvFiles(logger: FastifyBaseLogger): void {
  const candidates = [
    // Worker's own .env (the one tsx --env-file-if-exists actually loads).
    path.resolve(__dirname, '..', '.env'),
    // Project-root .env (web app may also read this).
    path.resolve(__dirname, '..', '..', '..', '.env'),
    // Web app's .env (used by Next.js).
    path.resolve(__dirname, '..', '..', 'web', '.env'),
  ];

  const issues: EnvIssue[] = [];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    let buf: Buffer;
    try {
      buf = readFileSync(file);
    } catch {
      continue;
    }

    // BOM check
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      issues.push({
        file,
        problem: 'UTF-8 BOM at file start (Notepad default)',
        fixHint: 'Re-save with VS Code/Notepad++, or in Notepad change Encoding to "UTF-8" (without BOM)',
      });
    }

    // Em-dash / en-dash check
    const text = buf.toString('utf8');
    if (text.includes('—') || text.includes('–')) {
      issues.push({
        file,
        problem: 'Contains em-dash (—) or en-dash (–) — usually from Notepad auto-correcting hyphens',
        fixHint: 'Open in VS Code/Notepad++ and Find/Replace — and – with regular -',
      });
    }
  }

  if (issues.length === 0) {
    logger.debug('env-check: all .env files clean');
    return;
  }

  for (const i of issues) {
    logger.warn(
      { file: i.file, problem: i.problem, fix: i.fixHint },
      '⚠️  .env file has a problem that may break env-var parsing',
    );
  }
}
