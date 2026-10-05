-- =====================================================================
-- NODO · Migración 003 · Login sin nombre
-- Correr UNA vez en el SQL Editor de Supabase (se puede volver a correr).
--
-- El nombre en el login pasa a ser opcional (la app lo pide solo si hay reservas manuales).
-- Sin nombre, la sesión queda registrada con el usuario (NODO).
-- =====================================================================

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

revoke all on function public.reservas_nodo_login(text, text, text) from public;
grant execute on function public.reservas_nodo_login(text, text, text) to anon, authenticated;