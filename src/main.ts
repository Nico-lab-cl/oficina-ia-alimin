import { Miniverse, PropSystem } from '@miniverse/core';
import type { SceneConfig, SpriteSheetConfig } from '@miniverse/core';

const WORLD_ID = 'posh-highrise';
const basePath = `/worlds/${WORLD_ID}`;

function charSprites(name: string): SpriteSheetConfig {
  return {
    sheets: {
      walk: `/universal_assets/citizens/${name}_walk.png`,
      actions: `/universal_assets/citizens/${name}_actions.png`,
    },
    animations: {
      idle_down: { sheet: 'walk', row: 0, frames: 2, speed: 0.5 },
      idle_up: { sheet: 'walk', row: 1, frames: 2, speed: 0.5 },
      walk_down: { sheet: 'walk', row: 0, frames: 4, speed: 0.15 },
      walk_up: { sheet: 'walk', row: 1, frames: 4, speed: 0.15 },
      walk_left: { sheet: 'walk', row: 2, frames: 4, speed: 0.15 },
      walk_right: { sheet: 'walk', row: 3, frames: 4, speed: 0.15 },
      working: { sheet: 'actions', row: 0, frames: 4, speed: 0.3 },
      // De noche dormitan sentados en su silla (no en el piso): primer cuadro de 'working'.
      sleeping: { sheet: 'actions', row: 0, frames: 1, speed: 1 },
      talking: { sheet: 'actions', row: 2, frames: 4, speed: 0.15 },
    },
    frameWidth: 64,
    frameHeight: 64,
  };
}

function buildSceneConfig(cols: number, rows: number, floor: string[][] | undefined, tiles: Record<string, string> | undefined): SceneConfig {
  const safeFloor: string[][] = floor ?? Array.from({ length: rows }, () => Array(cols).fill(''));
  const walkable: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    walkable[r] = [];
    for (let c = 0; c < cols; c++) walkable[r][c] = (safeFloor[r]?.[c] ?? '') !== '';
  }

  const resolvedTiles: Record<string, string> = { ...(tiles ?? {}) };
  for (const [key, src] of Object.entries(resolvedTiles)) {
    if (/^(blob:|data:|https?:\/\/)/.test(src)) continue;
    const clean = src.startsWith('/') ? src.slice(1) : src;
    resolvedTiles[key] = `${basePath}/${clean}`;
  }

  return {
    name: 'main',
    tileWidth: 32,
    tileHeight: 32,
    layers: [safeFloor],
    walkable,
    locations: {},
    tiles: resolvedTiles,
  };
}

