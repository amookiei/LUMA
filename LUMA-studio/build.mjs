import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({entryPoints:['src/app.js'], bundle:true, minify:true, sourcemap:false, format:'esm', target:['es2022'], outfile:'dist/app.js', legalComments:'linked'});
await Promise.all(['index.html','style.css'].map(f=>copyFile(`src/${f}`,`dist/${f}`)));
await cp('assets','dist/assets',{recursive:true});
await cp('node_modules/three/examples/jsm/libs/draco','dist/draco',{recursive:true});
console.log('LUMA studio built.');
