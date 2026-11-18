-- Roda só na cópia local, logo depois do restore: zera tudo que daria acesso a sistemas externos ou a contas reais.
update public.lojas set
  omie_app_key = null, omie_app_secret = null,
  integracao_api_key = null, integracao_teste_api_key = null,
  certificado_senha_enc = null, certificado_path = null, certificado_nome = null,
  csc_producao = null, csc_id_producao = null;
-- Contas reais: sem senha utilizável e sem sessões (só valem os logins de teste, criados depois).
update auth.users set encrypted_password = '', recovery_token = '', confirmation_token = '', email_change_token_new = '';
delete from auth.refresh_tokens;
delete from auth.sessions;
delete from auth.one_time_tokens;
delete from auth.mfa_factors;
