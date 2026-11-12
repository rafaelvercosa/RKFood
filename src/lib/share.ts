/**
 * Abre a janela de compartilhar do próprio celular (WhatsApp, e-mail, Telegram,
 * Google Keep, Notas...). Manda o arquivo junto quando o aparelho aceita.
 * 'sem-suporte' = o navegador não tem essa janela (a maioria dos computadores).
 */
export async function shareContent(data: { title: string; text: string; file?: File }): Promise<'ok' | 'cancelado' | 'sem-suporte'> {
  if (!navigator.share) return 'sem-suporte'
  const withFile = data.file && navigator.canShare?.({ files: [data.file] })
  try {
    await navigator.share(withFile ? { title: data.title, text: data.text, files: [data.file!] } : { title: data.title, text: data.text })
    return 'ok'
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelado'
    throw e
  }
}

/** Baixa o arquivo (para quando não dá para compartilhar). */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Compartilha um texto: janela do celular ou, no computador, WhatsApp Web. */
export async function shareText(text: string): Promise<void> {
  const r = await shareContent({ title: 'RKFood', text })
  if (r === 'sem-suporte') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}
