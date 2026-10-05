-- =====================================================================
-- NODO · Migración 002 · Reservas de ATC
-- Correr UNA vez en el SQL Editor de Supabase, después de la 001 (se puede volver a correr).
--
--   * reservas_nodo_turnos.origen: 'atc' = ocupado según ATC (lo marca el botón "Reservas ATC").
--   * reservas_nodo_atc_sincronizar: marca lo ocupado en ATC y libera lo que ATC volvió a habilitar.
--   * Reservar a mano o un fijo sobre un turno libre lo saca de ATC.
-- =====================================================================

alter table public.reservas_nodo_turnos
  add column if not exists origen text check (origen is null or origen in ('atc'));

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
         fijo_id         = excluded.fijo_id,
         origen          = null
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
                fijo_id         = null,
                origen          = null
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

create or replace function public.reservas_nodo_atc_sincronizar(p_token uuid, p_fecha date, p_ocupados text[])
returns table (marcados int, liberados int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := public.reservas_nodo__sesion(p_token);
  v_ocup   text[] := coalesce(p_ocupados, '{}');
  v_m      int;
  v_l      int;
begin
  if p_fecha < public.reservas_nodo__hoy() then
    raise exception 'Solo se puede reservar/cancelar turnos del día o posteriores.' using errcode = '22023';
  end if;
  if p_fecha > public.reservas_nodo__fecha_maxima() then
    raise exception 'Solo se puede reservar hasta el último día del mes próximo.' using errcode = '22023';
  end if;

  insert into public.reservas_nodo_turnos
         (fecha, complejo, cancha, hora, estado, actualizado_por, actualizado, reservado_para, fijo_id, origen)
  select p_fecha, 'nodo', split_part(o, '|', 1), split_part(o, '|', 2), 'reservada', 'ATC', now(), 'ATC', null, 'atc'
    from unnest(v_ocup) as o
   where o ~ '^[^|]{1,20}[|][0-2][0-9]:[0-5][0-9]$'
  on conflict (fecha, complejo, cancha, hora) do update
     set estado = 'reservada', actualizado_por = 'ATC', actualizado = now(),
         reservado_para = 'ATC', fijo_id = null, origen = 'atc'
   where public.reservas_nodo_turnos.estado <> 'reservada';
  get diagnostics v_m = row_count;

  update public.reservas_nodo_turnos t
     set estado = 'libre', reservado_para = null, origen = null,
         actualizado_por = 'ATC', actualizado = now()
   where t.fecha = p_fecha and t.complejo = 'nodo'
     and t.origen = 'atc' and t.estado = 'reservada'
     and not ((t.cancha || '|' || t.hora) = any (v_ocup))
     and public.reservas_nodo__futuro(t.fecha, t.hora);
  get diagnostics v_l = row_count;

  return query select v_m, v_l;
end;
$$;

revoke all on function public.reservas_nodo_atc_sincronizar(uuid, date, text[]) from public;
grant execute on function public.reservas_nodo_atc_sincronizar(uuid, date, text[]) to anon, authenticated;