// Som de clique em todos os botões do app. Liga e desliga por aparelho
// (uma TV da cozinha pode ficar sem), guardado no próprio navegador.

import { useSyncExternalStore } from 'react'
import { click } from './beep'

const KEY = 'rkfood:som-clique'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

let enabled = read()

export function setClickSound(on: boolean): void {
  enabled = on
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* sem storage: vale até fechar */ }
  listeners.forEach((l) => l())
  if (on) click() // para a pessoa ouvir como fica
}

export function useClickSound(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => enabled)
}

/** Escuta o toque em qualquer botão (inclusive links com cara de botão) da página inteira. */
export function installClickSound(): void {
  document.addEventListener('pointerdown', (e) => {
    if (!enabled || e.button !== 0) return
    const el = (e.target as Element | null)?.closest('button, .btn, [role="radio"]')
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return
    click()
  }, { capture: true, passive: true })
}
