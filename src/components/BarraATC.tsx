import { useEffect, useRef, useState } from 'react'
import type { EstadoATC } from '../lib/useATC'
import { esPasado } from '../config/limites'
import { textoActualizado } from '../lib/fechas'

const AYUDA_ATC =
  'Trae de ATC los turnos ocupados del día que estás viendo y te muestra qué cambió. ' +
  'La tabla también se actualiza sola: al abrir la app, al cambiar de día, cada 5 minutos y al volver a la pestaña.'

function IconoActualizar({ girando }: { girando: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={girando ? 'animate-spin' : ''}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

/** Botón para forzar la consulta a ATC (muestra el popup con los cambios) */
export function BotonATC({ atc }: { atc: EstadoATC }) {
  return (
    <button onClick={() => atc.actualizar({ informar: true })} disabled={atc.consultando}
      title={AYUDA_ATC} aria-label="Actualizar desde ATC"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-escudo px-3 py-2 font-tablero text-lg font-bold leading-none text-white disabled:opacity-70">
      <IconoActualizar girando={atc.consultando} />
      {atc.consultando ? 'Actualizando…' : 'Actualizar'}
    </button>
  )
}

/** Ícono ⓘ que al tocarlo explica cómo se actualiza la tabla desde ATC (sirve en celu, donde no hay tooltip) */
export function InfoATC() {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: Event) => ref.current && !ref.current.contains(e.target as Node) && setAbierto(false)
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [abierto])
  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button type="button" onClick={() => setAbierto(!abierto)} aria-label="Cómo se actualiza desde ATC" aria-expanded={abierto}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-tinta/50 text-[11px] font-bold leading-none text-tinta hover:border-noche hover:text-noche">
        i
      </button>
      {abierto && (
        <span role="tooltip"
          className="absolute left-1/2 top-7 z-20 w-64 -translate-x-1/2 rounded-xl bg-noche px-3 py-2.5 text-xs font-normal leading-snug text-white shadow-xl">
          {AYUDA_ATC}
        </span>
      )}
    </span>
  )
}

/**
 * Estado de ATC fuera de la tabla. Con soloErrores (pestaña Turnos, donde el estado va junto al
 * contador) solo aparece si la consulta falló; si no, muestra "Actualizado: ..." y el botón.
 */
export default function BarraATC({ atc, fecha, soloErrores = false }: { atc: EstadoATC; fecha: string; soloErrores?: boolean }) {
  if (!atc.activo || esPasado(fecha)) return null
  if (atc.error) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-rojo/10 px-3 py-2 text-rojo">
        <span className="flex-1 text-sm font-medium">{atc.error}</span>
        {!soloErrores && <BotonATC atc={atc} />}
      </div>
    )
  }
  if (soloErrores) return null
  return (
    <div className="flex items-center gap-3 rounded-xl bg-escudo/10 px-3 py-2 text-noche">
      <span className="flex-1 text-sm">
        {atc.ultima
          ? <>Actualizado: <strong className="font-semibold">{textoActualizado(atc.ultima, 'ATC')}</strong></>
          : 'Consultando reservas en ATC…'}
        <InfoATC />
      </span>
      <BotonATC atc={atc} />
    </div>
  )
}