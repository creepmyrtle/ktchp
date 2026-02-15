import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import { sql } from '@vercel/postgres';

async function main() {
  // Un-default these sources (they were personal, not meant for all users)
  const names = ['One useful thing', 'ZeroHedge', 'Google News'];

  for (const name of names) {
    const { rowCount } = await sql`
      UPDATE sources SET is_default = FALSE
      WHERE LOWER(name) = LOWER(${name}) AND is_default = TRUE
    `;
    if (rowCount && rowCount > 0) {
      console.log(`Unmarked "${name}" as default`);
    } else {
      console.log(`"${name}" not found or already not default`);
    }
  }

  console.log('Done');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
