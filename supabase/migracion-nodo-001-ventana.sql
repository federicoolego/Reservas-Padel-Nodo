-- =====================================================================
-- NODO · Migración 001 · Ventana de reservas
-- Correr UNA vez en el SQL Editor de Supabase (se puede volver a correr).
--
--   * Solo se puede reservar/cancelar desde HOY hasta el último día del mes próximo.
--     Los días anteriores a hoy quedan de solo lectura (error: "Solo se puede
--     reservar/cancelar turnos del día o posteriores.").
--   * Los turnos fijos se reservan solos hasta el último día del mes próximo
--     (antes: 60 días). El historial de 90 días no cambia.
-- =====================================================================

create or replace function public.reservas_nodo__fecha_maxima()
returns date language sql stable as $$
  select (date_trunc('month', public.reservas_nodo__hoy()) + interval '2 months' - interval '1 day')::date
$$;

create or replace function public.reservas_nodo__fijo_materializar(p_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy date := public.reservas_nodo__hoy();
  v_fin date := public.reservas_nodo__fecha_maxima();
  v_n   int;
begin
  insert into public.reservas_nodo_turnos
         (fecha, complejo, cancha, hora, estado, actualizado_por, actualizado, reservado_para, fijo_id)
  select d.fecha, f.complejo, f.cancha, f.hora, 'reservada',
         coalesce(f.actualizado_por, f.creado_por, 'Turno fijo'), now(), f.para, f.id
    from public.reservas_nodo_fijos f
   cross join lateral (
         select g::date as fecha
           from generate_series(greatest(f.desde, v_hoy), least(coalesce(f.hasta, v_fin), v_fin), interval '1 day') g
        ) d
   where f.id = p_id
     and extract(dow from d.fecha) = f.dia_semana
     and public.reservas_nodo__futuro(d.fecha, f.hora)
     and not exists (select 1 from public.reservas_nodo_fijos_excepciones e
                      where e.fijo_id = f.id and e.fecha = d.fecha)
  on conflict (fecha, complejo, cancha, hora) do update
     set estado          = 'reservada',
         actualizado_por = excluded.actualizado_por,
         actualizado     = excluded.actualizado,
         reservado_para  = excluded.reservado_para,
         fijo_id         = excluded.fijo_id
   where public.reservas_nodo_turnos.estado <> 'reservada';   -- ocupado: se saltea

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.reservas_nodo_set_estado(
  p_token    uuid,
  p_fecha    date,
  p_complejo text,
  p_cancha   text,
  p_hora     text,
  p_estado   text,
  p_para     text default null
)
returns public.reservas_nodo_turnos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := public.reservas_nodo__sesion(p_token);
  v_hoy    date := public.reservas_nodo__hoy();
  v_para   text := nullif(left(trim(coalesce(p_para, '')), 40), '');
  v_fijo   uuid;
  v_fila   public.reservas_nodo_turnos;
begin
  if p_fecha < v_hoy then
    raise exception 'Solo se puede reservar/cancelar turnos del día o posteriores.' using errcode = '22023';
  end if;
  if p_fecha > public.reservas_nodo__fecha_maxima() then
    raise exception 'Solo se puede reservar hasta el último día del mes próximo.' using errcode = '22023';
  end if;
  if p_estado = 'reservada' and v_para is null then
    raise exception 'Indicá para quién es la reserva.' using errcode = '22023';
  end if;

  select fijo_id into v_fijo
    from public.reservas_nodo_turnos
   where fecha = p_fecha and complejo = p_complejo and cancha = p_cancha and hora = p_hora;

  -- una reserva a mano nunca queda atada a un fijo
  insert into public.reservas_nodo_turnos
         (fecha, complejo, cancha, hora, estado, actualizado_por, actualizado, reservado_para, fijo_id)
  values (p_fecha, p_complejo, p_cancha, p_hora, p_estado, v_nombre, now(),
          case when p_estado = 'reservada' then v_para end, null)
  on conflict (fecha, complejo, cancha, hora)
  do update set estado          = excluded.estado,
                actualizado_por = excluded.actualizado_por,
                actualizado     = excluded.actualizado,
                reservado_para  = excluded.reservado_para,
                fijo_id         = null
  returning * into v_fila;

  -- liberar una fecha de un fijo: se anota para que no se vuelva a reservar sola
  if p_estado = 'libre' and v_fijo is not null then
    insert into public.reservas_nodo_fijos_excepciones (fijo_id, fecha)
    values (v_fijo, p_fecha)
    on conflict do nothing;
  end if;

  -- limpieza: lo más viejo que el historial se borra solo
  delete from public.reservas_nodo_turnos
   where fecha < v_hoy - public.reservas_nodo__dias_historia();

  return v_fila;
end;
$$;

create or replace function public.reservas_nodo_fijo_previsualizar(
  p_complejo text,
  p_canchas  text[],
  p_cancha   text,
  p_dia      smallint,
  p_hora     text,
  p_desde    date,
  p_hasta    date default null,
  p_excluir  uuid default null
)
returns table (dia date, libres text[], ocupado_por text, ocupado_para text, ocupado_fijo boolean)
language sql
stable
security definer
set search_path = public
as $$
  with ventana as (
    select public.reservas_nodo__hoy() as hoy,
           public.reservas_nodo__fecha_maxima() as fin
  ),
  dias as (
    select g::date as fecha
      from ventana v,
           generate_series(greatest(p_desde, v.hoy), least(coalesce(p_hasta, v.fin), v.fin), interval '1 day') g
     where extract(dow from g) = p_dia
       and public.reservas_nodo__futuro(g::date, p_hora)
  ),
  ocup as (
    select t.fecha, t.cancha, t.actualizado_por, t.reservado_para, t.fijo_id
      from public.reservas_nodo_turnos t
      join dias d on d.fecha = t.fecha
     where t.complejo = p_complejo
       and t.hora = p_hora
       and t.estado = 'reservada'
       and (p_excluir is null or t.fijo_id is distinct from p_excluir)
  )
  select d.fecha,
         array(select u.c
                 from unnest(p_canchas) with ordinality u(c, pos)
                where not exists (select 1 from ocup x where x.fecha = d.fecha and x.cancha = u.c)
                order by u.pos),
         o.actualizado_por,
         o.reservado_para,
         o.fijo_id is not null
    from dias d
    left join ocup o on o.fecha = d.fecha and o.cancha = p_cancha
   order by d.fecha;
$$;

drop function if exists public.reservas_nodo__dias_adelante();

revoke all on function public.reservas_nodo__fecha_maxima() from public;

-- Reservas de fijos que quedaron más allá del nuevo límite (se habían creado con la ventana
-- vieja de 60 días). Se vuelven a crear solas cuando la ventana llegue a esas fechas.
delete from public.reservas_nodo_turnos
 where fijo_id is not null and fecha > public.reservas_nodo__fecha_maxima();

-- Que los fijos se completen ya con la ventana nueva
select public.reservas_nodo__fijos_sincronizar_todos();