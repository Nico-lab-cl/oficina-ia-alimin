import { Miniverse, PropSystem } from '@miniverse/core';
import type { SceneConfig, SpriteSheetConfig } from '@miniverse/core';
import { Gato } from './gato';

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
  // - Trabajando, atento o durmiendo: en su puesto. Los investigadores
  //   siempre están ahí, sentados frente al notebook; Ali - Interacción,
  //   Ali - Calificador y Ali - Cierre en su oficina privada.
  // - Café: en la cafetería, un rato corto.
  // - Gato: va a acariciar a Michi (server.js lo manda como 'speaking' para
  //   que quede de pie y gesticulando).
  // Globos (Nicolás, 14-11-2026): siempre hay alguno a la vista. El trabajo
  // real sale en globo blanco con borde verde; el ambiente (atento, repaso,
  // café, Michi) en una nube gris clara, para no confundirlos.
  const interno = mv as any;
  type Globo = { c: any; texto: string; real: boolean; charla: boolean; vida: number };
  const globos = new Map<string, Globo>();
  const globo = (c: any, texto: string | null, real: boolean, charla = false) => {
    if (!texto) return;
    const actual = globos.get(c.agentId);
    // El ambiente no tapa un trabajo real ni una charla.
    if ((actual?.real || actual?.charla) && !real && !charla) return;
    globos.set(c.agentId, { c, texto: texto.length > 34 ? `${texto.slice(0, 33)}…` : texto, real, charla, vida: real ? 7 : charla ? 6 : 4.5 });
  };
  const lugares = () => interno.typedLocations;
  const ruta = () => interno.scene.pathfinder;
  const acariciando = new Map<string, { llego: boolean }>();
  /** Quien camina a conversar: al llegar dice lo suyo y el otro le responde. */
  const conversando = new Map<string, { llego: boolean; charlaId: number }>();

  const irAEscritorio = (c: any, para: string) => {
    const ancla = lugares().find((l: any) => l.name === PUESTO[para]);
    if (!ancla) return;
    const desde = c.getTilePosition();
    let mejor: { x: number; y: number }[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1]]) {
      const p = ruta().findPath(desde.x, desde.y, ancla.x + dx, ancla.y + dy);
      if (p.length > 1 && (!mejor.length || p.length < mejor.length)) mejor = p;
    }
    if (!mejor.length) return;
    interno.reservation.release(c.agentId);
    c.walkTo(mejor);
    conversando.set(c.agentId, { llego: false, charlaId: 0 });
  };
  let gato: Gato | null = null;

  const irAlGato = (c: any) => {
    if (!gato) return;
    gato.esperar(25);
    const g = gato.baldosa();
    const desde = c.getTilePosition();
    let mejor: { x: number; y: number }[] = [];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
      const p = ruta().findPath(desde.x, desde.y, g.x + dx, g.y + dy);
      if (p.length > 1 && (!mejor.length || p.length < mejor.length)) mejor = p;
    }
    if (!mejor.length) return;
    interno.reservation.release(c.agentId);
    c.walkTo(mejor);
    acariciando.set(c.agentId, { llego: false });
  };

  interno.handleStateTransition = (c: any, _de: string, a: string) => {
    const reservas = interno.reservation;
    if (a === 'working' || a === 'sleeping') {
      c.goToAnchor(c.getHomePosition(), lugares(), ruta(), reservas);
    } else if (a === 'thinking') {
      const otros = interno.getOtherHomeAnchors(c.agentId);
      c.goToAnchorType('utility', lugares(), ruta(), reservas, otros) || c.goToAnchorType('social', lugares(), ruta(), reservas, otros);
    } else if (a === 'speaking' && /^Gato:/.test(c.task ?? '')) {
      irAlGato(c);
    } else if (a === 'speaking' && /^Charla:/.test(c.task ?? '')) {
      const para = Object.keys(NOMBRE).find(id => (c.task ?? '').endsWith(NOMBRE[id]));
      if (para) irAEscritorio(c, para);
    }
    if (a === 'working' && !esAmbiente(c.task)) {
      globo(c, c.task, true);
    } else if (esAmbiente(c.task)) {
      globo(c, fraseAmbiente(c.agentId, c.state, c.task), false);
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
      // Al abrir la página todos parten en su puesto: el que está en el café
      // o con el gato camina hacia allá sin esperar a cambiar de estado.
      if (!ubicados.has(c.agentId)) {
        ubicados.add(c.agentId);
        if (c.state === 'thinking' || c.state === 'speaking') interno.handleStateTransition(c, '', c.state);
      }
      const previo = antes.get(c.agentId);
      if (!previo || previo.state !== c.state || previo.task === c.task) continue;
      if (c.state === 'working' && !esAmbiente(c.task)) globo(c, c.task, true);
      else globo(c, fraseAmbiente(c.agentId, c.state, c.task), false);
    }
  };

  await mv.start();

  mv.addLayer({ order: 5, render: (ctx) => props.renderBelow(ctx) });
  mv.addLayer({ order: 15, render: (ctx) => props.renderAbove(ctx) });

  // --- Globos: se dibujan sobre el nombre de cada agente ---
  const proximo = new Map<string, number>();
  const anchoMundo = gridCols * tileSize;
  mv.addLayer({
    order: 26,
    render: (ctx, dt: number) => {
      // Cada tanto, una nube de ambiente para el que no tiene globo.
      for (const c of mv.getCitizens() as any[]) {
        const falta = (proximo.get(c.agentId) ?? 1 + Math.random() * 6) - dt;
        if (falta > 0) { proximo.set(c.agentId, falta); continue; }
        proximo.set(c.agentId, 7 + Math.random() * 9);
        if (!globos.has(c.agentId)) globo(c, fraseAmbiente(c.agentId, c.state, c.task), false);
      }
      for (const [id, g] of globos) {
        g.vida -= dt;
        if (g.vida <= 0) { globos.delete(id); continue; }
        const c = g.c;
        if (!c.visible) continue;
        ctx.save();
        ctx.globalAlpha = Math.min(1, g.vida / 0.5);
        ctx.font = g.real ? 'bold 9px monospace' : '9px monospace';
        const w = Math.ceil(ctx.measureText(g.texto).width) + 12;
        const h = 16;
        const cx = c.x + tileSize / 2;
        // Los de arriba no tienen espacio sobre la cabeza: el globo no se sale del borde.
        const base = Math.max(h + 3, c.y - c.frameHeight + tileSize - 16 - c.getSittingOffset() - (modoReal ? 12 : 0));
        const x = Math.max(2, Math.min(anchoMundo - w - 2, cx - w / 2));
        const y = base - h;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, g.real ? 4 : g.charla ? 6 : 8);
        ctx.fillStyle = g.real ? '#ffffff' : g.charla ? '#fff6dc' : 'rgba(234,243,239,0.93)';
        ctx.strokeStyle = g.real ? '#16a34a' : g.charla ? '#d4a24c' : '#93b4a8';
        ctx.lineWidth = g.real ? 1.5 : 1;
        ctx.fill();
        ctx.stroke();
        if (g.real || g.charla) {
          ctx.beginPath();
          ctx.moveTo(cx - 4, base); ctx.lineTo(cx, base + 6); ctx.lineTo(cx + 4, base);
          ctx.fillStyle = g.real ? '#ffffff' : '#fff6dc';
          ctx.fill();
          ctx.fillStyle = g.real ? '#14532d' : '#6b4a12';
        } else {
          // Nube de pensamiento: dos burbujitas hacia el agente.
          ctx.beginPath(); ctx.arc(cx, base + 3, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx + 2, base + 8, 1.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#3f5f55';
        }
        ctx.fillText(g.texto, x + 6, y + 11.5);
        ctx.restore();
      }
    },
  });

  // --- Michi, el gato de la oficina ---
  // Pasea por el pasillo y la cafetería, duerme siestas y recibe mimos.
  const PASEOS = [
    { x: 5, y: 8 }, { x: 11, y: 7 }, { x: 17, y: 8 }, { x: 18, y: 10 }, { x: 19, y: 9 },
    { x: 22, y: 4 }, { x: 20, y: 4 }, { x: 24, y: 11 }, { x: 6, y: 11 }, { x: 12, y: 11 }, { x: 4, y: 7 },
  ];
  gato = new Gato(tileSize, { x: 19, y: 9 }, () => PASEOS, ruta);
  let reloj = 0;
  mv.addLayer({
    order: 13,
    render: (ctx, dt: number) => {
      reloj += dt;
      // Quien va a acariciarlo: al llegar, Michi recibe los mimos.
      // Charlas: al llegar al escritorio, uno dice lo suyo y el otro responde.
      for (const [id, info] of conversando) {
        const c = (mv.getCitizens() as any[]).find(x => x.agentId === id);
        if (!c || c.state !== 'speaking' || !/^Charla:/.test(c.task ?? '')) { conversando.delete(id); continue; }
        if (info.llego || c.isMoving()) continue;
        const charla = charlaEnCurso;
        if (!charla || charla.de !== id) continue;
        info.llego = true;
        info.charlaId = charla.id;
        globo(c, charla.dice, false, true);
        const otro = (mv.getCitizens() as any[]).find(x => x.agentId === charla.para);
        if (otro && charla.responde) setTimeout(() => globo(otro, charla.responde, false, true), 3500);
      }
      for (const [id, info] of acariciando) {
        const c = (mv.getCitizens() as any[]).find(x => x.agentId === id);
        if (!c || c.state !== 'speaking') { acariciando.delete(id); continue; }
        if (!info.llego && !c.isMoving()) { info.llego = true; gato!.recibirMimos(c.x, 16); }
      }
      gato!.update(dt);
      gato!.render(ctx, reloj);
    },
  });

  // --- Modo "Actividad real": etiqueta sobre cada agente con su estado de verdad ---
  mv.addLayer({
    order: 31,
    render: (ctx) => {
      if (!modoReal) return;
      for (const c of mv.getCitizens() as any[]) {
        if (!c.visible) continue;
        const a = actividad.get(c.agentId);
        const trabajando = Boolean(a?.trabajando);
        const texto = trabajando ? '● TRABAJANDO' : a?.ultima ? `en espera · ${haceCorto(a.ultima.at)}` : 'en espera';
        ctx.save();
        ctx.font = 'bold 7px monospace';
        const w = ctx.measureText(texto).width;
        const x = c.x + (tileSize - w) / 2;
        const y = c.y - c.frameHeight + tileSize - 17 - c.getSittingOffset();
        ctx.fillStyle = trabajando ? 'rgba(22,101,52,0.92)' : 'rgba(40,40,40,0.85)';
        ctx.fillRect(x - 3, y - 7, w + 6, 10);
        ctx.fillStyle = trabajando ? '#bbf7d0' : '#d4d4d4';
        ctx.fillText(texto, x, y);
        ctx.restore();
      }
    },
  });

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
    const [agentes, real] = await Promise.all([
      fetch('/api/agents').then(r => r.json()).then((d: any) => (d.agents ?? []) as Vista[]).catch(() => [] as Vista[]),
      fetch('/api/actividad').then(r => r.json()).then((d: any) => {
        charlaEnCurso = d.charla ?? null;
        return (d.agentes ?? []) as Actividad[];
      }).catch(() => null),
    ]);
    if (real) {
      for (const a of real) {
        const antes = actividad.get(a.agent);
        actividad.set(a.agent, a);
        // La ficha abierta se actualiza sola cuando su agente hace algo nuevo.
        if (a.agent === fichaAgente && a.ultima && antes?.ultima?.at !== a.ultima.at) refrescarFicha();
      }
    }
    vista.clear();
    for (const a of agentes) vista.set(a.agent, a);
    pintarAhoraFicha();

    statusBar.innerHTML = '';
    for (const id of ORDEN) {
      const a = vista.get(id);
      if (!a) continue;
      const el = document.createElement('div');
      el.className = 'agent';
      el.title = 'Ver lo que hizo';
      el.dataset.agente = id;
      el.innerHTML = '<span class="status-dot"></span><b></b><span class="estado"></span>';
      const r = actividad.get(id);
      const punto = modoReal ? (r?.trabajando ? 'working' : 'espera') : claseVista(a.state, a.task);
      el.querySelector('.status-dot')!.classList.add(punto);
      el.querySelector('b')!.textContent = a.name;
      el.querySelector('.estado')!.textContent = modoReal ? textoReal(r) : textoVista(a.state, a.task);
      statusBar.appendChild(el);
    }
  };
  pintarAhora = pintarEstado;
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
  // --- Pizarra: notas y charlas que dejó el director (CRM web) ---
  const listaPizarra = document.getElementById('pizarra')!;
  const pintarPizarra = async () => {
    const d: any = await fetch('/api/pizarra').then(r => r.json()).catch(() => ({ error: 'Sin conexión con la oficina' }));
    const filas: { tipo: string; autor: string; para: string | null; texto: string; respuesta: string | null; created_at: string }[] = d.pizarra ?? [];
    listaPizarra.innerHTML = '';
    if (!filas.length) {
      const li = document.createElement('li');
      li.className = 'vacio';
      li.textContent = d.error ?? 'Todavía no hay notas. Cada 15 minutos (de 8 a 23 h) los agentes conversan sobre lo que pasó y anotan lo importante.';
      listaPizarra.appendChild(li);
      return;
    }
    for (const f of filas.slice(0, 8)) {
      const li = document.createElement('li');
      li.className = f.tipo;
      li.innerHTML = '<time></time><div><b></b><span></span></div>';
      li.querySelector('time')!.textContent = new Date(f.created_at).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
      li.querySelector('b')!.textContent = f.tipo === 'nota' ? `📌 ${NOMBRE[f.autor] ?? f.autor}` : `${NOMBRE[f.autor] ?? f.autor} → ${NOMBRE[f.para ?? ''] ?? f.para}`;
      li.querySelector('span')!.textContent = f.tipo === 'nota' ? f.texto : `«${f.texto}» — «${f.respuesta ?? ''}»`;
      listaPizarra.appendChild(li);
    }
  };

  await Promise.all([pintarEstado(), pintarEventos(), pintarPizarra()]);
  setInterval(pintarPizarra, 60000);
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

