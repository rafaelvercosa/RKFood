// Contraste da cor da marca: o texto sobre ela é branco ou escuro, o que ler melhor.

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Luminância relativa (0 a 1) de uma cor #rrggbb. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const n = parseInt(m[1], 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** Razão de contraste entre duas cores (1 a 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const WHITE = '#ffffff'
const DARK = '#2a2420'

/** Cor do texto sobre o fundo `bg`: branco, ou escuro se o branco não chegar a 4,5 para 1. */
export function inkOn(bg: string): string {
  return contrast(bg, WHITE) >= 4.5 || contrast(bg, WHITE) >= contrast(bg, DARK) ? WHITE : DARK
}
