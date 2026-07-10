# Arquitetura da API

## Objetivo

A API é o limite de confiança da plataforma. Frontends podem melhorar a
experiência, mas autorização, cálculos financeiros, acesso a documentos e
mudanças de estado são sempre validados no backend.

O projeto começa como um monólito modular. Esse formato mantém transações e
operações simples enquanto o produto cresce, sem impedir que um módulo seja
extraído no futuro caso exista uma necessidade real de escala ou isolamento.

## Organização

```text
src/
├── config/             configuração validada
├── modules/            regras agrupadas por domínio
├── shared/             infraestrutura transversal pequena e estável
├── api.ts              composição das rotas versionadas
├── app.ts              middlewares e composição da aplicação
└── index.ts            entrada detectada pela Vercel
```

Cada módulo deve crescer por dentro do próprio domínio. Quando necessário, ele
pode conter:

- `domain`: entidades, valores e regras puras;
- `application`: casos de uso e portas;
- `infrastructure`: banco, storage e integrações;
- `http`: rotas, schemas e tradução HTTP.

Dependências apontam de infraestrutura e HTTP para aplicação e domínio. O
domínio não importa Hono, banco de dados, Vercel nem SDKs externos.

## Módulos previstos

| Módulo | Responsabilidade |
| --- | --- |
| identity | usuários, sessões, MFA, papéis e permissões |
| clients | cadastro e relacionamento com clientes |
| investor-profiles | questionários e histórico do perfil de investidor |
| portfolios | posições, patrimônio e consolidação da carteira |
| recommendations | recomendações de investimento e resgate |
| documents | metadados, acesso e assinatura de documentos |
| service-requests | pedidos extras, responsáveis e estados |
| audit | trilha imutável das ações administrativas |
| notifications | e-mails e outras notificações |
| b3 | importação e reconciliação dos dados da B3 |

O único módulo implementado nesta fundação é `health`. Os demais entram com a
primeira entrega real de cada domínio, evitando pastas vazias e contratos
fictícios.

## Contratos HTTP

- Rotas públicas da aplicação começam em `/api/v1`.
- Payloads são JSON e validados na borda antes de chegar aos casos de uso.
- Erros usam `{ error: { code, message, requestId } }`.
- Códigos de erro são estáveis; mensagens podem mudar.
- Endpoints que criam operações financeiras devem aceitar chave de idempotência.
- Paginação deve ser por cursor em coleções que crescem continuamente.

## Persistência

PostgreSQL é o banco recomendado para os dados transacionais. O ORM e o provedor
serão escolhidos junto do primeiro modelo de domínio, considerando pooling
serverless e a região do deploy.

- Dinheiro nunca usa ponto flutuante; valores usam unidade mínima ou decimal de
  precisão explícita.
- Datas são persistidas em UTC e convertidas apenas na apresentação.
- Mudanças compostas usam transações.
- Registros financeiros e de auditoria não são apagados silenciosamente.
- Identificadores públicos não devem ser sequenciais.

## Documentos

Arquivos ficam em storage privado. A API armazena metadados e emite URLs curtas
e temporárias após autorização. Uploads grandes devem ir diretamente ao storage
por URL assinada; o limite global da API permanece pequeno.

## Integração B3

O agendamento diário das 23:05 em `America/Sao_Paulo` apenas dispara um caso de
uso. A sincronização precisa ser idempotente, registrar execução, aplicar lock
distribuído e permitir reprocessamento. Antes de configurar o cron da Vercel, o
horário deve ser convertido para UTC e protegido por `CRON_SECRET`.

## Auditoria

Auditoria é separada de logs técnicos. Cada ação sensível registra ator, ação,
recurso, resultado, data, request ID e contexto mínimo necessário. Eventos são
append-only e nunca carregam senhas, tokens ou conteúdo completo de documentos.
