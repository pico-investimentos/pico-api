# Pacotes de acesso B3 (nunca versionar)

Coloque aqui o conteúdo do zip da B3, **separado por ambiente**:

```text
.secrets/b3/
  certification/     ← pacote STVM / CERT (mTLS + client_id/secret)
  production/        ← pacote FINTECH / PRODUÇÃO (mTLS + client_id/secret + link_autorizacao)
```

## Local

1. `B3_ENVIRONMENT` no `.env` deve bater com a pasta em `B3_SECRETS_DIR`.
2. Host da API é derivado do ambiente:
   - certification → `https://apib3i-cert.b3.com.br:2443`
   - production → `https://investidor.b3.com.br:2443`
3. Nunca misturar cert mTLS/token de um ambiente com host/link do outro.

## Vercel (API project only)

Não faça upload do zip nem cole o PEM multilinha cru (a UI reclama de “return characters”).

Gere Base64 em uma linha e cole como **Sensitive** env vars:

```bash
# certificado
base64 -w 0 .secrets/b3/production/SEU_ARQUIVO.cer

# chave privada
base64 -w 0 .secrets/b3/production/SEU_ARQUIVO.key
```

| Variável | Valor |
|---|---|
| `B3_ENVIRONMENT` | `production` ou `certification` |
| `B3_OPT_IN_URL` | URL do `link_autorizacao.txt` |
| `B3_OPT_IN_ALLOWED_HOSTS` | host do opt-in |
| `B3_CLIENT_ID` | `Client_ID` do `*_client_id_secret.txt` |
| `B3_CLIENT_SECRET` | `Secret` do mesmo arquivo |
| `B3_MTLS_CERT_PEM_BASE64` | saída do `base64` do `.cer` |
| `B3_MTLS_KEY_PEM_BASE64` | saída do `base64` do `.key` |
| `B3_P12_PASSWORD` | opcional; só se precisar da senha do `.p12` |

Alternativa (menos preferida): `B3_MTLS_CERT_PEM` / `B3_MTLS_KEY_PEM` com `\n` literal em uma linha.

A API prefere env completa; se não houver, usa `B3_SECRETS_DIR`.

Este diretório de secrets está no `.gitignore`.
