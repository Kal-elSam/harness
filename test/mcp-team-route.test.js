import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, tree } from './team-route-fixture.test.js';
import { registerKairoMcpTools, KAIRO_MCP_READ_TOOLS, KAIRO_MCP_WRITE_TOOLS } from '../src/global/mcp/kairo-mcp.js';

test('MCP route registered read-only and equals CLI JSON without writes', async t => {
  const f = await fixture(t);
  await f.cache();
  for (const workspaceBound of [false, true]) {
    const tools = new Map();
    registerKairoMcpTools((name, config, handler) => tools.set(name, { config, handler }), { homeDir: f.home, cwd: f.cwd, cwdExplicit: true, workspaceBound });
    assert.ok(KAIRO_MCP_READ_TOOLS.includes('kairo_team_route'));
    assert.equal(KAIRO_MCP_WRITE_TOOLS.includes('kairo_team_route'), false);
    const tool = tools.get('kairo_team_route');
    assert.ok(tool);
    const before = await tree(f.home);
    const args = tool.config.inputSchema.parse({ role: 'Builder', cwd: f.cwd });
    const result = await tool.handler(args);
    assert.deepEqual(result.structuredContent, JSON.parse(f.cli('--role', 'Builder').stdout));
    assert.deepEqual(await tree(f.home), before);
    const unknown = await tool.handler({ role: 'Unknown', cwd: f.cwd });
    assert.equal(unknown.isError, true);
  }
});
