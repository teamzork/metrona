# Installing Metrona on a server

This guide is for whoever runs the server. Site owners who just read the dashboard want the
[user guide](user-guide.md).

Metrona runs as two small services on the machine that has the web server's access logs:

| Service | What it does |
| --- | --- |
| `metrona-scheduler` | Every hour, reads each site's access log and writes the site's numbers to `/var/lib/metrona` |
| `metrona-dashboard` | Serves the dashboard on `127.0.0.1:3001`, for your web server to put behind HTTPS and a password |

Both read one config file, `/etc/metrona/metrona.yaml`. Nothing else is needed: no database, no
build step, and no outgoing network access.

There are three ways to install. `metrona init` is the quickest. Docker suits a server that runs
everything in containers. By hand is there if you want to see every step.

## Requirements

- Linux with systemd (examples use Ubuntu/Debian paths), or Docker
- Node.js 22 or newer (not needed with Docker)
- nginx or Caddy (2.8+) writing an access log per site. Behind Cloudflare's proxy? Read "Behind
  Cloudflare's proxy?" in step 2 below first.

## The quick way: `metrona init`

```bash
sudo git clone https://github.com/teamzork/metrona.git /opt/metrona
cd /opt/metrona && sudo npm ci --omit=dev
sudo npx metrona init --start
```

`init` asks which web server you use and, for each site, its domain and access log. Then it:

- writes `/etc/metrona/metrona.yaml` and `/etc/metrona/metrona.env` (a new visitor salt and
  session secret; an existing salt is always kept),
- creates the `metrona` system user, adds it to `adm` (nginx) or `caddy` so it can read the logs,
  and makes `/var/lib/metrona`,
- writes both systemd units, with the log folders and the group filled in, and starts them
  (`--start`). The scheduler processes every site right away, then hourly.
