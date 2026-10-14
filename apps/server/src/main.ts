import { networkInterfaces } from 'node:os';
import { createPokerServer } from './server';

const port = Number(process.env.PORT ?? 3000);
// 0.0.0.0 permite conectarse desde otros dispositivos de la red (p. ej. el móvil).
const host = process.env.HOST ?? '0.0.0.0';
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
  : true;
// En producción el mismo proceso sirve la web compilada.
const staticDir = process.env.STATIC_DIR || undefined;
const isProduction = process.env.NODE_ENV === 'production';

const server = createPokerServer({ corsOrigin, staticDir });
const actualPort = await server.listen(port, host);

console.log(`Solo Poker server escuchando en http://localhost:${actualPort}`);
if (staticDir) console.log(`  sirviendo la web desde ${staticDir}`);
// Direcciones de la red local, para probar desde el móvil.
if (!isProduction && host === '0.0.0.0') {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        console.log(`  en tu red local: http://${address.address}:${actualPort}`);
      }
    }
  }
}

async function shutdown() {
  console.log('Cerrando servidor…');
  await server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