// --- Lo que se ve en la oficina y lo que pasa de verdad ---
// La oficina siempre se ve como una oficina (Nicolás, 14-11-2026): los que
// atienden están atentos en su puesto, a veces toman café o acarician a
// Michi. "Actividad real" muestra solo lo que las IA hicieron de verdad
// (/api/actividad, desde los avisos de los servicios).
interface Vista { agent: string; name: string; state: string; task: string | null }
interface Actividad { agent: string; trabajando: boolean; ultima: { texto: string; tipo: string; at: number } | null }
const vista = new Map<string, Vista>();
const actividad = new Map<string, Actividad>();
let pintarAhora: () => void = () => {};
const esAmbiente = (t: string | null) => !t || /^(Repasando|Estudiando|Pensando|Atento|Café|Gato|Charla):/.test(t);
/** Charla en curso que manda el servidor (guion del director del CRM web). */
interface Charla { id: number; de: string; para: string; dice: string; responde: string; at: number }
let charlaEnCurso: Charla | null = null;

/** Frase corta de ambiente para la nube gris (no es trabajo real). */
const FRASES: Record<string, string[]> = {
  ali: ['Atento a Instagram', 'Atento al chat web', 'Atento a Facebook'],
  calificador: ['Atento a chats nuevos', 'Atento al lead score'],
  cierre: ['Atento a las visitas', 'Atento a los correos'],
};
const unoDe = <T,>(l: T[]) => l[Math.floor(Math.random() * l.length)];
function fraseAmbiente(agente: string, state: string, task: string | null) {
  if (state === 'sleeping') return 'Zzz…';
  const t = task ?? '';
  let m: RegExpMatchArray | null;
  if (/^Gato:/.test(t)) return unoDe(['¡Hola, Michi!', 'Michi ♥', '¿Quién es el gatito?']);
  if (/^Charla:/.test(t)) return null;
  if ((m = t.match(/^Pensando: (.*)/))) return `💭 ${m[1]}`;
  if ((m = t.match(/^Café: (.*)/))) return `☕ ${m[1]}`;
  if ((m = t.match(/^(?:Repasando|Estudiando): (.*)/))) return `Repaso: ${m[1]}`;
  if (/^Atento:/.test(t)) return unoDe(FRASES[agente] ?? ['Atento']);
  return null;
}

