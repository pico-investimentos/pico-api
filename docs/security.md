# Segurança

Esta fundação reduz riscos básicos, mas ainda não torna a plataforma pronta para
dados financeiros reais.

## Controles já ativos

- CORS restrito às origens configuradas e com credenciais explícitas.
- Proteção de formulários cross-site por `Origin` e `Sec-Fetch-Site`.
- Headers HTTP seguros e respostas com `Cache-Control: no-store` por padrão.
- Limite global de 1 MB para corpos de requisição.
- Request ID em respostas e logs estruturados.
- Erros internos sem stack trace ou detalhes de infraestrutura para o cliente.
- Logs de acesso sem query string, payload, token, CPF, saldo ou documento.
- Validação das variáveis de ambiente no início da aplicação.
- Senhas novas com Argon2id; hashes scrypt legados são migrados após login
  válido.
- Rate limit persistente por conta/usuário e IP no login e na senha de
  revogação B3, com chaves HMAC e `Retry-After`. A chave HMAC vem de
  `RATE_LIMIT_KEY_SECRET`, obrigatória em produção.
- mTLS B3 com timeout, TLS estrito em produção e cache de token por processo.

## Obrigatório antes das features de negócio

- Definir modelo de ameaças e classificação dos dados.
- Escolher autenticação com MFA e recuperação de conta segura.
- Usar sessão em cookie `HttpOnly`, `Secure` e `SameSite` adequado.
- Implementar autorização no servidor por papel, recurso e vínculo do cliente.
- Estender rate limit para recuperação de conta, downloads e demais ações
  sensíveis.
- Registrar trilha de auditoria imutável para o painel administrativo.
- Criptografar dados em trânsito e em repouso, com rotação de segredos.
- Definir retenção, exclusão, consentimento e resposta a incidentes segundo LGPD.
- Configurar backups, testes de restauração e observabilidade com redaction.
- Fazer análise de dependências, SAST e testes de autorização no CI.

## Regras de implementação

- Nunca confiar em IDs, papéis, saldos ou permissões enviados pelo frontend.
- Nunca armazenar token de sessão em `localStorage`.
- Nunca expor bucket público para documentos de clientes.
- Nunca incluir dados pessoais ou financeiros em URLs.
- Nunca registrar corpos de requisição ou resposta por padrão.
- Validar autorização novamente no download e em URLs assinadas.
- Preferir bibliotecas consolidadas para criptografia e autenticação; não criar
  algoritmos próprios.
