-- Testes do banco: isolamento entre estabelecimentos, perfis e regras de negócio.
-- Cada bloco lança erro se algo estiver errado. Saída esperada: só "OK ...".
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@teste.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@teste.com'),
  ('00000000-0000-0000-0000-00000000000c', null); -- celular anônimo que vai abrir o link de convite

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
  perform public.save_staff(t, null, 'Ana', '', '1111', array['atendente']);
  perform public.save_staff(t, null, 'Caixa', '', '3333', array['caixa']);
  begin
    perform public.save_staff(t, null, 'Repetido', '', '1111', array['caixa']);
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
  perform public.save_establishment(ta, e.name, e.slogan, null, null, '#112233', 'antes', '', '', 'chave@pix', 15, 10);
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
    perform public.save_establishment(ta, e.name, e.slogan, null, null, '#112233', 'depois', '', '', 'chave@pix', 0, 10);
    raise exception 'tempo estimado 0 deveria falhar';
  exception when others then assert sqlerrm like 'O tempo estimado deve ser%', sqlerrm; end;
  raise notice 'OK tempo estimado de preparo validado';
end $$;

-- Perfil dono e gerente comum
do $$
declare ta uuid := (select v::uuid from ctx where k = 'ta');
begin
  assert (select 'dono' = any (roles) from public.staff where name = 'Dono A'), 'cadastro inicial deveria criar o dono';
  perform public.save_staff(ta, null, 'Gerente G', '', '5555', array['gerente']);
end $$;
insert into ctx select 'tg', token::text from public.operator_login((select v::uuid from ctx where k = 'ea'), '5555');

do $$
declare
  ta uuid := (select v::uuid from ctx where k = 'ta');
  tg uuid := (select v::uuid from ctx where k = 'tg');
  dono uuid := (select id from public.staff where name = 'Dono A');
begin
  begin
    perform public.save_staff(tg, null, 'Outro', '', '6666', array['dono']);
    raise exception 'gerente não deveria criar dono';
  exception when others then assert sqlerrm = 'O gerente só cria perfil de atendente', sqlerrm; end;
  begin
    perform public.save_staff(tg, dono, 'Dono A', '', null, array['gerente']);
    raise exception 'gerente não deveria alterar o dono';
  exception when others then assert sqlerrm = 'Só o dono pode alterar um perfil', sqlerrm; end;
  begin
    perform public.set_trashed(tg, 'users', dono, true);
    raise exception 'gerente não deveria excluir o dono';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  begin
    perform public.save_staff(ta, dono, 'Dono A', '', null, array['gerente']);
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
  perform public.save_establishment((select v::uuid from ctx where k = 'ta'), 'Espetinho A', '', null, null, '#112233', 'depois', '', '', '', 15, 10);
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

  -- a cozinha também pede o cancelamento (o PIN do gerente é quem autoriza)
  perform public.save_staff((select v::uuid from ctx where k = 'ta'), null, 'Coz', '', '4545', array['cozinha']);
  o := public.create_order(tana, 'mesa', '9', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 1)));
  msg := public.cancel_order((select token from public.operator_login((select v::uuid from ctx where k = 'ea'), '4545')), o.id, 'pedido errado', '5555');
  assert msg is null, msg;
  assert exists (select 1 from public.audit_log where summary like '%cancelado por Coz, autorizado por Gerente G: pedido errado'), 'cozinha cancela com PIN do gerente';

  o := public.create_order(tana, 'mesa', '8', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 1)));
  begin
    perform public.set_order_priority(tcx, o.id, true, 'pressa');
    raise exception 'caixa não deveria adiantar';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  perform public.set_order_priority(tg, o.id, true, 'Cliente esperou demais');
  assert (select priority_at is not null from public.orders where id = o.id), 'adiantado';
  raise notice 'OK só gerente adianta pedido';
end $$;

-- Mesas: gerente ou dono; aparência: só o dono
do $$
declare
  ta uuid := (select v::uuid from ctx where k = 'ta');
  tg uuid := (select v::uuid from ctx where k = 'tg');
  e public.establishments := (select e from public.establishments e);
