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
  { agent: 'ali', name: 'Ali - Interacción' },
  { agent: 'calificador', name: 'Ali - Calificador' },
  { agent: 'cierre', name: 'Ali - Cierre' },
  // Investigadores (CRM web, lib/investigacion): leen la web pública todos los días.
  { agent: 'competencia', name: 'Ali - Competencia' },
  { agent: 'anuncios', name: 'Ali - Anuncios' },
  { agent: 'mercado', name: 'Ali - Mercado' },
];
const NOMBRES = Object.fromEntries(AGENTES.map(a => [a.agent, a.name]));
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

// Los nombres los pone la oficina (Nicolás, 14-11-2026): aunque un servicio
// mande otro "name", se ven como "Ali - Interacción", "Ali - Calificador" y
// "Ali - Cierre".
//
// Los investigadores no se levantan del notebook (Nicolás, 14-11-2026): de
// día siempre quedan "trabajando" (sentados). Lo que dicen llega como tarea
// nueva y la página le pone el globo; cuando descansan, vuelven a repasar.
const EN_ESCRITORIO = new Set(['competencia', 'anuncios', 'mercado']);
const latido = server.store.heartbeat.bind(server.store);
server.store.heartbeat = data => {
  const d = { ...data, name: NOMBRES[data.agent] ?? data.name };
  // Hablar es parte del trabajo: se queda sentado en su puesto y la página
  // pone el globo (en Miniverse, 'speaking' lo dejaría de pie).
  if (d.state === 'speaking') d.state = 'working';
  if (EN_ESCRITORIO.has(d.agent) && d.state && !['working', 'sleeping', 'offline'].includes(d.state)) {
    d.task = `Repasando: ${temaAlAzar(d.agent)}`;
    d.state = 'working';
  }
  return latido(d);
};

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
    // Trabajo real: la rutina de estudio no lo pisa mientras dure.
    const aviso = await leerAviso(req);
    const agente = typeof aviso?.agent === 'string' ? aviso.agent : null;
    if (agente) {
      ultimoReal.set(agente, Date.now());
      estudiando.delete(agente);
      guardarEnHistorial(pathname, agente, aviso);
    }
    return original(req, res);
  }

  // Ficha de un agente: lo que hizo en las fechas pedidas (sin datos de clientes).
  if (req.method === 'GET' && pathname === '/api/historial') {
    return historial(url, res);
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
 * Historial (Nicolás, 14-11-2026): la oficina olvida al reiniciarse, así que
 * cada trabajo real se guarda en el CRM web (oficina_registro) y la ficha de
 * cada agente lo lee de ahí. Las conversaciones completas solo se ven en el
 * CRM, con su clave: aquí llegan conteos.
 */
const CRM = (process.env.CRM_WEB_URL || 'https://marketing.aliminspa.cl').replace(/\/+$/, '');
const esRepasoTexto = t => !t || /^(Repasando|Estudiando):/.test(t);

function guardarEnHistorial(ruta, agente, aviso) {
  if (!SECRETO || !NOMBRES[agente]) return;
  let tipo = null;
  let texto = null;
  if (ruta === '/api/act' && aviso.action?.type === 'speak' && typeof aviso.action.message === 'string') {
    tipo = 'dijo';
    texto = aviso.action.message;
  } else if (ruta === '/api/heartbeat' && aviso.state === 'working' && typeof aviso.task === 'string' && !esRepasoTexto(aviso.task)) {
    tipo = 'tarea';
    texto = aviso.task;
  }
  if (!tipo) return;
  fetch(`${CRM}/api/webhooks/ia/oficina`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ia-secret': SECRETO },
    body: JSON.stringify({ agente, tipo, texto }),
    signal: AbortSignal.timeout(5000),
  }).catch(error => console.warn('[oficina] No se pudo guardar en el historial:', error.message));
}

async function historial(url, res) {
  const agente = url.searchParams.get('agente');
  const responder = (codigo, cuerpo) => {
    res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(cuerpo));
  };
  if (!NOMBRES[agente]) return responder(400, { error: 'Agente desconocido' });
  const params = new URLSearchParams({ agente });
  for (const k of ['desde', 'hasta', 'q']) {
    const v = url.searchParams.get(k);
    if (v) params.set(k, v.slice(0, 80));
  }
  try {
    const r = await fetch(`${CRM}/api/webhooks/ia/oficina?${params}`, {
      headers: { 'x-ia-secret': SECRETO },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`el CRM respondió ${r.status}`);
    responder(200, { ...(await r.json()), crm: `${CRM}/agentes-ia/historial` });
  } catch (error) {
    responder(502, { error: `No se pudo leer el historial: ${error.message}`, crm: `${CRM}/agentes-ia/historial` });
  }
}

/**
 * El cuerpo del aviso se lee una sola vez: se guarda y se le devuelve al
 * servidor de Miniverse igual que llegó.
 */
