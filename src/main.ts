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
      sleeping: { sheet: 'actions', row: 1, frames: 2, speed: 0.8 },
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
  const tooltip = document.getElementById('tooltip')!;
  const statusBar = document.getElementById('status-bar')!;

  const sceneData = await fetch(`${basePath}/world.json`).then(r => r.json()).catch(() => null);

  // Collect work anchor names from props for citizen placement
  const workAnchors: string[] = (sceneData?.props ?? [])
    .flatMap((f: any) => (f.anchors ?? []).filter((a: any) => a.type === 'work').map((a: any) => a.name));

  const gridCols = sceneData?.gridCols ?? 16;
  const gridRows = sceneData?.gridRows ?? 12;
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
      position: workAnchors[i] ?? sceneData?.wanderPoints?.[i]?.name ?? `wander_${i}`,
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

  const syncProps = () => {
    mv.setTypedLocations(props.getLocations());
    mv.updateWalkability(props.getBlockedTiles());
  };
  syncProps();
  props.onSave(syncProps);

  await mv.start();

  mv.addLayer({ order: 5, render: (ctx) => props.renderBelow(ctx) });
  mv.addLayer({ order: 15, render: (ctx) => props.renderAbove(ctx) });

  // Sin editor: en EasyPanel la oficina solo se mira.

  // --- Ficha al tocar un agente ---
  mv.on('citizen:click', (data: unknown) => {
    const d = data as { name: string; state: string; task: string | null };
    tooltip.style.display = 'block';
    tooltip.querySelector('.name')!.textContent = d.name;
    tooltip.querySelector('.state')!.textContent = ESTADO[d.state] ?? d.state;
    tooltip.querySelector('.task')!.textContent = d.task ?? ROL[d.name] ?? '';
    setTimeout(() => { tooltip.style.display = 'none'; }, 4000);
  });

  container.addEventListener('mousemove', (e) => {
    tooltip.style.left = e.clientX + 12 + 'px';
    tooltip.style.top = e.clientY + 12 + 'px';
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
      const hora = new Date(ev.timestamp).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' });
      li.innerHTML = '<time></time><b></b><span></span>';
      li.querySelector('time')!.textContent = hora;
      li.querySelector('b')!.textContent = NOMBRE[ev.agentId] ?? ev.agentId;
      li.querySelector('span')!.textContent = ev.action.message;
      registro.prepend(li);
      while (registro.children.length > 12) registro.lastChild!.remove();
    }
    if (typeof d.lastEventId === 'number') ultimoEvento = d.lastEventId;
    if (!registro.children.length) registro.innerHTML = '<li class="vacio">Todavía no hay movimiento. Cuando un agente trabaje, aparece aquí.</li>';
    else registro.querySelector('.vacio')?.remove();
  };
  await Promise.all([pintarEstado(), pintarEventos()]);
  setInterval(pintarEstado, 3000);
  setInterval(pintarEventos, 3000);
}

const ORDEN = ['ali', 'calificador', 'cierre', 'competencia', 'anuncios', 'mercado'];

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

main().catch(console.error);
