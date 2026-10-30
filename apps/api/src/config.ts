import { z } from 'zod';

const booleano = z.enum(['true', 'false']).transform((v) => v === 'true');

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  /** Conexión con el rol gastos_app (nunca con el dueño del esquema). */
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:8080'),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('gastos-soportes'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleano.default('true'),

  /** Base de los webhooks de n8n, p. ej. http://n8n:5678/webhook. Sin ella no hay notificaciones. */
  N8N_WEBHOOK_BASE: z.string().url().optional(),
  N8N_WEBHOOK_TOKEN: z.string().min(8).optional(),

  SESION_HORAS: z.coerce.number().positive().default(10),
  COOKIE_SECURE: booleano.default('false'),
});

export type Config = z.infer<typeof esquema>;

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = esquema.safeParse(env);
  if (!r.success) {
    const faltantes = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuración inválida:\n  ${faltantes}`);
  }
  return r.data;
}
