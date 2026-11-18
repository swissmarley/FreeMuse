import { createDb } from './pool.js';
import { migrate } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createDb(url, 1);
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
await db.close();
