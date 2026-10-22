import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';

// Optional local secrets: LUMA-studio/.env (see .env.example). Hosting platforms such as
// Vercel provide the same variables through their environment settings.
try { process.loadEnvFile('.env'); } catch { /* no .env: fall back to process.env */ }

// Supabase settings are baked into the bundle. The anon key is a public key; data is
// protected by Row Level Security (see docs/supabase.md).
const define = {
  'globalThis.LUMA_SUPABASE_URL': JSON.stringify(process.env.LUMA_SUPABASE_URL || ''),
  'globalThis.LUMA_SUPABASE_ANON_KEY': JSON.stringify(process.env.LUMA_SUPABASE_ANON_KEY || ''),
};

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, sourcemap: false, format: 'esm', target: ['es2022'], outfile: 'dist/app.js', legalComments: 'linked', define });
await Promise.all(['index.html', 'style.css'].map(f => copyFile(`src/${f}`, `dist/${f}`)));
await cp('assets', 'dist/assets', { recursive: true });
await cp('node_modules/three/examples/jsm/libs/draco', 'dist/draco', { recursive: true });
console.log(`LUMA studio built.${process.env.LUMA_SUPABASE_URL ? ' Supabase: ' + process.env.LUMA_SUPABASE_URL : ' (Supabase not configured)'}`);
