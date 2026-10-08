// Nombres de tablas y funciones en Supabase. Todo lo de esta app vive bajo un mismo prefijo,
// así convive con otros complejos en la misma base. Para replicar la app, se cambia solo PREFIJO.
const PREFIJO = 'reservas_nodo'

export const TABLA = {
  turnos: `${PREFIJO}_turnos`,
  contactos: `${PREFIJO}_contactos`,
  fijos: `${PREFIJO}_fijos`,
  atcConsultas: `${PREFIJO}_atc_consultas`,
} as const

export const RPC = {
  login: `${PREFIJO}_login`,
  validar: `${PREFIJO}_validar`,
  logout: `${PREFIJO}_logout`,
  setEstado: `${PREFIJO}_set_estado`,
  contactoGuardar: `${PREFIJO}_contacto_guardar`,
  contactoEliminar: `${PREFIJO}_contacto_eliminar`,
  contactoMover: `${PREFIJO}_contacto_mover`,
  fijosSincronizar: `${PREFIJO}_fijos_sincronizar`,
  fijoPrevisualizar: `${PREFIJO}_fijo_previsualizar`,
  fijoGuardar: `${PREFIJO}_fijo_guardar`,
  fijoEliminar: `${PREFIJO}_fijo_eliminar`,
  atcSincronizar: `${PREFIJO}_atc_sincronizar`,
} as const

// Claves de localStorage: otras apps del mismo dominio (federicoolego.github.io) lo comparten.
export const CLAVE_SESION = 'nodo-reservas:sesion:v1'
export const CLAVE_AUTH = 'nodo-reservas:auth'