async function main() {
  const container = document.getElementById('miniverse-container')!;
  const statusBar = document.getElementById('status-bar')!;

  const sceneData = await fetch(`${basePath}/world.json`).then(r => r.json()).catch(() => null);

  const gridCols = sceneData?.gridCols ?? 16;
  const gridRows = sceneData?.gridRows ?? 12;
  // Proporción del plano, para que el CSS muestre la oficina completa (index.html).
  container.style.setProperty('--aspecto', String(gridCols / gridRows));
  const sceneConfig = buildSceneConfig(gridCols, gridRows, sceneData?.floor, sceneData?.tiles);
  const tileSize = 32;

  // Los agentes de Alimin, siempre en el mismo orden y con el mismo personaje
  // (el servidor los mantiene presentes; ver server.js).
  const availableSprites: string[] = await fetch('/api/citizens').then(r => r.json()).catch(() => ['dexter', 'morty', 'nova', 'rio']);
  const SPRITE: Record<string, string> = {
    ali: 'nova', calificador: 'dexter', cierre: 'rio',
    // morty2 y dexter2 son morty y dexter con otra ropa (scripts/tenir.mjs).
    competencia: 'morty', anuncios: 'dexter2', mercado: 'morty2',
  };
  const serverAgents: { agent: string; name: string }[] = await fetch('/api/agents')
    .then(r => r.json())
    .then((d: any) => (d.agents ?? []) as { agent: string; name: string }[])
    .then(lista => lista.sort((a, b) => (ORDEN.indexOf(a.agent) + 99) % 99 - (ORDEN.indexOf(b.agent) + 99) % 99))
    .catch(() => []);

  const spriteSheets: Record<string, SpriteSheetConfig> = {};
  const citizens: { agentId: string; name: string; sprite: string; position: string }[] = [];

  for (let i = 0; i < serverAgents.length; i++) {
    const agent = serverAgents[i];
    const spriteAsset = availableSprites.includes(SPRITE[agent.agent]) ? SPRITE[agent.agent] : availableSprites[i % availableSprites.length];
    spriteSheets[agent.agent] = charSprites(spriteAsset);
    citizens.push({
      agentId: agent.agent,
      name: agent.name || agent.agent,
      sprite: agent.agent,
      position: PUESTO[agent.agent] ?? sceneData?.wanderPoints?.[i]?.name ?? `wander_${i}`,
    });
  }

  const mv = new Miniverse({
    container,
    world: WORLD_ID,
    scene: 'main',
    signal: {
      type: 'websocket',
      // Mismo dominio que la página (en EasyPanel va por https).
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
    },
    citizens,
    scale: 2,
    width: gridCols * tileSize,
    height: gridRows * tileSize,
    sceneConfig,
    spriteSheets,
    objects: [],
  });

  // --- Props system ---
  const props = new PropSystem(tileSize, 2);

  const rawSpriteMap: Record<string, string> = sceneData?.propImages ?? {};
  await Promise.all(
    Object.entries(rawSpriteMap).map(([id, src]) => {
      const clean = src.startsWith('/') ? src : `/${src}`;
      return props.loadSprite(id, `${basePath}${clean}`);
    }),
  );

  props.setLayout(sceneData?.props ?? []);
  if (sceneData?.wanderPoints) {
    props.setWanderPoints(sceneData.wanderPoints);
  }

  props.setDeadspaceCheck((col, row) => {
    const floor = mv.getFloorLayer();
    return floor?.[row]?.[col] === '';
  });

  // Los muros de las oficinas son baldosas de concreto: nadie los atraviesa.
  const muros: string[] = [];
  (sceneData?.floor ?? []).forEach((fila: string[], y: number) => fila.forEach((t, x) => {
    if (t === 'polished_concrete_wall' || t === 'glass_wall') muros.push(`${x},${y}`);
  }));
  const syncProps = () => {
    mv.setTypedLocations(props.getLocations());
    mv.updateWalkability(new Set([...props.getBlockedTiles(), ...muros]));
  };
  syncProps();
  props.onSave(syncProps);

  // Dónde va cada uno (Nicolás, 14-11-2026):
  // - Trabajando, hablando o durmiendo: en su puesto. Los investigadores
  //   siempre están ahí, sentados frente al notebook; Ali - Interacción,
  //   Ali - Calificador y Ali - Cierre en su oficina privada.
  // - Repasando o en pausa: en la cafetería (ahí están todos los puntos de
  //   paseo y de café del plano).
  // El globo de diálogo es solo para trabajo real, no para los repasos.
  const interno = mv as any;
  const esRepaso = (t: string | null) => !t || /^(Repasando|Estudiando):/.test(t);
  interno.handleStateTransition = (c: any, _de: string, a: string) => {
    const lugares = interno.typedLocations, ruta = interno.scene.pathfinder, reservas = interno.reservation;
    if (a === 'working' || a === 'speaking' || a === 'sleeping') {
      c.goToAnchor(c.getHomePosition(), lugares, ruta, reservas);
    } else if (a === 'thinking') {
      const otros = interno.getOtherHomeAnchors(c.agentId);
      c.goToAnchorType('utility', lugares, ruta, reservas, otros) || c.goToAnchorType('social', lugares, ruta, reservas, otros);
    }
    if ((a === 'working' || a === 'speaking') && !esRepaso(c.task)) {
      interno.speechBubbles.show(c.x + 16, c.y - 8 - c.getSittingOffset(), c.task, a === 'speaking' ? 5 : 4, c);
    } else if (a === 'error') {
      interno.particles.emitExclamation(c.x + 16, c.y - c.getSittingOffset());
    }
  };
  // Nadie se para a hablar: lo que dicen llega como tarea nueva sin cambiar
  // de estado (server.js) y aquí sale el globo, con el agente sentado.
  const señal = interno.handleSignalUpdate.bind(mv);
  const ubicados = new Set<string>();
  interno.handleSignalUpdate = (lista: unknown) => {
    const antes = new Map(mv.getCitizens().map((c: any) => [c.agentId, { task: c.task, state: c.state }]));
    señal(lista);
    for (const c of mv.getCitizens() as any[]) {
      // Al abrir la página todos parten en su puesto: el que está repasando
      // camina a la cafetería sin esperar a cambiar de estado.
      if (!ubicados.has(c.agentId)) {
        ubicados.add(c.agentId);
        if (c.state === 'thinking') interno.handleStateTransition(c, '', c.state);
      }
      const previo = antes.get(c.agentId);
      if (!previo || previo.state !== 'working' || c.state !== 'working' || esRepaso(c.task)) continue;
      if (previo.task !== c.task) interno.speechBubbles.show(c.x + 16, c.y - 8 - c.getSittingOffset(), c.task, 5, c);
    }
  };

  await mv.start();

  mv.addLayer({ order: 5, render: (ctx) => props.renderBelow(ctx) });
  mv.addLayer({ order: 15, render: (ctx) => props.renderAbove(ctx) });

  // Sin editor: en EasyPanel la oficina solo se mira.

  // --- Ficha al tocar un agente (en la oficina o en la barra de estado) ---
  // Miniverse calcula el clic con su escala fija (2x) y no ve el canvas
  // achicado al ancho de la pantalla: aquí se mide con el tamaño real.
  interno.handleClick = (e: MouseEvent) => {
    const canvas = interno.renderer.canvas as HTMLCanvasElement;
    const caja = canvas.getBoundingClientRect();
    const x = (e.clientX - caja.left) * (canvas.width / caja.width);
    const y = (e.clientY - caja.top) * (canvas.height / caja.height);
    const tocado = (mv.getCitizens() as any[])
      .filter(c => c.visible)
      .find(c => {
        const izq = c.x + (c.tileWidth - c.frameWidth) / 2;
        const arriba = c.y + (c.tileHeight - c.frameHeight);
        return x >= izq + 10 && x <= izq + c.frameWidth - 10 && y >= arriba && y <= arriba + c.frameHeight;
      });
    if (tocado) abrirFicha(tocado.agentId);
  };
  // La barra se redibuja cada 3 s: el clic se escucha en la barra, no en cada nombre.
  statusBar.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-agente]')?.dataset.agente;
    if (id) abrirFicha(id);
  });

  // --- Barra de estado y registro, con lo que avisan los agentes de verdad ---
  const registro = document.getElementById('registro')!;
  let ultimoEvento = 0;
  const pintarEstado = async () => {
    const agentes: { agent: string; name: string; state: string; task: string | null }[] = await fetch('/api/agents')
      .then(r => r.json()).then((d: any) => d.agents ?? []).catch(() => []);
    statusBar.innerHTML = '';
    for (const id of ORDEN) {
      const a = agentes.find(x => x.agent === id);
      if (!a) continue;
      const el = document.createElement('div');
      el.className = 'agent';
      el.title = 'Ver lo que hizo';
      el.dataset.agente = id;
      el.innerHTML = '<span class="status-dot"></span><b></b><span class="estado"></span>';
      el.querySelector('.status-dot')!.classList.add(a.state);
      el.querySelector('b')!.textContent = a.name;
      el.querySelector('.estado')!.textContent = `${ESTADO[a.state] ?? a.state}${a.task ? ` · ${a.task}` : ''}`;
      statusBar.appendChild(el);
    }
  };
  const pintarEventos = async () => {
    const d: any = await fetch(`/api/events${ultimoEvento ? `?since=${ultimoEvento}` : ''}`).then(r => r.json()).catch(() => null);
    if (!d) return;
    for (const ev of d.events ?? []) {
      if (ev.action?.type !== 'speak' || typeof ev.action.message !== 'string') continue;
      const li = document.createElement('li');
      const hora = new Date(ev.timestamp).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
      li.innerHTML = '<time></time><b></b><span></span>';
      li.querySelector('time')!.textContent = hora;
      li.querySelector('b')!.textContent = NOMBRE[ev.agentId] ?? ev.agentId;
      li.querySelector('span')!.textContent = ev.action.message;
      registro.prepend(li);
      while (registro.children.length > 12) registro.lastChild!.remove();
    }
    if (typeof d.lastEventId === 'number') ultimoEvento = d.lastEventId;
    const vacio = registro.querySelector('.vacio');
    if (registro.querySelector('li:not(.vacio)')) vacio?.remove();
    else if (!vacio) registro.innerHTML = '<li class="vacio">Todavía no hay movimiento. Cuando un agente trabaje, aparece aquí.</li>';
  };
  await Promise.all([pintarEstado(), pintarEventos()]);
  setInterval(pintarEstado, 3000);
  setInterval(pintarEventos, 3000);
}

