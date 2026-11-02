// PDF da lista de compras, gerado no próprio aparelho. O jsPDF só é baixado
// quando alguém pede o PDF (não pesa na abertura do app).

import { formatQty, periodText, type Consumption } from '../../data/reports'
import { brl } from '../../lib/money'

export async function purchaseListPdf(establishment: string, from: string, to: string, c: Consumption): Promise<File> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const left = 16
  const right = 194
  let y = 20

  const newPageIfNeeded = () => {
    if (y > 280) { doc.addPage(); y = 20 }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(`Lista de compras · ${establishment}`, left, y)
  y += 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Para repor o que foi vendido em ${periodText(from, to)}`, left, y)
  y += 10

  // cabeçalho da tabela
  doc.setFont('helvetica', 'bold')
  doc.text('Material', left + 7, y)
  doc.text('Comprar', 125, y, { align: 'right' })
  doc.text('Gasto', 158, y, { align: 'right' })
  doc.text('Custo', right, y, { align: 'right' })
  y += 2
  doc.line(left, y, right, y)
  y += 6
  doc.setFont('helvetica', 'normal')

  for (const l of c.lines) {
    newPageIfNeeded()
    doc.rect(left, y - 3.5, 4, 4) // quadradinho para marcar
    doc.text(doc.splitTextToSize(l.name, 80)[0], left + 7, y)
    doc.setFont('helvetica', 'bold')
    doc.text(formatQty(l.buy, l.unit), 125, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.text(formatQty(l.qty, l.unit), 158, y, { align: 'right' })
    doc.text(l.cost ? brl(l.cost) : '—', right, y, { align: 'right' })
    y += 8
  }

  newPageIfNeeded()
  doc.line(left, y - 4, right, y - 4)
  doc.setFont('helvetica', 'bold')
  doc.text('Custo estimado', left, y + 2)
  doc.text(brl(c.totalCost), right, y + 2, { align: 'right' })
  y += 10
  doc.setFont('helvetica', 'normal')
  if (c.withoutRecipe.length) {
    newPageIfNeeded()
    doc.setFontSize(9)
    const lines = doc.splitTextToSize(`Vendidos sem ficha técnica (fora da conta): ${c.withoutRecipe.join(', ')}`, right - left)
    doc.text(lines, left, y)
  }

  const name = `lista-de-compras-${from}${from === to ? '' : `-a-${to}`}.pdf`
  return new File([doc.output('blob')], name, { type: 'application/pdf' })
}
