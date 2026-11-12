// Conteúdo do manual de instruções (tela Manual e folha de ajuda do botão "?").
// O mesmo texto está resumido no README.md; ao mudar um, confira o outro.

import type { Role } from '../types'

export interface ManualArea {
  id: string
  icon: string
  title: string
  short: string
  /** Rota do app que abre a ajuda desta área (o botão ? usa o começo do caminho). */
  route: string
  who: string
  serve: string
  steps: string[]
  tip: string
  caution: string
  faq?: { q: string; a: string }[]
}

export const DAY_STEPS = [
  'De manhã, o caixa abre o caixa informando o troco da gaveta.',
  'Os atendentes entram com o PIN e tiram os pedidos no celular.',
  'A cozinha vê a fila no tablet ou na TV, prepara e marca pronto.',
  'O atendente é avisado, entrega, e o caixa recebe (Pix, cartão, dinheiro ou fiado).',
  'À noite, o caixa conta a gaveta e fecha; o dono recebe o resumo no WhatsApp.',
]

export const AREAS: ManualArea[] = [
  {
    id: 'atendente', icon: '📱', title: 'Atendente', short: 'Tirar pedidos e mesas', route: '/atendente',
    who: 'atendente, gerente e dono',
    serve: 'Tirar os pedidos de mesa, de balcão e de viagem, sem papel.',
    steps: [
      'Toque em “Novo pedido”.',
      'Escolha a mesa (ou digite o nome) e “Comer aqui” ou “Para viagem”; toque em Continuar.',
      'Toque no + dos itens; use o contador para mais unidades.',
      'Toque em “Revisar”, marque as observações rápidas e envie.',
      'Para mais itens numa mesa já aberta, vá em Mesas → “Adicionar itens”.',
    ],
    tip: 'Quando o pedido ficar pronto, a tela verde “Pronto!” avisa a mesa.',
    caution: 'Depois de enviado, o pedido só se cancela com PIN de gerente.',
  },
  {
    id: 'cozinha', icon: '🔥', title: 'Cozinha', short: 'Fila, tempo e “Na chapa”', route: '/cozinha',
    who: 'cozinha, gerente e dono',
    serve: 'Mostrar o que preparar e em que ordem.',
    steps: [
      'Veja a fila: o mais antigo fica no topo.',
      'Use a barra “Na chapa” para saber quanto de cada espeto colocar.',
      'Toque no pedido para iniciar o preparo e de novo para marcar pronto.',
      'Fique de olho no cronômetro: pedido atrasado fica destacado.',
    ],
    tip: 'O modo TV deixa tudo legível à distância e toca um som quando chega pedido.',
    caution: 'Só o gerente adianta um pedido na fila, e precisa dizer o motivo.',
  },
  {
    id: 'caixa', icon: '💳', title: 'Caixa', short: 'Receber, Pix, troco e fechar', route: '/caixa',
    who: 'caixa, gerente e dono',
    serve: 'Receber o dinheiro e conferir o dia.',
    steps: [
      'Abra o caixa com o troco da gaveta.',
      'Toque no pedido e escolha como o cliente paga; pode dividir em várias formas.',
      'No Pix, mostre o QR Code, confira no app do banco e confirme.',
      'Em mesa, use “Fechar conta” para juntar os pedidos e dividir por pessoa.',
      'No fim do dia, conte a gaveta, veja a diferença e feche o caixa.',
    ],
    tip: 'O resumo do dia pode ir para o WhatsApp do dono ao fechar.',
    caution: 'Pedido pago não se apaga: cancele com PIN de gerente e diga o motivo. Cortesia exige o PIN do dono.',
    faq: [
      { q: 'O cliente pagou parte em Pix e parte em dinheiro?', a: 'Na tela de cobrança, adicione as duas formas e informe o valor de cada uma.' },
      { q: 'O Pix não aparece como pago.', a: 'O sistema não confirma o Pix sozinho. Confira no app do banco e toque em Confirmar recebimento.' },
    ],
  },
  {
    id: 'fiado', icon: '📒', title: 'Fiado', short: 'Clientes, limite e extrato', route: '/fiado',
    who: 'caixa, gerente e dono',
    serve: 'Vender para clientes de confiança e acompanhar quanto devem.',
    steps: [
      'Cadastre o cliente e defina o limite.',
      'No pagamento do pedido, escolha “Fiado”.',
      'Quando o cliente pagar, registre o recebimento (pode ser parcial).',
      'Abra o extrato e envie em PDF ou pelo WhatsApp.',
    ],
    tip: 'O sistema avisa quando a compra passaria do limite.',
    caution: 'O fiado entra nas vendas, mas não no dinheiro da gaveta.',
  },
  {
    id: 'gerencia', icon: '⚙️', title: 'Gerência', short: 'Cardápio, equipe e lixeira', route: '/gerente',
    who: 'gerente (o dono pode tudo)',
    serve: 'Cuidar do cardápio, da equipe e da loja.',
    steps: [
      'Em Cardápio, crie e edite itens com foto e preço.',
      'Em Equipe, cadastre atendentes e envie o convite.',
      'Em Estabelecimento, ajuste o número de mesas e o tempo-alvo da cozinha.',
      'Em Observações rápidas, escolha os botões que aparecem ao revisar o pedido.',
      'Em Lixeira e histórico, restaure o que foi excluído sem querer.',
    ],
    tip: 'Desative um item em vez de excluir, quando acabar o estoque do dia.',
    caution: 'O gerente só cria atendente; mudar perfis, bloquear e mexer na aparência é do dono.',
  },
  {
    id: 'dono', icon: '📈', title: 'Área do dono', short: 'Vendas, materiais e compras', route: '/dono',
    who: 'somente o dono',
    serve: 'Mostrar os números e planejar compras.',
    steps: [
      'Em Vendas, escolha o período e veja vendas, lucro estimado e horário de pico.',
      'Em Desempenho, compare a equipe e os tempos de preparo e entrega.',
      'Cadastre Materiais e monte a Ficha técnica de cada item.',
      'Em Lista de compras, veja o que repor e compartilhe pelo WhatsApp.',
      'Em Aparelhos, bloqueie um aparelho perdido.',
    ],
    tip: 'Preencha o custo dos materiais para ver o lucro estimado de cada item.',
    caution: 'Sem ficha técnica, o consumo e as compras não são calculados.',
  },
]

