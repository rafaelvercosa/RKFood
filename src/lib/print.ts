/**
 * Imprime um HTML usando um iframe invisível. Funciona com qualquer impressora
 * instalada no aparelho (inclusive térmicas de 58/80 mm) e também permite
 * "Salvar como PDF".
 */
export function printHtml(title: string, body: string, opts: { widthMm?: number } = {}): void {
  const width = opts.widthMm ? `${opts.widthMm}mm` : 'auto'
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { margin: ${opts.widthMm ? '0' : '12mm'}; ${opts.widthMm ? `size: ${width} auto;` : ''} }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #000; margin: 0; padding: ${opts.widthMm ? '3mm' : '0'}; width: ${width}; font-size: ${opts.widthMm ? '12px' : '13px'}; }
  h1 { font-size: 1.4em; margin: 0 0 4px; } h2 { font-size: 1.15em; margin: 10px 0 4px; }
  .big { font-size: 2em; font-weight: 800; } .muted { color: #444; } .right { text-align: right; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ccc; vertical-align: top; }
  th.right, td.right { text-align: right; } .neg { color: #b00020; } .pos { color: #0a6b2d; }
  img.logo { max-height: 56px; }
</style></head><body>${body}</body></html>`
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  if (!doc || !iframe.contentWindow) return
  doc.open()
  doc.write(html)
  doc.close()
  const win = iframe.contentWindow
  const go = () => {
    win.focus()
    win.print()
    setTimeout(() => iframe.remove(), 1000)
  }
  // espera imagens (logomarca) carregarem
  const imgs = Array.from(doc.images)
  if (imgs.length === 0) setTimeout(go, 50)
  else Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r })))).then(go)
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
