# sentientdash.com

The public one-page site for Sentient Dash. Plain HTML and CSS, no JavaScript and no build step; separate from `app/`
(the dashboard). It uses the app's tokens and fonts so the two read as one product (see `DESIGN.md`).

| File | What |
|---|---|
| `index.html`, `styles.css` | The page. Light and dark follow the visitor's system setting. |
| `404.html` | Served by Vercel for any unknown path. |
| `vercel.json` | Static output, clean URLs, `www` → apex redirect, security headers (strict CSP: no scripts at all). |
| `fonts/` | Archivo, Public Sans, IBM Plex Mono, self-hosted (OFL, see `fonts/LICENSE.txt`). |
| `favicon.svg`, `apple-touch-icon.png`, `og.png` | The Lane S mark and the social card. |
| `robots.txt`, `sitemap.xml` | SEO basics. |

Preview locally: `python3 -m http.server --directory site 4180`, then open http://localhost:4180.

## Put it live (owner, once)

1. **Create the Vercel project.** vercel.com → Add New → Project → import this GitHub repo → set **Root Directory**
   to `site` → Framework Preset **Other**, leave the build and output settings empty → Deploy. (CLI alternative, from
   the repo root: `cd site && vercel link` (new project), then `vercel deploy --prod`.)
2. **Add the domain.** In the new project: Settings → Domains → add `sentientdash.com`, then add `www.sentientdash.com`
   and choose **Redirect to sentientdash.com** (308). At your DNS provider, create the records Vercel shows: an `A`
   record for the apex (`76.76.21.21`) and a `CNAME` for `www` (`cname.vercel-dns.com`), or switch the nameservers to
   Vercel's. Remove any older `A`/`CNAME` records for those names.
3. **Check HTTPS.** Once the domain shows "Valid Configuration", open https://sentientdash.com and
   http://www.sentientdash.com (it should land on https://sentientdash.com/), and run
   `curl -sI https://sentientdash.com | grep -i -E "strict-transport|content-security"` to see the headers.

Pushes to `main` that touch `site/` redeploy it. To skip app-only commits, set the project's Ignored Build Step to
`git diff --quiet HEAD^ HEAD -- .` (run inside `site`).
