# Solo Poker

Texas Hold'em No-Limit en el navegador: un jugador crea una mesa, comparte el enlace y la partida empieza cuando se llena.

## Estructura

```
packages/engine/     Lógica pura de póker (TypeScript, sin red ni UI)
packages/protocol/   Contrato cliente-servidor: eventos y tipos (validación zod en /schemas)
apps/server/         Servidor Node + Socket.IO (mesas en memoria)
apps/web/            Frontend Angular 22 (standalone + signals) con Tailwind 4
```

## Motor (`@solo-poker/engine`)

Máquina de estados pura: `(estado, acción) → { estado, eventos }`. El azar (`rng`) y el reloj (`now`) se inyectan, así que todo es determinista y testeable.

- Importes siempre en **céntimos enteros** (`1000` = 10,00 €).
- `getPlayerView(state, playerId)` es lo único que debe llegar al cliente: nunca incluye la baraja ni las cartas ajenas.
- Los eventos (`playerActed`, `streetDealt`, `potAwarded`…) sirven para animar la UI.

## Servidor (`@solo-poker/server`)

Una `TableRoom` por mesa: guarda el estado del motor, la conexión de cada jugador y los temporizadores (cuenta atrás de inicio, turno, pausa entre manos y margen de reconexión). Cada jugador recibe su propia vista tras cada cambio; nunca se hace broadcast del estado.

| Cliente → servidor | Respuesta (ack) |
|---|---|
| `table:create` `{ nickname, password, maxPlayers, buyIn }` | `{ tableId, playerId, token }` |
| `table:info` `{ tableId }` | `{ table }` (para la página del enlace) |
| `table:join` `{ tableId, password, nickname }` | `{ tableId, playerId, token }` |
| `table:rejoin` `{ tableId, token }` | `{ tableId, playerId, token }` |
| `table:leave` `{}` | `{}` |
| `game:action` `{ handNumber, action }` | `{}` |

Servidor → cliente: `table:view`, `game:events`, `table:countdown`, `session:replaced`.

Variables de entorno: `PORT` (3000), `HOST` (0.0.0.0) y `CORS_ORIGIN` (lista separada por comas; si no se define, se acepta cualquier origen). En producción: `CORS_ORIGIN=https://solo-poker.app`.

## Web (`@solo-poker/web`)

Rutas: `/` (inicio), `/crear` (nueva mesa) y `/mesa/:id` (unirse, sala de espera y partida). `TableService` guarda la última vista recibida en un signal; el servidor es la única fuente de verdad. La sesión (token) se guarda en `localStorage` para reconectar tras recargar o perder la conexión.

En desarrollo, `ng serve` reenvía `/socket.io` al servidor (puerto 3000) con `proxy.conf.json`, así que web y servidor comparten origen. Los paquetes del monorepo se excluyen del pre-empaquetado de Vite (`prebundle.exclude` en `angular.json`) porque se consumen como TypeScript.

En pantallas de 1024 px o más, la partida se muestra como una mesa ovalada con los rivales alrededor; en móvil, en columna.

**Iconos de jugador:** cada jugador elige un icono al crear o unirse, y no se puede repetir en la misma mesa. Se guarda como texto: `e:🦊` (cualquier emoji, sin coste de descarga) o `p:spade` (predeterminado: SVG plano dibujado en [avatar-presets.ts](apps/web/src/app/ui/avatar-presets.ts)). Para añadir un predeterminado, añade su id en [avatars.ts](packages/protocol/src/avatars.ts) y su dibujo en `avatar-presets.ts`. El servidor solo acepta un emoji único o un id de la lista.

**Sonidos:** se sintetizan con Web Audio en [sound.service.ts](apps/web/src/app/core/sound.service.ts) (sin ficheros de audio). Cada sonido es una "receta" corta de osciladores y ruido filtrado; para retocar uno, cambia sus frecuencias, volumen (`peak`) o duración (`decay`). Se pueden silenciar desde la cabecera de la mesa.

El enlace con clave lleva la clave en el fragmento (`/mesa/K7X-92Q#k=clave`): el fragmento nunca se envía al servidor y la app lo borra de la barra de direcciones al leerlo.

## Comandos

```bash
npm install
npm run dev          # servidor (3000) + web (4200), accesibles desde la red local
npm test
npm run typecheck
npm run build        # build de producción de la web en apps/web/dist
```

Para probar varios jugadores en el mismo navegador, usa un origen distinto para cada uno (por ejemplo `http://localhost:4200` y `http://test.localhost:4200`): las pestañas del mismo origen comparten `localStorage` y, por tanto, la sesión.
