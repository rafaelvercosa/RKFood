/** Descrição curta do aparelho para o histórico, ex.: "Chrome no Android". */
export function deviceInfo(ua: string = navigator.userAgent): string {
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'navegador'
  const system =
    /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iPhone/iPad'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : 'sistema desconhecido'
  return `${browser} no ${system}`
}

const KEY = 'rkfood:aparelho'

/** Chave aleatória guardada no aparelho, para o dono ver e bloquear cada aparelho. */
export function deviceKey(): string {
  try {
    let k = localStorage.getItem(KEY)
    if (!k) {
      k = crypto.randomUUID()
      localStorage.setItem(KEY, k)
    }
    return k
  } catch {
    return 'sem-chave'
  }
}
