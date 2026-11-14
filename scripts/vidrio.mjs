// Genera la baldosa de pared de vidrio de las oficinas (32x32) a partir del
// mármol del piso: vidrio celeste con marco de acero y reflejos.
// Uso: node scripts/vidrio.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const dir = 'public/worlds/posh-highrise/world_assets/tiles';
const base = PNG.sync.read(readFileSync(`${dir}/white_marble_floor.png`));
const out = new PNG({ width: 32, height: 32 });

const VIDRIO = [150, 205, 222];
const MARCO = [96, 132, 146];
const BRILLO = [236, 248, 252];

const poner = (x, y, [r, g, b], a = 1) => {
  const i = (y * 32 + x) * 4;
  out.data[i] = Math.round(out.data[i] * (1 - a) + r * a);
  out.data[i + 1] = Math.round(out.data[i + 1] * (1 - a) + g * a);
  out.data[i + 2] = Math.round(out.data[i + 2] * (1 - a) + b * a);
  out.data[i + 3] = 255;
};

for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4;
    out.data[i] = base.data[i];
    out.data[i + 1] = base.data[i + 1];
    out.data[i + 2] = base.data[i + 2];
    out.data[i + 3] = 255;
    poner(x, y, VIDRIO, 0.55);
  }
}
// Reflejos diagonales.
for (let k = 0; k < 32; k++) {
  for (const [d, a] of [[6, 0.55], [7, 0.35], [13, 0.4], [21, 0.25]]) {
    const x = k, y = 31 - k + d - 10;
    if (y >= 0 && y < 32) poner(x, y, BRILLO, a);
  }
}
// Marco de acero en los bordes (al juntarse, dos baldosas forman un parante).
for (let k = 0; k < 32; k++) {
  for (const [x, y] of [[k, 0], [k, 31], [0, k], [31, k]]) poner(x, y, MARCO, 0.9);
  for (const [x, y] of [[k, 1], [1, k]]) poner(x, y, BRILLO, 0.35);
}

writeFileSync(`${dir}/glass_wall.png`, PNG.sync.write(out));
console.log('glass_wall.png listo');
