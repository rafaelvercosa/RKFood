-- Testes do banco: isolamento entre estabelecimentos, perfis e regras de negócio.
-- Cada bloco lança erro se algo estiver errado. Saída esperada: só "OK ...".
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@teste.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@teste.com');

create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;
insert into ctx values
  ('ea', private.bootstrap_establishment('Espetinho A', 'a@teste.com', 'Dono A', '1234')::text),
  ('eb', private.bootstrap_establishment('Espetinho B', 'b@teste.com', 'Dono B', '1234')::text);

create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
end $$;
\o /dev/null

-- só para as conferências deste teste (o app não tem acesso a estas funções)
grant execute on function private.order_total(uuid), private.order_paid(uuid), private.customer_balance(uuid) to authenticated;

-- ===================================================== como aparelho A
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
\o

do $$
begin
  assert (select count(*) from public.establishments) = 1, 'A deveria ver só 1 estabelecimento';
  assert (select name from public.my_context()) = 'Espetinho A', 'contexto errado';
  raise notice 'OK isolamento: A só vê o próprio estabelecimento';
end $$;

-- PIN errado: não entra e fica no histórico (a função não lança erro, para o registro ficar)
do $$
begin
  assert (select count(*) from public.operator_login((select v::uuid from ctx where k = 'ea'), '9999')) = 0, 'PIN errado não deveria entrar';
  assert exists (select 1 from public.audit_log where action = 'pin.errado'), 'PIN errado deveria ficar no histórico';
  raise notice 'OK PIN errado recusado e registrado';
end $$;

-- Login no estabelecimento B com conta A deve falhar
do $$
begin
  perform public.operator_login((select v::uuid from ctx where k = 'eb'), '1234');
  raise exception 'A não deveria entrar em B';
exception when others then
  assert sqlerrm like 'Este aparelho não tem acesso%', sqlerrm;
  raise notice 'OK conta A não entra no estabelecimento B';
end $$;

insert into ctx select 'ta', token::text from public.operator_login((select v::uuid from ctx where k = 'ea'), '1234');

-- Hash do PIN não pode ser lido
do $$
begin
  perform pin_hash from public.staff;
  raise exception 'pin_hash não deveria ser legível';
exception when insufficient_privilege then
  raise notice 'OK hash do PIN protegido';
end $$;

-- Escrita direta bloqueada
do $$
begin
  insert into public.categories (establishment_id, name) values ((select v::uuid from ctx where k = 'ea'), 'X');
  raise exception 'insert direto deveria falhar';
exception when insufficient_privilege then
  raise notice 'OK escrita direta nas tabelas bloqueada';
end $$;

-- Cardápio + atendente
do $$
declare
  t uuid := (select v::uuid from ctx where k = 'ta');
  cat uuid := (select id from public.categories where name = 'Espetinhos');
  beb uuid := (select id from public.categories where name = 'Bebidas');
begin
  perform public.save_product(t, null, cat, 'Carne', 'Alcatra', 1000, null, true, true);
  perform public.save_product(t, null, beb, 'Refri', '', 600, null, true, false);
  perform public.save_staff(t, null, 'Ana', '1111', array['atendente']);
  perform public.save_staff(t, null, 'Caixa', '3333', array['caixa']);
  begin
    perform public.save_staff(t, null, 'Repetido', '1111', array['caixa']);
    raise exception 'PIN repetido deveria falhar';
  exception when others then
    assert sqlerrm = 'Esse PIN já está em uso', sqlerrm;
  end;
  perform public.save_customer(t, null, 'Seu João', '(81) 99999-0000', '', 5000);
  raise notice 'OK cardápio, equipe e cliente cadastrados';
end $$;

insert into ctx select 'tana', token::text from public.operator_login((select v::uuid from ctx where k = 'ea'), '1111');
insert into ctx select 'tcx', token::text from public.operator_login((select v::uuid from ctx where k = 'ea'), '3333');

-- Perfil: atendente não pode mexer no cardápio nem receber
do $$
declare t uuid := (select v::uuid from ctx where k = 'tana');
begin
  begin
    perform public.save_category(t, null, 'Nova');
    raise exception 'atendente não deveria editar cardápio';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  raise notice 'OK perfis respeitados';
end $$;