- if you answer yes to the `/stats/` question (or pass `--stats`), sets up a stats page on each site
  itself: see [A stats page on the site: /stats/](#a-stats-page-on-the-site-stats).

Everything can also be given as options, for scripts:

```bash
sudo npx metrona init --server caddy --site example.com=/var/log/caddy/example.log --site blog.example.com=/var/log/caddy/blog.log --yes --start
```

`--root /tmp/try` writes the files under `/tmp/try` instead, without touching the system, so you can
read them first. Then check:

```bash
npx metrona status          # each site: is its log readable, when were its numbers last written
```

What's left is putting the dashboard online, in [step 5](#5-put-the-dashboard-online), or using
the `/stats/` page below instead.

### Adding a site later

Run `init` once per server. To count one more site, use `add-site`. It keeps the sites already set
up, and everything else in `metrona.yaml`:

```bash
sudo npx metrona add-site blog.example.com=/var/log/nginx/blog.example.com-access.log
```

It works out the web server from the other sites (`--server` if they're mixed), checks the site
like the scheduler does, and refuses a domain that's already there. It copies the old config to
`metrona.yaml.bak` before writing it, and keeps the comments at the top. Then it restarts the
Metrona services that are running.

If the install already has `/stats/` pages, the new site gets one too, behind the same password.
`--stats` adds one where there were none yet, and `--no-stats` leaves it out. The command ends by
printing the two lines to add to the site's `server` (or Caddy site) block: its `access_log` and
its `/stats/` snippet.

`init --force` is for starting over. It writes `metrona.yaml` with only the sites you give it.

## A stats page on the site: /stats/

For a site with no admin area of its own, this is the simplest way to show its numbers: no
dashboard service, port, hostname or certificate. The scheduler writes the site's page as plain
files after every run, and the web server that already runs the site serves them at
`https://example.com/stats/` behind a password.

```bash
sudo npx metrona init --stats --start
```

`init --stats`:

- adds `publish: { dir: /var/lib/metrona/public }` to `metrona.yaml`, so the scheduler writes
  `/var/lib/metrona/public/<siteId>/index.html` (with its `assets/`) after each run;
- makes a password, shows it once, and stores only its bcrypt hash in `/etc/metrona/stats.htpasswd`
  (user `stats`). Running init again keeps it; `--new-password --force` replaces it;
- writes one snippet per site in `/etc/metrona/web/`, readable by the web server only.

A site added later with `metrona add-site` gets its snippet the same way, with the same password.

It doesn't edit your web server's configuration. Add one line to each site, then reload:

**nginx**, inside the site's HTTPS `server { … }` block:

```nginx
include /etc/metrona/web/example-com.nginx.conf;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**Caddy**, inside the site's block:

```
import /etc/metrona/web/example-com.caddy
```

```bash
sudo systemctl reload caddy
```

The snippets serve the folder at `/stats/` with basic authentication, add `X-Robots-Tag: noindex`
so search engines skip it, and redirect `/stats` to `/stats/`. On nginx, the password file needs
bcrypt support in the system's `crypt()`, which Ubuntu 22.04+ and Debian 12+ have.

`npx metrona publish` writes the pages right away from the numbers already on disk. By hand: set
`publish.dir` in `metrona.yaml`; `metrona scheduler` and `metrona run` pick it up.

## With Docker

The image `ghcr.io/teamzork/metrona` holds every command. `compose.example.yaml` in the repository
runs the scheduler (no network, logs mounted read-only) and the dashboard (on `127.0.0.1:3001`):

```bash
mkdir -p /srv/metrona && cd /srv/metrona
curl -fsSLO https://raw.githubusercontent.com/teamzork/metrona/main/compose.example.yaml && mv compose.example.yaml compose.yaml
curl -fsSL https://raw.githubusercontent.com/teamzork/metrona/main/templates/config/metrona.yaml.example -o metrona.yaml
printf 'VISITOR_HASH_SALT=%s\nSESSION_SECRET=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > metrona.env && chmod 600 metrona.env
editor metrona.yaml compose.yaml    # your sites; the log folder and the group that can read it
docker compose up -d
docker compose exec scheduler metrona status
```

Then put the dashboard online, as in [step 5](#5-put-the-dashboard-online).

## By hand

The same as `init` does, one step at a time.

### 1. Get the code

```bash
sudo useradd --system --home /var/lib/metrona --shell /usr/sbin/nologin metrona
sudo git clone https://github.com/teamzork/metrona.git /opt/metrona
cd /opt/metrona && sudo npm ci --omit=dev
sudo mkdir -p /etc/metrona /var/lib/metrona/datasets /var/lib/metrona/dashboard
sudo chown -R metrona:metrona /var/lib/metrona
```

### 2. Let Metrona read the logs

**Caddy.** Give each site a JSON log file, group-readable (`mode 0640`). See
`templates/caddy/Caddyfile.example` and [caddy.md](caddy.md). Metrona reads them through the
`caddy` group:

```bash
sudo usermod -aG caddy metrona
```

**nginx.** nginx's default *combined* format already works. Give each site its own `access_log`
so one file holds one site. On Ubuntu and Debian, nginx logs belong to the `adm` group:

```bash
sudo usermod -aG adm metrona
```

**Behind Cloudflare's proxy?** Then the address in the log is Cloudflare's, not the visitor's,
and visitor counts are meaningless. With Caddy, set `parserOptions.clientIpHeader:
Cf-Connecting-Ip` for that site. With nginx, use `templates/nginx/cloudflare.conf`, which writes a
separate log with the visitor's address (it explains how).

Rotation: Metrona reads each site's current log plus the files rotated beside it (logrotate's
`.1`, or Caddy's dated files). It keeps day-by-day totals after files are rotated away, so hourly
runs miss nothing. Top pages and referrers cover the log files still on disk. Keep about 30 days of
logs if you want 30-day lists.

### 3. Configure

```bash
sudo cp /opt/metrona/templates/config/metrona.yaml.example /etc/metrona/metrona.yaml
sudo editor /etc/metrona/metrona.yaml
```

One entry under `sites` per site: `siteId` (short, lowercase), `siteName`, `domain`, other names
in `aliases` (so your own links aren't counted as referrers), `logPath`, `format` (`nginx` or
`caddy`), and `schedule: hourly`. The example file explains each field.

Then the secrets, in `/etc/metrona/metrona.env`:

```bash
printf 'VISITOR_HASH_SALT=%s\nSESSION_SECRET=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" \
  | sudo tee /etc/metrona/metrona.env > /dev/null
sudo chown root:metrona /etc/metrona/metrona.* && sudo chmod 0640 /etc/metrona/metrona.*
```

**Never change `VISITOR_HASH_SALT`** once Metrona is counting, or every visitor afterwards looks
new. Back it up with the rest of `/etc/metrona`.

### 4. Start the services

```bash
sudo cp /opt/metrona/templates/systemd/metrona-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now metrona-scheduler metrona-dashboard
```

The unit files are written for Caddy. For nginx, edit `metrona-scheduler.service`: replace
`SupplementaryGroups=caddy` with `adm` and `/var/log/caddy` with `/var/log/nginx`.

The first numbers appear at the top of the next hour (the scheduler runs on the hour, not when it
starts). Check on it with:

```bash
systemctl status metrona-scheduler metrona-dashboard
sudo journalctl -u metrona-scheduler -f       # each hourly run, and any parse warnings
ls -l /var/lib/metrona/dashboard              # one <siteId>.yaml per site, rewritten hourly
```

## 5. Put the dashboard online

The dashboard listens on `127.0.0.1:3001` only. Give it a hostname through your web server, with
HTTPS and a password.

**Caddy** (TLS is automatic; make the hash with `caddy hash-password`):

```
metrona.example.com {
	basic_auth {
		admin <hash>
	}
	reverse_proxy 127.0.0.1:3001
}
```

**nginx** (with a certificate from certbot or similar; make the password file with `htpasswd`):

```nginx
server {
    listen 443 ssl;
    server_name metrona.example.com;
    # ssl_certificate ... ;
    auth_basic "Metrona";
    auth_basic_user_file /etc/nginx/metrona.htpasswd;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Prefer Metrona's own login page to basic auth? Set `dashboard.passwordHash` in `metrona.yaml` to
a bcrypt hash:

```bash
cd /opt/metrona && node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" 'the password'
```

To embed the dashboard in another site's admin pages, list that site's origin in
`dashboard.frameAncestors`.

## Updating

```bash
cd /opt/metrona && sudo git pull && sudo npm ci --omit=dev
sudo systemctl restart metrona-scheduler metrona-dashboard
```

With Docker: `docker compose pull && docker compose up -d`.

## Troubleshooting

Start with `npx metrona status`: it checks each site's log and how fresh its numbers are, and says
what to look at. `npx metrona run` processes every site once, now, and reports each one.

| Symptom | Look at |
| --- | --- |
| A site never gets numbers | `journalctl -u metrona-scheduler`: "Log file not found" or "Permission denied" means the `logPath` is wrong or the group from step 2 is missing (restart the service after `usermod`) |
| Visitors look far too few | The site is behind a proxy and the log has the proxy's address: see "Behind Cloudflare's proxy?" |
| Numbers stopped updating | `systemctl status metrona-scheduler`; the card's "Updated" time on the dashboard shows the last run |
| The dashboard answers 502 | `systemctl status metrona-dashboard`, and that the proxy points at `127.0.0.1:3001` |

`metrona setup` is an earlier interactive wizard for nginx only; `metrona init` replaces it.
