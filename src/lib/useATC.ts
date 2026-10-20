import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { TABLA } from '../config/db'
import type { Complejo } from '../config/complejos'
import { esPasado } from '../config/limites'
import { sincronizarATC, type ResultadoATC } from './atc'
import { SesionVencida } from './turnos'

// Sin refresco periódico: la base se mantiene sola con Supabase Cron (5' antes de cada turno).
const AL_VOLVER = 15 * 60 * 1000 // al volver a la app, si pasó más que esto desde la última consulta

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
 * Mantiene la tabla igual a ATC para el día que se está viendo: consulta al abrir, al cambiar de día,
 * al tocar "Actualizar" y al volver a la app (si pasaron más de 15 minutos). Los días pasados no se
 * consultan (son de solo lectura).
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
  const ultimaMs = useRef(0)
  const fechaActual = useRef(fecha)
  fechaActual.current = fecha
  const callbacks = useRef({ alVencer, alTerminar })
  callbacks.current = { alVencer, alTerminar }

  // desde cuándo hay datos de ATC del día (los turnos que empezaron antes son "sin dato")
  const cargarPrimera = useCallback(async (f: string) => {
    if (!activo) return
    const { data } = await supabase.from(TABLA.atcConsultas).select('primera').eq('fecha', f).maybeSingle()
    if (f === fechaActual.current) setPrimera((data as { primera: string | null } | null)?.primera ?? null)
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
      cargarPrimera(f)
      setError(null)
      ultimaMs.current = Date.now()
      callbacks.current.alTerminar?.()
    } catch (e) {
      if (e instanceof SesionVencida) callbacks.current.alVencer()
      else if (f === fechaActual.current) setError((e as Error).message)
    } finally {
      enCurso.current = false
      setConsultando(false)
    }
  }, [activo, complejo, token, cargarPrimera])

  // al abrir (o refrescar) y cada vez que cambia el día
  useEffect(() => {
    setResultado(null)
    setUltima(null)
    setError(null)
    setPrimera(undefined)
    cargarPrimera(fecha)
    actualizar()
  }, [fecha, actualizar, cargarPrimera])

  // al volver a la app (sin polling periódico)
  useEffect(() => {
    if (!activo) return
    const alVolver = () => {
      if (document.visibilityState === 'visible' && Date.now() - ultimaMs.current > AL_VOLVER) actualizar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [activo, actualizar])

  return { activo, consultando, ultima, resultado, error, actualizar, informe, cerrarInforme: () => setInforme(null), primera }
}