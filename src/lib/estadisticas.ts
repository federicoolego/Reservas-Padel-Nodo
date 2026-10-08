import { supabase } from './supabase'
import { TABLA } from '../config/db'
import type { Complejo } from '../config/complejos'
import { hoyISO, sumarDias } from './fechas'
import { diaSemanaDe } from './fijos'

export type Periodo = 7 | 15 | 30
export const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
export const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const DURACION = 90 // minutos de cada turno

/** reservados sobre disponibles (turnos que el club tuvo habilitados) */
export interface Celda { reservados: number; disponibles: number }

export interface Metricas {
  total: Celda
  porHora: Record<string, Celda>
  porDia: Celda[] // 0 = lunes
  porCelda: Record<string, Celda> // `${dia}|${hora}`
  porCancha: Record<string, Celda>
}

export interface Estadisticas {
  desde: string
  hasta: string
  prevDesde: string
  prevHasta: string
  actual: Metricas
  anterior: Metricas
}

interface HorarioDia { abierto: boolean | null; apertura: string | null; cierre: string | null }

const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
const vacia = (): Celda => ({ reservados: 0, disponibles: 0 })
const lunesPrimero = (iso: string) => (diaSemanaDe(iso) + 6) % 7

export function pct(c: Celda | undefined): number | null {
  return c && c.disponibles ? Math.min(100, Math.round((100 * c.reservados) / c.disponibles)) : null
}
/** diferencia en puntos entre dos porcentajes */
export function puntos(a: Celda | undefined, b: Celda | undefined): number | null {
  const pa = pct(a), pb = pct(b)
  return pa === null || pb === null ? null : pa - pb
}
/** variación en % de una cantidad */
export function variacion(a: number, b: number): number | null {
  return b ? Math.round(((a - b) / b) * 100) : null
}

/** ¿El turno estaba habilitado ese día según el horario de ATC? Sin datos de horario, cuenta toda la grilla. */
function habilitado(h: string, hd: HorarioDia | undefined): boolean {
  if (!hd || hd.abierto === null) return true
  if (!hd.abierto) return false
  if (!hd.apertura || !hd.cierre) return true
  const cierra = hd.cierre === '00:00' ? 24 * 60 : min(hd.cierre)
  return min(h) >= min(hd.apertura) && min(h) + DURACION <= cierra
}

function calcular(c: Complejo, desde: string, hasta: string, reservas: Set<string>, horarios: Map<string, HorarioDia>): Metricas {
  const m: Metricas = { total: vacia(), porHora: {}, porDia: DIAS_CORTOS.map(vacia), porCelda: {}, porCancha: {} }
  for (const h of c.horarios) m.porHora[h] = vacia()
  for (const ca of c.canchas) m.porCancha[ca] = vacia()
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    const dia = lunesPrimero(f)
    for (const h of c.horarios) {
      const celda = (m.porCelda[`${dia}|${h}`] ??= vacia())
      const reservadasAca = c.canchas.filter((ca) => reservas.has(`${f}|${ca}|${h}`))
      // si hubo una reserva, el turno estaba habilitado aunque falte el horario de ATC
      if (!habilitado(h, horarios.get(f)) && reservadasAca.length === 0) continue
      for (const ca of c.canchas) {
        const r = reservadasAca.includes(ca) ? 1 : 0
        for (const x of [m.total, m.porHora[h], m.porDia[dia], celda, m.porCancha[ca]]) {
          x.disponibles += 1
          x.reservados += r
        }
      }
    }
  }
  return m
}

/** Trae reservas y horarios del período y del anterior (mismo largo) y calcula todo */
export async function cargarEstadisticas(c: Complejo, periodo: Periodo): Promise<Estadisticas> {
  const hasta = hoyISO()
  const desde = sumarDias(hasta, -(periodo - 1))
  const prevHasta = sumarDias(desde, -1)
  const prevDesde = sumarDias(prevHasta, -(periodo - 1))

  // reservas (de a 1000 filas, que es el máximo por pedido)
  const reservas = new Set<string>()
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase
      .from(TABLA.turnos)
      .select('fecha, cancha, hora')
      .eq('complejo', c.id)
      .eq('estado', 'reservada')
      .gte('fecha', prevDesde)
      .lte('fecha', hasta)
      .order('fecha')
      .range(i, i + 999)
    if (error) throw new Error('No se pudieron cargar las estadísticas. Revisá la conexión.')
    for (const t of data as { fecha: string; cancha: string; hora: string }[]) reservas.add(`${t.fecha}|${t.cancha}|${t.hora}`)
    if (data.length < 1000) break
  }

  // horario del club según ATC (si el complejo usa ATC)
  const horarios = new Map<string, HorarioDia>()
  if (c.atc) {
    const { data } = await supabase.from(TABLA.atcConsultas).select('fecha, abierto, apertura, cierre').gte('fecha', prevDesde).lte('fecha', hasta)
    for (const h of (data ?? []) as (HorarioDia & { fecha: string })[]) horarios.set(h.fecha, h)
  }

  return {
    desde, hasta, prevDesde, prevHasta,
    actual: calcular(c, desde, hasta, reservas, horarios),
    anterior: calcular(c, prevDesde, prevHasta, reservas, horarios),
  }
}

