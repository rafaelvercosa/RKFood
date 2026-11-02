let ctx: AudioContext | null = null

/** O mesmo AudioContext para todos os sons; o navegador só libera depois de um toque na tela. */
function audio(): AudioContext {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Toca um aviso sonoro curto (pedido novo na cozinha, pedido pronto no atendente). */
export function beep(times = 2): void {
  try {
    const a = audio()
    for (let i = 0; i < times; i++) {
      const osc = a.createOscillator()
      const gain = a.createGain()
      osc.frequency.value = 880
      gain.gain.value = 0.2
      osc.connect(gain).connect(a.destination)
      const start = a.currentTime + i * 0.3
      osc.start(start)
      osc.stop(start + 0.18)
    }
    navigator.vibrate?.([150, 80, 150])
  } catch {
    // navegador sem áudio: ignora
  }
}

/** Clique curto e baixo, como de tecla, para confirmar o toque num botão. */
export function click(): void {
  try {
    const a = audio()
    const t = a.currentTime
    const osc = a.createOscillator()
    const gain = a.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(1800, t)
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.03)
    gain.gain.setValueAtTime(0.12, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045)
    osc.connect(gain).connect(a.destination)
    osc.start(t)
    osc.stop(t + 0.05)
  } catch {
    // navegador sem áudio: ignora
  }
}
