-- =====================================================================
-- Reservas de canchas · NODO Club de Pádel
-- Script para correr UNA vez en el SQL Editor de Supabase (se puede
-- volver a correr sin romper nada).
--
-- Convive con El Clásico, Defensores y la app de torneos en la misma base: todas las
-- tablas y funciones llevan el prefijo "reservas_nodo_".
--
-- Seguridad:
--   * Lectura pública de turnos, contactos y fijos (es lo que se comparte por WhatsApp).
--   * Escribir solo se puede con un token de sesión (usuario + contraseña vía
--     reservas_nodo_login). La contraseña se guarda hasheada con bcrypt.
--   * El usuario se crea aparte, con crear-usuario-nodo.sql (no se sube al repo).
--
-- Rango de fechas:
--   * Se ve el historial de los últimos 90 días (lo anterior se borra solo).
--   * Solo se puede reservar/cancelar desde HOY hasta el último día del mes próximo.
--     Los días anteriores a hoy son de solo lectura.
--   * Los turnos fijos se reservan solos hasta el último día del mes próximo.
-- Si cambiás estas reglas, cambiá también src/config/limites.ts.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

-- Credenciales del login (sin políticas RLS: nadie las lee desde la API)
create table if not exists public.reservas_nodo_acceso (
  usuario     text primary key,
  clave_hash  text not null,
  creado      timestamptz not null default now()
);

-- Sesiones abiertas (una por dispositivo)
create table if not exists public.reservas_nodo_sesiones (
  token    uuid primary key default gen_random_uuid(),
  usuario  text not null references public.reservas_nodo_acceso(usuario) on delete cascade,
  nombre   text,
  creada   timestamptz not null default now(),
  expira   timestamptz not null default now() + interval '60 days'
);

-- Turnos fijos: la regla que se repite todas las semanas
create table if not exists public.reservas_nodo_fijos (
  id               uuid primary key default gen_random_uuid(),
  complejo         text not null check (complejo in ('nodo')),
  cancha           text not null check (char_length(cancha) between 1 and 20),
  dia_semana       smallint not null check (dia_semana between 0 and 6),  -- 0 = domingo (como extract(dow))
  hora             text not null check (hora ~ '^[0-2][0-9]:[0-5][0-9]$'),
  para             text not null check (char_length(para) between 1 and 40),
  desde            date not null,
  hasta            date,                                                 -- null = sin fin
  creado_por       text,
  creado           timestamptz not null default now(),
  actualizado_por  text,
  actualizado      timestamptz not null default now(),
  check (hasta is null or hasta >= desde)
);

-- Fechas de un fijo que se liberaron a mano (no se vuelven a reservar solas)
create table if not exists public.reservas_nodo_fijos_excepciones (
  fijo_id  uuid not null references public.reservas_nodo_fijos(id) on delete cascade,
  fecha    date not null,
  primary key (fijo_id, fecha)
);

-- Estado de cada turno. Si no hay fila, el turno está libre.
create table if not exists public.reservas_nodo_turnos (
  fecha            date not null,
  complejo         text not null check (complejo in ('nodo')),
  cancha           text not null check (char_length(cancha) between 1 and 20),
  hora             text not null check (hora ~ '^[0-2][0-9]:[0-5][0-9]$'),
  estado           text not null check (estado in ('reservada', 'libre')),
  actualizado_por  text,
  actualizado      timestamptz not null default now(),
  reservado_para   text check (reservado_para is null or char_length(reservado_para) between 1 and 40),
  fijo_id          uuid references public.reservas_nodo_fijos(id) on delete set null,
  origen           text check (origen is null or origen in ('atc')),   -- 'atc': ocupado según ATC
  primary key (fecha, complejo, cancha, hora)
);

alter table public.reservas_nodo_turnos
  add column if not exists origen text check (origen is null or origen in ('atc'));

create index if not exists reservas_nodo_turnos_fecha_complejo
  on public.reservas_nodo_turnos (fecha, complejo);
create index if not exists reservas_nodo_turnos_fijo
  on public.reservas_nodo_turnos (fijo_id) where fijo_id is not null;

