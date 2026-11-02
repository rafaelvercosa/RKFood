/**
 * Reduz uma foto escolhida no celular para no máximo `maxSize` px e devolve
 * um data URL JPEG. Fotos de celular chegam com 3–8 MB; depois disso ficam
 * com ~40–80 KB, o que deixa o cardápio leve mesmo no 4G.
 */
export async function resizeImage(file: File, maxSize = 640, quality = 0.8): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível processar a imagem')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', quality)
}
