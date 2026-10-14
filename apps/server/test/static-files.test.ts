import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPokerServer } from '../src/server';

const INDEX = '<!doctype html><title>Solo Poker</title>';
const BUNDLE = `console.log(${JSON.stringify('x'.repeat(4000))});`;

let dir: string;
let server: ReturnType<typeof createPokerServer>;
let url: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'solo-poker-static-'));
  writeFileSync(join(dir, 'index.html'), INDEX);
  writeFileSync(join(dir, 'main-QD73VWP3.js'), BUNDLE);
  writeFileSync(join(dir, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
  server = createPokerServer({ staticDir: dir });
  url = `http://127.0.0.1:${await server.listen(0, '127.0.0.1')}`;
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('web estática', () => {
  it('sirve index.html en la raíz sin caché', async () => {
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(INDEX);
  });

  it('devuelve index.html en las rutas de Angular', async () => {
    const res = await fetch(`${url}/mesa/K7X-92Q`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
  });

  it('cachea para siempre los archivos con hash y los comprime', async () => {
    const res = await fetch(`${url}/main-QD73VWP3.js`, { headers: { 'accept-encoding': 'br, gzip' } });
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('content-encoding')).toBe('br');
    expect(await res.text()).toBe(BUNDLE);
  });

  it('usa gzip si el navegador no acepta brotli', async () => {
    const res = await fetch(`${url}/main-QD73VWP3.js`, { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });

  it('da 404 a archivos que no existen y no sale de la carpeta', async () => {
    expect((await fetch(`${url}/no-existe.js`)).status).toBe(404);
    expect((await fetch(`${url}/..%2F..%2Fpackage.json`)).status).toBe(404);
  });

  it('mantiene el health check', async () => {
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ status: 'ok', tables: 0 });
  });
});
