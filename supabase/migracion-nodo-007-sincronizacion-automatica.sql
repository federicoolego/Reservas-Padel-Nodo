-- =====================================================================
-- NODO · Migración 007 · Sincronización automática con ATC
-- Correr UNA vez en el SQL Editor de Supabase, después de la 006 (se puede volver a correr).
--
--   * reservas_nodo__atc_aplicar: la lógica de sincronización, sin sesión (uso interno).
--   * reservas_nodo_atc_sincronizar: la que usa la app (igual que antes).
--   * reservas_nodo_atc_sincronizar_servicio: la que usa Supabase Cron vía la Edge Function.
--     Solo la puede ejecutar el servidor (service_role).
--   * reservas_nodo_atc_consultas.primera: desde cuándo hay datos de ATC de cada día. Los turnos
--     que ya habían empezado antes de esa hora se muestran como "Sin dato".
-- =====================================================================

alter table public.reservas_nodo_atc_consultas add column if not exists primera timestamptz;
-- para los días ya consultados no se sabe desde cuándo: se toma la última consulta (lo más prudente)
update public.reservas_nodo_atc_consultas set primera = ultima where primera is null;

drop function if exists public.reservas_nodo__atc_aplicar(text, date, text[], boolean, text, text);
create function public.reservas_nodo__atc_aplicar(
  p_por      text,
  p_fecha    date,
  p_ocupados text[],
  p_abierto  boolean default null,  -- horario del club que informa ATC ese día
  p_apertura text default null,
  p_cierre   text default null
)
returns table (marcados text[], liberados text[], anterior timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := p_por;
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
  insert into public.reservas_nodo_atc_consultas (fecha, ultima, primera, por, abierto, apertura, cierre)
  values (p_fecha, now(), now(), v_nombre, p_abierto,
          case when p_apertura ~ '^[0-2][0-9]:[0-5][0-9]$' then p_apertura end,
          case when p_cierre   ~ '^[0-2][0-9]:[0-5][0-9]$' then p_cierre end)
  on conflict (fecha) do update
     set ultima = excluded.ultima, por = excluded.por,
         primera  = coalesce(public.reservas_nodo_atc_consultas.primera, excluded.primera),
         abierto  = coalesce(excluded.abierto,  public.reservas_nodo_atc_consultas.abierto),
         apertura = coalesce(excluded.apertura, public.reservas_nodo_atc_consultas.apertura),
         cierre   = coalesce(excluded.cierre,   public.reservas_nodo_atc_consultas.cierre);
  delete from public.reservas_nodo_atc_consultas where fecha < public.reservas_nodo__hoy() - public.reservas_nodo__dias_historia();

  -- limpieza de turnos viejos (en NODO no se reserva a mano, así que set_estado ya no la hace)
  delete from public.reservas_nodo_turnos where fecha < public.reservas_nodo__hoy() - public.reservas_nodo__dias_historia();

  return query select v_m, v_l, v_ant;
end;
$$;

-- La que usa la app (con la sesión de quien está logueado)
drop function if exists public.reservas_nodo_atc_sincronizar(uuid, date, text[], boolean, text, text);
create function public.reservas_nodo_atc_sincronizar(
  p_token    uuid,
  p_fecha    date,
  p_ocupados text[],
  p_abierto  boolean default null,
  p_apertura text default null,
  p_cierre   text default null
)
returns table (marcados text[], liberados text[], anterior timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query select * from public.reservas_nodo__atc_aplicar(
    public.reservas_nodo__sesion(p_token), p_fecha, p_ocupados, p_abierto, p_apertura, p_cierre);
end;
$$;

-- La que usa la sincronización automática (Supabase Cron -> Edge Function atc-nodo).
-- Solo la puede ejecutar el servidor (service_role), nunca la app.
drop function if exists public.reservas_nodo_atc_sincronizar_servicio(date, text[], boolean, text, text);
create function public.reservas_nodo_atc_sincronizar_servicio(
  p_fecha    date,
  p_ocupados text[],
  p_abierto  boolean default null,
  p_apertura text default null,
  p_cierre   text default null
)
returns table (marcados text[], liberados text[], anterior timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query select * from public.reservas_nodo__atc_aplicar('ATC (automático)', p_fecha, p_ocupados, p_abierto, p_apertura, p_cierre);
end;
$$;

revoke all on function public.reservas_nodo__atc_aplicar(text, date, text[], boolean, text, text) from public, anon, authenticated;
revoke all on function public.reservas_nodo_atc_sincronizar(uuid, date, text[], boolean, text, text) from public;
grant execute on function public.reservas_nodo_atc_sincronizar(uuid, date, text[], boolean, text, text) to anon, authenticated;
revoke all on function public.reservas_nodo_atc_sincronizar_servicio(date, text[], boolean, text, text) from public, anon, authenticated;
grant execute on function public.reservas_nodo_atc_sincronizar_servicio(date, text[], boolean, text, text) to service_role;