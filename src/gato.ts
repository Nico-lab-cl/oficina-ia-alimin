/**
 * Michi, el gato de la oficina (Nicolás, 14-11-2026): pasea por la oficina,
 * se echa a dormir y los agentes lo van a acariciar de vez en cuando.
 * Pixel art dibujado aquí mismo (sin imágenes): cada cuadro es una grilla de
 * letras y cada letra un color. Mira a la derecha; a la izquierda se espeja.
 */

const COLOR: Record<string, string> = {
  k: '#3a2416', // contorno
  o: '#e8933c', // naranjo
  d: '#b9621f', // rayas
  w: '#f7e9d2', // crema
  p: '#f29bb0', // rosado (orejas y nariz)
  e: '#1b1b1b', // ojos
};

const CAMINA_1 = [
  '..............k...k.',
  '.............kpk.kpk',
  'kk...........koooook',
  'kdk.........koeooeok',
  '.kok........kowppwok',
  '..kok.......kwwwwwk.',
  '...kkkkkkkkkkoooook.',
  '...kodoodoodooooook.',
  '...koodoodoodooook..',
  '...kooooooooowwwk...',
  '...kok.kok..kok.kok.',
  '...kk...kk...kk..kk.',
];
const CAMINA_2 = [
  '..............k...k.',
  '.............kpk.kpk',
  '.............koooook',
  'kk..........koeooeok',
  'kdk.........kowppwok',
  '.kok........kwwwwwk.',
  '..kokkkkkkkkkoooook.',
  '...kodoodoodooooook.',
  '...koodoodoodooook..',
  '...kooooooooowwwk...',
  '....kok.kok.kok.kok.',
  '....kk...kk.kk...kk.',
];
const SENTADO_1 = [
  '..........k...k.....',
  '.........kpk.kpk....',
  '.........kooooook...',
  '........koeooeok....',
  '........kowppwok....',
  '.........kwwwwk.....',
  '.......kkdooodk.....',
  '......kodoowwok.....',
  '.....kooodowwok.....',
  '..kk.koodoowwok.....',
  '.kdk.kooooowwok.....',
  '..kkkkkkkkkkkkk.....',
];
const SENTADO_2 = SENTADO_1.map((f, i) => (i === 9 ? '.kk..koodoowwok.....' : i === 10 ? 'kdk..kooooowwok.....' : i === 11 ? '.kkkkkkkkkkkkkk.....' : f));
const DUERME_1 = [
  '....................',
  '....................',
  '....................',
  '....................',
  '.............k...k..',
  '......kkkkkkkpk.kpk.',
  '....kkodoodokooooook',
  '...kodoodoodkokkokok',
  '..koodoodoodokwppwok',
  '..kooooooooooowwwwk.',
  '..kddddkooooooooook.',
  '...kkkkkkkkkkkkkkk..',
];
const DUERME_2 = DUERME_1.map((f, i) => (i === 6 ? '.....kkdoodokooooook' : i === 5 ? '.......kkkkkkpk.kpk.' : f));

export const CUADROS = { CAMINA_1, CAMINA_2, SENTADO_1, SENTADO_2, DUERME_1, DUERME_2 };
export type Cuadro = keyof typeof CUADROS;

const ESCALA = 1.5;
const cache = new Map<string, HTMLCanvasElement>();
function lienzo(nombre: Cuadro, espejo: boolean) {
  const clave = `${nombre}:${espejo}`;
  const hecho = cache.get(clave);
  if (hecho) return hecho;
  const filas = CUADROS[nombre];
  const ancho = Math.max(...filas.map(f => f.length));
  const c = document.createElement('canvas');
  c.width = ancho;
  c.height = filas.length;
  const ctx = c.getContext('2d')!;
  filas.forEach((fila, y) => [...fila].forEach((letra, x) => {
    if (!COLOR[letra]) return;
    ctx.fillStyle = COLOR[letra];
    ctx.fillRect(espejo ? ancho - 1 - x : x, y, 1, 1);
  }));
  cache.set(clave, c);
  return c;
}

type Punto = { x: number; y: number };
interface Buscador { findPath(x1: number, y1: number, x2: number, y2: number): Punto[]; isWalkable?(x: number, y: number): boolean }

type Modo = 'pasea' | 'sentado' | 'duerme' | 'mimos';

/**
 * El gato vive en el mundo de Miniverse (coordenadas de baldosa de 32 px) y
 * camina con el mismo buscador de caminos que los agentes.
 */
export class Gato {
  x: number;
  y: number;
  private camino: Punto[] = [];
  private paso = 0;
  private avance = 0;
  private modo: Modo = 'sentado';
  private reloj = 0;
  private hasta = 4;
  private mira = 1; // 1 derecha, -1 izquierda
  private corazones: { x: number; y: number; vida: number }[] = [];
  private proximoCorazon = 0;

  constructor(private tile: number, inicio: Punto, private lugares: () => Punto[], private buscador: () => Buscador) {
    this.x = inicio.x * tile;
    this.y = inicio.y * tile;
  }

  baldosa(): Punto {
    return { x: Math.round(this.x / this.tile), y: Math.round(this.y / this.tile) };
  }

