# EditFlix — clip finder

Motor de busca de clipes em alta qualidade para editores — **anime, filmes, séries**.
Fontes V0 (todas API pública):
- **Sakugabooru** — cortes BD de anime, WebM/MP4
- **AnimeThemes.moe** — OPs/EDs em 1080p
- **TMDb** — metadados + trailers de filmes/séries (key grátis opcional)
- **Reddit** — r/moviescenes, r/sakuga, r/HighQualityGifs, r/cinemagems, r/tvscenes
- **Internet Archive** — filmes/séries domínio público
- **YouTube** — metadados (download em V1 via yt-dlp)

Corte de vídeo local via `ffmpeg.wasm` (sem servidor, mantém a qualidade original).

## Estrutura

```
editflix-site/
├── index.html      # UI (search + results + cutter)
├── app.css         # Tema dark navy + azul
├── app.js          # Frontend logic + ffmpeg.wasm
├── worker.js       # Cloudflare Worker — proxy das fontes
├── wrangler.toml   # Deploy config
└── README.md
```

## Correr local

```bash
# 1) Frontend estático — abre index.html direto ou serve com qualquer server
npx serve editflix-site
# → http://localhost:3000

# 2) Worker (noutro terminal)
cd editflix-site
npx wrangler dev
# → http://localhost:8787/api/search?q=maki
```

O `app.js` deteta `localhost` e aponta para `http://localhost:8787` automaticamente.

## Deploy (Cloudflare)

1. **Worker** (backend):
   ```bash
   cd editflix-site
   npx wrangler deploy
   ```
2. **Pages** (frontend): sobe `editflix-site/` como projeto Pages novo, ou reaproveita o pipeline existente do `euposto` apontando para esta pasta.
3. **Domínio**: aponta `editflix.pt` para o Pages e adiciona rota `editflix.pt/api/*` no Worker (descomenta em `wrangler.toml`).

## Configuração opcional

### YouTube Data API v3
Sem esta key, YouTube devolve zero resultados; outras fontes continuam a funcionar.

```bash
wrangler secret put YOUTUBE_API_KEY
# cola a key gerada em https://console.cloud.google.com → APIs & Services → YouTube Data API v3
```

### TMDb API (filmes/séries)
Grátis, registo em 1 minuto. Sem esta key, a busca em filmes/séries via TMDb fica desativada (Reddit + Archive continuam a servir cinema).

```bash
wrangler secret put TMDB_API_KEY
# cola a key de https://www.themoviedb.org/settings/api
```

### Cache (KV)
Para acelerar buscas repetidas (24h TTL):

```bash
wrangler kv:namespace create EDITFLIX_CACHE
# cola o id em wrangler.toml (bloco kv_namespaces)
wrangler deploy
```

## V1 — próximos passos

- **Cloudflare Container** com `yt-dlp` + `ffmpeg` para permitir corte real de YouTube (V0 só mostra links)
- **Interpolação RIFE** para 60fps opcional (server-side, GPU)
- **Índice manual de packs** (Drive/Mega curados pela comunidade)
- **Autocomplete** de personagens/animes (base de dados própria)
- **Favoritos** por utilizador (localStorage → conta ligada ao EuPosto)

## Notas de qualidade

- Anime é animado nativo a **23.976fps**. 60fps em anime é sempre interpolação (RIFE/DAIN/SVP). Para autenticidade máxima usa 24fps.
- **Sakugabooru** = fonte mais limpa e autêntica (cortes de BD com créditos).
- **AnimeThemes** = OPs/EDs em WebM alta qualidade, direto do BD.
- **YouTube "AMV Source"** channels = cenas já isoladas, mas dependente de yt-dlp para descarregar (V1).

## Legal

Ferramenta para pesquisa e edição pessoal / fair use. Utilizadores respeitam licenças e créditos das obras originais. Se receberes um DMCA, remove o índice da obra em questão; o EditFlix não hospeda vídeo — apenas indexa fontes públicas.