export interface Conclusion { icono: string; fondo: string; texto: string } // texto con **negritas**

/** Conclusiones en texto que salen de los números */
export function conclusiones(c: Complejo, e: Estadisticas): Conclusion[] {
  const { actual: a, anterior: b } = e
  const out: Conclusion[] = []

  // franjas: mañana / tarde / noche × semana / fin de semana
  const franjas = [
    { nombre: 'Mañanas', horas: c.horarios.filter((h) => h < '13:31') },
    { nombre: 'Tardes', horas: c.horarios.filter((h) => h > '13:31' && h < '17:59') },
    { nombre: 'Noches', horas: c.horarios.filter((h) => h >= '18:00') },
  ].filter((f) => f.horas.length)
  const grupos = [
    { nombre: 'de lunes a viernes', dias: [0, 1, 2, 3, 4] },
    { nombre: 'de fin de semana', dias: [5, 6] },
  ]
  const bloques = franjas.flatMap((f) => grupos.map((g) => {
    const celda = vacia()
    for (const d of g.dias) for (const h of f.horas) {
      const x = a.porCelda[`${d}|${h}`]
      if (x) { celda.reservados += x.reservados; celda.disponibles += x.disponibles }
    }
    const rango = f.horas.length > 1 ? `de ${f.horas[0]} a ${f.horas[f.horas.length - 1]}` : `a las ${f.horas[0]}`
    return { texto: `${f.nombre} ${g.nombre} (${rango})`, p: pct(celda) }
  })).filter((x) => x.p !== null) as { texto: string; p: number }[]

  const flojo = [...bloques].sort((x, y) => x.p - y.p)[0]
  if (flojo && flojo.p <= 35)
    out.push({ icono: '💡', fondo: 'rgba(210,218,31,.3)', texto: `**${flojo.texto}** vienen flojas: promedian **${flojo.p}%**. Buen lugar para una promo o para ofrecer turnos fijos.` })
  const lleno = [...bloques].sort((x, y) => y.p - x.p)[0]
  if (lleno && lleno.p >= 75)
    out.push({ icono: '🔥', fondo: 'rgba(15,90,78,.12)', texto: `**${lleno.texto}** están casi siempre llenas (**${lleno.p}%**). Evitar seguir sumando fijos en estos horarios.` })

  // el día que más cambió respecto al período anterior
  const cambios = DIAS_LARGOS.map((d, i) => ({ d, v: puntos(a.porDia[i], b.porDia[i]) })).filter((x) => x.v !== null) as { d: string; v: number }[]
  const baja = [...cambios].sort((x, y) => x.v - y.v)[0]
  const sube = [...cambios].sort((x, y) => y.v - x.v)[0]
  if (baja && baja.v <= -5) out.push({ icono: '📉', fondo: 'rgba(200,50,58,.1)', texto: `**El ${baja.d} bajó ${-baja.v} pts** respecto al período anterior.` })
  else if (sube && sube.v >= 5) out.push({ icono: '📈', fondo: 'rgba(46,139,87,.12)', texto: `**El ${sube.d} subió ${sube.v} pts** respecto al período anterior.` })

  // cancha más y menos elegida
  const canchas = c.canchas.map((ca) => ({ ca, p: pct(a.porCancha[ca]) })).filter((x) => x.p !== null) as { ca: string; p: number }[]
  if (canchas.length > 1) {
    const orden = [...canchas].sort((x, y) => y.p - x.p)
    const dif = orden[0].p - orden[orden.length - 1].p
    if (dif >= 5) out.push({ icono: '🏆', fondo: 'rgba(46,139,87,.12)', texto: `**${orden[0].ca} es la más elegida** (${orden[0].p}%). ${orden[orden.length - 1].ca} quedó ${dif} pts por debajo.` })
  }
  return out
}