// Copies avatar images from the repo-root /images folder into
// apps/client/public/avatars/ (so Vite serves them at /avatars/<file>).
// Run from apps/client: `node scripts/gen-avatars.mjs`
//
// After running, register each new file in src/constants/avatars.ts
// (the gallery uses friendly labels, so it stays hand-authored).
import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg']);

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', '..', '..', 'images');       // repo-root /images
const outDir = join(here, '..', 'public', 'avatars');

function slug(name) {
  return name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

await mkdir(outDir, { recursive: true });
const files = (await readdir(srcDir)).filter((f) => IMG_EXT.has(extname(f).toLowerCase()));

for (const file of files) {
  const dest = `${slug(file)}${extname(file).toLowerCase()}`;
  await copyFile(join(srcDir, file), join(outDir, dest));
  console.log(`✓ ${file}  ->  /avatars/${dest}`);
}
console.log(`\nCopied ${files.length} image(s). Register them in src/constants/avatars.ts.`);
