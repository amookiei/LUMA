// CLI entry point: `npm start` (node server/cli.mjs) serves dist/ and the /api persistence layer.
// It deliberately does not live at the project root as server.mjs: hosting platforms such as
// Vercel treat a root server.* file as a serverless function, which cannot hold a SQLite file.
import { createApp } from './index.mjs';
const app = createApp();
const address = await app.listen();
console.log(`LUMA studio: http://${address.address}:${address.port}`);
console.log(app.store ? `Data directory: ${app.store.dataDir}` : '저장소 없음: 갤러리는 브라우저 탭에만 보관됩니다.');
const shutdown = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
