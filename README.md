## Sistema de Estoque Integrado Omie

Aplicação Laravel para gestão de estoque integrada ao ERP Omie, com foco em:

- Inventários.
- Transferências de estoque.
- Ordens de produção.
- Notas fiscais de entrada/saída.

---

## Requisitos

- PHP 8.4+
- Composer
- Node.js + npm
- Banco de dados compatível com Laravel (MySQL/MariaDB, PostgreSQL, etc.)

---

## Configuração do Ambiente

1. Copie o arquivo de exemplo de ambiente:

```bash
cp .env.example .env
```

2. Ajuste as variáveis de ambiente principais no `.env`:

- Conexão com banco de dados (`DB_*`).
- Configurações de app (`APP_NAME`, `APP_ENV`, `APP_URL`).
- Credenciais Omie (exemplo):
  - `OMIE_APP_KEY`
  - `OMIE_APP_SECRET`

3. Instale as dependências PHP e JavaScript:

```bash
composer install
npm install
```

4. Gere a chave da aplicação:

```bash
php artisan key:generate
```

---

## Migrações e Seeds

Execute as migrações do banco:

```bash
php artisan migrate
```

Em seguida, rode os seeds básicos (seguro para qualquer ambiente, sem credenciais reais):

```bash
php artisan db:seed
```

O `DatabaseSeeder` executa apenas seeders responsáveis por dados estruturais (por exemplo, permissões), sem criar usuários reais nem armazenar chaves Omie. Dados sensíveis devem sempre vir do `.env`.

---

## Ambiente de Desenvolvimento

Para rodar a aplicação em desenvolvimento, incluindo servidor HTTP, Vite e filas, consulte os scripts definidos em `composer.json`, por exemplo:

```bash
composer dev
```

ou suba manualmente:

```bash
php artisan serve
npm run dev
php artisan queue:work
```

---

## Boas Práticas de Segurança

- Nunca commitar `.env` ou credenciais em código.
- Utilize variáveis de ambiente para:
  - Credenciais Omie.
  - Usuários administrativos.
  - Dados específicos de cada ambiente (dev/homolog/produção).
- Caso precise de seeds com dados de exemplo (usuários, lojas, etc.), crie seeders específicos que:
  - Leiam valores sensíveis via `config()`/`.env`, ou
  - Utilizem dados fictícios que não representem credenciais reais.
