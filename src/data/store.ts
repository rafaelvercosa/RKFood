// Armazenamento do MODO DEMONSTRAÇÃO.
//
// Enquanto o Supabase não está conectado, os dados ficam no próprio navegador
// (localStorage). Abas abertas no mesmo aparelho se sincronizam sozinhas — dá
// para abrir "Atendente" numa aba e "Cozinha" em outra e ver o pedido chegar.
//
// Todas as telas usam apenas `useDB()` (leitura) e as funções de actions.ts
// (escrita). Na etapa do Supabase só esta camada muda; as telas continuam iguais.

import { useSyncExternalStore } from 'react'
import { newId } from '../lib/id'
import { nowIso } from '../lib/dates'
import type { Database } from '../types'
import { DB_VERSION, seedDatabase } from './seed'

const KEY = 'rkfood:db'

let db: Database = load()
const listeners = new Set<() => void>()

function load(): Database {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Database
      if (parsed.version === DB_VERSION) return parsed
    }
  } catch {
    // dado corrompido ou storage bloqueado: recomeça com a demonstração
  }
  const fresh = seedDatabase()
  persist(fresh)
  return fresh
}

function persist(value: Database): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch (e) {
    console.error(e)
    alert('Não foi possível salvar: o armazenamento do navegador está cheio. Use fotos menores ou exclua itens antigos.')
    throw e
  }
}

function notify(): void {
  for (const l of listeners) l()
}

// Sincroniza entre abas do mesmo navegador.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue) {
      db = JSON.parse(e.newValue) as Database
      notify()
    }
  })
}

export function getDB(): Database {
  return db
}

/**
 * Aplica uma alteração. `mutate` recebe uma CÓPIA do banco e devolve o resumo
 * que vai para o histórico (auditoria). Se der erro no meio, nada é salvo.
 */
export function commit(userId: string, action: string, mutate: (draft: Database) => string): void {
  const draft = structuredClone(db)
  const summary = mutate(draft)
  draft.audit.unshift({ id: newId(), at: nowIso(), userId, action, summary })
  if (draft.audit.length > 2000) draft.audit.length = 2000
  persist(draft)
  db = draft
  notify()
}

export function replaceDB(next: Database): void {
  persist(next)
  db = next
  notify()
}

export function resetDemo(): void {
  replaceDB(seedDatabase())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useDB(): Database {
  return useSyncExternalStore(subscribe, getDB)
}
