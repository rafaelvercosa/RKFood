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

## Roteiro

- [x] **Etapa 1:** pedido, cozinha, caixa, fiado, cardápio com fotos, personalização (modo demo)
- [x] **Etapa 2:** Supabase multi-empresa, login do aparelho + PIN do operador, tempo real, fotos no Storage
- [ ] Publicar na Vercel e validar com um estabelecimento real
- [ ] **Etapa 3:** backups automáticos (Google Drive + segundo local) e painel do administrador da plataforma
- [ ] **Etapa 4:** ficha técnica, consumo de material e lista de compras
- [ ] **Etapa 5:** relatórios por período, gráficos e exportação para planilha
