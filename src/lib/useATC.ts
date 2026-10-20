import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { TABLA } from '../config/db'
import type { Complejo } from '../config/complejos'
import { esPasado } from '../config/limites'
import { sincronizarATC, type ResultadoATC } from './atc'
import { SesionVencida } from './turnos'

// La app NO consulta ATC sola (ni al abrir, ni al cambiar de día, ni cada x tiempo).
// La base se mantiene con Supabase Cron (5' antes de cada turno) y con el botón "Actualizar".
// Al abrir / cambiar de día solo se lee de la base cuándo fue la última actualización, y se escucha
// en tiempo real reservas_nodo_atc_consultas: cuando corre el cron (o alguien toca Actualizar en otro
// dispositivo) el "Actualizado: ..." cambia solo. Los turnos ya llegan en tiempo real por useTurnos.

export interface EstadoATC {
  activo: boolean // el complejo toma reservas por ATC
  consultando: boolean
  ultima: string | null // momento (ISO) de la última consulta que salió bien
  resultado: ResultadoATC | null
  error: string | null
  actualizar: (opciones?: { informar?: boolean }) => void
  informe: ResultadoATC | null // resultado a mostrar en el popup de cambios
  primera: string | null | undefined // desde cuándo hay datos de ATC de ese día (undefined: cargando)
  cerrarInforme: () => void
}

/**
 * Consulta ATC solo cuando se toca "Actualizar" (el resto lo hace el cron 5' antes de cada turno).
 * Al abrir y al cambiar de día lee de la base la última actualización de ese día (sin consultar ATC).
 * Los días pasados no se consultan (son de solo lectura).
 */
export function useSincronizacionATC(complejo: Complejo, fecha: string, token: string, alVencer: () => void, alTerminar?: () => void): EstadoATC {
  const activo = Boolean(complejo.atc)
  const [consultando, setConsultando] = useState(false)
  const [ultima, setUltima] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoATC | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [informe, setInforme] = useState<ResultadoATC | null>(null)
  const [primera, setPrimera] = useState<string | null | undefined>(undefined)
  const enCurso = useRef(false)
  const fechaActual = useRef(fecha)
  fechaActual.current = fecha
  const callbacks = useRef({ alVencer, alTerminar })
  callbacks.current = { alVencer, alTerminar }

  // de la base: última actualización del día (cron o botón) y desde cuándo hay datos de ATC
  // (los turnos que empezaron antes de "primera" son "sin dato")
  const cargarConsulta = useCallback(async (f: string) => {
    if (!activo) return
    const { data } = await supabase.from(TABLA.atcConsultas).select('ultima, primera').eq('fecha', f).maybeSingle()
    if (f !== fechaActual.current) return
    const c = data as { ultima: string | null; primera: string | null } | null
    setUltima(c?.ultima ?? null)
    setPrimera(c?.primera ?? null)
  }, [activo])

  const actualizar = useCallback(async ({ informar = false }: { informar?: boolean } = {}) => {
    const f = fechaActual.current
    if (!activo || enCurso.current || esPasado(f)) return
    enCurso.current = true
    setConsultando(true)
    try {
      const r = await sincronizarATC(token, complejo, f)
      if (f !== fechaActual.current) return // cambiaron de día mientras tanto
      setResultado(r)
      // Popup de cambios desactivado: alcanza con "Actualizado: ..." junto a la tabla.
      // Para volver a mostrarlo al tocar "Actualizar", descomentar la línea de abajo.
      // if (informar) setInforme(r)
      void informar
      setUltima(new Date().toISOString())
      cargarConsulta(f)
      setError(null)
      callbacks.current.alTerminar?.()
    } catch (e) {
      if (e instanceof SesionVencida) callbacks.current.alVencer()
      else if (f === fechaActual.current) setError((e as Error).message)
    } finally {
      enCurso.current = false
      setConsultando(false)
    }
  }, [activo, complejo, token, cargarConsulta])

  // al abrir (o refrescar) y cada vez que cambia el día: solo leer la base, NO consultar ATC
  useEffect(() => {
    setResultado(null)
    setUltima(null)
    setError(null)
    setPrimera(undefined)
    cargarConsulta(fecha)
    if (!activo) return
    // tiempo real: cada sincronización (cron o botón) actualiza la fila del día
    const canal = supabase
      .channel(`atc-consultas:${fecha}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLA.atcConsultas, filter: `fecha=eq.${fecha}` },
        (p) => {
          const c = p.new as { fecha?: string; ultima?: string | null; primera?: string | null } | null
          if (!c?.fecha || c.fecha !== fechaActual.current) return
          setUltima(c.ultima ?? null)
          setPrimera(c.primera ?? null)
        })
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [fecha, activo, cargarConsulta])

  return { activo, consultando, ultima, resultado, error, actualizar, informe, cerrarInforme: () => setInforme(null), primera }
}