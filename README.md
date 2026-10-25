# Metrona

**Website analytics from the logs your server already keeps.** Metrona reads your web server's
access logs and shows each site's pageviews, visitors, top pages, referrers, and daily trends. It
adds no tracking script and no cookies to your pages, and it uses no third-party service.

![The Metrona dashboard for one site: totals, top pages, referrers and a 30-day trend](Docs/images/site.png)

## Why Metrona

- **Nothing on your pages.** Every request already reaches your server and gets logged; Metrona
  counts from that. Pages stay as fast as they were, and ad blockers don't hide your visitors.
- **Private by design.** Visitors are counted with a salted one-way hash of IP address and
  browser. Raw IPs never leave your server's own log files, and nothing is sent anywhere.
- **People, not bots.** Crawlers, uptime checks, scripts, assets (images, CSS, JavaScript), errors
  and single-page-app background requests are left out.
- **Many sites, one place.** One install counts any number of sites and shows them side by side.
- **Plain files.** Results are YAML files you can read, back up, export to CSV, or feed into
  something else.
- **Small.** A Node.js process that wakes up once an hour. No database.

## What you get

| All sites at a glance | One site in depth |
| --- | --- |
| ![All sites](Docs/images/all-sites.png) | ![One site](Docs/images/site.png) |
| Pageviews, visitors and the top page of each site | Date ranges, top pages, referrers, a 30-day trend, CSV exports |

Running a site and want to know how to read these numbers? See the
**[user guide](Docs/user-guide.md)**. It's written for site owners, not server admins.

## How it works

```
web server access log ──► scheduler (hourly) ──► <site>.yaml ──► dashboard
  nginx or Caddy            parse, filter,         totals, pages,    a small web app
                            hash, count            referrers, days   behind your login
```

1. Your web server writes an access log for each site: nginx in its usual *combined* format, or
   Caddy as JSON.
2. Once an hour the **scheduler** re-reads the logs still on disk and recounts. Re-running is
   always safe. Day-by-day totals are kept even after the old log files are rotated away.
3. The **dashboard** shows the results. It listens only on the server itself. Your web server
   puts it on a hostname of your choice, behind HTTPS and a password.

## Try it in a minute

You'll need Node.js 18 or newer.

```bash
git clone https://github.com/teamzork/metrona.git
cd metrona
npm install
node examples/try-dashboard.js     # sample data → http://localhost:3003
```

## Install it on a server

[**Docs/setup.md**](Docs/setup.md) walks through it: the config file, log access for nginx or
Caddy, the two systemd services, and putting the dashboard behind HTTPS. For Caddy specifics and
how counting works in detail, see [Docs/caddy.md](Docs/caddy.md).

## Documentation

| | For |
| --- | --- |
| [User guide](Docs/user-guide.md) | Site owners: reading the dashboard, what the numbers mean |
| [Setup](Docs/setup.md) | Admins: installing and running Metrona on a server |
| [Caddy and counting rules](Docs/caddy.md) | Admins: Caddy logs, per-site options, privacy notes |
| [Architecture](Docs/architecture.md) · [API](Docs/api.md) | Developers |
| [Design history](Docs/design/) | The original spec, requirements and task list |

## Repository layout

```
packages/
  parser/      log parsing, filtering, counting, YAML output
  scheduler/   the hourly job (daemon.js) and its config
  dashboard/   the web dashboard (start.js) and a static-HTML mode
  components/  embeddable web components (early)
  cli/         an nginx setup wizard (early)
  shared/      constants and helpers
templates/     config, systemd, nginx and Caddy examples
examples/      sample data and try-dashboard.js
Docs/          guides
```

## Development

```bash
npm install
npm test          # every package's Jest suite
```

Plain JavaScript (CommonJS), so there's no build step. Each package has its tests next to the source
(`*.test.js`, plus `*.property.test.js` for property-based tests).

## License

[MIT](LICENSE)