const ORDEN = ['ali', 'calificador', 'cierre', 'competencia', 'anuncios', 'mercado'];
/** Puesto de cada agente en world.json. */
const PUESTO: Record<string, string> = {
  ali: 'oficina_interaccion',
  calificador: 'oficina_calificador',
  cierre: 'oficina_cierre',
  competencia: 'puesto_competencia',
  anuncios: 'puesto_anuncios',
  mercado: 'puesto_mercado',
};
/** Los que nunca dejan el notebook (server.js los mantiene trabajando). */
const EN_ESCRITORIO = new Set(['competencia', 'anuncios', 'mercado']);

const ESTADO: Record<string, string> = {
  working: 'trabajando',
  thinking: 'repasando',
  speaking: 'hablando',
  idle: 'en pausa',
  sleeping: 'durmiendo (de noche)',
  error: 'con un problema',
  offline: 'fuera de la oficina',
};
const NOMBRE: Record<string, string> = {
  ali: 'Ali - Interacción',
  calificador: 'Ali - Calificador',
  cierre: 'Ali - Cierre',
  competencia: 'Ali - Competencia',
  anuncios: 'Ali - Anuncios',
  mercado: 'Ali - Mercado',
};
const ROL: Record<string, string> = {
  'Ali - Interacción': 'Atiende el chat web, Instagram y Facebook',
  'Ali - Calificador': 'Lee las conversaciones y suma al lead score',
  'Ali - Cierre': 'Acompaña a quien ya llegó a la visita',
  'Ali - Competencia': 'Revisa los avisos de terrenos de la competencia',
  'Ali - Anuncios': 'Revisa los anuncios de la competencia en Meta',
  'Ali - Mercado': 'Lee las noticias del sector',
};

