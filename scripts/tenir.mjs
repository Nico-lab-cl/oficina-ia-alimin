/**
 * Crea personajes nuevos a partir de los de Miniverse cambiando el color de
 * la ropa (no la piel ni el pelo). Así los 6 agentes de Alimin se distinguen
 * con solo 4 sprites base. Se corre una vez y los PNG se guardan en el repo:
 *
 *   node scripts/tenir.mjs
 *
 * - morty2: morty con polerón verde (Ali - Mercado).
 * - dexter2: dexter con chaqueta burdeo (Ali - Anuncios).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const DIR = path.resolve('public/universal_assets/citizens');

const VARIANTES = [
  // Polerón rojo de morty → verde. Solo rojos saturados y no muy claros (la piel es más clara y anaranjada).
  // El pelo café anda por los 12–15°, el polerón por los 0–5°: el corte va en 9°.
  { base: 'morty', nombre: 'morty2', desde: [335, 9], minSat: 0.45, maxVal: 0.9, giro: 130 },
  // Chaqueta azul marino de dexter → burdeo.
  { base: 'dexter', nombre: 'dexter2', desde: [195, 255], minSat: 0.2, maxVal: 1, giro: 125 },
];

function aHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max / 255];
}

function aRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const enRango = (h, [a, b]) => (a <= b ? h >= a && h <= b : h >= a || h <= b);

for (const v of VARIANTES) {
  for (const hoja of ['walk', 'actions']) {
    const png = PNG.sync.read(readFileSync(path.join(DIR, `${v.base}_${hoja}.png`)));
    let cambiados = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] === 0) continue;
      const [h, s, val] = aHsv(png.data[i], png.data[i + 1], png.data[i + 2]);
      if (!enRango(h, v.desde) || s < v.minSat || val > v.maxVal) continue;
      const [r, g, b] = aRgb((h + v.giro) % 360, s, val);
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      cambiados++;
    }
    writeFileSync(path.join(DIR, `${v.nombre}_${hoja}.png`), PNG.sync.write(png));
    console.log(`${v.nombre}_${hoja}.png: ${cambiados} píxeles teñidos`);
  }
}
