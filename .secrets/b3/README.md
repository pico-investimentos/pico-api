# Pacotes de acesso B3 (nunca versionar)

Coloque aqui o conteúdo do zip da B3, **separado por ambiente**:

```text
.secrets/b3/
  certification/     ← pacote STVM / CERT (mTLS + client_id/secret)
  production/        ← pacote FINTECH / PRODUÇÃO (mTLS + client_id/secret + link_autorizacao)
```

Regras:

1. `B3_ENVIRONMENT` no `.env` deve bater com a pasta em `B3_SECRETS_DIR`.
2. Host da API é derivado do ambiente:
   - certification → `https://apib3i-cert.b3.com.br:2443`
   - production → `https://investidor.b3.com.br:2443`
3. Nunca misturar cert mTLS/token de um ambiente com host/link do outro.
4. O pacote de **certificação STVM** pode vir **sem** `link_autorizacao.txt`; o opt-in de cert continua em `B3_OPT_IN_URL` no `.env` (host `b3investidorcer…`). O pacote de **produção** costuma trazer o `link_autorizacao.txt`.

Este diretório de secrets está no `.gitignore`.
