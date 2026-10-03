# Turnos · NODO Club de Pádel

App para gestionar las reservas de canchas de **NODO** (C1, C2 y C3) y generar la imagen de turnos
libres para compartir por WhatsApp.

- Varias personas cargan reservas a la vez desde el celu o la compu: los cambios se ven al instante en todos los dispositivos (Supabase Realtime).
- Tres pestañas: **Fijos** (turnos que se repiten todas las semanas), **Turnos** (tabla Libre / Reservada, con "¿para quién es la reserva?"; es la que abre al entrar) e **Imagen** (se arma sola con el estado de la tabla; los turnos reservados llevan una pelotita).
- Login genérico: usuario **NODO**. La contraseña se guarda hasheada (bcrypt) en la base, no en el código.

Stack: Vite + React + TypeScript + Tailwind + Supabase. Publicada con GitHub Pages.

## 1. Base de datos

Usa la misma base de Supabase que El Clásico, Defensores y la app de torneos. Todo lleva el prefijo `reservas_nodo_`,
así que no toca nada existente.

En **SQL Editor**:

1. Corré `supabase/reservas-nodo.sql`. Crea tablas, funciones, permisos y tiempo real. Los contactos de la imagen se cargan desde la app. Se puede volver a correr sin romper nada.
2. Corré `crear-usuario-nodo.sql`, después de poner la contraseña en `v_clave` (se entrega aparte y **no se sube al repo**).

Tablas: `reservas_nodo_acceso`, `_sesiones`, `_turnos`, `_contactos`, `_fijos` y `_fijos_excepciones`.

Los nombres de tablas y funciones que usa el front están todos en `src/config/db.ts`.

## 2. Publicar

1. **Settings → Environments → github-pages → Environment variables**: cargá `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (los mismos valores que El Clásico).
2. **Settings → Pages → Source**: elegí **GitHub Actions**.
3. Push a `main`: el workflow compila y publica en `https://federicoolego.github.io/<nombre-del-repo>/`.

## Turnos fijos

Cada fijo se materializa como reservas reales en `reservas_nodo_turnos` (columna `fijo_id`) para los próximos
60 días; nunca pisa un turno ya reservado. La app llama a `reservas_nodo_fijos_sincronizar()` al abrir para correr
la ventana. Si querés que pase aunque nadie abra la app, programalo con pg_cron (comentado al final del script).

## Rango de fechas y limpieza

Se pueden ver y cargar turnos desde hoy - 90 días hasta hoy + 60 días. Lo más viejo que 90 días se borra solo
cada vez que alguien cambia un turno. Para cambiar el rango, editá los dos lugares:
`src/config/limites.ts` (la app) y `reservas_nodo__dias_historia()` / `__dias_adelante()` en el script (la base).

## Cambiar canchas, horarios o teléfonos

Canchas y horarios están en `src/config/complejos.ts`. Los teléfonos de la imagen se editan desde la app
(pestaña Imagen → Contactos de la imagen).

## Cambiar la contraseña

```sql
update public.reservas_nodo_acceso
   set clave_hash = extensions.crypt('ClaveNueva', extensions.gen_salt('bf', 10))
 where usuario = 'NODO';
delete from public.reservas_nodo_sesiones where usuario = 'NODO'; -- cierra las sesiones abiertas
```

No hace falta volver a publicar la app.

## Correr local

```bash
cp .env.example .env   # completar URL y anon key
npm install
npm run dev
```
