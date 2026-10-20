// =====================================================================
// Edge Function "atc-nodo": turnos libres de NODO en ATC (atcsports.io) para una fecha.
//
// La app no puede leer ATC directo desde el navegador (CORS), así que esta función
// hace de intermediaria. Solo lee datos PÚBLICOS (lo mismo que ve cualquier jugador):
// no usa credenciales ni guarda nada.
//
// Entrada:  POST { "fecha": "YYYY-MM-DD" }
// Salida:   { fecha, abierto, apertura, cierre, fuente, canchas: [{ id, nombre, libres: ["15:00", ...] }] }
//
// Modo sincronizar (lo dispara Supabase Cron 5 minutos antes de cada turno, ver migración 008):
//   POST { "sincronizar": true } con el header x-cron-secret = secreto ATC_CRON_SECRET.
//   Consulta ATC para HOY y guarda en la base los turnos ocupados, aunque nadie tenga la app
//   abierta, así cada turno queda registrado antes de empezar.
// =====================================================================

const CLUB_ID = 1669 // NODO Club de pádel & Co (Villa Ramallo)
const PERMALINK = 'nodo-club-de-padel-co-villa-ramallo'
const DEPORTE = 7 // pádel

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const NAVEGADOR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36',
  Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9',
}

// deno-lint-ignore no-explicit-any
type Json = any

export interface DisponibilidadATC {
  fecha: string
  abierto: boolean
  apertura: string | null
  cierre: string | null
  fuente: 'api' | 'web'
  canchas: { id: string; nombre: string; libres: string[] }[]
}

/** Busca, en cualquier nivel del JSON, el objeto del club (el que tiene available_courts) */
export function buscarClub(o: Json, prof = 0): Json | null {
  if (!o || typeof o !== 'object' || prof > 8) return null
  if (Array.isArray(o.available_courts)) return o
  for (const v of Object.values(o)) {
    const r = buscarClub(v, prof + 1)
    if (r) return r
  }
  return null
}

/** Pasa la respuesta de ATC a un formato simple: horas de inicio libres por cancha, en hora argentina */
export function normalizar(club: Json, fecha: string, fuente: 'api' | 'web'): DisponibilidadATC {
  const bh = club.business_hours_for_given_date ?? {}
  return {
    fecha,
    abierto: bh.open !== false,
    apertura: typeof bh.open_time === 'string' ? bh.open_time.slice(0, 5) : null,
    cierre: typeof bh.close_time === 'string' ? bh.close_time.slice(0, 5) : null,
    fuente,
    canchas: (club.available_courts as Json[]).map((c) => ({
      id: String(c.id),
      nombre: String(c.name ?? ''),
      // "2026-10-05T16:30-03:00" -> "16:30" (solo los de la fecha pedida)
      libres: [...new Set(((c.available_slots ?? []) as Json[])
        .map((s) => String(s.start ?? ''))
        .filter((s) => s.slice(0, 10) === fecha)
        .map((s) => s.slice(11, 16)))].sort(),
    })),
  }
}

async function desdeApi(fecha: string): Promise<Json> {
  const r = await fetch(`https://alquilatucancha.com/api/v3/availability/sportclubs/${CLUB_ID}?date=${fecha}`, { headers: NAVEGADOR })
  if (!r.ok) throw new Error(`API ATC ${r.status}`)
  const club = buscarClub(await r.json())
  if (!club) throw new Error('API ATC sin canchas')
  return club
}

async function desdeWeb(fecha: string): Promise<Json> {
  const r = await fetch(`https://atcsports.io/venues/${PERMALINK}?dia=${fecha}&sportIds=${DEPORTE}`, { headers: NAVEGADOR })
  if (!r.ok) throw new Error(`Web ATC ${r.status}`)
  const html = await r.text()
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('Web ATC sin datos')
  const club = buscarClub(JSON.parse(m[1]))
  if (!club) throw new Error('Web ATC sin canchas')
  return club
}

// ---------------------------------------------------------------------
// Sincronización automática
// IMPORTANTE: mantener HORARIOS y CANCHAS iguales a src/config/complejos.ts
// ---------------------------------------------------------------------
const HORARIOS = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00']
const CANCHAS: Record<string, string> = { '6261': 'C1', '6262': 'C2', '6263': 'C3' } // id en ATC -> cancha en la app
const DURACION = 90

const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

/** Fecha y hora actuales en Argentina */
export function ahoraAR(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]))
  return { hoy: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }
}

/** Misma regla que la app (src/lib/atc.ts): turnos en horario del club, que no empezaron y que ATC no muestra libres */
export function ocupados(d: DisponibilidadATC, ahora: { hoy: string; hora: string }): string[] {
  if (!d.abierto || !d.apertura || !d.cierre) return []
  const abre = minutos(d.apertura)
  const cierra = d.cierre === '00:00' ? 24 * 60 : minutos(d.cierre)
  const out: string[] = []
  for (const c of d.canchas) {
    const nuestra = CANCHAS[c.id]
    if (!nuestra) continue
    const libres = new Set(c.libres)
    for (const h of HORARIOS) {
      const m = minutos(h)
      if (m < abre || m + DURACION > cierra) continue
      if (d.fecha === ahora.hoy && h <= ahora.hora) continue
      if (!libres.has(h)) out.push(`${nuestra}|${h}`)
    }
  }
  return out
}

async function consultar(fecha: string): Promise<DisponibilidadATC> {
  try {
    return normalizar(await desdeApi(fecha), fecha, 'api')
  } catch {
    return normalizar(await desdeWeb(fecha), fecha, 'web')
  }
}

async function sincronizar(req: Request): Promise<Response> {
  const env = (k: string) => D?.env?.get(k) as string | undefined
  const secreto = env('ATC_CRON_SECRET')
  if (!secreto) return json({ error: 'Falta configurar el secreto ATC_CRON_SECRET en la Edge Function' }, 500)
  if (req.headers.get('x-cron-secret') !== secreto) return json({ error: 'No autorizado' }, 401)

  const ahora = ahoraAR()
  const d = await consultar(ahora.hoy)
  const lista = ocupados(d, ahora)
  const url = env('SUPABASE_URL')
  const clave = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !clave) return json({ error: 'Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }, 500)
  const r = await fetch(`${url}/rest/v1/rpc/reservas_nodo_atc_sincronizar_servicio`, {
    method: 'POST',
    headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_fecha: ahora.hoy, p_ocupados: lista, p_abierto: d.abierto, p_apertura: d.apertura, p_cierre: d.cierre }),
  })
  if (!r.ok) return json({ error: `La base respondió ${r.status}: ${await r.text()}` }, 502)
  const [res] = (await r.json()) as { marcados: string[]; liberados: string[] }[]
  return json({ fecha: ahora.hoy, hora: ahora.hora, fuente: d.fuente, ocupados: lista.length, marcados: res?.marcados ?? [], liberados: res?.liberados ?? [] })
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function atender(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const cuerpo = await req.json().catch(() => ({}))
    if (cuerpo?.sincronizar === true) return await sincronizar(req)
    const { fecha } = cuerpo
    if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json({ error: 'Fecha inválida' }, 400)
    let club: Json, fuente: 'api' | 'web' = 'api'
    try {
      club = await desdeApi(fecha)
    } catch {
      club = await desdeWeb(fecha)
      fuente = 'web'
    }
    return json(normalizar(club, fecha, fuente))
  } catch (e) {
    return json({ error: `No se pudo consultar ATC: ${(e as Error).message}` }, 502)
  }
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno
if (D?.serve) D.serve(atender)