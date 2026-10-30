import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Base de datos de prueba: PGlite (Postgres embebido) servido por socket, o un Postgres
    // real si se define PRUEBAS_DATABASE_URL. Ver test/preparacion-global.ts
    globalSetup: ['test/preparacion-global.ts'],
    // Una sola conexión a la base: los archivos de prueba se ejecutan uno tras otro
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
