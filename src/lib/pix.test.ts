import { describe, expect, it } from 'vitest'
import { buildPix, crc16, isValidCpf, normalizePixKey } from './pix'

describe('Pix copia e cola', () => {
  it('CRC16 (CCITT-FALSE) confere com o valor de referência do padrão', () => {
    expect(crc16('123456789')).toBe('29B1')
  })

  it('monta o código com valor, nome sem acento e CRC no fim', () => {
    const code = buildPix({ key: 'rafael@exemplo.com', name: 'Espetinho do João', amountCents: 4500 })
    expect(code.startsWith('000201010211')).toBe(true)
    expect(code).toContain('0014BR.GOV.BCB.PIX0118rafael@exemplo.com')
    expect(code).toContain('540545.00')
    expect(code).toContain('5917ESPETINHO DO JOAO')
    expect(code).toContain('5802BR')
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)))
  })

  it('sem valor, deixa o cliente digitar', () => {
    expect(buildPix({ key: 'a@b.com', name: 'X', amountCents: 0 })).not.toContain('5404')
  })

  it('aceita o código pronto de copia e cola como está', () => {
    const pronto = '00020126360014BR.GOV.BCB.PIX0114+5581986102030520400005303986540510.005802BR5901A6001B62070503***63041234'
    expect(buildPix({ key: pronto, name: 'X', amountCents: 100 })).toBe(pronto)
  })

  it('normaliza telefone, CPF, CNPJ, e-mail e chave aleatória', () => {
    expect(normalizePixKey('(81) 98610-2030')).toBe('+5581986102030')
    expect(normalizePixKey('+55 81 98610-2030')).toBe('+5581986102030')
    expect(normalizePixKey('529.982.247-25')).toBe('52998224725')
    expect(normalizePixKey('11.222.333/0001-81')).toBe('11222333000181')
    expect(normalizePixKey(' Fulano@Mail.com ')).toBe('Fulano@Mail.com')
    expect(normalizePixKey('123e4567-e12b-12d1-a456-426655440000')).toBe('123e4567-e12b-12d1-a456-426655440000')
  })

  it('reconhece CPF válido e não confunde com celular', () => {
    expect(isValidCpf('52998224725')).toBe(true)
    expect(isValidCpf('81986102030')).toBe(false)
    expect(isValidCpf('11111111111')).toBe(false)
  })
})