  /** Un agente viene a acariciarlo: se queda quieto mirándolo. */
  recibirMimos(desdeX: number, segundos: number) {
    this.camino = [];
    this.modo = 'mimos';
    this.reloj = 0;
    this.hasta = segundos;
    this.mira = desdeX > this.x ? 1 : -1;
  }

  /** Mientras alguien camina hacia él, espera sentado. */
  esperar(segundos: number) {
    // Si iba caminando, se queda en la baldosa más cercana.
    const b = this.baldosa();
    this.x = b.x * this.tile;
    this.y = b.y * this.tile;
    this.camino = [];
    this.modo = 'sentado';
    this.reloj = 0;
    this.hasta = segundos;
  }

  private caminarA(destino: Punto) {
    const desde = this.baldosa();
    const camino = this.buscador().findPath(desde.x, desde.y, destino.x, destino.y);
    if (camino.length > 1) {
      this.camino = camino;
      this.paso = 1;
      this.avance = 0;
      this.modo = 'pasea';
      return true;
    }
    return false;
  }

  private decidir() {
    this.reloj = 0;
    const r = Math.random();
    if (this.modo === 'pasea' || this.modo === 'mimos' || r < 0.45) {
      // Descansa: a veces sentado, a veces una siesta larga.
      this.modo = Math.random() < 0.5 ? 'sentado' : 'duerme';
      this.hasta = this.modo === 'duerme' ? 25 + Math.random() * 40 : 6 + Math.random() * 10;
      return;
    }
    const opciones = this.lugares();
    const destino = opciones[Math.floor(Math.random() * opciones.length)];
    if (!destino || !this.caminarA(destino)) {
      this.modo = 'sentado';
      this.hasta = 5;
    }
  }

  update(dt: number) {
    for (const c of this.corazones) { c.vida -= dt; c.y -= dt * 10; }
    this.corazones = this.corazones.filter(c => c.vida > 0);

    if (this.modo === 'pasea' && this.paso < this.camino.length) {
      const objetivo = this.camino[this.paso];
      const ox = objetivo.x * this.tile, oy = objetivo.y * this.tile;
      const previo = this.camino[this.paso - 1];
      const px = previo.x * this.tile, py = previo.y * this.tile;
      if (ox !== px) this.mira = ox > px ? 1 : -1;
      this.avance += dt * 1.6;
      if (this.avance >= 1) {
        this.x = ox; this.y = oy; this.avance = 0; this.paso++;
        if (this.paso >= this.camino.length) { this.camino = []; this.decidir(); }
      } else {
        this.x = px + (ox - px) * this.avance;
        this.y = py + (oy - py) * this.avance;
      }
      return;
    }

    this.reloj += dt;
    if (this.modo === 'mimos') {
      this.proximoCorazon -= dt;
      if (this.proximoCorazon <= 0) {
        this.proximoCorazon = 0.7;
        this.corazones.push({ x: this.x + 16 + (Math.random() * 10 - 5), y: this.y + 6, vida: 1.6 });
      }
    }
    if (this.reloj >= this.hasta) this.decidir();
  }

  render(ctx: CanvasRenderingContext2D, t: number) {
    let cuadro: Cuadro;
    if (this.modo === 'pasea') cuadro = Math.floor(t * 6) % 2 ? 'CAMINA_2' : 'CAMINA_1';
    else if (this.modo === 'duerme') cuadro = Math.floor(t * 1.2) % 2 ? 'DUERME_2' : 'DUERME_1';
    else cuadro = Math.floor(t * (this.modo === 'mimos' ? 3 : 0.8)) % 2 ? 'SENTADO_2' : 'SENTADO_1';
    const img = lienzo(cuadro, this.mira < 0);
    // Centrado en la baldosa, con las patas en el borde de abajo. Un poco más
    // grande que el dibujo para que se note en la oficina (Nicolás, 14-11-2026).
    const w = Math.round(img.width * ESCALA), h = Math.round(img.height * ESCALA);
    const dx = Math.round(this.x + (this.tile - w) / 2);
    const dy = Math.round(this.y + this.tile - h - 1);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(dx + 4, dy + h - 2, w - 8, 3);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, dx, dy, w, h);
    if (this.modo === 'duerme' && Math.floor(t * 0.7) % 2) {
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.5;
      ctx.strokeText('z', dx + w - 2, dy - 1);
      ctx.fillText('z', dx + w - 2, dy - 1);
    }
    for (const c of this.corazones) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, c.vida);
      corazon(ctx, Math.round(c.x), Math.round(c.y));
      ctx.restore();
    }
  }

  get caminando() { return this.modo === 'pasea'; }
}

const CORAZON = ['.kk.kk.', 'kppkppk', 'kpppppk', '.kpppk.', '..kpk..', '...k...'];
function corazon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  CORAZON.forEach((fila, j) => [...fila].forEach((l, i) => {
    if (l === '.') return;
    ctx.fillStyle = l === 'k' ? '#7a1f35' : '#ff5d8f';
    ctx.fillRect(x + i - 3, y + j, 1, 1);
  }));
}