export const FIRST_USE = [
  'Conecte o aparelho com o e-mail e a senha do estabelecimento.',
  'Monte o cardápio: use o modelo Espetinho e ajuste nomes, preços e fotos.',
  'Cadastre a equipe em Gerência → Equipe.',
  'Mande o convite pelo WhatsApp; cada pessoa entra pelo próprio celular e cria o PIN.',
  'Faça um pedido de teste do atendente até a cozinha.',
]

export const FAQ = [
  { q: 'Cancelei sem querer. Dá para voltar?', a: 'Itens removidos têm “Desfazer” por 8 segundos. Pedido cancelado não volta, mas o histórico guarda tudo. Itens e perfis excluídos voltam pela Lixeira.' },
  { q: 'A internet caiu.', a: 'O app mostra uma faixa “Sem internet” e não deixa enviar. O modo contingência está no roteiro do projeto.' },
  { q: 'Perdi o celular de um funcionário.', a: 'Área do dono → Aparelhos → Bloquear.' },
  { q: 'Esqueci o PIN.', a: 'Em Gerência → Equipe, toque em “Enviar acesso” na pessoa: ela recebe um link novo pelo WhatsApp e cria outro PIN.' },
]

export const GLOSSARY: [string, string][] = [
  ['Ticket médio', 'Valor médio de cada pedido (vendas ÷ número de pedidos).'],
  ['Fiado', 'Venda para pagar depois, com limite por cliente.'],
  ['Cortesia', 'Pedido sem cobrança, autorizado pelo dono.'],
  ['PIN', 'Senha numérica pessoal de cada operador.'],
  ['Ficha técnica', 'Receita do item: quanto de cada material ele usa.'],
  ['Na chapa', 'Soma dos espetos em preparo na cozinha.'],
  ['Lixeira', 'Onde ficam os itens excluídos, que podem ser restaurados.'],
  ['PWA', 'Aplicativo que se instala na tela inicial do celular, sem loja de aplicativos.'],
]

/** Quem pode o quê: [ação, atendente, cozinha, caixa, gerente, dono]. */
export const PERMISSIONS: [string, ...boolean[]][] = [
  ['Tirar pedido', true, false, false, true, true],
  ['Preparar na cozinha', false, true, false, true, true],
  ['Receber e fiado', false, false, true, true, true],
  ['Abrir e fechar caixa', false, false, true, true, true],
  ['Cancelar pedido (PIN do gerente)', false, false, false, true, true],
  ['Adiantar na fila', false, false, false, true, true],
  ['Cardápio e mesas', false, false, false, true, true],
  ['Criar atendente', false, false, false, true, true],
  ['Cortesia (PIN do dono)', false, false, false, false, true],
  ['Editar e bloquear perfis', false, false, false, false, true],
  ['Marca da barraca', false, false, false, false, true],
  ['Área do dono', false, false, false, false, true],
]

export const PERMISSION_ROLES: Role[] = ['atendente', 'cozinha', 'caixa', 'gerente', 'dono']

/** Área do manual que corresponde ao caminho aberto (para o botão ?). */
export function areaForPath(path: string): ManualArea | undefined {
  return AREAS.find((a) => path === a.route || path.startsWith(`${a.route}/`))
}
