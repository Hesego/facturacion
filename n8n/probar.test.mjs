// Pruebas de los workflows de n8n sin levantar n8n: ejecuta el JavaScript de los nodos Code
// con eventos de ejemplo (la misma forma del payload de la API) y revisa la estructura.
//   node --test n8n/        ·  MUESTRAS=carpeta node --test n8n/   (además guarda los correos en HTML)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CREDENCIALES, generar } from './generar.mjs';

const TOKEN = 'token-secreto-de-prueba';
const ENV = { N8N_WEBHOOK_TOKEN: TOKEN, APP_URL: 'http://localhost:8080', MAIL_FROM: 'Gastos <g@hesego.test>' };
const workflows = generar();

/** Ejecuta el nodo Code `nombre` de un workflow como lo haría n8n (modo «todos los ítems»). */
async function ejecutar(archivo, nombre, items, env = ENV) {
  const nodo = workflows[archivo].nodes.find((n) => n.name === nombre);
  const $input = { first: () => items[0], all: () => items };
  const fn = new Function('$input', '$env', `return (async () => {\n${nodo.parameters.jsCode}\n})();`);
  return fn($input, env);
}

const persona = (email, nombre) => ({ id: 1, email, nombre });
const evento = (o = {}) => ({
  outbox_id: '7a1c3e5e-0000-4000-a000-000000000001',
  tipo: 'transaccion.avanzada',
  version_payload: 1,
  evento: { id: 10, tipo: 'transaccion.avanzada', ocurrido_en: '2026-10-29T15:00:00Z' },
  transaccion: {
    id: 12, consecutivo: 'GTO-2026-000012', estado: 'en_curso', valor: '1850000.00', valor_formateado: '$ 1.850.000',
    descripcion: 'Botas dieléctricas <para> cuadrillas', facturas: ['FE-4101'], proveedor: null, solicitante: 'Carolina Ruiz',
    asignado: 'Julián Ortiz', area: 'Seguridad y salud en el trabajo', url: 'http://localhost:8080/transacciones/12',
  },
  etapa_origen: { codigo: 'SOL', nombre: 'Solicitud de gasto' },
  etapa_destino: { codigo: 'RQ', nombre: 'Requerimiento', sla_dias: 3 },
  actor: { nombre: 'Carolina Ruiz', email: 'contabilidad1@hesego.test' },
  motivo: null,
  comentario: null,
  observaciones: [
    { fecha: '2026-10-28T14:00:00Z', actor: 'Carolina Ruiz', etapa: 'Solicitud de gasto', tipo: 'avanzada', texto: 'Favor montar el RQ <urgente>' },
    { fecha: '2026-10-29T15:00:00Z', actor: 'Carolina Ruiz', etapa: 'Solicitud de gasto', tipo: 'avanzada', texto: 'Con prioridad' },
  ],
  destinatarios: {
    responsables: [persona('ops.sst@hesego.test', 'Julián Ortiz')],
  },
  ...o,
});
const webhook = (cuerpo, token = TOKEN) => [{ json: { headers: { 'x-webhook-token': token }, body: cuerpo } }];

const muestras = process.env.MUESTRAS && path.resolve(process.env.MUESTRAS);
const guardar = (nombre, html) => { if (muestras) { fs.mkdirSync(muestras, { recursive: true }); fs.writeFileSync(path.join(muestras, `${nombre}.html`), html); } };

