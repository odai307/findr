import { loadConfig } from '../shared/config.js';
import { openDatabase } from './client.js';

/** Applies pending SQL migrations from ./migrations. Run as a release step before new code starts. */
const config = loadConfig();
const database = await openDatabase(config.DATABASE_URL);
await database.migrate();
await database.close();
console.log('Migrations applied.');
