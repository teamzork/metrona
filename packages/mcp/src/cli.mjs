#!/usr/bin/env node
/**
 * metrona-mcp [--data-dir <dir>]
 *
 * The read-only MCP server over stdio. The data folder is where the scheduler writes
 * <siteId>.yaml: --data-dir, else METRONA_DATA_DIR, else /var/lib/metrona/dashboard.
 * (`metrona mcp` does the same and can also read the folder from metrona.yaml.)
 */
import { DEFAULT_DATA_DIR, serveStdio } from './server.mjs';

const at = process.argv.indexOf('--data-dir');
const dataDir = (at > -1 && process.argv[at + 1]) || process.env.METRONA_DATA_DIR || DEFAULT_DATA_DIR;
await serveStdio({ dataDir });
