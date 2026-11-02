let ctx: AudioContext | null = null

/** Toca um aviso sonoro curto (pedido novo na cozinha, pedido pronto no atendente). */
export function beep(times = 2): void {
  try {
    ctx ??= new AudioContext()
    const audio = ctx
    for (let i = 0; i < times; i++) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.frequency.value = 880
      gain.gain.value = 0.2
      osc.connect(gain).connect(audio.destination)
      const start = audio.currentTime + i * 0.3
      osc.start(start)
      osc.stop(start + 0.18)
    }
    navigator.vibrate?.([150, 80, 150])
  } catch {
    // navegador sem áudio: ignora
  }
}
