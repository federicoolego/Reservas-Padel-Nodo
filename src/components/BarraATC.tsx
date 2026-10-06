import type { EstadoATC } from '../lib/useATC'
import { esPasado } from '../config/limites'
import { textoActualizado } from '../lib/fechas'

/** Botón para forzar la consulta a ATC */
export function BotonATC({ atc }: { atc: EstadoATC }) {
  return (
    <button onClick={() => atc.actualizar({ informar: true })} disabled={atc.consultando}
      className="shrink-0 rounded-lg bg-escudo px-3 py-2 font-tablero text-lg font-bold leading-none text-white disabled:opacity-60">
      {atc.consultando ? 'Consultando…' : 'Reservas ATC'}
    </button>
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
      </span>
      <BotonATC atc={atc} />
    </div>
  )
}