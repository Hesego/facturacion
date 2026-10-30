import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Los activos de marca viven en /brand en la raíz del repo (archivos maestros de Comunicaciones).
// Se sirven en /brand durante el desarrollo y se copian al build. Si faltan, la app usa marcadores.
const DIR_MARCA = path.resolve(__dirname, '../../brand');

function activosDeMarca(): Plugin {
  const tipos: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  return {
    name: 'activos-de-marca',
    configureServer(server) {
      server.middlewares.use('/brand', (req, res, next) => {
        const archivo = path.join(DIR_MARCA, decodeURIComponent((req.url ?? '').split('?')[0]!));
        if (!archivo.startsWith(DIR_MARCA) || !tipos[path.extname(archivo)] || !fs.existsSync(archivo)) return next();
        res.setHeader('Content-Type', tipos[path.extname(archivo)]!);
        fs.createReadStream(archivo).pipe(res);
      });
    },
    writeBundle(opciones) {
      const destino = path.join(opciones.dir!, 'brand');
      const copiar = (origen: string, hacia: string) => {
        for (const e of fs.readdirSync(origen, { withFileTypes: true })) {
          const o = path.join(origen, e.name), d = path.join(hacia, e.name);
          if (e.isDirectory()) copiar(o, d);
          else if (tipos[path.extname(e.name)]) { fs.mkdirSync(hacia, { recursive: true }); fs.copyFileSync(o, d); }
        }
      };
      if (fs.existsSync(DIR_MARCA)) copiar(DIR_MARCA, destino);
    },
  };
}

export default defineConfig({
  plugins: [react(), activosDeMarca()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
