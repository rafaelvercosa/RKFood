// Quem está usando o aparelho agora. Cada aba guarda o seu usuário
// (sessionStorage), então numa mesma máquina dá para ter uma aba "Cozinha"
// e outra "Atendente". O último login vira o padrão das próximas abas.

import { useSyncExternalStore } from 'react'
import type { Role, User } from '../types'
import { getDB, useDB } from './store'

const KEY = 'rkfood:session'
const listeners = new Set<() => void>()

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY)
  } catch {
    return null
  }
}

let currentId: string | null = read()

export function login(user: User): void {
  currentId = user.id
  try {
    sessionStorage.setItem(KEY, user.id)
    localStorage.setItem(KEY, user.id)
  } catch {
    // sem storage: vale só enquanto a página estiver aberta
  }
  listeners.forEach((l) => l())
}

export function logout(): void {
  currentId = null
  try {
    sessionStorage.removeItem(KEY)
    localStorage.removeItem(KEY)
  } catch {
    // ignora
  }
  listeners.forEach((l) => l())
}

export function useCurrentUser(): User | null {
  const id = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => currentId,
  )
  const db = useDB()
  const user = db.users.find((u) => u.id === id && !u.deletedAt)
  return user ?? null
}

export function currentUserId(): string {
  const u = getDB().users.find((x) => x.id === currentId)
  return u?.id ?? 'desconhecido'
}

export function hasRole(user: User | null, role: Role): boolean {
  return !!user && (user.roles.includes(role) || user.roles.includes('gerente'))
}
