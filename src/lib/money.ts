const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Formata centavos como "R$ 12,50". */
export function brl(cents: number): string {
  return fmt.format(cents / 100)
}

/** Converte texto digitado ("12,50", "12.5", "R$ 1.234,56") em centavos. */
export function parseBRL(text: string): number {
  const clean = text.replace(/[^\d,.-]/g, '').trim()
  if (!clean) return 0
  let normalized = clean
  if (clean.includes(',')) {
    // padrão brasileiro: ponto é milhar, vírgula é decimal
    normalized = clean.replace(/\./g, '').replace(',', '.')
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? Math.round(value * 100) : 0
}

/** Centavos para texto editável ("12,50"). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}