begin
  perform public.save_establishment(tg, e.name, e.slogan, e.logo_url, e.cover_url, e.brand_color, e.payment_timing, e.phone, e.address, e.pix_key, e.kitchen_target_min, 25);
  assert (select table_count from public.establishments) = 25, 'gerente muda as mesas';
  begin
    perform public.save_establishment(tg, e.name, e.slogan, e.logo_url, e.cover_url, '#000000', e.payment_timing, e.phone, e.address, e.pix_key, e.kitchen_target_min, 25);
    raise exception 'gerente não deveria mudar a cor';
  exception when others then assert sqlerrm like 'Só o dono pode mudar o nome%', sqlerrm; end;
  begin
    perform public.save_establishment(ta, e.name, e.slogan, e.logo_url, e.cover_url, e.brand_color, e.payment_timing, e.phone, e.address, e.pix_key, e.kitchen_target_min, 201);
    raise exception '201 mesas deveria falhar';
  exception when others then assert sqlerrm like 'A quantidade de mesas%', sqlerrm; end;
  perform public.save_establishment(ta, 'Espetinho A', 'Novo slogan', e.logo_url, e.cover_url, '#000000', e.payment_timing, e.phone, e.address, e.pix_key, e.kitchen_target_min, 25);
  assert (select brand_color = '#000000' and slogan = 'Novo slogan' from public.establishments), 'dono muda a aparência';
  assert exists (select 1 from public.audit_log where summary like '%mesas: 10 → 25%'), 'mudança de mesas no histórico';
  raise notice 'OK mesas pelo gerente ou dono; aparência só pelo dono';
end $$;

-- Perfis: gerente só cria atendente; dono bloqueia
do $$
declare
  ta uuid := (select v::uuid from ctx where k = 'ta');
  tg uuid := (select v::uuid from ctx where k = 'tg');
  ger uuid := (select id from public.staff where name = 'Gerente G');
  dono uuid := (select id from public.staff where name = 'Dono A');
  nova uuid;
begin
  perform public.save_staff(tg, null, 'Bia', '(81) 98888-7777', '7777', array['atendente']);
  select id into nova from public.staff where name = 'Bia';
  assert (select phone = '81988887777' and created_by = ger from public.staff where id = nova), 'telefone e criado por';
  assert exists (select 1 from public.audit_log where summary = 'Usuário Bia (atendente) criado por Gerente G'), 'quem criou no histórico';
  -- sem PIN: a pessoa cria pelo link do WhatsApp (por isso o telefone é obrigatório)
  perform public.save_staff(tg, null, 'Duda', '81 97777-6666', null, array['atendente']);
  assert (select not has_pin from public.staff where name = 'Duda'), 'Duda ainda sem PIN';
  assert exists (select 1 from public.audit_log where summary = 'Usuário Duda (atendente) criado por Gerente G, sem PIN (a pessoa cria pelo link)'), 'sem PIN no histórico';
  assert (select has_pin from public.staff where id = nova), 'Bia com PIN';
  begin
    perform public.save_staff(tg, null, 'Edu', '', null, array['atendente']);
    raise exception 'sem PIN e sem telefone deveria falhar';
  exception when others then assert sqlerrm like 'Informe o PIN ou o WhatsApp%', sqlerrm; end;
  begin
    perform public.save_staff(tg, null, 'Caio', '', '7878', array['caixa']);
    raise exception 'gerente não deveria criar caixa';
  exception when others then assert sqlerrm = 'O gerente só cria perfil de atendente', sqlerrm; end;
  begin
    perform public.save_staff(tg, nova, 'Bia', '', null, array['atendente']);
    raise exception 'gerente não deveria editar perfil';
  exception when others then assert sqlerrm = 'Só o dono pode alterar um perfil', sqlerrm; end;
  begin
    perform public.save_staff(ta, null, 'Zé', '123', '7979', array['atendente']);
    raise exception 'telefone curto deveria falhar';
  exception when others then assert sqlerrm like 'Telefone inválido%', sqlerrm; end;
  begin
    perform public.set_staff_blocked(tg, nova, true);
    raise exception 'gerente não deveria bloquear';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  begin
    perform public.set_staff_blocked(ta, dono, true);
    raise exception 'não pode bloquear a si mesmo';
  exception when others then assert sqlerrm = 'Você não pode bloquear o próprio perfil', sqlerrm; end;
  perform public.set_staff_blocked(ta, nova, true);
  assert (select count(*) from public.operator_login((select v::uuid from ctx where k = 'ea'), '7777')) = 0, 'bloqueado não entra';
  assert exists (select 1 from public.audit_log where action = 'pin.bloqueado' and summary like '%Bia'), 'tentativa de bloqueado no histórico';
  perform public.set_staff_blocked(ta, nova, false);
  assert (select count(*) from public.operator_login((select v::uuid from ctx where k = 'ea'), '7777')) = 1, 'desbloqueado entra';
  raise notice 'OK perfis: gerente só cria atendente; só o dono edita, bloqueia e exclui';
