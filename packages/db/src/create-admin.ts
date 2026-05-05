import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from './client';
import { households, users } from './schema/identity';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// Usage:
//   pnpm create-admin
//   (interactive — asks for email + password + display name)
//
//   pnpm create-admin -- --email=you@example.com --password='pa$$' --name='Your Name'
//   (non-interactive — useful in scripts)

interface Args {
  email?: string;
  password?: string;
  name?: string;
}

function parseArgs(): Args {
  const out: Args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--email=')) out.email = arg.slice('--email='.length);
    else if (arg.startsWith('--password=')) out.password = arg.slice('--password='.length);
    else if (arg.startsWith('--name=')) out.name = arg.slice('--name='.length);
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
  // crude masking: rewrite the line as user types
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
        // Ctrl-C
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

async function main() {
  const args = parseArgs();

  const email = args.email ?? (await prompt('Email: '));
  if (!email || !email.includes('@')) {
    throw new Error('Invalid email');
  }
  const password = args.password ?? (await prompt('Password: ', true));
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const name = args.name ?? (await prompt('Display name: '));

  const db = getDb();
  const [household] = await db.select().from(households).limit(1);
  if (!household) {
    throw new Error('No household exists. Run `pnpm db:seed` first.');
  }

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  if (existing.length > 0) {
    console.error(`User ${email} already exists. Aborting.`);
    process.exit(1);
  }

  console.log('Hashing password (argon2id)…');
  const passwordHash = await hash(password, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  await db.insert(users).values({
    householdId: household.id,
    email: email.toLowerCase(),
    passwordHash,
    role: 'admin',
    displayName: name || null,
    locale: 'he',
  });

  console.log(`✓ Admin created: ${email} (household: ${household.id})`);
  console.log('You can now sign in at http://localhost:3000/sign-in');
  console.log('TOTP 2FA can be enabled later from the settings page.');

  await closeDb();
}

main().catch((err) => {
  console.error('create-admin failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
