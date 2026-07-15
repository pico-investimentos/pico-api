# Pico Investimentos API

API da plataforma Pico Investimentos, construída com Hono e TypeScript.

Esta versão inclui identidade com sessão em cookie, persistência
Drizzle/PostgreSQL e integração B3 para opt-in, confirmação, revogação e
Sincronização de Posição D-1 assíncrona.

## Requisitos

- Node.js 22
- npm 10+
- PostgreSQL (Supabase via Vercel Marketplace em ambientes remotos)

## Desenvolvimento local

```bash
npm install
cp .env.example .env
# Preencha DATABASE_URL / DATABASE_MIGRATION_URL (ou aliases Supabase) e B3_*
# (B3_OPT_IN_URL = conteúdo de link_autorizacao.txt)
npm run db:migrate
npm run db:seed-user
npm run dev
```

A API fica disponível em `http://localhost:3000`.

Endpoints principais:

```text
GET  /api/v1/health
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/me
POST /api/v1/integrations/b3/authorization-attempts
GET  /api/v1/integrations/b3/connection
POST /api/v1/integrations/b3/connection/confirmation
POST /api/v1/integrations/b3/connection/revocation
POST /api/v1/integrations/b3/syncs
GET  /api/v1/integrations/b3/syncs/latest
GET  /api/v1/portfolios/positions?cursor=<uuid>&limit=50
```

`POST /api/v1/integrations/b3/syncs` responde `202` ao criar uma Corrida
`PENDING`. O cron diário consulta `last-load-update` e cria um despacho
paginado; o worker avança seu checkpoint e processa uma Corrida por chamada.
As duas rotas internas usam `GET` autenticado por `CRON_SECRET`:

```text
GET /api/v1/internal/b3/daily-position-sync
GET /api/v1/internal/b3/process-position-syncs
```

## Comandos

- `npm run dev`: inicia o servidor local com reload.
- `npm run build`: compila a aplicação para `dist`.
- `npm start`: executa a versão compilada localmente.
- `npm run typecheck`: valida os tipos sem gerar arquivos.
- `npm run lint`: executa o ESLint.
- `npm test`: executa os testes uma vez.
- `npm run db:generate`: gera migrations Drizzle.
- `npm run db:migrate`: aplica migrations.
- `npm run db:seed-user`: cria usuário local de teste.

Antes de aplicar `0003_known_vulcan.sql` em uma base existente, verifique CPFs
duplicados:

```sql
SELECT cpf, array_agg(id) AS user_ids
FROM users
WHERE cpf IS NOT NULL
GROUP BY cpf
HAVING count(*) > 1;
```

Se houver linhas, interrompa o deploy e faça a consolidação aprovada das
identidades e de seus registros dependentes. A migration falha de propósito e
não exclui nem escolhe automaticamente uma conta financeira.

Senhas novas usam Argon2id. Login e tentativas de senha na revogação B3 usam
rate limit persistente no PostgreSQL; respostas bloqueadas incluem
`Retry-After`. Configure `RATE_LIMIT_KEY_SECRET` com ao menos 32 caracteres em
produção.

## Aceite manual do passo 1 (certificação B3)

1. Cadastrar em `B3_OPT_IN_URL` o link exato de `link_autorizacao.txt`.
2. Definir `B3_OPT_IN_ALLOWED_HOSTS` com o hostname desse link.
3. Autenticar no client-webapp (`/login`) com o usuário seed.
4. Clicar em **Conectar com a B3** no dashboard.
5. Confirmar registro da tentativa e status `AUTHORIZATION_REQUESTED`.
6. Confirmar redirect para a interface oficial da B3.
7. Confirmar que o frontend não recebeu certificados/`client_secret`.
8. Ao voltar à Pico, o status ainda não deve ser `AUTHORIZED` (passo 2).

Nunca versionar o pacote B3 (`.p12`, `.key`, `*_client_id_secret.txt`, `*_senha_p12.txt`, `link_autorizacao.txt`).

## Deploy

O arquivo `src/index.ts` exporta o app Hono como default. Esse é o formato
detectado nativamente pela Vercel, sem necessidade de adaptador ou rewrite.

Consulte [docs/architecture.md](docs/architecture.md) e
[docs/security.md](docs/security.md) antes de adicionar novos módulos.
