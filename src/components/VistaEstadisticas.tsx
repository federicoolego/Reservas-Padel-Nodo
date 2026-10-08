import { useEffect, useState, type ReactNode } from 'react'
import type { Complejo } from '../config/complejos'
import { ddmm } from '../lib/fechas'
import {
  cargarEstadisticas, conclusiones, DIAS_CORTOS, DIAS_LARGOS, pct, puntos, variacion,
  type Celda, type Estadisticas, type Periodo,
} from '../lib/estadisticas'

const PERIODOS: Periodo[] = [7, 15, 30]

/** ▲ 6 pts / ▼ 3% / = 0 pts */
function Variacion({ v, unidad }: { v: number | null; unidad: string }) {
  if (v === null) return <span className="inline-flex whitespace-nowrap rounded-full bg-niebla px-2 py-0.5 text-xs font-semibold text-tinta">sin datos</span>
  const cls = v > 0 ? 'bg-cesped/10 text-cesped' : v < 0 ? 'bg-rojo/10 text-rojo' : 'bg-niebla text-tinta'
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {v > 0 ? '▲' : v < 0 ? '▼' : '='} {Math.abs(v)}{unidad}
    </span>
  )
}

const Tarjeta = ({ titulo, sub, children }: { titulo: string; sub: string; children: ReactNode }) => (
  <section className="rounded-2xl border border-linea bg-white p-4">
    <h2 className="font-tablero text-2xl font-extrabold leading-tight text-noche">{titulo}</h2>
    <p className="mb-3 text-xs text-tinta">{sub}</p>
    {children}
  </section>
)

const Kpi = ({ titulo, valor, children }: { titulo: string; valor: ReactNode; children: ReactNode }) => (
  <div className="rounded-2xl border border-linea bg-white p-3">
    <p className="text-xs font-semibold text-tinta">{titulo}</p>
    <p className="mt-0.5 font-tablero text-4xl font-extrabold leading-none text-noche">{valor}</p>
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{children}</div>
  </div>
)

const Barra = ({ p, tono = 'normal' }: { p: number | null; tono?: 'alto' | 'bajo' | 'normal' }) => (
  <div className="h-3.5 overflow-hidden rounded-full bg-niebla">
    <div className={`h-full rounded-full ${tono === 'alto' ? 'bg-noche' : tono === 'bajo' ? 'bg-escudo/40' : 'bg-escudo'}`} style={{ width: `${p ?? 0}%` }} />
  </div>
)

/** texto con **negritas** */
const ConNegritas = ({ t }: { t: string }) => (
  <>{t.split('**').map((x, i) => (i % 2 ? <strong key={i} className="font-semibold">{x}</strong> : x))}</>
)