function textoVista(state: string, task: string | null) {
  if (state === 'sleeping') return 'durmiendo (de noche)';
  if (!task) return ESTADO[state] ?? state;
  let m: RegExpMatchArray | null;
  if ((m = task.match(/^Atento: (.*)/))) return `en su puesto · atento ${m[1]}`;
  if ((m = task.match(/^(?:Repasando|Estudiando): (.*)/))) return `en su puesto · repasando ${m[1]}`;
  if ((m = task.match(/^Pensando: (.*)/))) return `en su puesto · pensando: ${m[1]}`;
  if ((m = task.match(/^Charla: (.*)/))) return `conversando ${m[1]}`;
  if ((m = task.match(/^Café: (.*)/))) return `en la cafetería · ${m[1]}`;
  if ((m = task.match(/^Gato: (.*)/))) return m[1];
  return `trabajando · ${task}`;
}
function claseVista(state: string, task: string | null) {
  if (state === 'working') return esAmbiente(task) ? 'puesto' : 'working';
  if (state === 'speaking') return 'gato';
  return state;
}
function hace(at: number) {
  const min = Math.floor((Date.now() - at) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.floor(min / 60)} h`;
  return `el ${new Date(at).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`;
}
function haceCorto(at: number) {
  const min = Math.floor((Date.now() - at) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h`;
  return `${Math.floor(min / 1440)} d`;
}
function textoReal(a: Actividad | undefined) {
  if (!a) return 'sin datos';
  if (a.trabajando) return `trabajando ahora · ${a.ultima?.texto ?? ''}`;
  if (a.ultima) return `en espera · última tarea ${hace(a.ultima.at)}: ${a.ultima.texto}`;
  return 'en espera · sin tareas esta semana';
}

let modoReal = (() => {
  if (new URLSearchParams(location.search).get('modo') === 'real') return true;
  try { return localStorage.getItem('oficina-modo') === 'real'; } catch { return false; }
})();
const botonReal = document.getElementById('modo-real') as HTMLButtonElement;
function aplicarModo() {
  document.body.classList.toggle('modo-real', modoReal);
  botonReal.setAttribute('aria-pressed', String(modoReal));
  botonReal.textContent = modoReal ? '● Actividad real (activada)' : 'Ver actividad real';
  pintarAhora();
}
botonReal.addEventListener('click', () => {
  modoReal = !modoReal;
  try { localStorage.setItem('oficina-modo', modoReal ? 'real' : 'oficina'); } catch { /* sin almacenamiento */ }
  aplicarModo();
});
aplicarModo();

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

async function cargarFicha(silencioso = false) {
  const pedido = ++fichaPedido;
  const r = rangoFicha();
  const q = fichaQ.value.trim();
  const lista = ficha.querySelector('.tareas')!;
  const resumen = ficha.querySelector('.resumen')!;
  if (!silencioso) {
    lista.innerHTML = '<li class="vacio">Cargando…</li>';
    resumen.innerHTML = '';
  }

  const params = new URLSearchParams({ agente: fichaAgente, desde: r.desde, hasta: r.hasta });
  if (q) params.set('q', q);
  const d: Historial = await fetch(`/api/historial?${params}`).then(x => x.json()).catch(() => ({ error: 'Sin conexión con la oficina' }));
  if (pedido !== fichaPedido) return;
  ficha.querySelector('.actualizado')!.textContent = `actualizado ${new Date().toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour12: false })}`;
  resumen.innerHTML = '';

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

/** "Ahora" de la ficha: lo real arriba, lo que se ve en la oficina abajo. Cada 3 s. */
function pintarAhoraFicha() {
  if (!fichaAgente || !ficha.classList.contains('abierta')) return;
  const r = actividad.get(fichaAgente);
  const v = vista.get(fichaAgente);
  const real = ficha.querySelector<HTMLElement>('.ahora-real')!;
  real.classList.toggle('trabajando', Boolean(r?.trabajando));
  real.textContent = r?.trabajando
    ? `Trabajando ahora: ${r.ultima?.texto ?? ''}`
    : r?.ultima
      ? `En espera. Última tarea ${hace(r.ultima.at)}: ${r.ultima.texto}`
      : 'En espera. Sin tareas registradas esta semana.';
  ficha.querySelector('.ahora-vista')!.textContent = v ? `En la oficina: ${textoVista(v.state, v.task)}` : '';
}

/** Con "Hoy" y sin búsqueda, la lista se pone al día sola. */
function refrescarFicha() {
  if (!fichaAgente || !ficha.classList.contains('abierta')) return;
  if (fichaPeriodo !== 'hoy' || fichaQ.value.trim()) return;
  cargarFicha(true);
}
setInterval(refrescarFicha, 20000);

function abrirFicha(agentId: string) {
  if (!NOMBRE[agentId]) return;
  fichaAgente = agentId;
  ficha.querySelector('h2')!.textContent = NOMBRE[agentId];
  ficha.querySelector('.rol')!.textContent = ROL[NOMBRE[agentId]] ?? '';
  ficha.classList.add('abierta');
  pintarAhoraFicha();
  cargarFicha();
}

const cerrarFicha = () => { ficha.classList.remove('abierta'); fichaAgente = ''; };
ficha.querySelectorAll<HTMLElement>('[data-cerrar]').forEach(el => el.addEventListener('click', cerrarFicha));
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarFicha(); });
ficha.querySelector('.actualizar')!.addEventListener('click', () => { pintarAhora(); cargarFicha(); });
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
[fichaDesde, fichaHasta].forEach(i => i.addEventListener('change', () => cargarFicha()));
ficha.querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); cargarFicha(); });

main().catch(console.error);
