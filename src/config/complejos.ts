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
}

const HORARIOS = ['10:00', '11:30', '13:00', '14:30', '16:00', '17:30', '19:00', '20:30', '22:00', '23:30']

export const COMPLEJOS: Complejo[] = [
  {
    id: 'nodo',
    nombre: 'NODO',
    tituloImagen: 'NODO',
    canchas: ['C1', 'C2', 'C3'],
    horarios: HORARIOS,
    estilo: 'nodo',
  },
]

export const complejoPorId = (id: ComplejoId) => COMPLEJOS.find((c) => c.id === id)!