-- Teléfonos del pie de la imagen (hasta 4, en orden)
create table if not exists public.reservas_nodo_contactos (
  id        uuid primary key default gen_random_uuid(),
  complejo  text not null check (complejo in ('nodo')),
  nombre    text not null check (char_length(nombre) between 1 and 20),
  telefono  text not null check (telefono ~ '^[0-9 +()-]{6,20}$'),
  orden     int not null,
  creado    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RLS: lectura pública de lo que se muestra; escritura solo por funciones
-- ---------------------------------------------------------------------
alter table public.reservas_nodo_acceso            enable row level security;
alter table public.reservas_nodo_sesiones          enable row level security;
alter table public.reservas_nodo_turnos            enable row level security;
alter table public.reservas_nodo_contactos         enable row level security;
alter table public.reservas_nodo_fijos             enable row level security;
alter table public.reservas_nodo_fijos_excepciones enable row level security;

drop policy if exists "reservas_nodo_turnos lectura publica" on public.reservas_nodo_turnos;
create policy "reservas_nodo_turnos lectura publica"
  on public.reservas_nodo_turnos for select to anon, authenticated using (true);

drop policy if exists "reservas_nodo_contactos lectura publica" on public.reservas_nodo_contactos;
create policy "reservas_nodo_contactos lectura publica"
  on public.reservas_nodo_contactos for select to anon, authenticated using (true);

drop policy if exists "reservas_nodo_fijos lectura publica" on public.reservas_nodo_fijos;
create policy "reservas_nodo_fijos lectura publica"
  on public.reservas_nodo_fijos for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- Funciones internas (no se exponen a la API)
-- ---------------------------------------------------------------------
create or replace function public.reservas_nodo__dias_historia()
returns int language sql immutable as $$ select 90 $$;

create or replace function public.reservas_nodo__hoy()
returns date language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

-- Último día que se puede reservar: el último día del mes próximo (hora argentina)
create or replace function public.reservas_nodo__fecha_maxima()
returns date language sql stable as $$
  select (date_trunc('month', public.reservas_nodo__hoy()) + interval '2 months' - interval '1 day')::date
$$;

-- true si el turno (fecha, hora) todavía no empezó, en hora argentina
create or replace function public.reservas_nodo__futuro(p_fecha date, p_hora text)
returns boolean language sql stable as $$
  select p_fecha > public.reservas_nodo__hoy()
      or (p_fecha = public.reservas_nodo__hoy()
          and p_hora > to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI'))
$$;

-- Nombre de quien usa la sesión, o error si venció
create or replace function public.reservas_nodo__sesion(p_token uuid)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v text;
begin
  select coalesce(nombre, usuario) into v
    from public.reservas_nodo_sesiones
   where token = p_token and expira > now();
  if v is null then
    raise exception 'La sesión venció. Volvé a ingresar.' using errcode = '28000';
  end if;
  return v;
end;
$$;

-- Crea las reservas de un fijo dentro de la ventana. No pisa turnos reservados.
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

-- Libera las reservas de un fijo que todavía no se jugaron. Las pasadas quedan.
create or replace function public.reservas_nodo__fijo_liberar_futuros(p_id uuid, p_nombre text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.reservas_nodo_turnos
     set estado = 'libre', reservado_para = null, fijo_id = null,
         actualizado_por = p_nombre, actualizado = now()
   where fijo_id = p_id
     and estado = 'reservada'
     and public.reservas_nodo__futuro(fecha, hora);
$$;

-- Materializa todos los fijos vigentes (los más viejos tienen prioridad).
create or replace function public.reservas_nodo__fijos_sincronizar_todos()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int := 0;
  v_id    uuid;
begin
  delete from public.reservas_nodo_fijos_excepciones where fecha < public.reservas_nodo__hoy();
  for v_id in
    select id from public.reservas_nodo_fijos
     where hasta is null or hasta >= public.reservas_nodo__hoy()
     order by creado
  loop
    v_total := v_total + public.reservas_nodo__fijo_materializar(v_id);
  end loop;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- Sesión
-- ---------------------------------------------------------------------
create or replace function public.reservas_nodo_login(p_usuario text, p_clave text, p_nombre text default null)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash   text;
  v_token  uuid;
  v_nombre text := nullif(left(trim(coalesce(p_nombre, '')), 30), '');
begin
  select clave_hash into v_hash
    from public.reservas_nodo_acceso
   where usuario = upper(trim(p_usuario));

  if v_hash is null or v_hash <> crypt(p_clave, v_hash) then
    perform pg_sleep(0.5);  -- frena intentos por fuerza bruta
    raise exception 'Usuario o contraseña incorrectos' using errcode = '28P01';
  end if;

  -- El nombre es opcional: la app lo pide solo si hay reservas manuales (reservasManuales en
  -- src/config/complejos.ts). Sin nombre, en los cambios queda registrado el usuario.

  delete from public.reservas_nodo_sesiones where expira < now();

  insert into public.reservas_nodo_sesiones (usuario, nombre)
  values (upper(trim(p_usuario)), v_nombre)
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function public.reservas_nodo_validar(p_token uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.reservas_nodo_sesiones where token = p_token and expira > now());
$$;

create or replace function public.reservas_nodo_logout(p_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.reservas_nodo_sesiones where token = p_token;
$$;

-- ---------------------------------------------------------------------
-- Turnos
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Contactos de la imagen
-- ---------------------------------------------------------------------
create or replace function public.reservas_nodo_contacto_guardar(
  p_token uuid, p_id uuid, p_complejo text, p_nombre text, p_telefono text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_tel    text := trim(coalesce(p_telefono, ''));
  v_id     uuid;
begin
  perform public.reservas_nodo__sesion(p_token);

  if char_length(v_nombre) not between 1 and 20 then
    raise exception 'El nombre tiene que tener entre 1 y 20 letras.' using errcode = '22023';
  end if;
  if v_tel !~ '^[0-9 +()-]{6,20}$' then
    raise exception 'El teléfono tiene que tener entre 6 y 20 números.' using errcode = '22023';
  end if;

  if p_id is null then
    if (select count(*) from public.reservas_nodo_contactos where complejo = p_complejo) >= 4 then
      raise exception 'Ya hay 4 contactos, que es lo que entra en la imagen.' using errcode = '22023';
    end if;
    insert into public.reservas_nodo_contactos (complejo, nombre, telefono, orden)
    values (p_complejo, v_nombre, v_tel,
            coalesce((select max(orden) from public.reservas_nodo_contactos where complejo = p_complejo), 0) + 1)
    returning id into v_id;
  else
    update public.reservas_nodo_contactos
       set nombre = v_nombre, telefono = v_tel
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Ese contacto ya no existe.' using errcode = '22023';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.reservas_nodo_contacto_eliminar(p_token uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_complejo text;
begin
  perform public.reservas_nodo__sesion(p_token);
  delete from public.reservas_nodo_contactos where id = p_id returning complejo into v_complejo;
  if v_complejo is null then return; end if;
  -- renumera para que el orden quede 1, 2, 3…
  update public.reservas_nodo_contactos c
     set orden = n.nuevo
    from (select id, row_number() over (order by orden) as nuevo
            from public.reservas_nodo_contactos where complejo = v_complejo) n
   where c.id = n.id and c.orden <> n.nuevo;
end;
$$;

-- p_direccion: -1 sube, 1 baja (intercambia con el vecino)
create or replace function public.reservas_nodo_contacto_mover(p_token uuid, p_id uuid, p_direccion int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yo      public.reservas_nodo_contactos;
  v_vecino  public.reservas_nodo_contactos;
begin
  perform public.reservas_nodo__sesion(p_token);
  select * into v_yo from public.reservas_nodo_contactos where id = p_id;
  if not found then return; end if;

  select * into v_vecino
    from public.reservas_nodo_contactos
   where complejo = v_yo.complejo
     and case when p_direccion < 0 then orden < v_yo.orden else orden > v_yo.orden end
   order by case when p_direccion < 0 then -orden else orden end
   limit 1;
  if not found then return; end if;

  update public.reservas_nodo_contactos set orden = v_vecino.orden where id = v_yo.id;
  update public.reservas_nodo_contactos set orden = v_yo.orden     where id = v_vecino.id;
end;
$$;

-- ---------------------------------------------------------------------
-- Turnos fijos
-- ---------------------------------------------------------------------
create or replace function public.reservas_nodo_fijos_sincronizar(p_token uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reservas_nodo__sesion(p_token);
  return public.reservas_nodo__fijos_sincronizar_todos();
end;
$$;

-- Para cada fecha que tocaría el fijo (dentro de la ventana): qué canchas están libres
-- a esa hora y, si la cancha pedida está ocupada, por quién.
-- p_excluir: id del fijo que se está editando (sus propias reservas no cuentan como ocupado).
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

-- Crea (p_id null) o edita un fijo y actualiza sus reservas. Devuelve el id.
create or replace function public.reservas_nodo_fijo_guardar(
  p_token    uuid,
  p_id       uuid,
  p_complejo text,
  p_cancha   text,
  p_dia      smallint,
  p_hora     text,
  p_para     text,
  p_desde    date,
  p_hasta    date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := public.reservas_nodo__sesion(p_token);
  v_para   text := nullif(left(trim(coalesce(p_para, '')), 40), '');
  v_ant    public.reservas_nodo_fijos;
  v_choque text;
  v_id     uuid;
begin
  if v_para is null then
    raise exception 'Indicá para quién es el turno fijo.' using errcode = '22023';
  end if;
  if p_desde is null then
    raise exception 'Indicá desde qué fecha arranca.' using errcode = '22023';
  end if;
  if p_hasta is not null and p_hasta < p_desde then
    raise exception 'La fecha "hasta" no puede ser anterior a "desde".' using errcode = '22023';
  end if;

  select f.para into v_choque
    from public.reservas_nodo_fijos f
   where f.complejo = p_complejo and f.cancha = p_cancha
     and f.dia_semana = p_dia and f.hora = p_hora
     and f.id is distinct from p_id
     and daterange(f.desde, f.hasta, '[]') && daterange(p_desde, p_hasta, '[]')
   limit 1;
  if v_choque is not null then
    raise exception 'Ya hay un turno fijo en ese día, horario y cancha (para %).', v_choque using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.reservas_nodo_fijos
           (complejo, cancha, dia_semana, hora, para, desde, hasta, creado_por, actualizado_por)
    values (p_complejo, p_cancha, p_dia, p_hora, v_para, p_desde, p_hasta, v_nombre, v_nombre)
    returning id into v_id;
  else
    select * into v_ant from public.reservas_nodo_fijos where id = p_id for update;
    if not found then
      raise exception 'Ese turno fijo ya no existe.' using errcode = '22023';
    end if;

    perform public.reservas_nodo__fijo_liberar_futuros(p_id, v_nombre);

    -- si cambió el horario, las fechas salteadas a mano ya no aplican
    if (v_ant.complejo, v_ant.cancha, v_ant.dia_semana, v_ant.hora)
       is distinct from (p_complejo, p_cancha, p_dia, p_hora) then
      delete from public.reservas_nodo_fijos_excepciones where fijo_id = p_id;
    end if;

    update public.reservas_nodo_fijos
       set complejo = p_complejo, cancha = p_cancha, dia_semana = p_dia, hora = p_hora,
           para = v_para, desde = p_desde, hasta = p_hasta,
           actualizado_por = v_nombre, actualizado = now()
     where id = p_id;
    v_id := p_id;
  end if;

  perform public.reservas_nodo__fijo_materializar(v_id);
  return v_id;
end;
$$;

create or replace function public.reservas_nodo_fijo_eliminar(p_token uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := public.reservas_nodo__sesion(p_token);
begin
  perform public.reservas_nodo__fijo_liberar_futuros(p_id, v_nombre);
  delete from public.reservas_nodo_fijos where id = p_id;  -- las reservas pasadas quedan, con fijo_id en null
end;
$$;

-- ---------------------------------------------------------------------
-- Reservas de ATC (atcsports.io)
-- La app consulta ATC (Edge Function atc-nodo), calcula qué turnos de la grilla están
-- ocupados allá y los manda acá como 'cancha|hora'. Esta función:
--   * marca "Ocupado - ATC" los que acá están libres (nunca pisa reservas manuales ni fijos);
--   * libera los que había marcado ATC y que ATC volvió a mostrar libres (solo si no empezaron).
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on function public.reservas_nodo__dias_historia()                  from public;
revoke all on function public.reservas_nodo__fecha_maxima()                  from public;
revoke all on function public.reservas_nodo__hoy()                            from public;
revoke all on function public.reservas_nodo__futuro(date, text)               from public;
revoke all on function public.reservas_nodo__sesion(uuid)                     from public;
revoke all on function public.reservas_nodo__fijo_materializar(uuid)          from public;
revoke all on function public.reservas_nodo__fijo_liberar_futuros(uuid, text) from public;
revoke all on function public.reservas_nodo__fijos_sincronizar_todos()        from public;

revoke all on function public.reservas_nodo_login(text, text, text)                                              from public;
revoke all on function public.reservas_nodo_validar(uuid)                                                        from public;
revoke all on function public.reservas_nodo_logout(uuid)                                                         from public;
revoke all on function public.reservas_nodo_set_estado(uuid, date, text, text, text, text, text)                 from public;
revoke all on function public.reservas_nodo_contacto_guardar(uuid, uuid, text, text, text)                       from public;
revoke all on function public.reservas_nodo_contacto_eliminar(uuid, uuid)                                        from public;
revoke all on function public.reservas_nodo_contacto_mover(uuid, uuid, int)                                      from public;
revoke all on function public.reservas_nodo_fijos_sincronizar(uuid)                                              from public;
revoke all on function public.reservas_nodo_fijo_previsualizar(text, text[], text, smallint, text, date, date, uuid) from public;
revoke all on function public.reservas_nodo_fijo_guardar(uuid, uuid, text, text, smallint, text, text, date, date)  from public;
revoke all on function public.reservas_nodo_atc_sincronizar(uuid, date, text[])                       from public;
revoke all on function public.reservas_nodo_fijo_eliminar(uuid, uuid)                                            from public;

grant execute on function public.reservas_nodo_login(text, text, text)                                              to anon, authenticated;
grant execute on function public.reservas_nodo_validar(uuid)                                                        to anon, authenticated;
grant execute on function public.reservas_nodo_logout(uuid)                                                         to anon, authenticated;
grant execute on function public.reservas_nodo_set_estado(uuid, date, text, text, text, text, text)                 to anon, authenticated;
grant execute on function public.reservas_nodo_contacto_guardar(uuid, uuid, text, text, text)                       to anon, authenticated;
grant execute on function public.reservas_nodo_contacto_eliminar(uuid, uuid)                                        to anon, authenticated;
grant execute on function public.reservas_nodo_contacto_mover(uuid, uuid, int)                                      to anon, authenticated;
grant execute on function public.reservas_nodo_fijos_sincronizar(uuid)                                              to anon, authenticated;
grant execute on function public.reservas_nodo_fijo_previsualizar(text, text[], text, smallint, text, date, date, uuid) to anon, authenticated;
grant execute on function public.reservas_nodo_fijo_guardar(uuid, uuid, text, text, smallint, text, text, date, date)  to anon, authenticated;
grant execute on function public.reservas_nodo_atc_sincronizar(uuid, date, text[])                       to anon, authenticated;
grant execute on function public.reservas_nodo_fijo_eliminar(uuid, uuid)                                            to anon, authenticated;

-- ---------------------------------------------------------------------
-- Tiempo real: cada cambio llega al instante a todos los celus abiertos
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['reservas_nodo_turnos', 'reservas_nodo_contactos', 'reservas_nodo_fijos'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- OPCIONAL: que los fijos se reserven solos aunque nadie abra la app.
-- Requiere la extensión pg_cron (Database → Extensions → pg_cron).
--   select cron.schedule('reservas-nodo-fijos-diario', '10 3 * * *',
--                        $$select public.reservas_nodo__fijos_sincronizar_todos()$$);
-- ---------------------------------------------------------------------