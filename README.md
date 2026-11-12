# 🍢 RKFood

Sistema de **pedidos, cozinha, caixa e fiado** para espetinhos, carrocinhas e pequenas lanchonetes.
Funciona no navegador do celular, tablet ou TV e pode ser instalado na tela inicial como aplicativo (PWA).

> **Status:** versão 0.3 (visual novo, mesas, Pix com QR Code e caixa com abertura e fechamento). Funciona em **modo nuvem** (Supabase: vários estabelecimentos, tempo real entre aparelhos)
> ou em **modo demonstração** (sem configuração, dados só no navegador).
> Implantação: [docs/implantacao.md](docs/implantacao.md).

## Funcionalidades

| Perfil | O que faz |
|---|---|
| **Atendente** | Pede em **2 passos**: mesa (botões) ou nome, depois os itens com foto. **Observações rápidas** em botões (*sem pimenta*, *bem passado*...). Vê as **mesas abertas**, adiciona itens a uma mesa e recebe aviso de tela cheia quando o pedido fica pronto. |
| **Cozinha** | Fila em tempo real com **cronômetro em anel** por pedido e a barra **Na chapa** (soma dos espetos pedidos). Destaca atrasados. Tem **modo TV**, aviso sonoro e **impressão de comanda** (58 ou 80 mm). |
| **Caixa** | **Abre e fecha o caixa** (troco, dinheiro esperado, diferença e resumo no WhatsApp). Recebe por **Pix com QR Code**, crédito, débito, dinheiro (com troco) e **fiado**, inclusive dividido. **Conta da mesa**: junta os pedidos e divide por pessoa. |
| **Fiado** | Clientes com limite, saldo devedor e recebimento parcial ou total. **Extrato** em PDF ou pelo **WhatsApp**. |
| **Gerente** | Cardápio com fotos (e **cardápio modelo** para começar), observações rápidas, equipe com PIN e convite pelo WhatsApp, aparência (logomarca, foto, **cor da marca** com contraste automático), lixeira e histórico. |
| **Dono** | Vendas por período com **horário de pico** e **comparação com o período anterior**, desempenho da equipe, materiais, ficha técnica, **lista de compras** e aparelhos. Recebe o **resumo do dia** no WhatsApp. |

Em todas as telas o botão **?** abre a ajuda da tela e o **Manual** completo. Há tema claro, escuro e do sistema.

**Regras de segurança dos dados**
- Nada é apagado de verdade. O que for excluído vai para a **lixeira** e pode ser restaurado.
- Pedidos não são apagados, só **cancelados**, com motivo.
- Toda alteração fica no **histórico**, com quem fez e quando.
- Valores em dinheiro são guardados em centavos (inteiros), sem erro de arredondamento.

## Como rodar

```bash
npm install
npm run dev      # abre em http://localhost:5173
npm test         # testes automatizados
npm run build    # versão de produção em dist/
```

Sem o arquivo `.env.local` o app abre em **modo demonstração**. Para usar o Supabase, veja [docs/implantacao.md](docs/implantacao.md).

No modo demonstração, entre com um destes PINs:

| Usuário | PIN | Perfis |
|---|---|---|
| Dono | 1234 | todos |
| Ana (atendente) | 1111 | atendente |
| Cozinha | 2222 | cozinha |
| Caixa | 3333 | caixa |

> Dica: abra **Atendente** e **Cozinha** em duas abas para ver o pedido chegar em tempo real.

## Tecnologia

- **React 19 + TypeScript + Vite**, PWA (manifest e service worker)
- **React Router** para as telas por perfil
- **Vitest** para os testes de regras de negócio
- **Supabase**: Postgres com RLS multi-empresa, funções (RPC) com as regras de negócio, Auth, Realtime e Storage para fotos
- **Vercel** para hospedagem

