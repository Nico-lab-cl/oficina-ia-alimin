# Oficina IA Alimin

Oficina en pixel art donde se ven trabajar en vivo los agentes de IA de Alimin: **Ali** (atiende el chat web, Instagram y Facebook), el **Calificador** (lee las conversaciones y suma al lead score) y **Cierre** (acompaña a quien ya llegó a la visita).

Basada en [Miniverse](https://github.com/ianscott313/miniverse) (licencia MIT, ver `LICENSE-miniverse`).

## Cómo funciona

- `server.js` arranca el servidor de Miniverse, sirve la oficina construida (`dist/`) y protege todo con usuario y contraseña.
- Los servicios de Alimin avisan lo que hacen sus agentes con `POST /api/heartbeat` y `POST /api/act`, con el header `x-ia-secret` (el mismo `IA_SECRET` de los demás servicios).
- Sin trabajo, los agentes pasean; tras 3 minutos sin avisos se duermen y despiertan con el siguiente aviso.
- Nunca se mandan datos de clientes: solo el canal y la acción.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `OFICINA_USUARIO` | Usuario para entrar a mirar (por defecto `alimin`) |
| `OFICINA_CLAVE` | Contraseña para entrar a mirar. Sin ella nadie puede entrar |
| `IA_SECRET` | El mismo secreto de los demás servicios de Alimin |
| `PORT` | Puerto (por defecto 3000) |

En los servicios que avisan (sitio, CRM web, CRM móvil): `OFICINA_IA_URL` con la URL de esta oficina.

## Probar en local

```bash
npm install
OFICINA_CLAVE=prueba IA_SECRET=secreto npm run dev
```

```bash
curl -X POST localhost:3000/api/heartbeat -H "x-ia-secret: secreto" -H "Content-Type: application/json" -d '{"agent":"ali","name":"Ali","state":"working","task":"Atendiendo Instagram"}'
```
