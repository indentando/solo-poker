import { networkInterfaces } from 'node:os';
import { createPokerServer } from './server';

const port = Number(process.env.PORT ?? 3000);
// 0.0.0.0 permite conectarse desde otros dispositivos de la red (p. ej. el móvil).
const host = process.env.HOST ?? '0.0.0.0';
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
  : true;

const server = createPokerServer({ corsOrigin });
const actualPort = await server.listen(port, host);

console.log(`Solo Poker server escuchando en http://localhost:${actualPort}`);
// Direcciones de la red local, para probar desde el móvil.
for (const addresses of host === '0.0.0.0' ? Object.values(networkInterfaces()) : []) {
  for (const address of addresses ?? []) {
    if (address.family === 'IPv4' && !address.internal) {
      console.log(`  en tu red local: http://${address.address}:${actualPort}`);
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
