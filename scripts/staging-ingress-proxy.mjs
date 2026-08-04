import { createServer, request } from 'node:http';

const targets = new Map([
  ['api', 3001],
  ['web', 3000],
]);
const target = process.env.INGRESS_TARGET;
const port = targets.get(target);

if (port === undefined) {
  throw new Error('INGRESS_TARGET must be api or web');
}

const stripHopByHopHeaders = (headers) => {
  const filtered = { ...headers };
  for (const name of [
    'connection',
    'keep-alive',
    'proxy-connection',
    'transfer-encoding',
    'upgrade',
  ]) {
    delete filtered[name];
  }
  return filtered;
};

const server = createServer((incoming, outgoing) => {
  const url = new URL(incoming.url ?? '/', 'http://relay.invalid');
  const upstream = request(
    {
      hostname: target,
      port,
      method: incoming.method,
      path: `${url.pathname}${url.search}`,
      headers: stripHopByHopHeaders(incoming.headers),
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, stripHopByHopHeaders(response.headers));
      response.pipe(outgoing);
    },
  );

  upstream.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.pipe(upstream);
});

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

process.on('SIGTERM', () => server.close());
server.listen(port, '0.0.0.0');