end $$;

-- Convite por link e aparelhos
do $$
declare
  ta uuid := (select v::uuid from ctx where k = 'ta');
  tg uuid := (select v::uuid from ctx where k = 'tg');
  bia uuid := (select id from public.staff where name = 'Bia');
  caixa uuid := (select id from public.staff where name = 'Caixa');
  code text;
begin
  begin
    perform public.create_invite(tg, caixa);
    raise exception 'gerente não deveria mandar acesso para o caixa';
  exception when others then assert sqlerrm = 'O gerente só envia acesso para atendente', sqlerrm; end;
  code := public.create_invite(tg, bia);
  assert length(code) = 24, 'código do link';
  insert into ctx values ('convite', code);
  assert exists (select 1 from public.audit_log where summary like 'Link de acesso para Bia gerado por Gerente G%'), 'convite no histórico';
  -- aparelho da conta do estabelecimento fica registrado ao entrar com o PIN
  perform public.operator_login((select v::uuid from ctx where k = 'ea'), '3333', 'chave-balcao', 'Chrome no Windows');
  assert (select kind = 'estabelecimento' and last_staff_id = caixa from public.devices where device_key = 'chave-balcao'), 'aparelho do balcão registrado';
end $$;

-- o celular da Bia abre o link (login anônimo = outro usuário do Supabase)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$
declare
  ea uuid := (select v::uuid from ctx where k = 'ea');
  r record;
begin
  assert (select count(*) from public.establishments) = 0, 'sem convite não vê nada';
  begin
    perform public.redeem_invite((select v from ctx where k = 'convite'), '12', 'Chrome no Android', 'chave-celular-bia');
    raise exception 'PIN curto deveria falhar';
  exception when others then assert sqlerrm = 'O PIN deve ter de 4 a 6 números', sqlerrm; end;
  begin
    perform public.redeem_invite((select v from ctx where k = 'convite'), '3333', 'Chrome no Android', 'chave-celular-bia');
    raise exception 'PIN de outra pessoa deveria falhar';
  exception when others then assert sqlerrm = 'Esse PIN já está em uso. Escolha outro.', sqlerrm; end;
  -- a Bia escolhe o próprio PIN no link (o 7777 do cadastro deixa de valer)
  assert public.redeem_invite((select v from ctx where k = 'convite'), '7272', 'Chrome no Android', 'chave-celular-bia') = ea, 'convite aceito';
  assert (select name from public.my_context()) = 'Espetinho A', 'celular ligado ao estabelecimento';
  select * into r from public.operator_login(ea, '1234', 'chave-celular-bia', 'Chrome no Android');
  assert r.token is null and r.name = 'Este celular é só de Bia.', coalesce(r.name, 'dono entrou no celular da Bia');
  assert (select count(*) from public.operator_login(ea, '7777', 'chave-celular-bia', 'Chrome no Android')) = 0, 'PIN antigo da Bia não vale mais';
  select * into r from public.operator_login(ea, '7272', 'chave-celular-bia', 'Chrome no Android');
  assert r.token is not null and r.name = 'Bia', 'Bia entra no celular dela com o PIN que escolheu';
  assert exists (select 1 from public.audit_log where summary = 'Bia criou o próprio PIN pelo link'), 'PIN criado no histórico';
  begin
    perform public.redeem_invite((select v from ctx where k = 'convite'), '8888', 'x', 'outra');
    raise exception 'link não deveria valer duas vezes';
  exception when others then assert sqlerrm like 'Esse link já foi usado%', sqlerrm; end;
