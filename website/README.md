# moviespaces.org

Static landing site. Deploy on Cloudflare Pages (the domain's DNS is already
on Cloudflare):

1. Repo is connected to Cloudflare Workers Builds; `wrangler.jsonc` at the
   repo root points assets at `website/` with no build step, so the deploy
   command is just `npx wrangler deploy`. (Never let it run
   `expo export -p web` — that tries to compile the mobile app.)
2. Add custom domain `moviespaces.org` (and `www`) — Cloudflare creates the
   records itself; the existing MX/SPF email routing is untouched.
3. Done. `/privacy`, `/terms`, `/support` redirect to the canonical pages the
   API already serves (see `_redirects`), so the text lives in one place
   (LegalController.cs).

Also: add `support@moviespaces.org` in Cloudflare → Email → Email Routing →
Custom addresses, forwarding to the owner inbox — the legal pages name it.
