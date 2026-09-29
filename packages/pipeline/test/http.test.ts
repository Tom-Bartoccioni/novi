import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchText } from '../src/lib/http';

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.on('error', () => undefined);
    req.socket.on('error', () => undefined);
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(Buffer.alloc(5_000_000, 'a'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Custom-Header': 'Hello' });
    res.end('petit corps');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('fetchText', () => {
  it('truncates the body in streaming without downloading everything', async () => {
    const started = Date.now();
    const page = await fetchText(`${origin}/big`, { maxBytes: 1000 });
    expect(page.status).toBe(200);
    expect(page.body.length).toBeLessThanOrEqual(1000);
    expect(page.body.length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('lowercases header names and exposes the content type', async () => {
    const page = await fetchText(`${origin}/small`);
    expect(page.body).toBe('petit corps');
    expect(page.headers['x-custom-header']).toBe('Hello');
    expect(page.headers['content-type']).toBe('text/plain');
    expect(page.contentType).toBe('text/plain');
  });
});