// --- Ficha de un agente: lo que hizo hoy, ayer, en la semana o entre fechas ---
// Las tareas vienen del CRM web vía /api/historial (sin datos de clientes); las
// conversaciones se abren en el CRM, que pide su clave.

type Periodo = 'hoy' | 'ayer' | 'semana' | 'fechas';
interface Historial {
  tareas?: { tipo: string; texto: string; created_at: string }[];
  resumen?: { tareas: number; conversaciones: number; respuestas: number; informes: number };
  rango?: { desde: string; hasta: string };
  crm?: string;
  error?: string;
}

const ficha = document.getElementById('ficha')!;
const fichaQ = ficha.querySelector<HTMLInputElement>('input[name="q"]')!;
const fichaDesde = ficha.querySelector<HTMLInputElement>('input[name="desde"]')!;
const fichaHasta = ficha.querySelector<HTMLInputElement>('input[name="hasta"]')!;
let fichaAgente = '';
let fichaPeriodo: Periodo = 'hoy';
let fichaPedido = 0;

const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const restarDias = (f: string, d: number) => new Date(Date.parse(f) - d * 86400000).toISOString().slice(0, 10);
function rangoFicha() {
  const hoy = hoyChile();
  if (fichaPeriodo === 'ayer') return { desde: restarDias(hoy, 1), hasta: restarDias(hoy, 1) };
  if (fichaPeriodo === 'semana') return { desde: restarDias(hoy, 6), hasta: hoy };
  if (fichaPeriodo === 'fechas') return { desde: fichaDesde.value || hoy, hasta: fichaHasta.value || fichaDesde.value || hoy };
  return { desde: hoy, hasta: hoy };
}

function cifra(valor: number, texto: string) {
  const d = document.createElement('div');
  d.className = 'cifra';
  d.innerHTML = '<b></b><span></span>';
  d.querySelector('b')!.textContent = String(valor);
  d.querySelector('span')!.textContent = texto;
  return d;
}

