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

## Requirements

- Linux with systemd (examples use Ubuntu/Debian paths)
- Node.js 18 or newer at `/usr/bin/node`
- nginx or Caddy (2.8+) writing an access log per site

## 1. Get the code

```bash
sudo useradd --system --home /var/lib/metrona --shell /usr/sbin/nologin metrona
sudo git clone https://github.com/teamzork/metrona.git /opt/metrona
cd /opt/metrona && sudo npm ci --omit=dev
sudo mkdir -p /etc/metrona /var/lib/metrona/datasets /var/lib/metrona/dashboard
sudo chown -R metrona:metrona /var/lib/metrona
```

## 2. Let Metrona read the logs

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

## 3. Configure

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

## 4. Start the services

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

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| A site never gets numbers | `journalctl -u metrona-scheduler`: "Log file not found" or "Permission denied" means the `logPath` is wrong or the group from step 2 is missing (restart the service after `usermod`) |
| Visitors look far too few | The site is behind a proxy and the log has the proxy's address: see "Behind Cloudflare's proxy?" |
| Numbers stopped updating | `systemctl status metrona-scheduler`; the card's "Updated" time on the dashboard shows the last run |
| The dashboard answers 502 | `systemctl status metrona-dashboard`, and that the proxy points at `127.0.0.1:3001` |

The CLI in `packages/cli` (`metrona setup`) is an early nginx setup wizard. The steps above are the
supported way to install.