-- Fluxo de pedido
do $$
declare
  tana uuid := (select v::uuid from ctx where k = 'tana');
  tcx uuid := (select v::uuid from ctx where k = 'tcx');
  ta uuid := (select v::uuid from ctx where k = 'ta');
  carne uuid := (select id from public.products where name = 'Carne');
  refri uuid := (select id from public.products where name = 'Refri');
  joao uuid := (select id from public.customers where name = 'Seu João');
  o1 public.orders; o2 public.orders; o3 public.orders;
begin
  o1 := public.create_order(tana, 'mesa', '4', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 3, 'notes', 'bem passada')));
  o2 := public.create_order(tana, 'nome', 'Maria', 'viagem', '', jsonb_build_array(jsonb_build_object('product_id', refri, 'qty', 1)));
  assert o1.number = 1 and o2.number = 2, 'numeração';
  assert o1.status = 'novo', 'status inicial';
  assert o2.status = 'pronto', 'só bebida nasce pronto';
  assert private.order_total(o1.id) = 3000, 'total';

  perform public.set_order_status(ta, o1.id, 'preparo');
  perform public.set_order_status(ta, o1.id, 'pronto');

  -- pagamento dividido + não pagar a mais
  perform public.pay_order(tcx, o1.id, '[{"method":"pix","amount_cents":1000},{"method":"dinheiro","amount_cents":1000,"cash_received_cents":5000}]');
  begin
    perform public.pay_order(tcx, o1.id, '[{"method":"debito","amount_cents":1500}]');
    raise exception 'deveria recusar valor a mais';
  exception when others then assert sqlerrm like 'Valor maior que o restante%', sqlerrm; end;
  -- erro no meio não grava nada (fiado sem cliente)
  begin
    perform public.pay_order(tcx, o1.id, '[{"method":"pix","amount_cents":500},{"method":"fiado","amount_cents":500}]');
    raise exception 'deveria exigir cliente';
  exception when others then assert sqlerrm = 'Escolha o cliente do fiado', sqlerrm; end;
  assert private.order_paid(o1.id) = 2000, 'atomicidade';
  assert (select paid_cents = 2000 and total_cents = 3000 and not settled from public.orders where id = o1.id), 'colunas de total/pago';

  -- fiado com limite R$ 50
  perform public.pay_order(tcx, o1.id, format('[{"method":"fiado","amount_cents":1000,"customer_id":"%s"}]', joao)::jsonb);
  assert private.customer_balance(joao) = 1000, 'saldo fiado';
  o3 := public.create_order(tana, 'nome', 'João', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 5)));
  begin
    perform public.pay_order(tcx, o3.id, format('[{"method":"fiado","amount_cents":5000,"customer_id":"%s"}]', joao)::jsonb);
    raise exception 'deveria estourar limite';
  exception when others then assert sqlerrm like '%limite de fiado%', sqlerrm; end;
  perform public.receive_fiado(tcx, joao, 400, 'pix', '');
  assert private.customer_balance(joao) = 600, 'recebimento parcial';
  begin
    perform public.receive_fiado(tcx, joao, 9999, 'pix', '');
    raise exception 'não pode receber a mais';
  exception when others then assert sqlerrm like 'Valor maior que a dívida%', sqlerrm; end;

  -- cancelamento
  perform public.cancel_order(tcx, o3.id, 'desistiu', '1234');
  assert (select status from public.orders where id = o3.id) = 'cancelado', 'cancelado';
  begin
    perform public.cancel_order(tcx, o1.id, 'teste', '1234');
    raise exception 'não cancela pedido pago';
  exception when others then assert sqlerrm like 'Pedido já tem pagamento%', sqlerrm; end;

  -- cliente com dívida não vai para a lixeira
  begin
    perform public.set_trashed(tcx, 'customers', joao, true);
    raise exception 'cliente devendo não deveria ser excluído';
  exception when others then assert sqlerrm = 'Cliente ainda tem fiado em aberto', sqlerrm; end;

  -- lixeira
  perform public.set_trashed(ta, 'products', refri, true);
  assert (select deleted_at is not null from public.products where id = refri), 'lixeira';
  perform public.set_trashed(ta, 'products', refri, false);

  assert (select count(*) from public.audit_log) >= 10, 'histórico';
  raise notice 'OK fluxo completo: pedido, cozinha, pagamento dividido, fiado, limite, cancelamento, lixeira, histórico';
end $$;