```
src/
├── types.ts            modelo de dados
├── data/
│   ├── api.ts          ponto único de escrita (demo ou Supabase)
│   ├── cloud.ts        modo nuvem: login do aparelho, carga de dados, tempo real
│   ├── store.ts        "foto" dos dados que as telas leem
│   ├── actions.ts      regras do modo demonstração
│   ├── selectors.ts    cálculos: totais, saldo de fiado, relatórios
│   └── flow.test.ts    testes do fluxo completo
├── pages/              telas: Atendente, Cozinha, Caixa, Fiado, Gerente…
├── components/         componentes reutilizáveis
└── lib/                dinheiro, datas, impressão, fotos, som
supabase/
├── migrations/         esquema, segurança (RLS) e funções do banco
├── instalar_tudo.sql   tudo junto, para colar no SQL Editor
└── tests/              testes do banco (isolamento, perfis, regras)
```

Mais detalhes em [docs/arquitetura.md](docs/arquitetura.md).

## Manual de instruções

Guia para quem usa o RKFood no dia a dia. Está em português simples e organizado pela ordem de um dia de trabalho.
(O mesmo manual está dentro do app, no botão **?** de cada tela e em **Área do dono → Manual**.)

### Um dia de trabalho em 5 passos

1. **Abrir:** o caixa entra no app e deixa tudo pronto.
2. **Atender:** os atendentes entram com o PIN e tiram os pedidos no celular.
3. **Preparar:** a cozinha vê a fila no tablet ou na TV e marca *Pronto* quando termina.
4. **Receber:** o caixa recebe (Pix, cartão, dinheiro ou fiado).
5. **Fechar:** no fim do dia, o caixa faz o fechamento e o dono confere os números.

### Primeiro acesso do estabelecimento

1. O dono recebe o e-mail e a senha do **estabelecimento** (conta do aparelho). Abra o app, toque em **Conectar aparelho** e digite os dois. Isso é feito **uma vez por aparelho**.
2. Cada pessoa entra com o próprio **PIN**. O PIN vale por 16 horas e depois pede de novo.
3. Em **Gerência → Cardápio**, cadastre os itens (nome, preço, categoria e foto). Itens sem foto aparecem com um desenho.
4. Em **Gerência → Equipe**, cadastre os atendentes. Cadastre o WhatsApp da pessoa e toque em **Enviar acesso**: o app gera um **link de convite** (uso único, 24 horas) para mandar pelo WhatsApp. A pessoa abre o link no próprio celular e cria o PIN.
5. Em **Gerência → Estabelecimento**, ajuste nome, frase, cor, logomarca, quantidade de mesas e tempo-alvo da cozinha.
6. Faça um **pedido de teste** do atendente até a cozinha antes de abrir.

> No modo demonstração (sem Supabase) use os PINs da tabela acima.

### Quem pode o quê

| Ação | Atend. | Cozinha | Caixa | Gerente | Dono |
|---|:-:|:-:|:-:|:-:|:-:|
| Tirar pedido | ✅ | – | – | ✅ | ✅ |
| Preparar e marcar pronto | – | ✅ | – | ✅ | ✅ |
| Receber pagamento e fiado | – | – | ✅ | ✅ | ✅ |
| Abrir e fechar o caixa | – | – | ✅ | ✅ | ✅ |
| Cancelar pedido (pede **PIN de gerente**) | – | – | – | ✅ | ✅ |
| Adiantar pedido na fila | – | – | – | ✅ | ✅ |
| Cardápio e mesas | – | – | – | ✅ | ✅ |
| Criar atendente | – | – | – | ✅ | ✅ |
| Cortesia (pede **PIN do dono**) | – | – | – | – | ✅ |
| Editar, bloquear e excluir perfis | – | – | – | – | ✅ |
| Nome, cor, logomarca e foto | – | – | – | – | ✅ |
| Área do dono (vendas, materiais, compras, aparelhos) | – | – | – | – | ✅ |

Toda recusa e toda ação importante ficam no **histórico**.

### Atendente: tirar o pedido

