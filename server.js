/**
 * Oficina IA de Alimin: el servidor de Miniverse (MIT) con la oficina ya
 * construida, protegido con usuario y contraseña.
 *
 * - Las personas entran con usuario y contraseña (OFICINA_USUARIO /
 *   OFICINA_CLAVE) y solo pueden mirar.
 * - Los servicios de Alimin (sitio, CRM web, CRM móvil) avisan lo que hacen
 *   sus agentes con el header x-ia-secret = IA_SECRET, el mismo secreto que
 *   ya usan entre ellos. Solo ellos pueden escribir (heartbeat y act).
 * - Nada de datos de clientes: los avisos dicen el canal y la acción.
 *
 * Los agentes se quedan siempre en la oficina: si no trabajan, pasean; tras
 * unos minutos sin trabajo se duermen, y despiertan con el siguiente aviso.
 */
import { MiniverseServer } from '@miniverse/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 3000);
const DIST = path.resolve('dist');
const USUARIO = process.env.OFICINA_USUARIO || 'alimin';
const CLAVE = process.env.OFICINA_CLAVE || '';
const SECRETO = process.env.IA_SECRET || '';
const AGENTES = [
  { agent: 'ali', name: 'Ali' },
  { agent: 'calificador', name: 'Calificador' },
  { agent: 'cierre', name: 'Cierre' },
];
/** Sin avisos este rato, el agente se duerme (Miniverse lo hace solo). */
const DORMIR_MS = 3 * 60 * 1000;

if (!CLAVE) console.warn('[oficina] Falta OFICINA_CLAVE: nadie podrá entrar a mirar.');
if (!SECRETO) console.warn('[oficina] Falta IA_SECRET: los agentes no podrán avisar lo que hacen.');

const igual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const COOKIE = 'oficina_sesion';
const firma = () => createHmac('sha256', CLAVE || 'sin-clave').update(`oficina:${USUARIO}`).digest('hex');

function cookieValida(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return Boolean(CLAVE && m && igual(m[1], firma()));
}

/** "servicio" (agentes de Alimin), "persona" (equipo mirando) o null. */
function quienEs(req) {
  const s = req.headers['x-ia-secret'];
  if (SECRETO && typeof s === 'string' && igual(s, SECRETO)) return 'servicio';
  if (cookieValida(req)) return 'persona';
  const h = req.headers.authorization || '';
  if (CLAVE && h.startsWith('Basic ')) {
    const [u, ...resto] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
    if (igual(u, USUARIO) && igual(resto.join(':'), CLAVE)) return 'persona';
  }
  return null;
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function servirArchivo(res, ruta) {
  const tipo = TIPOS[path.extname(ruta).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': ruta.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' });
  createReadStream(ruta).pipe(res);
}

/** Archivo de dist/ para la ruta pedida, o null. Nunca sale de dist/. */
function archivoDe(pathname) {
  const limpio = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const ruta = path.join(DIST, limpio || 'index.html');
  if (!ruta.startsWith(DIST)) return null;
  if (existsSync(ruta) && statSync(ruta).isFile()) return ruta;
  return null;
}

const server = new MiniverseServer({ port: PORT, publicDir: DIST, offlineTimeout: DORMIR_MS });
const original = server.handleHttp.bind(server);

const LECTURA = new Set(['/api/info', '/api/agents', '/api/events', '/api/channels']);
const ESCRITURA = new Set(['/api/heartbeat', '/api/act']);

server.handleHttp = async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;

  if (pathname === '/salud') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  const quien = quienEs(req);
  if (!quien) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Oficina IA Alimin", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Necesitas usuario y contraseña para entrar a la oficina.');
    return;
  }

  // Los agentes de Alimin: solo avisan lo que hacen.
  if (req.method === 'POST' && ESCRITURA.has(pathname)) {
    if (quien !== 'servicio') {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Solo los agentes de Alimin pueden escribir aquí.');
      return;
    }
    return original(req, res);
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No permitido.');
    return;
  }

  // Al entrar con usuario y contraseña queda una cookie: así el WebSocket
  // también se autentica (el navegador no siempre manda Basic en el WS).
  if (quien === 'persona' && !cookieValida(req)) {
    res.setHeader('Set-Cookie', `${COOKIE}=${firma()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`);
  }

  if (LECTURA.has(pathname)) return original(req, res);

  if (pathname === '/api/citizens') {
    const dir = path.join(DIST, 'universal_assets', 'citizens');
    const nombres = existsSync(dir)
      ? readdirSync(dir).filter(f => f.endsWith('_walk.png')).map(f => f.replace(/_walk\.png$/, '')).sort()
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(nombres));
    return;
  }

  const archivo = archivoDe(pathname === '/' ? '/index.html' : pathname);
  if (archivo) return servirArchivo(res, archivo);

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('No encontrado.');
};

// WebSocket: solo con sesión iniciada.
server.httpServer.prependListener('upgrade', (req, socket) => {
  if (!quienEs(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
  }
});

/**
 * Los tres agentes siempre están en la oficina. Si nunca avisaron o
 * Miniverse los dio por desconectados, vuelven a aparecer dormidos.
 */
function presentes() {
  const ahora = Date.now();
  const estado = new Map(server.store.getAll().map(a => [a.agent, a]));
  for (const a of AGENTES) {
    const actual = estado.get(a.agent);
    if (!actual) {
      server.store.heartbeat({ ...a, state: 'idle', task: null });
    } else if (actual.state === 'offline' || (actual.state === 'sleeping' && ahora - actual.lastSeen > DORMIR_MS)) {
      server.store.heartbeat({ agent: a.agent, name: a.name, state: 'sleeping', task: null });
    }
  }
}

server.start().then(port => {
  presentes();
  setInterval(presentes, 30 * 1000).unref?.();
  console.log(`[oficina] Oficina IA Alimin en el puerto ${port}.`);
}).catch(error => {
  console.error('[oficina] No se pudo iniciar:', error);
  process.exit(1);
});
