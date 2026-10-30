// Tipos de las tablas para Kysely. Reflejan db/migrations; si cambia el esquema, se actualizan aquí.
import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';
import type { TipoReferencia } from '@gastos/shared';

/** timestamptz: se lee como Date, se escribe como Date o texto ISO. */
type Instante = ColumnType<Date, Date | string | undefined, Date | string | null>;
type InstanteNulo = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
/** numeric: pg lo entrega como texto para no perder precisión en pesos. */
type Json<T = unknown> = ColumnType<T, string, string>;

export type EstadoTransaccion = 'en_curso' | 'pagada' | 'anulada';
export type TipoEtapa = 'ejecucion' | 'aprobacion' | 'sistema';
export type MotivoInactivacion = 'reemplazo' | 'anulacion' | 'error_registro';
export type TipoEvento =
  | 'creada' | 'avanzada' | 'devuelta' | 'anulada' | 'cerrada'
  | 'dato_actualizado' | 'referencia_registrada'
  | 'factura_agregada' | 'factura_inactivada'
  | 'adjunto_agregado' | 'adjunto_inactivado'
  | 'comentario' | 'reasignada';

export interface TablaConfiguracion {
  clave: string;
  valor: Json;
  descripcion: string;
  actualizado_en: Generated<Date>;
}

export interface TablaUsuarios {
  id: Generated<number>;
  email: string;
  nombre: string;
  cargo: string | null;
  proveedor_auth: Generated<'local' | 'microsoft'>;
  password_hash: string | null;
  microsoft_oid: string | null;
  activo: Generated<boolean>;
  ultimo_acceso: InstanteNulo;
  creado_en: Generated<Date>;
  actualizado_en: Generated<Date>;
}

export interface TablaEquipos {
  id: Generated<number>;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  lider_usuario_id: number | null;
  activo: Generated<boolean>;
  creado_en: Generated<Date>;
  actualizado_en: Generated<Date>;
}

export interface TablaUsuarioEquipo {
  usuario_id: number;
  equipo_id: number;
  asignado_en: Generated<Date>;
}

export interface TablaAreas {
  id: Generated<number>;
  equipo_id: number;
  codigo: string;
  nombre: string;
  activa: Generated<boolean>;
  creado_en: Generated<Date>;
  actualizado_en: Generated<Date>;
}

export interface TablaUsuarioArea {
  usuario_id: number;
  area_id: number;
  asignado_en: Generated<Date>;
}

export interface TablaCatalogoEtapas {
  id: Generated<number>;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  grupo: string;
  orden: number;
  tipo: TipoEtapa;
  equipo_id: number | null;
  sla_dias: Generated<number>;
  etapa_devolucion_id: number | null;
  segregacion: Generated<boolean>;
  requisitos: ColumnType<unknown, string | undefined, string>;
  activa: Generated<boolean>;
  creado_en: Generated<Date>;
  actualizado_en: Generated<Date>;
}

export interface TablaTransacciones {
  id: Generated<number>;
  consecutivo: Generated<string>;
  valor: ColumnType<string | null, string | null | undefined, string | null>;
  moneda: Generated<string>;
  descripcion: string | null;
  etapa_actual_id: number;
  estado: Generated<EstadoTransaccion>;
  /** Persona que debe actuar ahora (NULL en la etapa del sistema y al cerrar). */
  asignado_a: number | null;
  /** Área (dentro del equipo de la etapa) a la que va la transacción. */
  area_id: Generated<number | null>;
  solicitante_id: number;
  en_etapa_desde: Generated<Date>;
  version: Generated<number>;
  creado_en: Generated<Date>;
  actualizado_en: Generated<Date>;
  cerrado_en: InstanteNulo;
}

export interface TablaAdjuntos {
  id: Generated<number>;
  transaccion_id: number;
  etapa_id: number;
  tipo: string;
  nombre_original: string;
  mime: string;
  tamano_bytes: ColumnType<number, number, number>;
  sha256: string;
  bucket: string;
  object_key: string;
  subido_por: number;
  subido_en: Generated<Date>;
  activo: Generated<boolean>;
  inactivado_en: InstanteNulo;
  inactivado_motivo: MotivoInactivacion | null;
}

