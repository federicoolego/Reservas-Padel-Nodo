-- =====================================================================
-- NODO · Migración 004 · Cambios de ATC
-- Correr UNA vez en el SQL Editor de Supabase, después de la 003 (se puede volver a correr).
--
--   * reservas_nodo_atc_consultas: cuándo se consultó ATC por última vez para cada día.
--   * reservas_nodo_atc_sincronizar ahora devuelve QUÉ turnos marcó y liberó, y cuándo fue la
--     consulta anterior (para el popup de cambios). Cambia el tipo de resultado: se recrea.
-- =====================================================================

-- Última consulta a ATC por día (para informar los cambios "respecto a la última consulta")
create table if not exists public.reservas_nodo_atc_consultas (
  fecha   date primary key,
  ultima  timestamptz not null,
  por     text
);
alter table public.reservas_nodo_atc_consultas enable row level security;
-- Sin políticas: solo se usa desde reservas_nodo_atc_sincronizar.

-- Devuelve qué turnos marcó y cuáles liberó ('cancha|hora', ordenados por hora) y cuándo fue la consulta anterior
drop function if exists public.reservas_nodo_atc_sincronizar(uuid, date, text[]);
create function public.reservas_nodo_atc_sincronizar(p_token uuid, p_fecha date, p_ocupados text[])
returns table (marcados text[], liberados text[], anterior timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := public.reservas_nodo__sesion(p_token);
  v_ocup   text[] := coalesce(p_ocupados, '{}');
  v_m      text[];
  v_l      text[];
  v_ant    timestamptz;
begin
  if p_fecha < public.reservas_nodo__hoy() then
    raise exception 'Solo se puede reservar/cancelar turnos del día o posteriores.' using errcode = '22023';
  end if;
  if p_fecha > public.reservas_nodo__fecha_maxima() then
    raise exception 'Solo se puede reservar hasta el último día del mes próximo.' using errcode = '22023';
  end if;

  -- marcar: ocupado en ATC y libre (o sin fila) acá
  with nuevos as (
    insert into public.reservas_nodo_turnos
           (fecha, complejo, cancha, hora, estado, actualizado_por, actualizado, reservado_para, fijo_id, origen)
    select p_fecha, 'nodo', split_part(o, '|', 1), split_part(o, '|', 2), 'reservada', 'ATC', now(), 'ATC', null, 'atc'
      from unnest(v_ocup) as o
     where o ~ '^[^|]{1,20}[|][0-2][0-9]:[0-5][0-9]$'
    on conflict (fecha, complejo, cancha, hora) do update
       set estado = 'reservada', actualizado_por = 'ATC', actualizado = now(),
           reservado_para = 'ATC', fijo_id = null, origen = 'atc'
     where public.reservas_nodo_turnos.estado <> 'reservada'
    returning cancha, hora
  )
  select coalesce(array_agg(n.cancha || '|' || n.hora order by n.hora, n.cancha), '{}') into v_m from nuevos n;

  -- liberar: marcado por ATC pero ATC ya lo muestra libre (solo turnos que no empezaron)
  with libres as (
    update public.reservas_nodo_turnos t
       set estado = 'libre', reservado_para = null, origen = null,
           actualizado_por = 'ATC', actualizado = now()
     where t.fecha = p_fecha and t.complejo = 'nodo'
       and t.origen = 'atc' and t.estado = 'reservada'
       and not ((t.cancha || '|' || t.hora) = any (v_ocup))
       and public.reservas_nodo__futuro(t.fecha, t.hora)
    returning t.cancha, t.hora
  )
  select coalesce(array_agg(l.cancha || '|' || l.hora order by l.hora, l.cancha), '{}') into v_l from libres l;

  -- registrar esta consulta y devolver la anterior
  select c.ultima into v_ant from public.reservas_nodo_atc_consultas c where c.fecha = p_fecha;
  insert into public.reservas_nodo_atc_consultas (fecha, ultima, por)
  values (p_fecha, now(), v_nombre)
  on conflict (fecha) do update set ultima = excluded.ultima, por = excluded.por;
  delete from public.reservas_nodo_atc_consultas where fecha < public.reservas_nodo__hoy() - public.reservas_nodo__dias_historia();

  return query select v_m, v_l, v_ant;
end;
$$;

revoke all on function public.reservas_nodo_atc_sincronizar(uuid, date, text[]) from public;
grant execute on function public.reservas_nodo_atc_sincronizar(uuid, date, text[]) to anon, authenticated;