// Pix "copia e cola" (BR Code estático) com o valor já preenchido, para virar QR Code.
// Não confirma o pagamento: quem recebe confere no app do banco.

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`
}

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), como pede o Banco Central. */
export function crc16(text: string): string {
  let crc = 0xffff
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Sem acento, maiúsculas e só caracteres simples (o BR Code não aceita acento). */
function plain(text: string, max: number): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').trim().toUpperCase().slice(0, max)
}

export interface PixInput {
  /** Chave Pix: CPF, CNPJ, telefone, e-mail ou chave aleatória. */
  key: string
  /** Nome de quem recebe (o estabelecimento). */
  name: string
  /** Valor em centavos; 0 deixa o cliente digitar. */
  amountCents: number
  city?: string
  /** Identificação da cobrança (até 25 letras ou números). */
  txid?: string
}

/** Uma chave já no formato "copia e cola" (começa com 000201) é usada como está, sem valor. */
export function isPixPayload(key: string): boolean {
  return /^000201/.test(key.trim())
}

/** CPF válido pelos dois dígitos verificadores (para não confundir com celular de 11 dígitos). */
export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false
  const dv = (n: number) => {
    let sum = 0
    for (let i = 0; i < n; i++) sum += Number(digits[i]) * (n + 1 - i)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(digits[9]) && dv(10) === Number(digits[10])
}

/** Normaliza a chave: e-mail e chave aleatória ficam como estão; CPF e CNPJ só números; telefone ganha +55. */
export function normalizePixKey(raw: string): string {
  const k = raw.trim()
  if (k.includes('@') || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k)) return k
  const digits = k.replace(/\D/g, '')
  if (k.startsWith('+')) return `+${digits}`
  if (digits.length === 14) return digits // CNPJ
  if (digits.length === 11) return isValidCpf(digits) ? digits : `+55${digits}`
  if (digits.length === 10) return `+55${digits}`
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`
  return k
}

export function buildPix({ key, name, amountCents, city = 'BRASIL', txid = '***' }: PixInput): string {
  if (isPixPayload(key)) return key.trim()
  const account = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', normalizePixKey(key))
  const body =
    tlv('00', '01') +
    tlv('01', '11') +
    tlv('26', account) +
    tlv('52', '0000') +
    tlv('53', '986') +
    (amountCents > 0 ? tlv('54', (amountCents / 100).toFixed(2)) : '') +
    tlv('58', 'BR') +
    tlv('59', plain(name, 25) || 'RECEBEDOR') +
    tlv('60', plain(city, 15) || 'BRASIL') +
    tlv('62', tlv('05', plain(txid, 25).replace(/ /g, '') || '***'))
  const base = `${body}6304`
  return base + crc16(base)
}
