-- =====================================================================
-- NODO · Migración 008 · Sincronización con ATC solo 5' antes de cada turno
-- Correr UNA vez en el SQL Editor de Supabase (se puede volver a correr).
--
-- Antes: job "nodo-atc-sincronizar" cada 10 minutos (~90 corridas/día) -> mucho Log Ingestion.
-- Ahora: 9 corridas/día, 5 minutos antes de cada turno:
--   09:00 10:30 12:00 13:30 15:00 16:30 18:00 19:30 21:00 (hora argentina)
--
-- pg_cron corre en UTC. Argentina = UTC-3 fijo (sin horario de verano):
--   nodo-atc-pre-turno-55 -> 08:55 11:55 14:55 17:55 20:55 ART = 11:55 14:55 17:55 20:55 23:55 UTC
--   nodo-atc-pre-turno-25 -> 10:25 13:25 16:25 19:25       ART = 13:25 16:25 19:25 22:25       UTC
--
-- Se reutiliza el mismo comando del job viejo (net.http_post a la Edge Function con x-cron-secret),
-- así no hay que volver a escribir la URL ni el secreto.
--
-- Si cambian los HORARIOS: actualizar también src/config/complejos.ts y la Edge Function atc-nodo.
-- =====================================================================

do $$
declare
  v_cmd text;
begin
  -- comando del job viejo, o de uno de los nuevos si la migración ya se corrió
  select command into v_cmd
    from cron.job
   where jobname in ('nodo-atc-sincronizar', 'nodo-atc-pre-turno-55', 'nodo-atc-pre-turno-25')
   order by (jobname = 'nodo-atc-sincronizar') desc
   limit 1;

  if v_cmd is null then
    raise exception 'No encontré el job "nodo-atc-sincronizar" ni los nuevos. Revisá: select jobname, schedule from cron.job;';
  end if;

  -- cron.schedule con un nombre existente lo actualiza (no duplica)
  perform cron.schedule('nodo-atc-pre-turno-55', '55 11,14,17,20,23 * * *', v_cmd);
  perform cron.schedule('nodo-atc-pre-turno-25', '25 13,16,19,22 * * *', v_cmd);

  -- baja del job viejo (cada 10 minutos)
  if exists (select 1 from cron.job where jobname = 'nodo-atc-sincronizar') then
    perform cron.unschedule('nodo-atc-sincronizar');
  end if;

  -- limpieza diaria del historial de pg_cron (cron.job_run_details crece sin límite)
  -- 03:30 ART = 06:30 UTC
  perform cron.schedule('limpieza-cron-historial', '30 6 * * *',
    $cmd$delete from cron.job_run_details where end_time < now() - interval '7 days'$cmd$);
end;
$$;

-- limpieza inicial del historial acumulado
delete from cron.job_run_details where end_time < now() - interval '7 days';

-- verificación: tienen que quedar los dos jobs pre-turno + la limpieza, y NO "nodo-atc-sincronizar"
select jobid, jobname, schedule, active from cron.job order by jobname;
