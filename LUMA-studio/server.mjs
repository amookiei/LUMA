// Backwards-compatible entry point: `node server.mjs` starts the studio server with the API.
import { createApp } from './server/index.mjs';
const app = createApp();
const address = await app.listen();
console.log(`LUMA studio: http://${address.address}:${address.port}`);
console.log(`Data directory: ${app.store.dataDir}`);
const shutdown = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
