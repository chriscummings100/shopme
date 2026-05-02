# ShopMe TypeScript Project Plan

ShopMe is now a TypeScript npm workspace with a Node-based CLI and MCP server.
The legacy Python implementation has been removed.

## Current Status

- npm workspaces are configured at the repository root.
- `packages/grocery-core` owns browser attachment, vendor implementations,
  shared models, screenshots, and shopping memory.
- `packages/cli` exposes the `shopme` bin.
- `servers/groceries` exposes the `shopme-mcp-groceries` bin.
- `packages/shared` contains small shared helpers.
- The Node CLI has been live-tested against Waitrose for cart, search, orders,
  and add-to-cart.
- The Node MCP server has been live-tested for cart and search.
- Python entry points, Python vendors, pytest config, pytest tests, and Python
  helper scripts have been removed.

## Repository Layout

```text
shopme/
  package.json
  tsconfig.base.json
  vitest.config.ts

  packages/
    grocery-core/
      src/
        browser/
        memory/
        vendors/
        errors.ts
        models.ts
        vendor-registry.ts
    cli/
      src/index.ts
    shared/
      src/

  servers/
    groceries/
      src/
        index.ts
        server.ts
        tools/
        resources/

  tests/
    unit/
```

## Launch Paths

Local CLI:

```bash
npm exec --workspace @chriscummings100/shopme -- shopme cart
```

Local MCP server:

```bash
node C:\dev\shopme\servers\groceries\dist\index.js
```

Local MCP config:

```json
{
  "mcpServers": {
    "shopme": {
      "command": "node",
      "args": ["C:\\dev\\shopme\\servers\\groceries\\dist\\index.js"]
    }
  }
}
```

Published MCP config, once packages are released:

```json
{
  "mcpServers": {
    "shopme": {
      "command": "npx",
      "args": ["-y", "@chriscummings100/shopme-mcp-groceries"]
    }
  }
}
```

## Verification

```bash
npm run typecheck
npm run build
npm run test:unit
```

Live checks require Chrome running with remote debugging and a logged-in vendor
tab:

```bash
npm exec --workspace @chriscummings100/shopme -- shopme --vendor waitrose start
npm exec --workspace @chriscummings100/shopme -- shopme cart
npm exec --workspace @chriscummings100/shopme -- shopme search "milk" --size 3
npm exec --workspace @chriscummings100/shopme -- shopme orders --size 1
```

## Remaining Work

- Add TypeScript integration tests that skip cleanly when Chrome is unavailable.
- Add MCP protocol-level tests for `servers/groceries`.
- Decide package names/scopes for publishing.
- Add CI for typecheck, build, and Vitest.
- Add an `api-spy` TypeScript server/package if reverse-engineering workflows
  are still needed.
