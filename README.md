# Industrial AI Index

An AI readiness assessment for manufacturers. Twelve or thirty-two questions across four areas, a score, and a short strategic report written by Claude.

## How it works

- `site/index.html`: the whole page. `site/questions.js`: the question bank, shared with the server.
- `server.js`: a small Node server with no dependencies. It serves the page and one route, `POST /api/report`.
- The browser sends only the answers. The server validates them, builds the prompt and calls the Anthropic API, so the API key cannot be used for anything else.
- If the API is unavailable or rate-limited, the page writes a rule-based report from the scores instead, and labels it as such.

## Limits and privacy

- Rate limits: 5 reports per IP per hour and 200 per day in total (both configurable in `.env`).
- Nothing is stored: no email capture, no database, no request bodies in logs.
- Fonts and the PDF library are served from this site; the page makes no third-party requests.

## Run

```
cp .env.example .env   # add ANTHROPIC_API_KEY
docker compose up -d --build
```

On the VPS, Traefik serves it at https://industrial-ai.radhakrishnakamaraju.com. Without Docker: `ANTHROPIC_API_KEY=... node server.js`, then open http://localhost:3000.

## Credit

The four assessment areas are inspired by Microsoft's e-book
[The Industrial Frontier: Four ways manufacturers can modernize across the value chain](https://info.microsoft.com/ww-landing-the-industrial-frontier.html?lcid=en-us).
The questions, scoring and report prompts are original. This is an independent project, not affiliated with or endorsed by Microsoft.
