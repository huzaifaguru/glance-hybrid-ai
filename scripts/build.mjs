// Builds the Chrome extension (dist/extension) and the web demo (dist/web) with esbuild.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!existsSync('glance.config.js')) {
  console.error('Missing glance.config.js. Copy glance.config.example.js to glance.config.js and fill in your Firebase web config.');
  process.exit(1);
}

const watch = process.argv.includes('--watch');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/extension/icons', { recursive: true });
mkdirSync('dist/web', { recursive: true });

const common = { bundle: true, minify: !watch, sourcemap: watch ? 'inline' : false, target: 'chrome139', logLevel: 'info' };

// The App Check debug token must never ship in the public web demo (anyone could read it).
// The web build gets a copy of the config without it, unless you pass --dev-web for localhost testing.
const devWeb = process.argv.includes('--dev-web');
const { default: cfg } = await import(pathToFileURL(resolve('glance.config.js')).href);
const webCfgPath = resolve('dist/.web-config.js');
mkdirSync('dist', { recursive: true });
writeFileSync(webCfgPath, `export default ${JSON.stringify({ ...cfg, appCheckDebugToken: devWeb ? cfg.appCheckDebugToken : '' }, null, 2)};\n`);
const webConfigPlugin = {
  name: 'web-config',
  setup(b) { b.onResolve({ filter: /glance\.config\.js$/ }, () => ({ path: webCfgPath })); },
};

await Promise.all([
  build({ ...common, entryPoints: ['extension/content.js'], outfile: 'dist/extension/content.js', format: 'iife' }),
  build({ ...common, entryPoints: ['extension/background.js'], outfile: 'dist/extension/background.js', format: 'esm' }),
  build({ ...common, entryPoints: ['extension/sidepanel.js'], outfile: 'dist/extension/sidepanel.js', format: 'esm' }),
  build({ ...common, entryPoints: ['web/app.js'], outfile: 'dist/web/app.js', format: 'esm', plugins: [webConfigPlugin] }),
]);
rmSync(webCfgPath, { force: true });

cpSync('extension/manifest.json', 'dist/extension/manifest.json');
cpSync('extension/sidepanel.html', 'dist/extension/sidepanel.html');
cpSync('src/ui/ui.css', 'dist/extension/ui.css');
cpSync('web/index.html', 'dist/web/index.html');
cpSync('web/web.css', 'dist/web/web.css');
cpSync('src/ui/ui.css', 'dist/web/ui.css');

for (const size of [16, 48, 128]) writeFileSync(`dist/extension/icons/${size}.png`, iconPng(size));
console.log('Built dist/extension (load unpacked in chrome://extensions) and dist/web (firebase deploy).');

// A small "eye" icon (blue ring with a dark pupil) drawn as a PNG, so no image assets are needed.
function iconPng(n) {
  const px = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) {
    px[y * (n * 4 + 1)] = 0;
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5 - n / 2) / (n / 2); const dy = (y + 0.5 - n / 2) / (n / 2);
      const r = Math.hypot(dx, dy);
      let c = [0, 0, 0, 0];
      if (r < 0.95) c = [26, 86, 219, 255];
      if (r < 0.62) c = [255, 255, 255, 255];
      if (r < 0.34) c = [20, 22, 26, 255];
      px.set(c, y * (n * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(px)), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c;
}