export default function VistaEstadisticas({ complejo }: { complejo: Complejo }) {
  const [periodo, setPeriodo] = useState<Periodo>(7)
  const [datos, setDatos] = useState<Estadisticas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setError(null)
    cargarEstadisticas(complejo, periodo)
      .then((d) => vigente && setDatos(d))
      .catch((e) => vigente && setError((e as Error).message))
      .finally(() => vigente && setCargando(false))
    return () => { vigente = false }
  }, [complejo, periodo])

  const filtros = (
    <div className="flex gap-2">
      {PERIODOS.map((p) => (
        <button key={p} onClick={() => setPeriodo(p)}
          className={`rounded-full border px-4 py-2 text-sm font-semibold ${p === periodo ? 'border-noche bg-noche text-white' : 'border-linea bg-white text-tinta'}`}>
          {p} días
        </button>
      ))}
    </div>
  )

  if (error) return <div className="space-y-3">{filtros}<p className="rounded-xl bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p></div>
  if (!datos) return <div className="space-y-3">{filtros}<p className="py-10 text-center text-tinta">Calculando estadísticas…</p></div>

  const { actual: a, anterior: b } = datos
  if (!a.total.reservados && !b.total.reservados) {
    return <div className="space-y-3">{filtros}<p className="rounded-2xl border border-linea bg-white px-4 py-10 text-center text-tinta">Todavía no hay reservas registradas en este período.</p></div>
  }

  const H = complejo.horarios
  const pctH = H.map((h) => pct(a.porHora[h]))
  const conDatos = H.map((h, i) => ({ h, p: pctH[i] })).filter((x) => x.p !== null) as { h: string; p: number }[]
  const orden = [...conDatos].sort((x, y) => y.p - x.p)
  const tops = new Set(orden.slice(0, 3).map((x) => x.h))
  const bajos = new Set(orden.slice(-3).map((x) => x.h))
  const pctD = a.porDia.map(pct)
  const maxD = Math.max(...pctD.map((x) => x ?? -1))
  const iDia = pctD.indexOf(maxD)
  const pico = orden[0]
  const cuadro = (c: Celda | undefined) => {
    const p = pct(c)
    if (p === null) return { style: { background: 'repeating-linear-gradient(45deg,#F2F6F4,#F2F6F4 4px,#E3ECE8 4px,#E3ECE8 8px)' }, texto: '' }
    return { style: { background: `rgba(15,90,78,${0.06 + (0.94 * p) / 100})`, color: p > 45 ? '#fff' : '#042D29' }, texto: `${p}%` }
  }
  const lista = conclusiones(complejo, datos)

  return (
    <div className="space-y-3.5">
      {filtros}
      <p className="-mt-1 text-xs text-tinta">
        Del <strong className="text-noche">{ddmm(datos.desde)} al {ddmm(datos.hasta)}</strong> · comparado con{' '}
        <strong className="text-noche">{ddmm(datos.prevDesde)} al {ddmm(datos.prevHasta)}</strong>
        {cargando && ' · actualizando…'}
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <Kpi titulo="Ocupación promedio" valor={<>{pct(a.total) ?? 0}<span className="text-lg text-tinta">%</span></>}>
          <Variacion v={puntos(a.total, b.total)} unidad=" pts" />
          {pct(b.total) !== null && <span className="text-[11px] text-tinta">vs {pct(b.total)}%</span>}
        </Kpi>
        <Kpi titulo="Turnos reservados" valor={a.total.reservados}>
          <Variacion v={variacion(a.total.reservados, b.total.reservados)} unidad="%" />
          <span className="text-[11px] text-tinta">vs {b.total.reservados}</span>
        </Kpi>
        <Kpi titulo="Horario más pedido" valor={pico?.h ?? '—'}>
          {pico && <span className="rounded-full bg-niebla px-2 py-0.5 text-xs font-semibold text-tinta">{pico.p}% ocupado</span>}
          {pico && <Variacion v={puntos(a.porHora[pico.h], b.porHora[pico.h])} unidad=" pts" />}
        </Kpi>
        <Kpi titulo="Día más fuerte" valor={iDia >= 0 ? DIAS_LARGOS[iDia][0].toUpperCase() + DIAS_LARGOS[iDia].slice(1) : '—'}>
          {iDia >= 0 && <span className="rounded-full bg-niebla px-2 py-0.5 text-xs font-semibold text-tinta">{maxD}% ocupado</span>}
          {iDia >= 0 && <Variacion v={puntos(a.porDia[iDia], b.porDia[iDia])} unidad=" pts" />}
        </Kpi>
      </div>

      <Tarjeta titulo="¿Cuándo se llena?" sub="Ocupación por día y horario. Cuanto más oscuro, más reservado.">
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: '44px repeat(7, 1fr)' }}>
          <div />
          {DIAS_CORTOS.map((d) => <div key={d} className="pb-0.5 text-center font-tablero text-sm font-bold text-tinta">{d}</div>)}
          {H.map((h) => (
            <div key={h} className="contents">
              <div className="flex items-center font-tablero text-[13px] font-bold text-tinta">{h}</div>
              {DIAS_CORTOS.map((_, d) => {
                const c = cuadro(a.porCelda[`${d}|${h}`])
                return <div key={d} className="flex h-[26px] items-center justify-center rounded-md text-[10.5px] font-semibold" style={c.style}>{c.texto}</div>
              })}
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-tinta">
          0% <span className="inline-block h-2 w-24 rounded" style={{ background: 'linear-gradient(90deg,rgba(15,90,78,.08),rgba(15,90,78,1))' }} /> 100%
          <span className="ml-2.5 inline-block h-2 w-3.5 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg,#F2F6F4,#F2F6F4 2px,#D9E4E0 2px,#D9E4E0 4px)' }} /> cerrado
        </div>
      </Tarjeta>

      <Tarjeta titulo="Por horario" sub="Ocupación de cada turno en el período y cuánto cambió.">
        {H.map((h, i) => (
          <div key={h} className="grid items-center gap-2 py-1" style={{ gridTemplateColumns: '52px 1fr 40px 64px' }}>
            <span className="font-tablero text-base font-bold">{h}</span>
            <Barra p={pctH[i]} tono={tops.has(h) ? 'alto' : bajos.has(h) ? 'bajo' : 'normal'} />
            <span className="text-right text-[13px] font-semibold">{pctH[i] === null ? '—' : `${pctH[i]}%`}</span>
            <span className="flex justify-center"><Variacion v={puntos(a.porHora[h], b.porHora[h])} unidad=" pts" /></span>
          </div>
        ))}
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {[['🔥 Más pedidos', orden.slice(0, 3)], ['💤 Menos pedidos', [...orden].reverse().slice(0, 3)]].map(([t, xs]) => (
            <div key={t as string} className="rounded-xl bg-niebla px-2.5 py-2">
              <p className="mb-1 text-[11px] font-semibold text-tinta">{t as string}</p>
              {(xs as { h: string; p: number }[]).map((x) => (
                <div key={x.h} className="flex justify-between py-0.5 text-[13px]"><b className="font-tablero text-[15px] font-bold">{x.h}</b><span>{x.p}%</span></div>
              ))}
            </div>
          ))}
        </div>
      </Tarjeta>

      <Tarjeta titulo="Por día" sub="Ocupación promedio de cada día de la semana.">
        <div className="flex h-[150px] items-end justify-between gap-2 px-1">
          {DIAS_CORTOS.map((d, i) => {
            const v = puntos(a.porDia[i], b.porDia[i])
            return (
              <div key={d} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-semibold">{pctD[i] === null ? '—' : `${pctD[i]}%`}</span>
                <div className={`w-full rounded-t-lg rounded-b ${i === iDia ? 'bg-noche' : 'bg-escudo'}`} style={{ height: `${pctD[i] ?? 0}px` }} />
                <span className="font-tablero text-[15px] font-bold text-tinta">{d}</span>
                <span className={`text-[10.5px] font-semibold ${v === null || v === 0 ? 'text-tinta' : v > 0 ? 'text-cesped' : 'text-rojo'}`}>
                  {v === null ? '—' : `${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${Math.abs(v)} pts`}
                </span>
              </div>
            )
          })}
        </div>
      </Tarjeta>

      <Tarjeta titulo="Por cancha" sub="Turnos reservados y ocupación de cada cancha.">
        {complejo.canchas.map((ca) => (
          <div key={ca} className="grid items-center gap-2 py-1" style={{ gridTemplateColumns: '34px 1fr 100px 64px' }}>
            <span className="font-tablero text-base font-bold">{ca}</span>
            <Barra p={pct(a.porCancha[ca])} />
            <span className="text-right text-[13px] font-semibold">{a.porCancha[ca].reservados} turnos · {pct(a.porCancha[ca]) ?? 0}%</span>
            <span className="flex justify-center"><Variacion v={puntos(a.porCancha[ca], b.porCancha[ca])} unidad=" pts" /></span>
          </div>
        ))}
      </Tarjeta>

      {lista.length > 0 && (
        <Tarjeta titulo="Para tener en cuenta" sub="Lo que surge de los números del período.">
          {lista.map((c, i) => (
            <div key={i} className={`flex gap-2.5 py-2.5 ${i ? 'border-t border-linea' : 'pt-0.5'}`}>
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-base" style={{ background: c.fondo }}>{c.icono}</span>
              <p className="text-[13px] leading-snug text-noche"><ConNegritas t={c.texto} /></p>
            </div>
          ))}
        </Tarjeta>
      )}

      <p className="px-2.5 text-center text-[11px] text-tinta">
        La ocupación se calcula sobre los turnos que el club tuvo habilitados en ATC: los horarios cerrados no cuentan.
        Los días anteriores a esta versión no tienen el horario del club y cuentan toda la grilla.
      </p>
    </div>
  )
}