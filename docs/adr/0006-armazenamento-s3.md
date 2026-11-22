# 0006 — Arquivos em S3/MinIO com URL pré-assinada

- **Status:** aceita (2026-11-21)

## Contexto
O projeto base gravava vídeos e zips no disco local. Isso não funciona com várias réplicas e serviços diferentes (a API recebe, o worker processa) e se perde quando o container reinicia. Guardar arquivos de centenas de MB no Postgres deixaria o banco lento e os backups enormes.

## Decisão
- Usar storage de objetos compatível com S3: MinIO no ambiente local, com dois buckets privados, `raw-videos` (expira em 7 dias) e `frame-zips`.
- A chave do objeto é `<user_id>/<video_id>.<ext>`, gerada pelo sistema e nunca a partir do nome enviado.
- Upload em streaming (multipart S3) e download por **URL pré-assinada de 5 min**: o arquivo vai direto do storage para o navegador.
- Os clientes usam a API S3 padrão (AWS SDK no Node, `minio-go` no Go), com checksums só quando a API exige, por compatibilidade.

## Alternativas
- **Volume compartilhado:** não escala além de uma máquina.
- **Arquivos no banco:** simples, mas ruim para o banco.

## Consequências
- Trocar o MinIO por AWS S3, R2 ou SeaweedFS é só configuração.
- A imagem pública do MinIO deixou de ser publicada em 2025. O ambiente local usa a última versão completa (Bitnami, congelada), aceitável só para desenvolvimento.
