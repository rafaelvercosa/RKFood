# Roteiro do RKFood

## Feito
- **Etapa 1:** pedido, cozinha, caixa, fiado, cardápio com fotos, personalização, lixeira e histórico
- **Etapa 2:** Supabase multi-empresa (RLS), login do aparelho + PIN, tempo real, fotos no Storage
- **Etapa 3 (nov/2026):** visual "placa de barraca"; mesa em destaque; mesas 1 a 10; comer aqui/para viagem;
  cronômetro da cozinha com tempo estimado e alerta de atrasados; gerente adianta pedido na fila; perfil
  **dono**; cancelamento só com PIN de gerente; **cortesia** só com PIN do dono; histórico com entrada e saída
  por PIN, PIN errado, autorização negada e conexão de aparelho; quantidade de mesas configurável; aparência só
  pelo dono; **área do dono** com vendas por período (dia, semana, mês, datas), materiais, ficha técnica, custo e
  lucro estimados e lista de compras (repor o que foi consumido)
- **Etapa 4 (nov/2026):** desempenho da equipe e tempos de saída; perfis com WhatsApp, "criado por" e bloqueio;
  convite por link no WhatsApp que libera o celular da pessoa; lista de aparelhos com bloqueio

## Agora
- Publicar: aplicar o banco no Supabase, cadastrar o primeiro estabelecimento, deploy na Vercel
- Validar com uso real numa barraca

## Próximos

### Modo contingência (offline)
Cenário real: internet de 4G **oscilando** com frequência e, às vezes, **horas sem internet**.

**Fase 1: cada aparelho continua funcionando sozinho**
- Cache local (IndexedDB) do cardápio, das fotos, dos clientes, dos pedidos do dia e da equipe. O app abre sem sinal.
- **Fila de envio:** pedidos, pagamentos e recebimentos de fiado feitos offline ficam na fila e sincronizam sozinhos.
  Cada operação leva um `client_id` (UUID) e as funções do banco ficam idempotentes: reenviar nunca duplica.
- Indicador fixo no topo: "🔴 Sem internet: N aguardando envio" → "✅ Tudo sincronizado".
- **Número provisório** do pedido offline (ex.: `A-07`, com o prefixo do aparelho) e número oficial na sincronização.
- O limite de fiado é conferido localmente e de novo no servidor. Se estourar, o gerente é avisado, mas a venda não é desfeita.
- PIN: quem já está logado continua. Login novo offline usa uma verificação local com cache do hash (a avaliar quanto à segurança).
- Conflitos: o servidor é a fonte da verdade. Mudanças de status seguem a ordem do horário de cada evento.

**Fase 2: cozinha recebendo pedidos sem internet (todas as opções)**
- **Comanda impressa pelo atendente:** impressora Bluetooth ou Wi-Fi ligada ao celular/tablet.
- **Tablet único:** um aparelho funcionando como atendimento, cozinha e caixa ao mesmo tempo (já é possível hoje com um usuário de vários perfis).
- **Atendente leva o celular:** tela "mostrar para a cozinha" com o pedido em letras grandes.
- **Servidor local na barraca:** um notebook ou mini-computador (ex.: Raspberry Pi) no mesmo Wi-Fi
  faz o papel da nuvem enquanto a internet está fora:
  - os aparelhos detectam que estão sem internet e passam a falar com o servidor local (endereço na rede da barraca);
  - a cozinha continua recebendo os pedidos em tempo real pela rede local;
  - quando a internet volta, o servidor local envia tudo para o Supabase e volta a ficar em espera;
  - possível produto à parte: "Kit RKFood Contingência" (equipamento já configurado), vendido ou alugado.

**Recomendação operacional:** roteador 4G reserva com chip de outra operadora.

### Segurança do PIN
- Bloquear por alguns minutos depois de várias tentativas de PIN errado seguidas no mesmo aparelho
  (hoje as tentativas ficam no histórico, mas não há bloqueio).

### Outros
- Backups automáticos diários (Google Drive + segundo local com bloqueio de exclusão)
- Painel do administrador da plataforma (cadastrar estabelecimentos sem SQL, ativar/bloquear)
- Controle de saldo de estoque (lançar compras e ver quanto tem de cada material; avisar abaixo do mínimo)
- Gráficos e exportação para planilha nos relatórios do dono
- Fechar a conta da mesa juntando vários pedidos

## Ideias para depois (apostas maiores)

Ficaram de fora da versão 0.3 de propósito. Cada uma muda bastante a forma de usar o sistema.

- **Cardápio por QR Code para o cliente:** o cliente lê o QR da mesa, vê o cardápio e pede sozinho. Exige uma área pública (sem PIN), proteção contra pedido falso e confirmação pelo atendente.
- **Modo contingência offline:** fila de sincronização e servidor local na barraca (descrito acima).
- **Impressora Bluetooth** para a comanda: hoje a impressão usa o diálogo do navegador (58 ou 80 mm).
- **Pix dinâmico com confirmação automática:** hoje o QR Code é estático e o caixa confere no app do banco. A confirmação automática exige um provedor de pagamentos (taxas e cadastro).
