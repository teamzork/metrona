import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.mjs';

const demoData = fileURLToPath(new URL('../../cli/demo-data', import.meta.url));

async function connect(dataDir) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer({ dataDir });
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return { client, server };
}

const call = async (client, name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return { ...result, data: result.isError ? null : JSON.parse(result.content[0].text) };
};

describe('Metrona MCP server', () => {
  let client;
  let server;
  before(async () => ({ client, server } = await connect(demoData)));
  after(async () => {
    await client.close();
    await server.close();
  });

  it('offers three read-only tools and explains what the numbers cover', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['get_daily_trend', 'get_top', 'list_sites']);
    assert.ok(tools.every((t) => t.annotations.readOnlyHint === true));
    assert.match(client.getInstructions(), /UTC day/);
  });

  it('lists every site with its totals', async () => {
    const { data } = await call(client, 'list_sites');
    const example = data.find((s) => s.siteId === 'example-com');
    assert.deepEqual([example.domain, example.pageviews, example.visitors], ['example.com', 15420, 8750]);
    assert.equal(data.length, 3);
  });

  it('returns top pages and referrers, limited', async () => {
    const pages = await call(client, 'get_top', { siteId: 'example-com', kind: 'pages', limit: 2 });
    assert.deepEqual(pages.data.rows.map((r) => r.path), ['/', '/about']);
    const refs = await call(client, 'get_top', { siteId: 'example-com', kind: 'referrers', limit: 1 });
    assert.equal(refs.data.rows[0].domain, 'google.com');
  });

  it('filters the daily trend by date and totals it', async () => {
    const { data } = await call(client, 'get_daily_trend', { siteId: 'blog-example', from: '2024-01-02', to: '2024-01-03' });
    assert.deepEqual(data.daily.map((d) => d.date), ['2024-01-02', '2024-01-03']);
    assert.equal(data.pageviews, data.daily[0].pageviews + data.daily[1].pageviews);
  });

  it('never reads outside the data folder', async () => {
    for (const siteId of ['../etc/passwd', '..', '.hidden', 'a/b']) {
      const result = await call(client, 'get_top', { siteId, kind: 'pages' });
      assert.equal(result.isError, true, siteId);
      assert.match(result.content[0].text, /Not a site id/);
    }
  });

  it('names the sites that exist when asked for one that does not', async () => {
    const result = await call(client, 'get_top', { siteId: 'nope', kind: 'pages' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /example-com/);
  });

  it('says plainly when the data folder is missing', async () => {
    const other = await connect('/nonexistent/metrona');
    const result = await call(other.client, 'list_sites');
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /METRONA_DATA_DIR/);
    await other.client.close();
    await other.server.close();
  });
});
