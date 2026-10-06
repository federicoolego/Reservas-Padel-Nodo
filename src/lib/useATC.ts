import { useCallback, useEffect, useRef, useState } from 'react'
import type { Complejo } from '../config/complejos'
import { esPasado } from '../config/limites'
import { sincronizarATC, type ResultadoATC } from './atc'
import { SesionVencida } from './turnos'

const CADA = 5 * 60 * 1000 // refresco automático mientras la app está abierta
const AL_VOLVER = 2 * 60 * 1000 // al volver a la app, si pasó más que esto desde la última consulta

export interface EstadoATC {
  activo: boolean // el complejo toma reservas por ATC
  consultando: boolean
  ultima: string | null // momento (ISO) de la última consulta que salió bien
  resultado: ResultadoATC | null
  error: string | null
  actualizar: (opciones?: { informar?: boolean }) => void
  informe: ResultadoATC | null // resultado a mostrar en el popup de cambios (solo cuando se toca el botón)
  cerrarInforme: () => void
}

/**
 * Mantiene la tabla igual a ATC para el día que se está viendo: consulta al abrir, al cambiar de día,
 * cada 5 minutos y al volver a la app. Los días pasados no se consultan (son de solo lectura).
 */
export function useSincronizacionATC(complejo: Complejo, fecha: string, token: string, alVencer: () => void, alTerminar?: () => void): EstadoATC {
  const activo = Boolean(complejo.atc)
  const [consultando, setConsultando] = useState(false)
  const [ultima, setUltima] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoATC | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [informe, setInforme] = useState<ResultadoATC | null>(null)
  const enCurso = useRef(false)
  const ultimaMs = useRef(0)
  const fechaActual = useRef(fecha)
  fechaActual.current = fecha
  const callbacks = useRef({ alVencer, alTerminar })
  callbacks.current = { alVencer, alTerminar }

  const actualizar = useCallback(async ({ informar = false }: { informar?: boolean } = {}) => {
    const f = fechaActual.current
    if (!activo || enCurso.current || esPasado(f)) return
    enCurso.current = true
    setConsultando(true)
    try {
      const r = await sincronizarATC(token, complejo, f)
      if (f !== fechaActual.current) return // cambiaron de día mientras tanto
      setResultado(r)
      if (informar) setInforme(r)
      setUltima(new Date().toISOString())
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
  }, [activo, complejo, token])

  // al abrir y cada vez que cambia el día
  useEffect(() => {
    setResultado(null)
    setUltima(null)
    setError(null)
    actualizar()
  }, [fecha, actualizar])

  // cada 5 minutos, y al volver a la app
  useEffect(() => {
    if (!activo) return
    const t = window.setInterval(() => document.visibilityState === 'visible' && actualizar(), CADA)
    const alVolver = () => {
      if (document.visibilityState === 'visible' && Date.now() - ultimaMs.current > AL_VOLVER) actualizar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [activo, actualizar])

  return { activo, consultando, ultima, resultado, error, actualizar, informe, cerrarInforme: () => setInforme(null) }
}