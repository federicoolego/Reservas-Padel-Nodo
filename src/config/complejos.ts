// Configuración de complejos, canchas y horarios.
// Para sumar/renombrar una cancha o cambiar un horario, se edita solo este archivo.
// Los contactos de la imagen se editan desde la app (tabla reservas_nodo_contactos).
// Si se agrega un complejo, sumar también su id al check "complejo in (...)" de las tablas en Supabase.

export type ComplejoId = 'nodo'

export interface Complejo {
  id: ComplejoId
  nombre: string            // como se muestra en la app
  tituloImagen: string      // nombre del complejo en la imagen
  canchas: string[]         // el orden es el de las columnas
  horarios: string[]        // HH:MM
  estilo: 'nodo'            // diseño de la imagen
  // Reservas tomadas por ATC (atcsports.io): id de cancha en ATC -> nombre de cancha en esta app
  atc?: { canchas: Record<string, string> }
  // false: la fuente de reservas es ATC. La tabla es de solo lectura, se actualiza sola desde ATC y la
  // pestaña Fijos no se muestra. Poné true para volver a reservar/liberar a mano y usar turnos fijos.
  reservasManuales: boolean
}

// Siempre HH:MM con cero adelante ('09:00', no '9:00'): la base valida ese formato y ordena como texto.
const HORARIOS = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00']

export const COMPLEJOS: Complejo[] = [
  {
    id: 'nodo',
    nombre: 'NODO',
    tituloImagen: 'NODO',
    canchas: ['C1', 'C2', 'C3'],
    horarios: HORARIOS,
    estilo: 'nodo',
    atc: { canchas: { '6261': 'C1', '6262': 'C2', '6263': 'C3' } }, // Cancha Padel 1, 2 y 3 en ATC
    reservasManuales: false, // la fuente de reservas es ATC (ver arriba)
  },
]

export const complejoPorId = (id: ComplejoId) => COMPLEJOS.find((c) => c.id === id)!

/** El login pide "Tu nombre" solo si algún complejo tiene reservas manuales (queda registrado en cada cambio) */
export const PIDE_NOMBRE = COMPLEJOS.some((c) => c.reservasManuales)