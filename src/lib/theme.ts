// Tema claro, escuro ou do sistema (segue o aparelho). Escolha por aparelho,
// guardada no próprio navegador. O CSS lê data-theme no <html>.

import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'claro' | 'escuro' | 'sistema'

const KEY = 'rkfood:tema'
const listeners = new Set<() => void>()

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'claro' || v === 'escuro' ? v : 'sistema'
  } catch {
    return 'sistema'
  }
}

let choice = read()

/** Aplica no <html>; chamado antes de desenhar a tela, para não piscar o tema errado. */
export function applyTheme(): void {
  const root = document.documentElement
  if (choice === 'sistema') delete root.dataset.theme
  else root.dataset.theme = choice === 'escuro' ? 'dark' : 'light'
}

export function setTheme(next: ThemeChoice): void {
  choice = next
  try { localStorage.setItem(KEY, next) } catch { /* sem storage: vale até fechar */ }
  applyTheme()
  listeners.forEach((l) => l())
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => choice)
}