describe('Estructura de los workflows', () => {
  for (const [archivo, wf] of Object.entries(workflows)) {
    it(`${archivo}: nodos únicos, conexiones válidas y credenciales conocidas`, () => {
      const nombres = new Set(wf.nodes.map((n) => n.name));
      assert.equal(nombres.size, wf.nodes.length, 'nombres de nodo repetidos');
      for (const [origen, { main }] of Object.entries(wf.connections)) {
        assert.ok(nombres.has(origen), `conexión desde nodo inexistente ${origen}`);
        for (const salida of main) for (const c of salida) assert.ok(nombres.has(c.node), `conexión hacia nodo inexistente ${c.node}`);
      }
      for (const n of wf.nodes) {
        for (const c of Object.values(n.credentials ?? {})) {
          assert.ok(Object.values(CREDENCIALES).some((k) => k.id === c.id && k.name === c.name), `credencial desconocida en ${n.name}`);
        }
        if (n.type === 'n8n-nodes-base.code') assert.doesNotThrow(() => new Function('$input', '$env', `return (async () => {${n.parameters.jsCode}})()`), `JS inválido en ${n.name}`);
      }
      assert.match(wf.id, /^[a-zA-Z0-9]{16}$/);
    });
  }

  it('los webhooks coinciden con las rutas que usa el relay de la API', () => {
    const rutas = Object.values(workflows).flatMap((w) => w.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook').map((n) => n.parameters.path));
    const relay = fs.readFileSync(new URL('../apps/api/src/servicios/relay-outbox.ts', import.meta.url), 'utf8');
    const delRelay = [...new Set([...relay.matchAll(/'(gastos-[a-z]+)'/g)].map((m) => m[1]))];
    assert.deepEqual(rutas.sort(), delRelay.sort());
  });

  it('los JSON del repo están al día con n8n/fuente (ejecute node n8n/generar.mjs)', () => {
    for (const [archivo, wf] of Object.entries(workflows)) {
      const enDisco = fs.readFileSync(new URL(`./workflows/${archivo}`, import.meta.url), 'utf8');
      assert.equal(enDisco, `${JSON.stringify(wf, null, 2)}\n`, `${archivo} desactualizado`);
    }
  });
});

describe('1 · Equipo responsable', () => {
  it('rechaza un token inválido', async () => {
    await assert.rejects(ejecutar('1-notificar-responsables.json', 'Preparar mensajes', webhook(evento(), 'otro')), /Token de webhook inválido/);
  });

  it('avisa a cada responsable de la nueva etapa, con clave idempotente y HTML escapado', async () => {
    const r = await ejecutar('1-notificar-responsables.json', 'Preparar mensajes', webhook(evento({ comentario: 'Con prioridad' })));
    assert.equal(r.length, 1);
    const m = r[0].json;
    assert.equal(m.para, 'ops.sst@hesego.test');
    assert.equal(m.canal, 'correo');
    assert.equal(m.clave, '7a1c3e5e-0000-4000-a000-000000000001:responsables:correo:ops.sst@hesego.test');
    assert.equal(m.asunto, 'Botas dieléctricas <para> cuadrillas [GTO-2026-000012]', 'el asunto es el que escribió el solicitante');
    assert.equal(m.de, '"Carolina Ruiz vía Gastos Hesego" <g@hesego.test>', 'muestra a quien la envió, desde la cuenta de la plataforma');
    assert.equal(m.responder_a, 'contabilidad1@hesego.test', 'las respuestas le llegan a quien la envió');
    assert.match(m.html, /El plazo es de 3 días hábiles/);
    assert.match(m.html, /FE-4101/);
    assert.match(m.html, /Seguridad y salud en el trabajo/);
    assert.match(m.html, /&lt;para&gt;/, 'la descripción debe ir escapada');
    assert.match(m.html, /Observación de Carolina Ruiz/, 'la observación del actor anterior va destacada');
    assert.match(m.html, /Observaciones anteriores[\s\S]*Favor montar el RQ &lt;urgente&gt;/, 'el historial lleva las anteriores, escapadas');
    assert.equal((m.html.match(/Con prioridad/g) || []).length, 1, 'la última no se repite en el historial');
    assert.match(m.html, /href="http:\/\/localhost:8080\/transacciones\/12"/);
    guardar('1-nueva-etapa', m.html);
  });

  it('en una devolución muestra el motivo', async () => {
    const r = await ejecutar('1-notificar-responsables.json', 'Preparar mensajes', webhook(evento({
      tipo: 'transaccion.devuelta', motivo: 'El pantallazo no es legible', etapa_origen: { codigo: 'AP', nombre: 'Aprobación del RQ' },
      actor: { nombre: 'Marcela Díaz', email: 'lider.sst@hesego.test' },
    })));
    assert.equal(r[0].json.asunto, 'Devuelto: Botas dieléctricas <para> cuadrillas [GTO-2026-000012]');
    assert.match(r[0].json.html, /El pantallazo no es legible/);
    guardar('1-devolucion', r[0].json.html);
  });

  it('en una reasignación avisa a la nueva persona con el motivo', async () => {
    const r = await ejecutar('1-notificar-responsables.json', 'Preparar mensajes', webhook(evento({
      tipo: 'transaccion.reasignada', motivo: 'Vacaciones de Julián', etapa_origen: { codigo: 'RQ', nombre: 'Requerimiento' },
      actor: { nombre: 'Carolina Ruiz', email: 'contabilidad1@hesego.test' },
      destinatarios: { responsables: [persona('ops.tics@hesego.test', 'Natalia Gómez')] },
    })));
    assert.equal(r[0].json.para, 'ops.tics@hesego.test');
    assert.equal(r[0].json.asunto, 'Reasignado: Botas dieléctricas <para> cuadrillas [GTO-2026-000012]');
    assert.match(r[0].json.html, /Vacaciones de Julián/);
  });

  it('sin asunto escrito usa el consecutivo; MAIL_FROM vacío usa SMTP_USER', async () => {
    const e = evento();
    e.transaccion.descripcion = null;
    const r = await ejecutar('1-notificar-responsables.json', 'Preparar mensajes', webhook(e), { ...ENV, MAIL_FROM: '', SMTP_USER: 'plataforma@gmail.com' });
    assert.equal(r[0].json.asunto, 'Gasto GTO-2026-000012');
    assert.equal(r[0].json.de, '"Carolina Ruiz vía Gastos Hesego" <plataforma@gmail.com>');
  });

  it('sin responsables (etapa del sistema) responde sin enviar', async () => {
    const e = evento();
    e.destinatarios.responsables = [];
    assert.deepEqual(await ejecutar('1-notificar-responsables.json', 'Preparar mensajes', webhook(e)), [{ json: { vacio: true } }]);
  });
});

describe('1 · Anulación', () => {
  it('avisa solo a quien la tenía pendiente, con el motivo', async () => {
    const e = evento({ tipo: 'transaccion.anulada', motivo: 'Solicitud duplicada', etapa_destino: null,
      actor: { nombre: 'Andrés Mejía', email: 'contabilidad2@hesego.test' } });
    const r = await ejecutar('1-notificar-responsables.json', 'Preparar mensajes', webhook(e));
    assert.deepEqual(r.map((x) => x.json.para), ['ops.sst@hesego.test']);
    assert.equal(r[0].json.asunto, 'Anulado: Botas dieléctricas <para> cuadrillas [GTO-2026-000012]');
    assert.match(r[0].json.html, /Solicitud duplicada/);
    guardar('1-anulacion', r[0].json.html);
  });
});

describe('4 · Cierre', () => {
  it('avisa solo al solicitante', async () => {
    const e = evento({ tipo: 'transaccion.cerrada', actor: null });
    e.destinatarios.responsables = [persona('contabilidad1@hesego.test', 'Carolina Ruiz')];
    const r = await ejecutar('4-notificar-cierre.json', 'Preparar mensajes', webhook(e));
    assert.deepEqual(r.map((x) => x.json.para), ['contabilidad1@hesego.test']);
    assert.equal(r[0].json.asunto, 'Pagado y cerrado: Botas dieléctricas <para> cuadrillas [GTO-2026-000012]');
    assert.equal(r[0].json.de, '"Gastos Hesego" <g@hesego.test>', 'sin actor: remitente de la plataforma');
    assert.equal(r[0].json.responder_a, '');
    assert.match(r[0].json.clave, /:cierre:correo:/);
    guardar('4-cierre', r[0].json.html);
  });
});

describe('3 · Recordatorio de SLA', () => {
  const fila = (o) => ({
    transaccion_id: 4, consecutivo: 'GTO-2026-000004', facturas: 'FE-4104', descripcion: 'Arneses para alturas', valor: '12750000.00',
    etapa_codigo: 'AG', etapa_nombre: 'Aprobación de la OC', sla_dias: 3, dias_habiles_en_etapa: 5, dias_vencida: 2,
    responsables: [persona('gerencia1@hesego.test', 'Ricardo Salazar')], escalar_a: persona('gerencia1@hesego.test', 'Ricardo Salazar'),
    escalar: true, hoy_habil: true, ...o,
  });

  it('un correo por persona con todos sus gastos vencidos, más el escalamiento al líder', async () => {
    const filas = [
      fila(),
      fila({ transaccion_id: 5, consecutivo: 'GTO-2026-000005', etapa_codigo: 'RQ', etapa_nombre: 'Requerimiento', dias_vencida: 1, dias_habiles_en_etapa: 4,
        responsables: [persona('ops.tics@hesego.test', 'Natalia Gómez')], escalar_a: persona('lider.tics@hesego.test', 'Santiago Vargas') }),
      fila({ transaccion_id: 6, consecutivo: 'GTO-2026-000006', responsables: [persona('ops.tics@hesego.test', 'Natalia Gómez')], escalar: false }),
    ];
    const r = (await ejecutar('3-recordatorio-sla.json', 'Preparar recordatorios', filas.map((json) => ({ json })))).map((x) => x.json);
    const resumen = r.map((m) => `${m.tipo}:${m.para}`).sort();
    assert.deepEqual(resumen, ['sla_escalamiento:gerencia1@hesego.test', 'sla_escalamiento:lider.tics@hesego.test',
      'sla_recordatorio:gerencia1@hesego.test', 'sla_recordatorio:ops.tics@hesego.test']);
    const natalia = r.find((m) => m.para === 'ops.tics@hesego.test');
    assert.equal(natalia.asunto, 'Tienes 2 gastos con el plazo vencido');
    assert.match(natalia.clave, /^sla:\d{4}-\d{2}-\d{2}:recordatorio:correo:ops\.tics@hesego\.test$/);
    assert.equal(natalia.transaccion_id, '');
    guardar('3-recordatorio-sla', natalia.html);
    guardar('3-escalamiento-sla', r.find((m) => m.tipo === 'sla_escalamiento').html);
  });

  it('no envía en días no hábiles', async () => {
    assert.deepEqual(await ejecutar('3-recordatorio-sla.json', 'Preparar recordatorios', [{ json: fila({ hoy_habil: false }) }]), []);
  });
});