-- cobrança antes
do $$
declare
  ta uuid := (select v::uuid from ctx where k = 'ta');
  carne uuid := (select id from public.products where name = 'Carne');
  e public.establishments := (select e from public.establishments e);
  o public.orders;
begin
  perform public.save_establishment(ta, e.name, e.slogan, null, null, '#112233', 'antes', '', '', 'chave@pix', 15);
  o := public.create_order(ta, 'mesa', '9', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 1)));
  assert o.status = 'aguardando_pagamento', 'deveria aguardar pagamento';
  begin
    perform public.set_order_status(ta, o.id, 'preparo');
    raise exception 'não deveria preparar antes de pagar';
  exception when others then assert sqlerrm like '%não pode mudar de situação%', sqlerrm; end;
  perform public.pay_order(ta, o.id, '[{"method":"pix","amount_cents":1000}]');
  assert (select status from public.orders where id = o.id) = 'novo', 'pago → cozinha';
  raise notice 'OK cobrança antes: só vai para a cozinha depois de pago';
  begin
    perform public.save_establishment(ta, e.name, e.slogan, null, null, '#112233', 'depois', '', '', 'chave@pix', 0);
    raise exception 'tempo estimado 0 deveria falhar';
  exception when others then assert sqlerrm like 'O tempo estimado deve ser%', sqlerrm; end;
  raise notice 'OK tempo estimado de preparo validado';
end $$;

-- Perfil dono e gerente comum
do $$
declare ta uuid := (select v::uuid from ctx where k = 'ta');
begin
  assert (select 'dono' = any (roles) from public.staff where name = 'Dono A'), 'cadastro inicial deveria criar o dono';
  perform public.save_staff(ta, null, 'Gerente G', '5555', array['gerente']);
end $$;
insert into ctx select 'tg', token::text from public.operator_login((select v::uuid from ctx where k = 'ea'), '5555');

do $$
declare
  ta uuid := (select v::uuid from ctx where k = 'ta');
  tg uuid := (select v::uuid from ctx where k = 'tg');
  dono uuid := (select id from public.staff where name = 'Dono A');
begin
  begin
    perform public.save_staff(tg, null, 'Outro', '6666', array['dono']);
    raise exception 'gerente não deveria criar dono';
  exception when others then assert sqlerrm = 'Só o dono pode dar o perfil de dono', sqlerrm; end;
  begin
    perform public.save_staff(tg, dono, 'Dono A', null, array['gerente']);
    raise exception 'gerente não deveria alterar o dono';
  exception when others then assert sqlerrm = 'Só o dono pode alterar outro dono', sqlerrm; end;
  begin
    perform public.set_trashed(tg, 'users', dono, true);
    raise exception 'gerente não deveria excluir o dono';
  exception when others then assert sqlerrm like 'Só o dono pode excluir%', sqlerrm; end;
  begin
    perform public.save_staff(ta, dono, 'Dono A', null, array['gerente']);
    raise exception 'não pode ficar sem dono';
  exception when others then assert sqlerrm = 'É preciso ter pelo menos um dono', sqlerrm; end;
  -- gerente comum continua podendo mexer no cardápio
  perform public.save_category(tg, null, 'Porções');
  raise notice 'OK perfil dono: só o dono cria, altera ou exclui dono, e sempre sobra um';
end $$;

-- Cancelamento com PIN de gerente, cortesia com PIN do dono
do $$
declare
  tana uuid := (select v::uuid from ctx where k = 'tana');
  tcx uuid := (select v::uuid from ctx where k = 'tcx');
  tg uuid := (select v::uuid from ctx where k = 'tg');
  carne uuid := (select id from public.products where name = 'Carne');
  dono uuid := (select id from public.staff where name = 'Dono A');
  ger uuid := (select id from public.staff where name = 'Gerente G');
  o public.orders;
  msg text;
