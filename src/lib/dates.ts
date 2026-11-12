/** Data local no formato AAAA-MM-DD (o "dia de operação"). */
export function today(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function dateBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

export function dateTimeBR(iso: string): string {
  return `${dateBR(iso)} ${hhmm(iso)}`
}

/** "AAAA-MM-DD" -> "DD/MM/AAAA" sem passar por fuso horário. */
export function businessDateBR(day: string): string {
  const [y, m, d] = day.split('-')
  return `${d}/${m}/${y}`
}

export function minutesSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
}

/** "38 min" ou "2 h 05": há quanto tempo algo começou. */
export function relativeAge(iso: string, now: number = Date.now()): string {
  const min = Math.max(0, minutesSince(iso, now))
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}