end $$;

-- o dono vê e bloqueia os aparelhos
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare
  ta uuid := (select v::uuid from ctx where k = 'ta');
  tg uuid := (select v::uuid from ctx where k = 'tg');
  cel uuid := (select id from public.devices where device_key = 'chave-celular-bia');
  balcao uuid := (select id from public.devices where device_key = 'chave-balcao');
  r record;
begin
  assert (select kind = 'convite' and info = 'Chrome no Android' from public.devices where id = cel), 'celular da Bia na lista';
  begin
    perform public.set_device_blocked(tg, cel, true);
    raise exception 'gerente não deveria bloquear aparelho';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  perform public.set_device_blocked(ta, cel, true);
  perform public.set_device_blocked(ta, balcao, true);
  select * into r from public.operator_login((select v::uuid from ctx where k = 'ea'), '3333', 'chave-balcao', 'Chrome no Windows');
  assert r.token is null and r.name = 'Este aparelho foi bloqueado pelo dono.', 'balcão bloqueado';
  assert exists (select 1 from public.audit_log where action = 'aparelho.bloquear' and summary like 'Aparelho Chrome no Android (celular de Bia) bloqueado por Dono A'), 'bloqueio no histórico';
  -- outro aparelho da mesma conta continua funcionando
  select * into r from public.operator_login((select v::uuid from ctx where k = 'ea'), '3333', 'chave-cozinha', 'Chrome no Android');
  assert r.token is not null, 'outro aparelho da conta segue liberado';
  perform public.set_device_blocked(ta, balcao, false);
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$
begin
  assert (select count(*) from public.establishments) = 0, 'celular bloqueado não vê mais nada';
  assert (select count(*) from public.orders) = 0, 'celular bloqueado não vê pedidos';
  raise notice 'OK convite por link: celular só da pessoa, uso único, e o dono vê e bloqueia aparelhos';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

-- Materiais e ficha técnica: só o dono
do $$
declare
  ta uuid := (select v::uuid from ctx where k = 'ta');
  tg uuid := (select v::uuid from ctx where k = 'tg');
  carne uuid := (select id from public.products where name = 'Carne');
  alcatra uuid;
  palito uuid;
