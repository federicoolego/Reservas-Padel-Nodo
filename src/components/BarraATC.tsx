import type { EstadoATC } from '../lib/useATC'
import { esPasado } from '../config/limites'

/** Estado de la sincronización con ATC + botón para forzarla. Se ve en Turnos e Imagen. */
export default function BarraATC({ atc, fecha }: { atc: EstadoATC; fecha: string }) {
  if (!atc.activo) return null
  const pasado = esPasado(fecha)
  const r = atc.resultado

  let texto: string
  if (pasado) texto = 'Día pasado: se muestra lo que quedó registrado de ATC.'
  else if (atc.error) texto = atc.error
  else if (atc.consultando && !atc.hora) texto = 'Consultando reservas en ATC…'
  else if (r && atc.hora)
    texto = `${r.ocupados ? `${r.ocupados} turno${r.ocupados === 1 ? '' : 's'} ocupado${r.ocupados === 1 ? '' : 's'} en ATC` : 'Sin turnos ocupados en ATC'} · actualizado a las ${atc.hora}`
  else texto = 'Reservas de ATC'

  return (
    <div className={`flex items-center gap-3 rounded-xl px-3 py-2 ${atc.error && !pasado ? 'bg-rojo/10 text-rojo' : 'bg-escudo/10 text-noche'}`}>
      <span className="flex-1 text-sm font-medium">{texto}</span>
      {!pasado && (
        <button onClick={atc.actualizar} disabled={atc.consultando}
          className="shrink-0 rounded-lg bg-escudo px-3 py-2 font-tablero text-lg font-bold leading-none text-white disabled:opacity-60">
          {atc.consultando ? 'Consultando…' : 'Reservas ATC'}
        </button>
      )}
    </div>
  )
}