async function leerAviso(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  const cuerpo = Buffer.concat(partes);
  const { Readable } = await import('node:stream');
  const copia = Readable.from([cuerpo]);
  req[Symbol.asyncIterator] = copia[Symbol.asyncIterator].bind(copia);
  req.on = copia.on.bind(copia);
  req.once = copia.once.bind(copia);
  try {
    const aviso = JSON.parse(cuerpo.toString('utf8'));
    return aviso && typeof aviso === 'object' ? aviso : null;
  } catch {
    return null;
  }
}

/**
 * Rutina sin IA (no gasta tokens, Nicolás 14-11-2026): cuando un agente no
 * tiene trabajo real, repasa temas de Alimin (va a la zona de café con
 * burbujas de pensamiento) y descansa entre repasos. De noche duerme. Es
 * solo una animación: el trabajo real se ve en su escritorio y queda en el
 * registro; esto no.
 */
const TEMAS = {
  ali: [
    'precios de Lomas del Mar', 'precios de Arena y Sol', 'entrega por etapas', 'qué incluyen los terrenos',
    'crédito directo sin banco', 'cómo se agenda una visita', 'objeción: ¿es estafa?', 'rol propio y escritura',
    'distancia a la playa', 'Libertad y Alegría',
  ],
  calificador: [
    'señales de compra en los chats', 'qué hace calificado a un lead', 'objeciones más repetidas', 'pie y forma de pago',
    'plazos de compra', 'lead score: los 28 puntos', 'conversaciones de Instagram', 'conversaciones del chat web',
  ],
  cierre: [
    'objeción: lo veo con mi pareja', 'segunda visita en pareja', 'promesa ante notario', 'cuotas el día 5',
    'escritura con la recepción final', 'cuándo se puede construir', 'correos post-visita', 'objeción: lo voy a pensar',
  ],
  competencia: [
    'precios por m² en El Tabo', 'avisos de Algarrobo y El Quisco', 'terrenos en Cartagena y San Antonio',
    'quién ofrece crédito directo', 'terrenos con vista al mar', 'avisos que bajaron de precio',
  ],
  anuncios: [
    'anuncios de la competencia en Meta', 'ángulos que repite la competencia', 'ofertas y promociones',
    'anuncios que llevan meses corriendo', 'videos vs. imágenes',
  ],
  mercado: [
    'noticias del litoral central', 'tasas hipotecarias', 'valor de la UF', 'normas de terrenos y permisos',
    'estafas con terrenos', 'obras y rutas en El Tabo',
  ],
};
const ultimoReal = new Map();
const estudiando = new Map();
const pausa = new Map();
const TRABAJO_REAL_MS = 90 * 1000;
const azar = (min, max) => min + Math.random() * (max - min);
function temaAlAzar(agente) {
  const temas = TEMAS[agente] ?? ['temas de Alimin'];
  return temas[Math.floor(Math.random() * temas.length)];
}

function esNoche() {
  const hora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago', hour: '2-digit', hour12: false }));
  return hora >= 23 || hora < 8;
}

function rutina() {
  const ahora = Date.now();
  const estado = new Map(server.store.getAll().map(a => [a.agent, a]));
  const noche = esNoche();
  for (const a of AGENTES) {
    const actual = estado.get(a.agent);
    if (!actual) {
      server.store.heartbeat({ ...a, state: noche ? 'sleeping' : 'idle', task: null });
      continue;
    }
    if (ahora - (ultimoReal.get(a.agent) ?? 0) < TRABAJO_REAL_MS) continue;

    if (noche) {
      estudiando.delete(a.agent);
      if (actual.state !== 'sleeping' || ahora - actual.lastSeen > DORMIR_MS) {
        server.store.heartbeat({ agent: a.agent, name: a.name, state: 'sleeping', task: null });
      }
      continue;
    }

    const hasta = estudiando.get(a.agent);
    if (hasta && ahora < hasta) continue;

    // Investigadores: repasan sentados en su puesto, cambiando de tema.
    if (EN_ESCRITORIO.has(a.agent)) {
      server.store.heartbeat({ agent: a.agent, name: a.name, state: 'working', task: `Repasando: ${temaAlAzar(a.agent)}` });
      estudiando.set(a.agent, ahora + azar(40, 90) * 1000);
      continue;
    }

    if (hasta) {
      estudiando.delete(a.agent);
      pausa.set(a.agent, ahora + azar(20, 70) * 1000);
      server.store.heartbeat({ agent: a.agent, name: a.name, state: 'idle', task: null });
      continue;
    }
    if ((pausa.get(a.agent) ?? 0) > ahora) {
      if (ahora - actual.lastSeen > DORMIR_MS / 2) server.store.heartbeat({ agent: a.agent, name: a.name, state: 'idle', task: null });
      continue;
    }
    server.store.heartbeat({ agent: a.agent, name: a.name, state: 'thinking', task: `Estudiando: ${temaAlAzar(a.agent)}` });
    estudiando.set(a.agent, ahora + azar(30, 60) * 1000);
  }
}

server.start().then(port => {
  rutina();
  setInterval(rutina, 5000).unref?.();
  console.log(`[oficina] Oficina IA Alimin en el puerto ${port}.`);
}).catch(error => {
  console.error('[oficina] No se pudo iniciar:', error);
  process.exit(1);
});
