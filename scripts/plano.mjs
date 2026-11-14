// Genera public/worlds/posh-highrise/world.json: tres oficinas de vidrio,
// sala abierta de investigadores y cafetería. Imprime un mapa de texto para
// revisar bloqueos y anclas.
// Uso: node scripts/plano.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const ruta = 'public/worlds/posh-highrise/world.json';
const viejo = JSON.parse(readFileSync(ruta, 'utf8'));

const W = 26, H = 13;
const MURO = 'polished_concrete_wall', VIDRIO = 'glass_wall', MARMOL = 'white_marble_floor', MADERA = 'dark_wood_floor_accent';
const floor = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => {
  if (y <= 1) return MURO;
  if (x >= 19 && y <= 11) return MADERA; // cafetería
  return MARMOL;
}));

// Oficinas: interior x0..x0+4, filas 2-5. Vidrio en x0+5 (filas 2-6) y en la
// fila 6, con puerta doble en x0+3 y x0+4.
const OFICINAS = [
  { x0: 1, anchor: 'oficina_interaccion' },
  { x0: 7, anchor: 'oficina_calificador' },
  { x0: 13, anchor: 'oficina_cierre' },
];
for (const { x0 } of OFICINAS) {
  for (let y = 2; y <= 6; y++) floor[y][x0 + 5] = VIDRIO;
  for (let x = x0; x <= x0 + 2; x++) floor[6][x] = VIDRIO;
}

const props = [];
/** Escritorio con notebook y silla; la silla va sobre el agente sentado. */
const escritorio = (x, y, anchor, silla) => {
  props.push({ id: 'standing_desk', x, y, w: 3, h: 1.5, layer: 'below', anchors: [{ name: anchor, ox: 1, oy: 1.5, type: 'work' }] });
  props.push({ id: 'a_laptop', x: x + 1, y: y - 0.25, w: 0.8, h: 1, layer: 'below', anchors: [] });
  const ax = Math.round(x + 1), ay = Math.round(y + 1.5);
  props.push({ id: silla, x: ax + 0.125, y: ay - 1.1, w: 0.75, h: 1.25, layer: 'above', anchors: [] });
};

// Ventanales a lo largo de toda la pared de las oficinas.
for (let i = 0; i < 13; i++) props.push({ id: 'panoramic_window', x: 1 + i * 1.3, y: 0, w: 1.3, h: 2, layer: 'below' });

for (const { x0, anchor } of OFICINAS) {
  escritorio(x0 + 1, 2.25, anchor, 'desk_chair_dark');
  props.push({ id: 'fiddle_leaf_fig', x: x0, y: 4.4, w: 1, h: 1, layer: 'below' });
}

// Sala abierta de investigadores.
escritorio(2, 9.25, 'puesto_competencia', 'desk_chair_light');
escritorio(8, 9.25, 'puesto_anuncios', 'desk_chair_light');
escritorio(14, 9.25, 'puesto_mercado', 'desk_chair_light');
props.push(
  { id: 'fiddle_leaf_fig', x: 6, y: 9.6, w: 1, h: 1, layer: 'below' },
  { id: 'fiddle_leaf_fig', x: 12, y: 9.6, w: 1, h: 1, layer: 'below' },
  { id: 'orchid_vase', x: 17.75, y: 10, w: 0.5, h: 0.5, layer: 'below' },
);

// Cafetería.
props.push(
  { id: 'wine_fridge', x: 19, y: 0.75, w: 0.95, h: 1.95, layer: 'below', anchors: [{ name: 'cafe_refrigerador', ox: 0.38, oy: 1.75, type: 'utility' }] },
  { id: 'espresso_machine', x: 20.5, y: 1.5, w: 1.5, h: 1, layer: 'below', anchors: [{ name: 'cafe_cafetera', ox: 0.75, oy: 1, type: 'utility' }] },
  { id: 'zen_fountain_credenza', x: 23, y: 0.5, w: 1.9, h: 2.2, layer: 'below' },
  { id: 'abstract_art', x: 20.6, y: 0.1, w: 2.3, h: 1.3, layer: 'below' },
  { id: 'l_sectional_sofa', x: 20, y: 6, w: 4.5, h: 3, layer: 'below', anchors: [{ name: 'cafe_sofa', ox: 2.25, oy: 3, type: 'social' }] },
  { id: 'glass_coffee_table', x: 20.25, y: 8, w: 2, h: 1.5, layer: 'below', anchors: [{ name: 'cafe_mesa', ox: 1, oy: 1.5, type: 'social' }] },
  { id: 'orchid_vase', x: 21, y: 8.25, w: 0.5, h: 0.5, layer: 'below' },
  { id: 'fiddle_leaf_fig', x: 24, y: 3.6, w: 1, h: 1, layer: 'below' },
  { id: 'dyson_air_purifier', x: 24.25, y: 10.5, w: 0.5, h: 0.5, layer: 'below' },
);

const wanderPoints = [
  { name: 'cafe_barra', x: 22, y: 4 },
  { name: 'cafe_ventana', x: 20, y: 4 },
  { name: 'cafe_rincon', x: 24, y: 11 },
];

const tiles = { ...viejo.tiles, [VIDRIO]: 'world_assets/tiles/glass_wall.png' };
const mundo = { ...viejo, gridCols: W, gridRows: H, floor, props, wanderPoints, tiles };
writeFileSync(ruta, JSON.stringify(mundo, null, 2) + '\n');

const bloq = new Set();
for (const p of props) for (let y = Math.floor(p.y); y < Math.ceil(p.y + p.h); y++) for (let x = Math.floor(p.x); x < Math.ceil(p.x + p.w); x++) bloq.add(`${x},${y}`);
const anclas = new Map();
for (const p of props) for (const a of p.anchors ?? []) anclas.set(`${Math.round(p.x + a.ox)},${Math.round(p.y + a.oy)}`, a.type[0].toUpperCase());
for (const w of wanderPoints) anclas.set(`${w.x},${w.y}`, 'V');
for (let y = 0; y < H; y++) {
  let s = '';
  for (let x = 0; x < W; x++) {
    const k = `${x},${y}`;
    s += anclas.get(k) ?? (floor[y][x] === MURO ? '#' : floor[y][x] === VIDRIO ? '|' : bloq.has(k) ? 'o' : (y === 0 || y === H - 1 || x === 0 || x === W - 1) ? '·' : '.');
  }
  console.log(String(y).padStart(2), s);
}
