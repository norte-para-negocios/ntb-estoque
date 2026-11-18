// Imprime o SQL que cria os logins de teste (dono, gerente, estoquista) nas lojas Sertão (4), ODARA (15) e 19.
// Senhas geradas na primeira vez e guardadas em .local-data/logins.txt (fora do git); depois só são reaproveitadas.
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

const dados = path.resolve(import.meta.dirname, '..', '..', '.local-data')
const arq = path.join(dados, 'logins.txt')
const LOJAS = { 4: 'sertao', 15: 'odara', 19: 'loja19' }
const CARGOS = { dono: null, gerente: 'Gerente', estoquista: 'Estoquista' }

const logins = [] // { email, senha, loja, cargo }
if (fs.existsSync(arq)) {
  for (const l of fs.readFileSync(arq, 'utf8').split('\n')) {
    const m = l.match(/^(\S+@ntb-teste\.local)\s+(\S+)\s+loja=(\d+)\s+cargo=(\w+)/)
    if (m) logins.push({ email: m[1], senha: m[2], loja: Number(m[3]), cargo: m[4] })
  }
}
if (logins.length === 0) {
  for (const [loja, slug] of Object.entries(LOJAS))
    for (const cargo of Object.keys(CARGOS))
      logins.push({ email: `${cargo}.${slug}@ntb-teste.local`, senha: crypto.randomBytes(9).toString('base64url'), loja: Number(loja), cargo })
  fs.mkdirSync(dados, { recursive: true })
  fs.writeFileSync(arq, '# e-mail  senha  loja  cargo (só da cópia local de teste)\n' + logins.map((l) => `${l.email} ${l.senha} loja=${l.loja} cargo=${l.cargo}`).join('\n') + '\n', { mode: 0o600 })
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const out = ['begin;']
for (const l of logins) {
  const nome = `Teste ${l.cargo} loja ${l.loja}`
  const perfil = l.cargo === 'dono' ? 'Admin' : 'Usuario'
  const superAdmin = l.cargo === 'dono'
  const id = `md5(${q(l.email)})::uuid`
  out.push(`
delete from auth.users where email = ${q(l.email)};
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated', ${q(l.email)}, extensions.crypt(${q(l.senha)}, extensions.gen_salt('bf', 10)), now(), '', '', '', '',
  '{"provider":"email","providers":["email"]}', ${q(JSON.stringify({ name: nome }))}::jsonb, now(), now());
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (${id}::text, ${id}, jsonb_build_object('sub', ${id}::text, 'email', ${q(l.email)}, 'email_verified', true), 'email', now(), now(), now());
insert into public.profiles (id, name, current_loja_id, perfil, status, email, is_super_admin)
values (${id}, ${q(nome)}, ${l.loja}, ${q(perfil)}, 'aprovado', ${q(l.email)}, ${superAdmin})
on conflict (id) do update set current_loja_id = excluded.current_loja_id, perfil = excluded.perfil, status = 'aprovado', is_super_admin = excluded.is_super_admin;
insert into public.loja_user (loja_id, user_id, cargo_id)
values (${l.loja}, ${id}, ${CARGOS[l.cargo] ? `(select id from public.cargos where nome = ${q(CARGOS[l.cargo])})` : 'null'})
on conflict (loja_id, user_id) do update set cargo_id = excluded.cargo_id;`)
}
out.push('commit;')
console.log(out.join('\n'))
