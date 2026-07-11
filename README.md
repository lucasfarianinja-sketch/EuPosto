# EuPosto

Plataforma web para publicar um vídeo em múltiplas redes sociais (YouTube, Instagram, TikTok, Facebook) a partir de um único interface.

**Site em produção:** https://eupostoapp.pages.dev

## Estrutura

- `index.html` — landing page (`/`)
- `euposto.html` — app principal (`/euposto`) — sidebar, publicação, contas, histórico, definições
- `privacy.html` / `terms.html` — páginas legais
- `worker.js` — Cloudflare Worker (backend: OAuth das plataformas, upload TikTok, IA, fila de agendamentos)
- `wrangler.toml` — config do Worker
- `_headers` — headers HTTP para o Cloudflare Pages
- `euposto-icon.svg` / `favicon.png` — logos

## Stack

- **Frontend:** HTML/CSS/JS puro num único ficheiro por página. Zero build step.
- **Hospedagem:** Cloudflare Pages (site) + Cloudflare Workers (backend)
- **Storage temporário:** Cloudflare R2 (vídeos intermediários)
- **IA:** Cloudflare Workers AI (Llama 3.3)

## Como testar localmente

Como não há build, basta abrir os `.html` no browser:

```bash
# Servidor local rápido
npx http-server . -p 8765 -c-1
# abre http://localhost:8765/euposto.html
```

Para o worker:
```bash
npx wrangler dev
```

## Como fazer deploy

```bash
# Site (Pages)
npx wrangler pages deploy . --project-name euposto --branch main --commit-dirty=true

# Worker (backend)
npx wrangler deploy
```

Precisas de estar autenticado na conta Cloudflare `lucasfarianinja`.

## Integrações externas

- **YouTube** (Google OAuth): Client ID em `euposto.html` (`GOOGLE_CLIENT_ID`)
- **Instagram / Facebook** (Meta OAuth): App ID `1736364031132996`
- **TikTok** (Content Posting API): Client key `aw25jfk9xzdhhfzv` — em modo produção, à espera da audit do "Direct Post" (usa modo *inbox/rascunho* enquanto isso)

## Segurança

- Toda a autenticação passa por OAuth das plataformas. Não guardamos passwords.
- Tokens ficam **só no localStorage do browser** do utilizador — sem base de dados.
- O worker.js contém segredos das apps (client secrets). **Não partilhar publicamente.**

_Deploy automático via GitHub ativo desde 2026-07-11._
