// Relay del outbox: entrega a n8n los eventos que la API escribió en `outbox_eventos` dentro de
// cada transición. n8n solo notifica; un evento queda «enviado» cuando TODOS sus webhooks
// responden 2xx. n8n es idempotente (notificaciones_log), así que reintentar no duplica correos.
//
// Varias instancias de la API pueden correr el relay a la vez: cada lote se reserva con
// FOR UPDATE SKIP LOCKED y una reserva temporal (`proximo_intento` en el futuro).
import { sql } from 'kysely';
import type { BD } from '../db/conexion.js';

/** A qué workflows de n8n va cada tipo de evento (ruta del webhook bajo N8N_WEBHOOK_BASE). */
export const RUTAS_N8N: Record<string, string[]> = {
  'transaccion.avanzada': ['gastos-responsables', 'gastos-seguimiento'],
  'transaccion.devuelta': ['gastos-responsables', 'gastos-seguimiento'],
  'transaccion.reasignada': ['gastos-responsables'],
  'transaccion.anulada': ['gastos-seguimiento'],
  'transaccion.cerrada': ['gastos-cierre'],
};

export interface OpcionesRelay {
  /** p. ej. http://n8n:5678/webhook */
  baseUrl: string;
  token: string;
  intervaloMs?: number;
  lote?: number;
  maxIntentos?: number;
  /** Tiempo que un lote queda reservado mientras se entrega. */
  reservaSegundos?: number;
  timeoutMs?: number;
  log?: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void; error: (o: object, m?: string) => void };
}

interface Fila {
  id: string;
  tipo: string;
  payload: Record<string, unknown>;
  intentos: number;
}

/** Espera antes del siguiente intento: 30 s, 1, 2, 4, 8… minutos, máximo 1 hora. */
export const esperaReintento = (intentos: number) => Math.min(30 * 2 ** Math.max(intentos - 1, 0), 3600);

export class RelayOutbox {
  private temporizador: NodeJS.Timeout | null = null;
  private corriendo = false;
  private pendienteDespertar = false;
  private readonly o: Required<Omit<OpcionesRelay, 'log'>> & Pick<OpcionesRelay, 'log'>;

  constructor(private readonly db: BD, opciones: OpcionesRelay) {
    this.o = { intervaloMs: 15_000, lote: 20, maxIntentos: 10, reservaSegundos: 120, timeoutMs: 30_000, ...opciones };
  }

  iniciar() {
    this.temporizador = setInterval(() => void this.despertar(), this.o.intervaloMs);
    void this.despertar();
  }

  async detener() {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
    while (this.corriendo) await new Promise((r) => setTimeout(r, 50));
  }

  /** Procesa ya (lo llama el LISTEN de Postgres). Si está ocupado, repite al terminar. */
  async despertar() {
    if (this.corriendo) { this.pendienteDespertar = true; return; }
    this.corriendo = true;
    try {
      do {
        this.pendienteDespertar = false;
        while ((await this.procesarLote()) === this.o.lote) { /* hay más pendientes */ }
      } while (this.pendienteDespertar);
    } catch (e) {
      this.o.log?.error({ err: e }, 'Relay del outbox: error procesando lote');
    } finally {
      this.corriendo = false;
    }
  }

  /** Reserva y entrega un lote. Devuelve cuántos eventos tomó. */
  async procesarLote(): Promise<number> {
    const { rows } = await sql<Fila>`
      UPDATE outbox_eventos o
         SET proximo_intento = now() + make_interval(secs => ${this.o.reservaSegundos}),
             intentos = o.intentos + 1
       WHERE o.id IN (SELECT id FROM outbox_eventos
                       WHERE estado = 'pendiente' AND proximo_intento <= now()
                       ORDER BY creado_en
                       LIMIT ${this.o.lote}
                       FOR UPDATE SKIP LOCKED)
      RETURNING o.id, o.tipo, o.payload, o.intentos`.execute(this.db);

    for (const fila of rows) await this.entregar(fila);
    return rows.length;
  }

  private async entregar(f: Fila) {
    const rutas = RUTAS_N8N[f.tipo] ?? [];
    try {
      for (const ruta of rutas) {
        const r = await fetch(`${this.o.baseUrl.replace(/\/$/, '')}/${ruta}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': this.o.token },
          body: JSON.stringify({ outbox_id: f.id, tipo: f.tipo, ...f.payload }),
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
        if (!r.ok) throw new Error(`${ruta} respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
      }
      await sql`UPDATE outbox_eventos SET estado = 'enviado', procesado_en = now(), ultimo_error = NULL WHERE id = ${f.id}::uuid`.execute(this.db);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (f.intentos >= this.o.maxIntentos) {
        await sql`UPDATE outbox_eventos SET estado = 'fallido', ultimo_error = ${error} WHERE id = ${f.id}::uuid`.execute(this.db);
        this.o.log?.error({ outbox: f.id, tipo: f.tipo, intentos: f.intentos, error }, 'Evento del outbox marcado como fallido');
      } else {
        await sql`UPDATE outbox_eventos
                     SET proximo_intento = now() + make_interval(secs => ${esperaReintento(f.intentos)}), ultimo_error = ${error}
                   WHERE id = ${f.id}::uuid`.execute(this.db);
        this.o.log?.warn({ outbox: f.id, tipo: f.tipo, intentos: f.intentos, error }, 'No se pudo entregar a n8n; se reintentará');
      }
    }
  }
}
