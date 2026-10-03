// Rango de días que se pueden ver y editar en la app.
// IMPORTANTE: si cambiás estos valores, cambiá también reservas_nodo__dias_historia()
// y reservas_nodo__dias_adelante() en Supabase (supabase/reservas-nodo.sql),
// que son las que validan en la base, borran lo viejo y reservan los turnos fijos.

/** Días hacia atrás que se guardan (historial). Lo anterior se borra solo. */
export const DIAS_HISTORIA = 90

/** Días hacia adelante en los que se puede reservar. */
export const DIAS_ADELANTE = 60