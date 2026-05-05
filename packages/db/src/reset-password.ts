import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from './client';
import { users } from './schema/identity';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Usage:
//   pnpm reset-password
//     → interactive: prompts for email, then either uses generated random password
//       or asks for one
//
//   pnpm reset-password -- --email=you@example.com --random
//     → generates random 20-char password, prints to stdout + writes to ~/Documents/budget-app-temp-credentials.txt
//
//   pnpm reset-password -- --email=you@example.com --password='newPa$$word'
//     → uses the supplied password
//
// Use case: you forgot your password and need to recover. Run from terminal —
// no email required. Fully under your control because you own the server.

interface Args {
  email?: string;
  password?: string;
  random?: boolean;
}

function parseArgs(): Args {
  const out: Args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--email=')) out.email = arg.slice('--email='.length);
    else if (arg.startsWith('--password=')) out.password = arg.slice('--password='.length);
    else if (arg === '--random') out.random = true;
  }
  return out;
}

async function prompt(label: string, mask = false): Promise<string> {
  const rl = readline.createInterface({ input, output, terminal: true });
  if (!mask) {
    const v = await rl.question(label);
    rl.close();
    return v.trim();
  }
  process.stdout.write(label);
  return new Promise((resolve) => {
    let value = '';
    const onData = (chunk: Buffer) => {
      const ch = chunk.toString('utf8');
      if (ch === '\r' || ch === '\n') {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        rl.close();
        resolve(value);
      } else if (ch === '') {
        process.exit(130);
      } else if (ch === '' || ch === '\b') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        value += ch;
        process.stdout.write('*');
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

function generatePassword(): string {
  // 20-char hex from 10 random bytes — easy to type, no special chars
  return randomBytes(10).toString('hex');
}

async function main() {
  const args = parseArgs();

  const email = args.email ?? (await prompt('Email of user to reset: '));
  if (!email || !email.includes('@')) {
    throw new Error('Invalid email');
  }

  let password: string;
  let isGenerated = false;
  if (args.password) {
    password = args.password;
  } else if (args.random) {
    password = generatePassword();
    isGenerated = true;
  } else {
    const useRandom = (await prompt('Generate a random password? [Y/n]: ')).toLowerCase();
    if (useRandom === '' || useRandom === 'y' || useRandom === 'yes') {
      password = generatePassword();
      isGenerated = true;
    } else {
      password = await prompt('New password (8+ characters): ', true);
      const confirm = await prompt('Confirm password: ', true);
      if (password !== confirm) throw new Error('Passwords do not match');
    }
  }
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const db = getDb();
  const newHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const result = await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.email, email.toLowerCase()))
    .returning({ id: users.id });

  if (result.length === 0) {
    console.error(`✗ User ${email} not found.`);
    await closeDb();
    process.exit(1);
  }

  console.log(`\n✓ Password reset for ${email}.`);

  if (isGenerated) {
    const credsFile = join(homedir(), 'Documents', 'budget-app-temp-credentials.txt');
    const content = `==========================================================
 Family Budget App — TEMPORARY credentials (RESET)
 Updated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}
==========================================================

  Email:     ${email}
  Password:  ${password}

==========================================================
 Sign in once, then change password at /settings/password.
 Delete this file after.
==========================================================
`;
    writeFileSync(credsFile, content, 'utf8');
    console.log(`\n  Generated password: ${password}`);
    console.log(`  Saved to: ${credsFile}`);
    console.log('\n  ⚠ Delete that file after signing in.');
  }

  await closeDb();
}

main().catch((err) => {
  console.error('reset-password failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