1. Toque em **Novo**. No **passo 1**, escolha a **mesa** (botões, ou **Outra**) **ou** digite o **nome** do cliente, marque **Comer aqui** ou **Para viagem** e toque em **Continuar**.
2. No **passo 2**, toque nos itens do cardápio. O botão **+** vira um contador (**−** e **+**). Use a lupa para buscar e as categorias para filtrar.
3. Toque em **Revisar →**. Marque as **observações rápidas** de cada item (*Bem passado*, *Sem pimenta*...) ou use **✎ Outra** para escrever.
4. Toque em **Enviar pedido**. Com cobrança *antes*, o pedido só vai para a cozinha depois de pago.
5. Quando o pedido ficar pronto, a tela verde **Pronto!** avisa a mesa, com som. Entregue e marque **Entregue** em *Pedidos*.

**Mesas:** a aba *Mesas* mostra cada mesa com conta aberta, o total e há quanto tempo. **+ Adicionar itens** abre um novo pedido na mesma mesa. **Fechar conta** leva ao caixa.

**Errou ao tirar um item?** Aparece o aviso **Desfazer** por **8 segundos**.

### Cozinha: preparar na ordem

- Os pedidos aparecem **na ordem de chegada**. O **anel** mostra os minutos desde que o pedido chegou e muda de cor: verde, amarelo e vermelho (**atrasado**, acima do tempo-alvo).
- A barra **Na chapa** soma quanto de cada item está na fila (por exemplo, *Frango 8, Linguiça 4*). Serve para saber quantos espetos colocar.
- Toque em **Iniciar preparo** e, depois, em **Pronto**.
- O **modo TV** deixa a tela escura, com letras grandes, para ler de longe. Há aviso sonoro e **impressão de comanda** em papel de 58 ou 80 mm.
- Somente o **gerente** pode adiantar um pedido na fila, e precisa dizer o motivo.

### Caixa: receber

1. **Abra o caixa** com o dinheiro de troco que está na gaveta (atalhos de R$ 50, 100 e 200).
2. Na aba **Receber**, toque no pedido. Escolha a forma: **Pix, crédito, débito, dinheiro** ou **fiado**. Pode **dividir** em várias formas.
3. No **dinheiro**, digite quanto o cliente deu: o app mostra o **troco**.
4. No **Pix**, toque em **Mostrar QR Code Pix**. O cliente lê o QR Code (ou usa o *copia e cola*). **O sistema não confirma o Pix sozinho:** confira no app do banco e toque em **Confirmar recebimento**. A chave Pix é cadastrada em Gerência → Estabelecimento.
5. Toque em **Confirmar**.

**Conta da mesa.** Na aba **Mesas**, toque na mesa: o app junta os pedidos. Para dividir, use **Dividir a conta** (− e +) e toque em **Receber** em cada pessoa; cada parte pode ser paga de um jeito diferente. **Receber tudo** quita a mesa de uma vez.

**Fechar o caixa.** No fim do dia, abra **Fechamento** → **Fechar o caixa**: o app mostra o que deveria ter na gaveta (*troco + dinheiro recebido*), você digita o dinheiro contado e vê a **diferença**. **Enviar resumo e fechar** manda o resumo do dia para o WhatsApp.

**Cuidado:** pedido pago **não é apagado**. Se errou, use **Cancelar pedido**, informe o PIN de um gerente e escreva o motivo.

### Fiado: vender para pagar depois

1. Cadastre o cliente e defina o **limite**.
2. No pagamento do pedido, escolha **Fiado**. O app avisa se a compra passa do limite.
3. Quando o cliente pagar, registre o **recebimento** (pode ser parcial).
4. Abra o **extrato** para imprimir, salvar em PDF ou mandar pelo **WhatsApp**.

### Gerência: cardápio, equipe e loja

- **Cardápio:** crie, edite e reordene itens com foto e preço. Quem está começando pode usar o **cardápio modelo** (Espetinho ou Lanchonete) e depois ajustar. Marque **indisponível** quando acabar, em vez de excluir.
- **Equipe:** perfis com nome, telefone (WhatsApp) e funções. O gerente **só cria atendente**. Editar, mudar permissões, bloquear e excluir é do dono.
- **Estabelecimento:** quantidade de mesas, tempo-alvo da cozinha, chave Pix e aparência. Nome, cor, logomarca e foto só o dono altera. A **cor da marca** pode ser qualquer uma: o texto sobre ela muda sozinho para branco ou escuro.
- **Observações rápidas:** escolha os botões que o atendente vê ao revisar o pedido (até 20).
- **Lixeira e histórico:** tudo que foi excluído pode ser **restaurado**; o histórico mostra quem fez o quê e quando, inclusive entradas por PIN, PIN errado, abertura e fechamento do caixa.

