// Respuestas de la API (ver docs/api.md y apps/api/src/dominio/consultas.ts).
import type { ItemRequisito, RequisitosEtapa, TipoReferencia } from '@gastos/shared';

export type Semaforo = 'verde' | 'amarillo' | 'naranja' | 'rojo';
export type Estado = 'en_curso' | 'pagada' | 'anulada';
export type TipoEtapa = 'ejecucion' | 'aprobacion' | 'sistema';

export interface Yo {
  id: number;
  nombre: string;
  email: string;
  equipos: string[];
}

export interface Persona { id: number; nombre: string; email: string }
export interface AreaConMiembros { id: number; codigo: string; nombre: string; miembros: Persona[] }
/** A quién se puede enviar: por área si el equipo las tiene, si no directo a las personas. */
export interface OpcionesDestino { miembros: Persona[]; areas: AreaConMiembros[] }

export interface Catalogos {
  etapas: { id: number; codigo: string; nombre: string; grupo: string; orden: number; tipo: TipoEtapa; sla_dias: number; requisitos: RequisitosEtapa; miembros: Persona[]; areas: AreaConMiembros[] }[];
  areas: { id: number; codigo: string; nombre: string; equipo: string }[];
}

export interface Pendiente {
  id: number;
  consecutivo: string;
  valor: string | null;
  descripcion: string | null;
  facturas: string | null;
  asignado_a: number | null;
  asignado_nombre: string | null;
  area_id: number | null;
  area_nombre: string | null;
  etapa_codigo: string;
  etapa_nombre: string;
  etapa_grupo: string;
  sla_dias: number;
  en_etapa_desde: string;
  dias_habiles_en_etapa: number;
  semaforo: Semaforo;
  vencida: boolean;
  version: number;
  creado_en: string;
  /** Lo último que escribió quien la envió, devolvió o reasignó (solo en «Mis pendientes»). */
  ultima_observacion?: string | null;
  ultima_observacion_de?: string | null;
}

export interface FilaListado {
  id: number;
  consecutivo: string;
  valor: string | null;
  descripcion: string | null;
  facturas: string | null;
  estado: Estado;
  creado_en: string;
  cerrado_en: string | null;
  asignado_nombre: string | null;
  area_nombre: string | null;
  etapa_codigo: string;
  etapa_nombre: string;
  etapa_grupo: string;
  dias_habiles_en_etapa: number | null;
  semaforo: Semaforo | null;
  vencida: boolean | null;
}

export interface Listado {
  total: number;
  pagina: number;
  porPagina: number;
  filas: FilaListado[];
}

export interface Transaccion {
  id: number;
  consecutivo: string;
  valor: string | null;
  descripcion: string | null;
  estado: Estado;
  version: number;
  en_etapa_desde: string;
  creado_en: string;
  cerrado_en: string | null;
  asignado_a: number | null;
  solicitante: Persona | null;
  asignado: Persona | null;
  area: { id: number; nombre: string } | null;
  dias_habiles_en_etapa?: number;
  semaforo?: Semaforo;
  vencida?: boolean;
  sla_dias?: number;
}

export interface Detalle {
  transaccion: Transaccion;
  etapa: {
    id: number; codigo: string; nombre: string; grupo: string; tipo: TipoEtapa; descripcion: string | null;
    referencia: { tipo: TipoReferencia; etiqueta: string } | null;
    documentos: { tipo: string; etiqueta: string; min: number }[];
  };
  siguiente: { codigo: string; nombre: string; tipo: TipoEtapa } | null;
  flujo: { id: number; codigo: string; nombre: string; grupo: string; orden: number; tipo: TipoEtapa }[];
  requisitos: ItemRequisito[];
  acciones: {
    avanzar: boolean;
    devolver: boolean;
    anular: boolean;
    reasignar: boolean;
    registrarFacturas: boolean;
    adjuntar: boolean;
    etiquetaAvanzar: string;
    etiquetaDevolver: string;
    comentarioObligatorio: boolean;
    bloqueoSegregacion: string | null;
    destino: OpcionesDestino;
    devolverA: { etapa: string; persona: string | null } | null;
    reasignacion: OpcionesDestino;
  };
  referencias: { id: number; tipo: TipoReferencia; numero: string; activa: boolean; registrada_en: string; inactivada_motivo: string | null; registrada_por: string }[];
  facturas: {
    id: number; numero: string; proveedor_nit: string | null; proveedor_nombre: string | null; fecha: string | null; valor: string | null;
    cufe: string | null; adjunto_id: number; xml_adjunto_id: number | null;
    activa: boolean; inactivada_motivo: string | null; registrada_en: string; registrada_por: string;
  }[];
  adjuntos: {
    id: number; tipo: string; nombre_original: string; mime: string; tamano_bytes: number; sha256: string; activo: boolean;
    inactivado_motivo: string | null; subido_en: string; subido_por: string; etapa_codigo: string; etapa_nombre: string;
  }[];
  historial: {
    id: number; tipo: string; motivo: string | null; datos: Record<string, unknown>; ocurrido_en: string; actor: string | null;
    origen_codigo: string | null; origen_nombre: string | null; destino_codigo: string | null; destino_nombre: string | null;
  }[];
  comentarios: { id: number; texto: string; creado_en: string; autor: string; etapa_codigo: string }[];
}

export interface Tablero {
  totales: {
    en_curso: number; valor_en_curso: string; vencidas: number; pagadas_mes: number; valor_pagado_mes: string; anuladas_mes: number;
    ciclo_dias_habiles: number | null; pagadas_180: number;
  };
  etapas: {
    id: number; codigo: string; nombre: string; grupo: string; sla_dias: number; valor: string;
    verde: number; amarillo: number; naranja: number; rojo: number; en_curso: number;
    tramos: number; promedio_dias_habiles: number | null; promedio_horas: number | null;
  }[];
  areas: { area_id: number | null; area: string; equipo: string | null; en_curso: number; vencidas: number }[];
  atascadas: (Pick<Pendiente, 'id' | 'consecutivo' | 'descripcion' | 'facturas' | 'asignado_nombre' | 'area_nombre' | 'valor' | 'etapa_codigo' | 'etapa_nombre' | 'sla_dias' | 'dias_habiles_en_etapa' | 'semaforo' | 'en_etapa_desde'> & { equipo_codigo: string | null })[];
}

// --- Administración ---
export interface UsuarioAdmin {
  id: number; email: string; nombre: string; cargo: string | null; activo: boolean; proveedor_auth: string;
  ultimo_acceso: string | null; creado_en: string; equipos: string[]; asignadas: number; areas: number[];
}
export interface EquipoAdmin {
  id: number; codigo: string; nombre: string; descripcion: string | null; activo: boolean;
  lider_usuario_id: number | null; lider_nombre: string | null; miembros: number; etapas: string[] | null;
}
export interface AreaAdmin {
  id: number; equipo_id: number; equipo: string; codigo: string; nombre: string; activa: boolean; miembros: number; en_curso: number;
}
export interface EtapaAdmin {
  id: number; codigo: string; nombre: string; descripcion: string | null; grupo: string; orden: number; tipo: TipoEtapa;
  equipo_id: number | null; sla_dias: number;
  etapa_devolucion_id: number | null; segregacion: boolean; requisitos: RequisitosEtapa; activa: boolean; en_curso: number;
}
export interface ConfigAdmin { clave: string; valor: unknown; descripcion: string; actualizado_en: string; editable: boolean }
