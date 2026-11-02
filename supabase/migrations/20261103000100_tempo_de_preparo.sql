-- =============================================================================
-- RKFood: tempo estimado de preparo
-- O gerente define em quantos minutos um pedido deve ficar pronto. A cozinha usa
-- esse tempo para o cronômetro de cada comanda e para o alerta de atrasados.
-- =============================================================================

alter table public.establishments
  add column kitchen_target_min integer not null default 15
    check (kitchen_target_min between 1 and 180);

-- save_establishment ganha o tempo estimado (troca de assinatura: apaga a antiga).
drop function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text);

create function public.save_establishment(
  p_token uuid, p_name text, p_slogan text, p_logo_url text, p_cover_url text, p_brand_color text,
  p_payment_timing text, p_phone text, p_address text, p_pix_key text, p_kitchen_target_min int
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
  old_target int;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do estabelecimento' using errcode = 'P0001'; end if;
  if p_kitchen_target_min is null or p_kitchen_target_min not between 1 and 180 then
    raise exception 'O tempo estimado deve ser de 1 a 180 minutos' using errcode = 'P0001';
  end if;
  select kitchen_target_min into old_target from public.establishments where id = op.establishment_id;
  update public.establishments
  set name = trim(p_name), slogan = coalesce(p_slogan, ''), logo_url = p_logo_url, cover_url = p_cover_url,
      brand_color = p_brand_color, payment_timing = p_payment_timing, phone = coalesce(p_phone, ''),
      address = coalesce(p_address, ''), pix_key = coalesce(p_pix_key, ''), kitchen_target_min = p_kitchen_target_min
  where id = op.establishment_id;
  perform private.audit(op.establishment_id, op.id, 'estabelecimento.editar',
    case when old_target is distinct from p_kitchen_target_min
      then format('Dados do estabelecimento atualizados (tempo estimado: %s → %s min)', old_target, p_kitchen_target_min)
      else 'Dados do estabelecimento atualizados' end);
end
$$;

revoke all on function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text, int) from public, anon;
grant execute on function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text, int) to authenticated;