begin
  begin
    perform public.save_material(tg, null, 'Alcatra', 'kg', 4800);
    raise exception 'gerente não deveria cadastrar material';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  alcatra := public.save_material(ta, null, 'Alcatra', 'kg', 4800);
  palito := public.save_material(ta, null, 'Palito', 'un', 5);
  begin
    perform public.save_material(ta, null, 'alcatra', 'kg', 0);
    raise exception 'nome repetido deveria falhar';
  exception when others then assert sqlerrm = 'Já existe um material com esse nome', sqlerrm; end;
  begin
    perform public.save_material(ta, null, 'Óleo', 'galão', 0);
    raise exception 'unidade inválida deveria falhar';
  exception when others then assert sqlerrm = 'Unidade inválida', sqlerrm; end;
  perform public.save_recipe(ta, carne, format('[{"material_id":"%s","qty":0.12},{"material_id":"%s","qty":1}]', alcatra, palito)::jsonb);
  assert (select count(*) from public.recipe_items where product_id = carne) = 2, 'ficha salva';
  assert (select qty from public.recipe_items where material_id = alcatra) = 0.12, 'quantidade decimal';
  assert exists (select 1 from public.audit_log where summary = 'Ficha técnica de Carne: 0,12 kg de Alcatra + 1 un de Palito'), 'ficha no histórico';
  begin
    perform public.save_recipe(tg, carne, '[]');
    raise exception 'gerente não deveria editar ficha';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  begin
    perform public.set_material_trashed(ta, alcatra, true);
    raise exception 'material em uso não deveria ir para a lixeira';
  exception when others then assert sqlerrm like 'Esse material está na ficha técnica de: Carne%', sqlerrm; end;
  -- trocar a ficha substitui a anterior (sem duplicar)
  perform public.save_recipe(ta, carne, format('[{"material_id":"%s","qty":0.15}]', alcatra)::jsonb);
  assert (select count(*) from public.recipe_items where product_id = carne) = 1, 'ficha substituída';
  perform public.set_material_trashed(ta, palito, true);
  assert (select deleted_at is not null from public.materials where id = palito), 'palito na lixeira';
  -- comprado pronto: cria o material com o nome do item e a ficha de 1 un, num passo só
  begin
    perform public.save_ready_made(tg, (select id from public.products where name = 'Refri'), 350);
    raise exception 'gerente não deveria marcar comprado pronto';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  perform public.save_ready_made(ta, (select id from public.products where name = 'Refri'), 350);
  assert (select unit = 'un' and cost_cents = 350 from public.materials where name = 'Refri' and deleted_at is null), 'material criado';
  assert (select r.qty = 1 from public.recipe_items r join public.products p on p.id = r.product_id where p.name = 'Refri'), 'ficha de 1 un';
  assert exists (select 1 from public.audit_log where summary = 'Refri marcado como comprado pronto: 1 un de Refri (custo R$ 3,50)'), 'comprado pronto no histórico';
  -- de novo: reaproveita o material e só atualiza o custo
  perform public.save_ready_made(ta, (select id from public.products where name = 'Refri'), 400);
  assert (select count(*) from public.materials where name = 'Refri') = 1, 'sem material repetido';
  assert (select cost_cents from public.materials where name = 'Refri') = 400, 'custo atualizado';
  -- material com o mesmo nome em kg: não mistura, pede para montar a ficha
  perform public.save_material(ta, null, 'Carne', 'kg', 0);
  begin
    perform public.save_ready_made(ta, carne, 0);
    raise exception 'material em kg não deveria virar comprado pronto';
  exception when others then assert sqlerrm like 'Já existe o material Carne comprado por kg%', sqlerrm; end;
  assert (select count(*) from public.recipe_items where product_id = carne) = 1, 'ficha da carne intacta';
  -- a categoria inteira de uma vez: Frango vira comprado pronto, Carne (material em kg) fica de fora
  perform public.save_product(ta, null, (select id from public.categories where name = 'Espetinhos'), 'Frango', '', 800, null, true, true);
  begin
    perform public.save_ready_made_category(tg, (select id from public.categories where name = 'Espetinhos'));
    raise exception 'gerente não deveria marcar a categoria';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  assert public.save_ready_made_category(ta, (select id from public.categories where name = 'Espetinhos')) = array['Carne'], 'Carne fica de fora';
  assert (select r.qty = 1 and m.name = 'Frango' and m.unit = 'un' from public.recipe_items r join public.materials m on m.id = r.material_id
          join public.products p on p.id = r.product_id where p.name = 'Frango'), 'Frango comprado pronto';
  assert (select count(*) from public.recipe_items where product_id = carne) = 1, 'ficha da carne continua';
  assert exists (select 1 from public.audit_log where summary = 'Categoria Espetinhos marcada como comprada pronta: Frango (ficaram de fora: Carne)'), 'categoria no histórico';
  raise notice 'OK materiais e ficha técnica: só o dono edita, tudo no histórico';
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

-- Caixa: abrir com troco, receber em dinheiro, fechar contando a gaveta; observações rápidas
do $$
declare
  ea uuid := (select v::uuid from ctx where k = 'ea');
  -- sessões novas: as anteriores podem ter sido encerradas pelos testes de saída
  ta uuid := (select token from public.operator_login(ea, '1234'));
  tg uuid := (select token from public.operator_login(ea, '5555'));
  tcx uuid := (select token from public.operator_login(ea, '3333'));
  tana uuid := (select token from public.operator_login(ea, '1111'));
  carne uuid := (select id from public.products where deleted_at is null order by name limit 1);
  price int := (select price_cents from public.products where id = carne);
  o public.orders;
  diff int;