export interface TablaReferencias {
  id: Generated<number>;
  transaccion_id: number;
  tipo: TipoReferencia;
  numero: string;
  etapa_id: number;
  registrada_por: number;
  registrada_en: Generated<Date>;
  activa: Generated<boolean>;
  inactivada_en: InstanteNulo;
  inactivada_motivo: MotivoInactivacion | null;
}

export interface TablaFacturas {
  id: Generated<number>;
  transaccion_id: number;
  etapa_id: number;
  numero: string;
  proveedor_nit: string | null;
  proveedor_nombre: string | null;
  fecha: string | null;
  valor: string | null;
  cufe: string | null;
  adjunto_id: number;
  xml_adjunto_id: number | null;
  registrada_por: number;
  registrada_en: Generated<Date>;
  activa: Generated<boolean>;
  inactivada_en: InstanteNulo;
  inactivada_motivo: MotivoInactivacion | null;
}

export interface TablaComentarios {
  id: Generated<number>;
  transaccion_id: number;
  etapa_id: number;
  autor_id: number;
  texto: string;
  creado_en: Generated<Date>;
}

export interface TablaEventos {
  id: Generated<number>;
  transaccion_id: number;
  tipo: TipoEvento;
  etapa_origen_id: number | null;
  etapa_destino_id: number | null;
  actor_id: number | null;
  motivo: string | null;
  datos: ColumnType<Record<string, unknown>, string | undefined, never>;
  txid: Generated<number>;
  ocurrido_en: Generated<Date>;
}

export interface TablaOutboxEventos {
  id: Generated<string>;
  evento_id: number;
  transaccion_id: number;
  tipo: string;
  payload: Json<Record<string, unknown>>;
  estado: Generated<'pendiente' | 'enviado' | 'fallido'>;
  intentos: Generated<number>;
  proximo_intento: Generated<Date>;
  creado_en: Generated<Date>;
  procesado_en: InstanteNulo;
  ultimo_error: string | null;
}

export interface TablaSesiones {
  id: Generated<string>;
  token_hash: string;
  usuario_id: number;
  creada_en: Generated<Date>;
  expira_en: Instante;
  revocada_en: InstanteNulo;
  ip: string | null;
  user_agent: string | null;
}

export interface VistaTransaccionesEnCurso {
  id: number;
  consecutivo: string;
  valor: string | null;
  descripcion: string | null;
  facturas: string | null;
  solicitante_id: number;
  asignado_a: number | null;
  asignado_nombre: string | null;
  area_id: number | null;
  area_nombre: string | null;
  etapa_actual_id: number;
  etapa_codigo: string;
  etapa_nombre: string;
  etapa_grupo: string;
  equipo_id: number | null;
  equipo_codigo: string | null;
  sla_dias: number;
  en_etapa_desde: Date;
  dias_habiles_en_etapa: number;
  semaforo: 'verde' | 'amarillo' | 'naranja' | 'rojo';
  vencida: boolean;
  version: number;
  creado_en: Date;
}

export interface Database {
  configuracion: TablaConfiguracion;
  usuarios: TablaUsuarios;
  equipos: TablaEquipos;
  usuario_equipo: TablaUsuarioEquipo;
  areas: TablaAreas;
  usuario_area: TablaUsuarioArea;
  catalogo_etapas: TablaCatalogoEtapas;
  transacciones: TablaTransacciones;
  adjuntos: TablaAdjuntos;
  referencias: TablaReferencias;
  facturas: TablaFacturas;
  comentarios: TablaComentarios;
  eventos: TablaEventos;
  outbox_eventos: TablaOutboxEventos;
  sesiones: TablaSesiones;
  v_transacciones_en_curso: VistaTransaccionesEnCurso;
}

export type Transaccion = Selectable<TablaTransacciones>;
export type Etapa = Selectable<TablaCatalogoEtapas>;
export type NuevoEvento = Insertable<TablaEventos>;
