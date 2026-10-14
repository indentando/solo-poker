import { readdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';

/*
 * Sirve la web compilada (Angular) desde el mismo proceso que el Socket.IO,
 * así web y servidor comparten origen. La web pesa menos de 1 MB, de modo que
 * al arrancar se carga entera en memoria ya comprimida (brotli y gzip).
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest)|image\/(svg|x-icon))/;
const MIN_COMPRESS_BYTES = 1024;
/** Los JS/CSS de Angular llevan un hash en el nombre (main-QD73VWP3.js): nunca cambian. */
const HASHED_FILE = /-[A-Za-z0-9_-]{8}\.(js|css)$/;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};

interface Asset {
  body: Buffer;
  br?: Buffer;
  gzip?: Buffer;
  type: string;
  cacheControl: string;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

function loadAsset(file: string): Asset {
  const body = readFileSync(file);
  const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
  const compress = COMPRESSIBLE.test(type) && body.length >= MIN_COMPRESS_BYTES;
  return {
    body,
    type,
    br: compress ? brotliCompressSync(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }) : undefined,
    gzip: compress ? gzipSync(body, { level: 9 }) : undefined,
    cacheControl: HASHED_FILE.test(file)
      ? 'public, max-age=31536000, immutable'
      : // index.html y demás: siempre se revalidan, para que cada despliegue se vea al momento.
        'no-cache',
  };
}

/**
 * Devuelve un manejador que responde con la web y `false` si la petición no es
 * suya (para que siga el resto del servidor). Las rutas sin extensión
 * (`/mesa/K7X-92Q`) devuelven index.html: el enrutado lo hace Angular.
 */
export function createStaticHandler(root: string) {
  const assets = new Map<string, Asset>();
  for (const file of walk(root)) {
    assets.set('/' + relative(root, file).split(sep).join('/'), loadAsset(file));
  }
  const index = assets.get('/index.html');
  if (!index) throw new Error(`No se encuentra index.html en ${root}`);

  return (req: IncomingMessage, res: ServerResponse): boolean => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return false;
    }

    // Solo se sirven archivos conocidos (búsqueda exacta en el mapa: sin riesgo de salir de la carpeta).
    const asset = assets.get(path) ?? (extname(path) === '' ? index : undefined);
    if (!asset) return false;

    const accepts = String(req.headers['accept-encoding'] ?? '');
    const [body, encoding] =
      asset.br && /\bbr\b/.test(accepts)
        ? [asset.br, 'br']
        : asset.gzip && /\bgzip\b/.test(accepts)
          ? [asset.gzip, 'gzip']
          : [asset.body, undefined];

    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': asset.type,
      'content-length': body.length,
      'cache-control': asset.cacheControl,
      vary: 'accept-encoding',
      ...(encoding ? { 'content-encoding': encoding } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