begin
  begin
    perform public.open_cash(tana, 5000);
    raise exception 'atendente não deveria abrir o caixa';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  begin
    perform public.close_cash(tcx, 0, '');
    raise exception 'fechar sem abrir deveria falhar';
  exception when others then assert sqlerrm = 'O caixa não está aberto', sqlerrm; end;
  begin
    perform public.open_cash(tcx, -1);
    raise exception 'troco negativo deveria falhar';
  exception when others then assert sqlerrm = 'Informe o troco da gaveta', sqlerrm; end;

  perform public.open_cash(tcx, 10000);
  begin
    perform public.open_cash(tg, 500);
    raise exception 'segundo caixa aberto deveria falhar';
  exception when others then assert sqlerrm = 'O caixa já está aberto', sqlerrm; end;
  assert (select count(*) from public.cash_sessions where closed_at is null) = 1, 'um caixa aberto';

  o := public.create_order(tana, 'mesa', '12', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 1)));
  perform public.pay_order(tcx, o.id, jsonb_build_array(jsonb_build_object('method', 'dinheiro', 'amount_cents', price, 'cash_received_cents', price + 500)), null);

  begin
    perform public.close_cash(tcx, -5, '');
    raise exception 'contagem negativa deveria falhar';
  exception when others then assert sqlerrm = 'Informe o dinheiro contado na gaveta', sqlerrm; end;
  -- esperado = troco + dinheiro recebido; faltando R$ 2,00 na contagem
  diff := public.close_cash(tcx, 10000 + price - 200, 'Troco dado a mais');
  assert diff = -200, 'diferença esperada de -200, veio ' || diff;
  assert (select expected_cents = 10000 + price and counted_cents = 10000 + price - 200 and difference_cents = -200 and note = 'Troco dado a mais'
          from public.cash_sessions where closed_at is not null), 'sessão fechada com esperado, contado e diferença';
  assert exists (select 1 from public.audit_log where action = 'caixa.abrir' and summary like 'Caixa aberto com troco de R$ 100,00'), 'abertura no histórico';
  assert exists (select 1 from public.audit_log where action = 'caixa.fechar' and summary like 'Caixa fechado:%diferença − R$ 2,00%Troco dado a mais%'), 'fechamento no histórico';
  perform public.open_cash(tcx, 0); -- depois de fechar, abre de novo
  assert (select count(*) from public.cash_sessions) = 2, 'duas sessões';

  -- observações rápidas: só o gerente; limpa repetidas e vazias; limites
  begin
    perform public.save_quick_notes(tcx, array['Sem pimenta']);
    raise exception 'caixa não deveria mudar as observações';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  perform public.save_quick_notes(tg, array['Sem pimenta', ' sem PIMENTA ', '', 'Bem passado']);
  assert (select quick_notes from public.establishments) = array['Sem pimenta', 'Bem passado'], 'observações limpas';
  begin
    perform public.save_quick_notes(tg, array['a, b']);
    raise exception 'vírgula deveria falhar';
  exception when others then assert sqlerrm like 'Cada observação deve ter até 30 letras%', sqlerrm; end;
  perform public.save_quick_notes(ta, '{}');
  assert (select cardinality(quick_notes) from public.establishments) = 0, 'volta ao padrão';
  assert (select count(*) from public.cash_sessions) = 2, 'dono vê as sessões';
  raise notice 'OK caixa: abrir, receber em dinheiro, fechar com diferença; observações rápidas';
end $$;

-- ===================================================== como aparelho B
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare ta uuid := (select v::uuid from ctx where k = 'ta');
begin
  assert (select count(*) from public.orders) = 0, 'B não pode ver pedidos de A';
  assert (select count(*) from public.customers) = 0, 'B não pode ver clientes de A';
  assert (select count(*) from public.materials) = 0 and (select count(*) from public.recipe_items) = 0, 'B não vê materiais nem fichas de A';
  assert (select count(*) from public.cash_sessions) = 0, 'B não vê o caixa de A';
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
