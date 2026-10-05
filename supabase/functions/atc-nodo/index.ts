// =====================================================================
// Edge Function "atc-nodo": turnos libres de NODO en ATC (atcsports.io) para una fecha.
//
// La app no puede leer ATC directo desde el navegador (CORS), así que esta función
// hace de intermediaria. Solo lee datos PÚBLICOS (lo mismo que ve cualquier jugador):
// no usa credenciales ni guarda nada.
//
// Entrada:  POST { "fecha": "YYYY-MM-DD" }
// Salida:   { fecha, abierto, apertura, cierre, fuente, canchas: [{ id, nombre, libres: ["15:00", ...] }] }
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

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function atender(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { fecha } = await req.json().catch(() => ({}))
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