// Copie le worker de MapLibre GL dans public/ pour qu'il soit servi tel quel.
//
// MapLibre GL 6 charge son worker via `new URL('./maplibre-gl-worker.mjs', import.meta.url)`.
// Sous Turbopack, `import.meta.url` du chunk ne pointe pas vers un dossier qui contient ce
// fichier : le worker ne démarre pas (« Worker failed to load ») et le fond de carte reste vide.
// Le composant appelle donc `setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')`, et ce script,
// lancé avant `next dev` et `next build`, dépose le worker et le module partagé qu'il importe.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const distDir = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const targetDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'maplibre');

mkdirSync(targetDir, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(distDir, file), join(targetDir, file));
}