async function cargarFicha() {
  const pedido = ++fichaPedido;
  const r = rangoFicha();
  const q = fichaQ.value.trim();
  const lista = ficha.querySelector('.tareas')!;
  const resumen = ficha.querySelector('.resumen')!;
  lista.innerHTML = '<li class="vacio">Cargando…</li>';
  resumen.innerHTML = '';

  const params = new URLSearchParams({ agente: fichaAgente, desde: r.desde, hasta: r.hasta });
  if (q) params.set('q', q);
  const d: Historial = await fetch(`/api/historial?${params}`).then(x => x.json()).catch(() => ({ error: 'Sin conexión con la oficina' }));
  if (pedido !== fichaPedido) return;

  const enCrm = new URLSearchParams({ agente: fichaAgente, ...(fichaPeriodo === 'fechas' ? { desde: r.desde, hasta: r.hasta } : { periodo: fichaPeriodo }) });
  if (q) enCrm.set('q', q);
  const crm = ficha.querySelector<HTMLAnchorElement>('.crm')!;
  if (d.crm) crm.href = `${d.crm}?${enCrm}`;
  const investigador = EN_ESCRITORIO.has(fichaAgente);
  crm.textContent = investigador ? 'Ver informes en el CRM' : 'Ver conversaciones en el CRM';

  if (d.error || !d.resumen) {
    lista.innerHTML = '<li class="vacio"></li>';
    lista.querySelector('li')!.textContent = d.error ?? 'No se pudo leer el historial.';
    return;
  }
  resumen.append(
    cifra(d.resumen.tareas, d.resumen.tareas === 1 ? 'tarea' : 'tareas'),
    investigador
      ? cifra(d.resumen.informes, d.resumen.informes === 1 ? 'informe' : 'informes')
      : cifra(d.resumen.conversaciones, d.resumen.conversaciones === 1 ? 'conversación' : 'conversaciones'),
    investigador
      ? cifra((d.tareas ?? []).filter(t => t.tipo === 'dijo').length, 'hallazgos contados')
      : cifra(d.resumen.respuestas, 'respuestas de la IA'),
  );

  const tareas = d.tareas ?? [];
  lista.innerHTML = '';
  if (!tareas.length) {
    lista.innerHTML = `<li class="vacio">${q ? 'Nada con esa búsqueda en estas fechas.' : 'Sin tareas registradas en estas fechas.'}</li>`;
    return;
  }
  const unDia = d.rango?.desde === d.rango?.hasta;
  for (const t of tareas) {
    const li = document.createElement('li');
    li.className = t.tipo;
    li.innerHTML = '<time></time><span></span>';
    const fecha = new Date(t.created_at);
    li.querySelector('time')!.textContent = unDia
      ? fecha.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false })
      : fecha.toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    li.querySelector('span')!.textContent = t.texto;
    lista.appendChild(li);
  }
}

async function abrirFicha(agentId: string) {
  if (!NOMBRE[agentId]) return;
  fichaAgente = agentId;
  ficha.querySelector('h2')!.textContent = NOMBRE[agentId];
  ficha.querySelector('.rol')!.textContent = ROL[NOMBRE[agentId]] ?? '';
  const ahora = await fetch('/api/agents').then(r => r.json()).then((d: any) => (d.agents ?? []).find((a: any) => a.agent === agentId)).catch(() => null);
  ficha.querySelector('.ahora')!.textContent = ahora
    ? `Ahora: ${ESTADO[ahora.state] ?? ahora.state}${ahora.task ? ` · ${ahora.task}` : ''}`
    : '';
  ficha.classList.add('abierta');
  cargarFicha();
}

ficha.querySelectorAll<HTMLElement>('[data-cerrar]').forEach(el => el.addEventListener('click', () => ficha.classList.remove('abierta')));
document.addEventListener('keydown', e => { if (e.key === 'Escape') ficha.classList.remove('abierta'); });
ficha.querySelectorAll<HTMLButtonElement>('button.periodo').forEach(b => b.addEventListener('click', () => {
  fichaPeriodo = b.dataset.periodo as Periodo;
  ficha.querySelectorAll('button.periodo').forEach(x => x.classList.toggle('activo', x === b));
  ficha.querySelector('.fechas')!.classList.toggle('visible', fichaPeriodo === 'fechas');
  if (fichaPeriodo === 'fechas' && !fichaDesde.value) {
    fichaDesde.value = restarDias(hoyChile(), 6);
    fichaHasta.value = hoyChile();
  }
  cargarFicha();
}));
[fichaDesde, fichaHasta].forEach(i => i.addEventListener('change', cargarFicha));
ficha.querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); cargarFicha(); });

main().catch(console.error);
