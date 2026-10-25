# Running Metrona with Caddy

Metrona reads Caddy's JSON access logs, one file per site, and serves a dashboard on loopback for
Caddy to put behind TLS and a login. No CLI wizard is needed (it assumes nginx); configure by hand.

## What runs

| Piece | Command | Reads | Writes |
| --- | --- | --- | --- |
| Scheduler | `node packages/scheduler/src/daemon.js -c /etc/metrona/metrona.yaml -o /var/lib/metrona/datasets --dashboard-data /var/lib/metrona/dashboard` | `/var/log/caddy/<site>.log` and Caddy's rolled files beside it | `datasets/analytics-<siteId>.yaml` (full dataset, history accumulates), `dashboard/<siteId>.yaml` (what the dashboard shows) |
| Dashboard | `node packages/dashboard/src/start.js /etc/metrona/metrona.yaml` | `dashboard/<siteId>.yaml` | nothing |

Both read the same config file: start from `templates/config/metrona.yaml.example`. Unit files:
`templates/systemd/metrona-scheduler.service` and `metrona-dashboard.service`. Caddy snippets:
`templates/caddy/Caddyfile.example`.

## How counting works

- Each run re-reads every log file still on disk and recomputes; it never adds to earlier totals,
  so restarts and re-runs are safe. Daily and hourly buckets are kept in the dataset after the
  log files they came from are rotated away; the oldest bucket of a run (possibly partial) never
  overwrites a fuller stored one.
- A request counts as a pageview when it's a GET/HEAD with a 2xx/3xx status, the response is
  `text/html`, it isn't an asset (by extension), it isn't a background request from a single-page
  app (`Rsc`, `Next-Router-Prefetch`, `Next-Action`, `Sec-Purpose: prefetch`), and the user agent
  isn't a known bot or script (`packages/parser/src/utils/bot-filter.js`).
- Visitors are a SHA-256 of IP + user agent + `VISITOR_HASH_SALT`. Set the salt once in
  `/etc/metrona/metrona.env` and never change it, or every visitor looks new. Raw IPs never leave
  Caddy's log files.
- Referrers from the site's own `domain` and `aliases` are internal navigation, not referrals.
- Days are UTC days (the `timezone` field is a label for now).

## Per-site options (`parserOptions`)

- `clientIpHeader: Cf-Connecting-Ip` — for hosts that are always behind Cloudflare's proxy, where
  `remote_ip` is Cloudflare's. Don't set it on hosts reachable directly: anyone can send the header.
- `collapsePrefixes: ["/r/"]` — paths whose remainder is a secret (tokenised links) are counted as
  `/r/:token`. Better still, `log_skip` them in Caddy so the tokens never reach the disk.
- `hosts: [a.example.com]` — when several hosts share one log file, count only these.

Beside `parserOptions`, a site can set `rotationNaming`: `caddy` (dated files such as
`site-2026-10-05T04-00-00.000.log` beside `site.log`) or `suffix` (logrotate's `.1`, `.gz`). It
defaults to the format's own, so it is only needed when something else rolls the log — for
example an nginx log that zwatch receives and rolls daily into dated files.

## Privacy notes

Caddy's log files hold raw IPs, user agents, and full URLs (Caddy redacts `Cookie` and
`Authorization` by default). Keep them `0640` (group `caddy`), rotate with `roll_keep_for`, and
give the metrona user read access through the `caddy` group only.