### Área do dono

- **Vendas:** por período, com lucro estimado, **comparação com o período anterior** (por exemplo, *↑ 12% contra os 7 dias anteriores*) e o gráfico **Vendas por hora**, com o **horário de pico** destacado.
- **Desempenho:** vendas e ticket médio por pessoa, tempo médio de preparo e de entrega.
- **Materiais e ficha técnica:** cadastre os materiais (kg, litro ou unidade) e quanto cada item usa. Sem ficha técnica o app não calcula consumo.
- **Lista de compras:** repõe o que foi consumido no período e pode ser compartilhada pelo WhatsApp. Não há saldo de estoque, de propósito.
- **Aparelhos:** veja os aparelhos conectados e **bloqueie** um aparelho perdido.
- **Primeiro uso:** na tela inicial do dono aparece a lista *Vamos deixar tudo pronto* (cardápio, equipe, convite e pedido de teste) até tudo estar feito.

### Perguntas frequentes

**O cliente pagou parte em Pix e parte em dinheiro.** Na tela de cobrança, adicione as duas formas e o valor de cada uma.

**Cancelei sem querer.** Item tirado do pedido e coisas movidas para a lixeira têm o aviso **Desfazer** por 8 segundos. Pedido cancelado não volta, mas o histórico guarda tudo. Itens e perfis excluídos voltam pela **Lixeira**.

**A internet caiu.** O app mostra a faixa *Sem internet* e não deixa enviar pedidos. Nada é guardado para depois: o modo contingência (offline) está no [roteiro](docs/roadmap.md).

**O Pix não aparece como pago.** O sistema não confirma o Pix sozinho. Confira no app do banco e toque em **Confirmar recebimento**.

**Perdi o celular de um funcionário.** Área do dono → Aparelhos → **Bloquear**.

**Esqueci o PIN.** Em Gerência → Equipe, toque em **Enviar acesso** na pessoa: ela recebe um novo link pelo WhatsApp e cria um PIN novo.

### Glossário

| Termo | Significado |
|---|---|
| Ticket médio | Valor médio de cada pedido (vendas ÷ número de pedidos) |
| Fiado | Venda para pagar depois, com limite por cliente |
| Cortesia | Pedido sem cobrança, autorizado pelo dono |
| PIN | Senha numérica pessoal de cada operador |
| Ficha técnica | Receita do item: quanto de cada material ele usa |
| Lixeira | Onde ficam os itens excluídos, que podem ser restaurados |
| PWA | Aplicativo que se instala na tela inicial sem loja de apps |

## Roteiro

- [x] **Etapa 1:** pedido, cozinha, caixa, fiado, cardápio com fotos, personalização (modo demo)
- [x] **Etapa 2:** Supabase multi-empresa, login do aparelho + PIN do operador, tempo real, fotos no Storage
- [x] Publicado na Vercel (rkfood.vercel.app)
- [ ] Validar com um estabelecimento real (celular de verdade, convite pelo WhatsApp)
- [x] **Visual novo (v0.3):** tema macio, mesas abertas, conta da mesa, Pix com QR Code, abrir e fechar caixa, observações rápidas, cardápio modelo, manual no app
- [ ] **Modo contingência (offline):** fila de sincronização e servidor local na barraca. Ver [docs/roadmap.md](docs/roadmap.md)
- [ ] **Etapa 3:** backups automáticos (Google Drive + segundo local) e painel do administrador da plataforma
- [x] **Etapa 4:** ficha técnica, consumo de material e lista de compras
- [x] **Etapa 5 (parte):** relatórios por período, gráfico por hora, comparação e horário de pico
- [ ] Exportação para planilha
- [ ] **Cardápio por QR Code para o cliente** pedir da mesa (ideia para depois)
- [ ] **Impressora Bluetooth** para a comanda (ideia para depois)
