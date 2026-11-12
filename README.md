# 🍢 RKFood

Sistema de **pedidos, cozinha, caixa e fiado** para espetinhos, carrocinhas e pequenas lanchonetes.
Funciona no navegador do celular, tablet ou TV e pode ser instalado na tela inicial como aplicativo (PWA).

> **Status:** versão 0.2. Funciona em **modo nuvem** (Supabase: vários estabelecimentos, tempo real entre aparelhos)
> ou em **modo demonstração** (sem configuração, dados só no navegador).
> Implantação: [docs/implantacao.md](docs/implantacao.md).

## Funcionalidades

| Perfil | O que faz |
|---|---|
| **Atendente** | Monta o pedido pelo cardápio com fotos, por **mesa** ou **nome do cliente**, para **comer aqui** ou **viagem**, com observação por item. Recebe aviso sonoro quando o pedido fica pronto. |
| **Cozinha** | Fila em tempo real: *Novo → Em preparo → Pronto*. Destaca pedidos atrasados. Tem **modo TV** (tela escura, letras grandes), aviso sonoro e **impressão de comanda** (58 ou 80 mm), manual ou automática. |
| **Caixa** | Recebe por **Pix, crédito, débito, dinheiro** (com cálculo de troco) e **fiado**. Aceita pagamento dividido em várias formas. Imprime comprovante e faz o fechamento do dia. |
| **Fiado** | Cadastro de clientes com limite de crédito, saldo devedor e recebimento parcial ou total. **Extrato** para imprimir, salvar em PDF ou enviar pelo **WhatsApp**. |
| **Gerente** | Cardápio com **fotos**, categorias e itens indisponíveis. Equipe com PIN e perfis. Personalização (logomarca, foto, cor, frase). Relatórios por dia, lixeira e histórico de alterações. |

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
(O app também terá este manual dentro dele, pelo botão **?**, a partir da nova versão.)

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

1. Escolha a **mesa** (botões de 1 a 10, ou outra) **ou** digite o **nome** do cliente.
2. Marque **Comer aqui** ou **Para viagem**.
3. Toque nos itens do cardápio. Use **+** e **−** para a quantidade.
4. Se precisar, escreva uma **observação** no item (por exemplo, *sem pimenta*).
5. Toque em **Enviar pedido**. Com cobrança *antes*, o pedido só vai para a cozinha depois de pago.
6. Quando o pedido ficar pronto, o app **avisa com som**. Entregue e pronto.

**Dica:** a aba *Pedidos do dia* mostra o estado de cada pedido: novo, em preparo, pronto.

### Cozinha: preparar na ordem

- Os pedidos aparecem **na ordem de chegada**, com cronômetro. Pedido **atrasado** (acima do tempo-alvo) fica destacado.
- Toque em **Iniciar preparo** e, depois, em **Pronto**.
- O **modo TV** deixa a tela escura, com letras grandes, para ler de longe. Há aviso sonoro e **impressão de comanda** em papel de 58 ou 80 mm.
- Somente o **gerente** pode adiantar um pedido na fila, e precisa dizer o motivo.

### Caixa: receber

1. Na aba **A receber**, toque no pedido.
2. Escolha a forma: **Pix, crédito, débito, dinheiro** ou **fiado**. Pode **dividir** em várias formas.
3. No **dinheiro**, digite quanto o cliente deu: o app mostra o **troco**.
4. Toque em **Confirmar**. Imprima o comprovante, se quiser.
5. No fim do dia, abra **Fechamento**: vendas, pedidos, ticket médio, entradas por forma de pagamento e cancelados.

**Cuidado:** pedido pago **não é apagado**. Se errou, use **Cancelar pedido**, informe o PIN de um gerente e escreva o motivo.

### Fiado: vender para pagar depois

1. Cadastre o cliente e defina o **limite**.
2. No pagamento do pedido, escolha **Fiado**. O app avisa se a compra passa do limite.
3. Quando o cliente pagar, registre o **recebimento** (pode ser parcial).
4. Abra o **extrato** para imprimir, salvar em PDF ou mandar pelo **WhatsApp**.

### Gerência: cardápio, equipe e loja

- **Cardápio:** crie, edite e reordene itens com foto e preço. Marque **indisponível** quando acabar, em vez de excluir.
- **Equipe:** perfis com nome, telefone (WhatsApp) e funções. O gerente **só cria atendente**. Editar, mudar permissões, bloquear e excluir é do dono.
- **Estabelecimento:** quantidade de mesas, tempo-alvo da cozinha e aparência. Nome, cor, logomarca e foto só o dono altera.
- **Lixeira:** tudo que foi excluído pode ser **restaurado**.
- **Histórico:** quem fez o quê e quando, inclusive entradas por PIN, PIN errado e conexão de aparelhos.

### Área do dono

- **Vendas:** por período, com lucro estimado.
- **Desempenho:** vendas e ticket médio por pessoa, tempo médio de preparo e de entrega.
- **Materiais e ficha técnica:** cadastre os materiais (kg, litro ou unidade) e quanto cada item usa. Sem ficha técnica o app não calcula consumo.
- **Lista de compras:** repõe o que foi consumido no período e pode ser compartilhada pelo WhatsApp. Não há saldo de estoque, de propósito.
- **Aparelhos:** veja os aparelhos conectados e **bloqueie** um aparelho perdido.

### Perguntas frequentes

**O cliente pagou parte em Pix e parte em dinheiro.** Na tela de cobrança, adicione as duas formas e o valor de cada uma.

**Cancelei sem querer.** Pedido cancelado não volta, mas o histórico guarda tudo. Itens e perfis excluídos voltam pela **Lixeira**.

**A internet caiu.** O app precisa de internet para enviar pedidos. O modo contingência (offline) está no [roteiro](docs/roadmap.md).

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
- [ ] Publicar na Vercel e validar com um estabelecimento real
- [ ] **Modo contingência (offline):** fila de sincronização e servidor local na barraca. Ver [docs/roadmap.md](docs/roadmap.md)
- [ ] **Etapa 3:** backups automáticos (Google Drive + segundo local) e painel do administrador da plataforma
- [ ] **Etapa 4:** ficha técnica, consumo de material e lista de compras
- [ ] **Etapa 5:** relatórios por período, gráficos e exportação para planilha
