# Asking an agent about your traffic (MCP)

Metrona includes a small, read-only [MCP](https://modelcontextprotocol.io) server. Connect it to
Claude Code, Cursor, Codex or any MCP client, then ask in plain words:

- "Which pages on the blog got the most views?"
- "Where do visitors to example.com come from?"
- "How did traffic in the last two weeks compare with the two weeks before?"

It reads the same files the dashboard reads, the `<siteId>.yaml` files the scheduler writes every
hour, so it needs no dashboard, no login and no network of its own.

## Connect it

The server speaks MCP over stdio. The simplest secure way to reach it is SSH: no open port, and
your SSH login is the only access control.

```bash
# Metrona installed on the server from a clone in /opt/metrona
claude mcp add metrona -- ssh myserver "cd /opt/metrona && npx --no-install metrona mcp"

# Metrona running in Docker (compose.example.yaml)
claude mcp add metrona -- ssh myserver docker compose -f /srv/metrona/compose.yaml exec -T dashboard metrona mcp

# Numbers copied to this machine, or Metrona running locally
claude mcp add metrona -- npx metrona mcp --data-dir /path/to/dashboard-data
```

The SSH user needs to read `/var/lib/metrona/dashboard` (for example, by being in the `metrona`
group: `sudo usermod -aG metrona $USER`).

Where the server looks for the numbers: `--data-dir`, else `METRONA_DATA_DIR`, else the
`dashboard.dataDir` of `/etc/metrona/metrona.yaml` (or `--config`), else
`/var/lib/metrona/dashboard`.

## Tools

| Tool | Answers |
| --- | --- |
| `list_sites` | Every site: id, domain, pageviews and visitors over the logged period, last update |
| `get_top` | A site's top pages, or the domains that sent it the most visits |
| `get_daily_trend` | Pageviews and visitors per UTC day, optionally between two dates |

All three are read-only: nothing an agent does here changes Metrona or your sites.

## What the numbers cover

Top pages and referrers count the access log files still on the server, often the last 2–30 days.
The daily trend keeps every day Metrona has seen, long after the log files are rotated away, so it
is the one to use for anything over time. The server tells agents this itself, so they can say
when a question goes beyond what the numbers hold.

## Without the metrona command

The server is also its own package, `@metrona/mcp`, with a `metrona-mcp` command. To embed it in
another Node.js program:

```js
import { createServer } from '@metrona/mcp';
const server = createServer({ dataDir: '/var/lib/metrona/dashboard' });
// connect it to any MCP transport
```
