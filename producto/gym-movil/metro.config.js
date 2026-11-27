const { getDefaultConfig } = require('expo/metro-config');
const http = require('http');

const config = getDefaultConfig(__dirname);

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      if (req.url && req.url.startsWith('/api/v1')) {
        const headers = { ...req.headers, host: '127.0.0.1:8000' };
        delete headers['ngrok-skip-browser-warning'];

        const proxyReq = http.request(
          {
            hostname: '127.0.0.1',
            port: 8000,
            path: req.url,
            method: req.method,
            headers,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
          }
        );

        proxyReq.on('error', (err) => {
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                detail: {
                  codigo: 'BACKEND_NO_DISPONIBLE',
                  mensaje: `No se pudo conectar con gym-jefe-api en 127.0.0.1:8000 (${err.message})`,
                },
              })
            );
          } else if (!res.writableEnded) {
            res.end();
          }
        });

        req.pipe(proxyReq, { end: true });
        return;
      }
      return middleware(req, res, next);
    };
  },
};

module.exports = config;
