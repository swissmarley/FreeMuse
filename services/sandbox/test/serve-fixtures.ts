import { startFixtures } from './fixtures.js';

const f = await startFixtures(Number(process.env.FIXTURE_PORT ?? 4600));
console.log(`fixtures on ${f.url}`);
