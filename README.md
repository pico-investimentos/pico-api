# Pico Investimentos API

API da plataforma Pico Investimentos, construída com Hono e TypeScript.

Esta primeira versão entrega a fundação do projeto: configuração validada,
versionamento de rotas, health check, respostas de erro consistentes, CORS por
lista de origens, proteção CSRF para formulários, limite de corpo, headers de
segurança, request ID e logs estruturados sem payloads sensíveis.

## Requisitos

- Node.js 22
- npm 10+

## Desenvolvimento local

```bash
npm install
cp .env.example .env
npm run dev
```

A API fica disponível em `http://localhost:3000`. O primeiro endpoint é:

```text
GET /api/v1/health
```

## Comandos

- `npm run dev`: inicia o servidor local com reload.
- `npm run build`: compila a aplicação para `dist`.
- `npm start`: executa a versão compilada localmente.
- `npm run typecheck`: valida os tipos sem gerar arquivos.
- `npm run lint`: executa o ESLint.
- `npm test`: executa os testes uma vez.

## Deploy

O arquivo `src/index.ts` exporta o app Hono como default. Esse é o formato
detectado nativamente pela Vercel, sem necessidade de adaptador ou rewrite.

Banco de dados, autenticação, armazenamento de documentos, e-mail e integração
com a B3 ainda não foram conectados. Essas decisões devem ser feitas antes da
primeira feature de negócio para não criar uma falsa sensação de segurança.

Consulte [docs/architecture.md](docs/architecture.md) e
[docs/security.md](docs/security.md) antes de adicionar novos módulos.
