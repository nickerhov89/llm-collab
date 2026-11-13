import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const host = '127.0.0.1';
const port = Number(process.env.OPENROUTER_GATEWAY_PORT ?? '3451');
const models = [
  { id: 'openrouter/auto', object: 'model', owned_by: 'openrouter' },
  { id: 'qwen/qwen3-coder', object: 'model', owned_by: 'qwen' },
];
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: models }));
    return;
  }
  if (!req.url?.startsWith('/v1/') || !req.headers.authorization?.startsWith('Bearer ')) {
    res.writeHead(401);
    res.end();
    return;
  }
  try {
    // Claude Gateway deliberately sends a dummy local credential. Resolve the
    // operator's existing OpenRouter credential here, never in browser state.
    const token = req.headers.authorization === 'Bearer dummy'
      ? (await readFile(process.env.POLZA_OPENROUTER_KEY_FILE ?? join(homedir(), '.config/polza/openrouter-cowork.key'), 'utf8')).trim()
      : req.headers.authorization.slice(7);
    if (!token || token === 'dummy') throw new Error('Missing gateway credential');
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': req.headers['content-type'] ?? 'application/json',
      accept: req.headers.accept ?? 'text/event-stream',
      ...(req.headers['anthropic-version'] ? { 'anthropic-version': req.headers['anthropic-version'] } : {}),
    };
    const upstream = await fetch(`https://openrouter.ai/api${req.url}`, {
      method: req.method,
      headers,
      ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: req, duplex: 'half' }),
      signal: AbortSignal.timeout(300_000),
    });
    // Transport metadata only: never log prompts, request headers or tokens.
    console.info('OpenRouter response', req.method, req.url.split('?')[0], upstream.status);
    const responseHeaders = {};
    for (const name of ['content-type', 'cache-control', 'x-request-id']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    res.writeHead(upstream.status, responseHeaders);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  } catch (error) {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'OpenRouter gateway request failed' } }));
    console.error('upstream request failed:', error instanceof Error ? error.message : String(error));
  }
});
// The local bridge serves SSE. Signal unsupported WebSocket transport locally
// instead of forwarding upgrade probes as authenticated upstream GET requests.
server.on('upgrade', (_req, socket) => {
  socket.end('HTTP/1.1 426 Upgrade Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
});
server.listen(port, host, () => console.log(`OpenRouter gateway listening on ${host}:${port}`));
