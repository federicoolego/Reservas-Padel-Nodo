import { supabase } from './supabase'
import { RPC } from '../config/db'
import type { Complejo } from '../config/complejos'
import { SesionVencida } from './turnos'
import { ahoraHHMM, hoyISO } from './fechas'

/** Lo que devuelve la Edge Function atc-nodo */
export interface DisponibilidadATC {
  fecha: string
  abierto: boolean
  apertura: string | null
  cierre: string | null
  fuente: 'api' | 'web'
  canchas: { id: string; nombre: string; libres: string[] }[]
}

const DURACION = 90 // minutos de cada turno
const minutos = (h: string) => {
  const [hh, mm] = h.split(':').map(Number)
  return hh * 60 + mm
}

/**
 * Turnos de la grilla que están ocupados en ATC: dentro del horario del club ese día,
 * que todavía no empezaron (ATC no publica los que ya pasaron) y que ATC no muestra como libres.
 * Devuelve claves "cancha|hora" con los nombres de cancha de esta app.
 */
export function ocupadosATC(c: Complejo, d: DisponibilidadATC, ahora = { hoy: hoyISO(), hora: ahoraHHMM() }): string[] {
  if (!c.atc || !d.abierto || !d.apertura || !d.cierre) return []
  const abre = minutos(d.apertura)
  const cierra = d.cierre === '00:00' ? 24 * 60 : minutos(d.cierre)
  const ocupados: string[] = []
  for (const cancha of d.canchas) {
    const nuestra = c.atc.canchas[cancha.id]
    if (!nuestra) continue // cancha de ATC que no está en esta app
    const libres = new Set(cancha.libres)
    for (const h of c.horarios) {
      const m = minutos(h)
      if (m < abre || m + DURACION > cierra) continue // fuera del horario del club en ATC
      if (d.fecha === ahora.hoy && h <= ahora.hora) continue // ya empezó
      if (!libres.has(h)) ocupados.push(`${nuestra}|${h}`)
    }
  }
  return ocupados
}

export interface ResultadoATC {
  ocupados: number
  marcados: number
  liberados: number
}

/** Consulta ATC para la fecha y deja la tabla igual: marca lo ocupado y libera lo que ATC volvió a habilitar */
export async function sincronizarATC(token: string, c: Complejo, fecha: string): Promise<ResultadoATC> {
  const { data, error } = await supabase.functions.invoke<DisponibilidadATC & { error?: string }>('atc-nodo', { body: { fecha } })
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status
    if (status === 404) throw new Error('La función atc-nodo no está publicada en Supabase (404). Revisá Edge Functions.')
    throw new Error('No se pudo consultar ATC. Probá de nuevo en un rato.')
  }
  if (!data || data.error) throw new Error(data?.error ?? 'No se pudo consultar ATC. Probá de nuevo en un rato.')
  const ocupados = ocupadosATC(c, data)
  const { data: r, error: e } = await supabase.rpc(RPC.atcSincronizar, { p_token: token, p_fecha: fecha, p_ocupados: ocupados })
  if (e) {
    if (e.code === '28000') throw new SesionVencida(e.message)
    if (e.code === '22023') throw new Error(e.message)
    throw new Error('No se pudo guardar lo de ATC. Revisá la conexión.')
  }
  const fila = (Array.isArray(r) ? r[0] : r) as { marcados: number; liberados: number }
  return { ocupados: ocupados.length, marcados: fila?.marcados ?? 0, liberados: fila?.liberados ?? 0 }
}