begin
  perform public.save_establishment((select v::uuid from ctx where k = 'ta'), 'Espetinho A', '', null, null, '#112233', 'depois', '', '', '', 15);
  o := public.create_order(tana, 'mesa', '7', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 1)));
  msg := public.cancel_order(tcx, o.id, 'cliente foi embora', '0000');
  assert msg like 'PIN de gerente incorreto%', coalesce(msg, 'cancelou com PIN errado');
  msg := public.cancel_order(tcx, o.id, 'cliente foi embora', '3333');
  assert msg like 'PIN de gerente incorreto%', 'PIN do caixa não autoriza';
  assert (select status from public.orders where id = o.id) = 'novo', 'não deveria cancelar sem gerente';
  assert (select count(*) from public.audit_log where action = 'autorizacao.negada') = 2, 'recusas no histórico';
  assert exists (select 1 from public.audit_log where summary like '%PIN de Caixa, que não é gerente%'), 'diz de quem era o PIN';
  msg := public.cancel_order(tcx, o.id, 'cliente foi embora', '5555');
  assert msg is null, msg;
  assert (select status = 'cancelado' and cancel_authorized_by = ger from public.orders where id = o.id), 'cancelado com autorizador';
  assert exists (select 1 from public.audit_log where summary like '%cancelado por Caixa, autorizado por Gerente G: cliente foi embora'), 'histórico do cancelamento';

  o := public.create_order(tana, 'nome', 'Seu Zé', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 2)));
  msg := public.pay_order(tcx, o.id, '[{"method":"pix","amount_cents":1000},{"method":"cortesia","amount_cents":1000}]', '5555');
  assert msg like 'PIN do dono incorreto%', 'gerente não autoriza cortesia';
  assert private.order_paid(o.id) = 0, 'nada pago sem autorização';
  msg := public.pay_order(tcx, o.id, '[{"method":"pix","amount_cents":1000},{"method":"cortesia","amount_cents":1000}]', '1234');
  assert msg is null, msg;
  assert (select settled from public.orders where id = o.id), 'cortesia quita o pedido';
  assert (select authorized_by from public.payments where order_id = o.id and method = 'cortesia') = dono, 'quem autorizou a cortesia';
  assert exists (select 1 from public.audit_log where summary like '%Cortesia R$ 10,00 (cortesia autorizada por Dono A)'), 'histórico da cortesia';
  raise notice 'OK cancelamento com PIN de gerente e cortesia com PIN do dono, tudo no histórico';

  o := public.create_order(tana, 'mesa', '8', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 1)));
  begin
    perform public.set_order_priority(tcx, o.id, true, 'pressa');
    raise exception 'caixa não deveria adiantar';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  perform public.set_order_priority(tg, o.id, true, 'Cliente esperou demais');
  assert (select priority_at is not null from public.orders where id = o.id), 'adiantado';
  raise notice 'OK só gerente adianta pedido';
end $$;

-- Entrada e saída por PIN e aparelho no histórico
do $$
declare tg uuid := (select v::uuid from ctx where k = 'tg');
begin
  assert exists (select 1 from public.audit_log where action = 'pin.entrar' and summary = 'Entrou com o PIN: Gerente G'), 'entrada';
  perform public.operator_logout(tg);
  assert exists (select 1 from public.audit_log where action = 'pin.sair' and summary = 'Saiu: Gerente G'), 'saída';
  perform public.log_device_event('conectar', 'Chrome no Windows');
  assert exists (select 1 from public.audit_log where action = 'aparelho.conectar' and summary like 'Aparelho conectado (a@teste.com): Chrome no Windows'), 'aparelho';
  begin
    perform public.log_device_event('apagar', 'x');
    raise exception 'evento inválido deveria falhar';
  exception when others then assert sqlerrm = 'Evento inválido', sqlerrm; end;
  raise notice 'OK entrada, saída e aparelho no histórico';
end $$;

-- ===================================================== como aparelho B
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare ta uuid := (select v::uuid from ctx where k = 'ta');
begin
  assert (select count(*) from public.orders) = 0, 'B não pode ver pedidos de A';
  assert (select count(*) from public.customers) = 0, 'B não pode ver clientes de A';
  assert (select count(*) from public.audit_log) = 1, 'B só vê o próprio histórico';
  begin
    perform public.save_category(ta, null, 'Invasão');
    raise exception 'B usando token de A deveria falhar';
  exception when others then assert sqlerrm like 'Sessão do operador expirada%', sqlerrm; end;
  raise notice 'OK B não vê nem altera nada de A (nem com token roubado)';
end $$;

-- ===================================================== sem login (anon)
reset role;
set role anon;
do $$
begin
  perform * from public.orders;
  raise exception 'anon não deveria ler';
exception when insufficient_privilege then
  raise notice 'OK visitante sem login não acessa nada';
end $$;
reset role;
