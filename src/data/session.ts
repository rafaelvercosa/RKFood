// Quem está operando o aparelho agora (o operador que digitou o PIN).
// Cada aba guarda o seu operador (sessionStorage), então numa mesma máquina dá
// para ter uma aba "Cozinha" e outra "Atendente". O último login vira o padrão
// das próximas abas. No modo nuvem guardamos também o token da sessão do
// operador, que o banco exige em toda alteração.

import { useSyncExternalStore } from 'react'
import type { Role, User } from '../types'
import { getDB, useDB } from './store'

const KEY = 'rkfood:operador'

interface OperatorSession {
  staffId: string
  token: string | null
}

const listeners = new Set<() => void>()

function read(): OperatorSession | null {
  try {
    const raw = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as OperatorSession) : null
  } catch {
    return null
  }
}

let current: OperatorSession | null = read()

function emit(): void {
  listeners.forEach((l) => l())
}

export function setOperator(staffId: string, token: string | null): void {
  current = { staffId, token }
  try {
    const raw = JSON.stringify(current)
    sessionStorage.setItem(KEY, raw)
    localStorage.setItem(KEY, raw)
  } catch {
    // sem storage: vale só enquanto a página estiver aberta
  }
  emit()
}

export function clearOperator(): void {
  current = null
  try {
    sessionStorage.removeItem(KEY)
    localStorage.removeItem(KEY)
  } catch {
    // ignora
  }
  emit()
}

export function operatorToken(): string | null {
  return current?.token ?? null
}

export function useCurrentUser(): User | null {
  const id = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current?.staffId ?? null,
  )
  const db = useDB()
  return db.users.find((u) => u.id === id && !u.deletedAt) ?? null
}

/** Id do operador atual (usado pelo modo demonstração para o histórico). */
export function currentUserId(): string {
  const u = getDB().users.find((x) => x.id === current?.staffId)
  return u?.id ?? 'desconhecido'
}

export function hasRole(user: User | null, role: Role): boolean {
  return !!user && (user.roles.includes(role) || user.roles.includes('gerente'))
}
