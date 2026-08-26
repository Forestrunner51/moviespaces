# moviespaces.org

Static landing site. Deploy on Cloudflare Pages (the domain's DNS is already
on Cloudflare):

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Upload assets
   (or connect the repo with root directory `website/`, no build command).
2. Add custom domain `moviespaces.org` (and `www`) — Cloudflare creates the
   records itself; the existing MX/SPF email routing is untouched.
3. Done. `/privacy`, `/terms`, `/support` redirect to the canonical pages the
   API already serves (see `_redirects`), so the text lives in one place
   (LegalController.cs).

Also: add `support@moviespaces.org` in Cloudflare → Email → Email Routing →
Custom addresses, forwarding to the owner inbox — the legal pages name it.
