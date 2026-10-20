-- =====================================================================
-- NODO · Migración 009 · Tiempo real para la hora de "Actualizado"
-- Correr UNA vez en el SQL Editor de Supabase (se puede volver a correr).
--
-- Los turnos ya llegan en tiempo real (reservas_nodo_turnos está en supabase_realtime).
-- Se suma reservas_nodo_atc_consultas: cada sincronización (cron 5' antes del turno o botón
-- Actualizar) actualiza su fila del día, y las apps abiertas refrescan "Actualizado: ..." sin polling.
-- La lectura pública ya existe (policy "reservas_nodo_atc_consultas lectura publica", migración 006).
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reservas_nodo_atc_consultas'
  ) then
    alter publication supabase_realtime add table public.reservas_nodo_atc_consultas;
  end if;
end $$;

-- verificación: tienen que aparecer turnos, contactos, fijos y atc_consultas
select tablename from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename like 'reservas_nodo%'
 order by 1;
