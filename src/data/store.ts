// "Foto" atual dos dados que as telas leem com `useDB()`.
//
// MODO DEMONSTRAÇÃO (sem Supabase configurado): os dados ficam no próprio
// navegador (localStorage) e as abas do mesmo aparelho se sincronizam sozinhas.
//
// MODO NUVEM: cloud.ts busca os dados no Supabase e chama `setSnapshot()` sempre
// que algo muda (tempo real). Nada é salvo no navegador.
//
// As telas leem com `useDB()` e escrevem pelas funções de api.ts.

import { useSyncExternalStore } from 'react'
import { newId } from '../lib/id'
import { nowIso } from '../lib/dates'
import type { Database } from '../types'
import { isCloud } from './backend'
import { DB_VERSION, emptyDatabase, seedDatabase } from './seed'

const KEY = 'rkfood:db'

let db: Database = isCloud ? emptyDatabase() : load()
const listeners = new Set<() => void>()

function load(): Database {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Database
      if (parsed.version === DB_VERSION) {
        parsed.establishment.kitchenTargetMin ??= 15 // demonstração salva antes do tempo estimado
        parsed.establishment.tableCount ??= 10 // ... e antes da quantidade de mesas
        parsed.establishment.quickNotes ??= [] // ... e antes das observações rápidas
        parsed.materials ??= [] // ... e antes da ficha técnica
        parsed.recipes ??= []
        parsed.devices ??= []
        for (const u of parsed.users) { u.phone ??= ''; u.createdBy ??= null; u.blockedAt ??= null } // ... e antes do telefone
        // salva antes do perfil dono: o primeiro gerente vira dono (igual à migração do banco)
        if (!parsed.users.some((u) => u.roles.includes('dono'))) {
          parsed.users.find((u) => !u.deletedAt && u.roles.includes('gerente'))?.roles.push('dono')
        }
        return parsed
      }
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
if (typeof window !== 'undefined' && !isCloud) {
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

/** Modo nuvem: troca a foto dos dados sem gravar no navegador. */
export function setSnapshot(next: Database): void {
  db = next
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
