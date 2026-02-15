import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import bcrypt from 'bcryptjs';
import { sql } from '@vercel/postgres';

const password = process.argv[2];
const username = process.argv[3] || 'admin';

if (!password) {
  console.error('Usage: npx tsx scripts/reset-password.ts <new-password> [username]');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

sql`UPDATE users SET password_hash = ${hash} WHERE username = ${username}`
  .then(({ rowCount }) => {
    if (rowCount === 0) {
      console.error(`No user found with username "${username}"`);
      process.exit(1);
    }
    console.log(`Password updated for "${username}"`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  });
