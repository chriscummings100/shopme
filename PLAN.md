# ShopMe TypeScript Migration Plan

This plan proposes moving ShopMe from a Python CLI plus Python MCP server to a
TypeScript-based project that can be launched with `npx` and can grow into a
collection of MCP servers over time.

## Implementation Status

As of 2026-05-02:

- Phase 1 is implemented with npm workspaces, package-local TypeScript configs,
  root scripts, and build/test tooling.
- Phases 2 and 3 are implemented in `packages/grocery-core`, including shared
  models, errors, ID helpers, and a compatible TypeScript shopping memory port.
- Phases 4 and 5 have initial TypeScript ports for browser attachment,
  screenshots, Waitrose, and Sainsbury's. Live supermarket smoke tests are still
  needed before retiring the Python implementation.
- Phase 6 is implemented as the `@shopme/cli` package with a `shopme` bin.
- Phase 7 is implemented as the `@shopme/mcp-groceries` package with a
  `shopme-mcp-groceries` bin and the equivalent safe tool/resource surface.
- Phase 8 is partially implemented through README updates and an npm-based
  `runmcp.bat`.
- Phase 9 remains pending.

## Goals

- Rebuild the project in TypeScript and run it on Node.js.
- Launch the CLI and MCP server through npm package bins, including `npx`.
- Preserve the current safe shopping surface and JSON CLI behavior.
- Keep the current `.shopme-memory` data format compatible.
- Restructure the repository so the groceries MCP server is the first server in
  a broader collection, not a one-off entry point.
- Keep vendor logic independent from MCP transport details.

## Non-Goals

- Do not change the authenticated-browser model yet. ShopMe should still attach
  to the user's Chrome session over CDP and use the live supermarket tab.
- Do not expose the raw authenticated API as a default MCP tool.
- Do not rewrite shopping memory semantics unless the TypeScript port uncovers a
  compatibility issue.
- Do not merge all future MCP servers into one large server process by default.

## Proposed Repository Structure

```text
shopme/
  package.json
  tsconfig.base.json
  README.md

  packages/
    grocery-core/
      package.json
      src/
        browser/
          chrome.ts
          screenshot.ts
        memory/
          index.ts
          scoring.ts
          store.ts
        vendors/
          base.ts
          waitrose.ts
          sainsburys.ts
        errors.ts
        models.ts
        vendor-registry.ts

    cli/
      package.json
      src/
        index.ts
        commands/
          browser.ts
          cart.ts
          memory.ts
          orders.ts
          products.ts

    shared/
      package.json
      src/
        json.ts
        paths.ts

  servers/
    groceries/
      package.json
      src/
        index.ts
        server.ts
        tools/
          browser.ts
          cart.ts
          memory.ts
          orders.ts
          products.ts
        resources/
          memory.ts

    api-spy/
      package.json
      src/
        index.ts

  tests/
    unit/
    integration/
    fixtures/

  scripts/
```

## Package Boundaries

### `packages/grocery-core`

Owns all supermarket behavior and local memory behavior.

Responsibilities:

- Chrome discovery and launch.
- CDP connection via Playwright.
- Vendor tab detection.
- Vendor abstraction and concrete vendor implementations.
- Opaque ID encoding and decoding.
- Product, cart, order, and order-detail models.
- Shopping memory event log and summary generation.
- Screenshot helper using the live Chrome session.

This package must not depend on the MCP SDK.

### `packages/cli`

Owns the human/debug CLI.

Responsibilities:

- Parse command-line arguments.
- Call `grocery-core`.
- Print JSON to stdout.
- Print errors as JSON and exit non-zero.
- Preserve command names where practical:
  - `start`
  - `search`
  - `cart`
  - `add`
  - `set`
  - `clear`
  - `orders`
  - `order`
  - `screenshot`
  - `api`
  - `memory summary`
  - `memory record`
  - `memory reject`
  - `memory explain`

### `servers/groceries`

Owns the MCP server for shopping.

Responsibilities:

- Create and run the groceries MCP server over stdio.
- Register safe shopping tools.
- Register memory resources.
- Keep stdout reserved for MCP protocol traffic.
- Send diagnostics to stderr only.
- Keep raw API disabled unless explicitly enabled with an environment variable.

### Future `servers/*`

Each future MCP server should be a separate package with its own `package.json`
and bin entry. Shared code belongs in `packages/*`; server-specific transport and
tool registration belongs in `servers/<name>`.

## npx Launch Strategy

The CLI package should expose:

```json
{
  "bin": {
    "shopme": "./dist/index.js"
  }
}
```

The groceries MCP server package should expose:

```json
{
  "bin": {
    "shopme-mcp-groceries": "./dist/index.js"
  }
}
```

Example CLI usage:

```bash
npx @your-scope/shopme --vendor waitrose start
npx @your-scope/shopme search "semi skimmed milk" --size 5
npx @your-scope/shopme cart
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "shopme-groceries": {
      "command": "npx",
      "args": ["-y", "@your-scope/shopme-mcp-groceries"]
    }
  }
}
```

For local development, use workspace commands:

```bash
npm run build
npm run test
npm run dev:cli -- search "milk"
npm run dev:mcp:grocery
```

## Tooling

Recommended dependencies:

- `typescript`
- `tsx` for local development
- `tsup` for building executable ESM output
- `vitest` for unit tests
- `playwright-core` for CDP connection without bundling browsers
- `commander` or `yargs` for CLI parsing
- `zod` for MCP tool input schemas and runtime validation
- MCP TypeScript SDK packages for server implementation

Use `playwright-core` rather than full `playwright` because ShopMe connects to
the user's installed Chrome over CDP.

## Migration Phases

### Phase 1: Workspace Skeleton

- Add root `package.json` with npm workspaces.
- Add `tsconfig.base.json`.
- Add package folders for `grocery-core`, `cli`, and `servers/groceries`.
- Add build, typecheck, test, and dev scripts.
- Keep the Python implementation working during this phase.

### Phase 2: Core Models and Errors

- Port dataclasses from `vendors/base.py` into TypeScript interfaces.
- Port `ShopMeError`.
- Port opaque ID helpers into explicit functions with tests.
- Add unit tests for model shape and ID round trips.

### Phase 3: Shopping Memory

- Port `shopping_memory.py` into `packages/grocery-core/src/memory`.
- Preserve `.shopme-memory/associations.jsonl`.
- Preserve `.shopme-memory/summary.json`.
- Preserve `SHOPME_MEMORY_DIR`.
- Add compatibility tests against existing fixture events.

This is the safest first functional port because it does not require Chrome.

### Phase 4: Browser and Vendor Resolution

- Port Chrome executable discovery.
- Port `start_browser`.
- Port CDP connection using Playwright.
- Port vendor tab auto-detection.
- Port screenshot support.
- Add integration tests that skip cleanly when Chrome is unavailable.

### Phase 5: Vendor Implementations

- Port Waitrose first.
- Port Sainsbury's second.
- Keep request behavior as close to Python as possible.
- Keep token extraction and refresh behavior equivalent.
- Preserve exposed opaque IDs.
- Add unit tests for parsing helpers and integration tests for live sessions.

### Phase 6: TypeScript CLI

- Implement the TypeScript CLI against `grocery-core`.
- Preserve JSON stdout.
- Preserve error format: `{ "error": "..." }`.
- Preserve command names and arguments where practical.
- Add a temporary side-by-side comparison script that runs Python and TypeScript
  commands for memory and non-mutating browser calls.

### Phase 7: Groceries MCP Server

- Port `shopme_mcp.py` to `servers/groceries`.
- Register equivalent tools:
  - `start_browser`
  - `search_products`
  - `get_cart`
  - `add_to_cart`
  - `set_cart_quantity`
  - `clear_cart`
  - `list_orders`
  - `get_order`
  - `screenshot_page`
  - memory read/write tools
- Register equivalent resources:
  - `shopme://memory/summary`
  - `shopme://memory/summary/{vendor}`
- Gate `raw_api` behind an environment variable.
- Verify stdio remains protocol-clean.

### Phase 8: Switch Launch Paths

- Replace `runmcp.bat` with an `npx`-based launcher or remove it from the
  recommended setup.
- Update README and AGENTS instructions.
- Update MCP client configuration examples.
- Keep old Python instructions in a migration note until TypeScript is proven.

### Phase 9: Remove Python

- Remove Python entry points once TypeScript integration tests and smoke tests
  cover the same behavior.
- Archive or delete `requirements.txt`, `pytest.ini`, and Python tests after
  TypeScript equivalents exist.
- Keep any useful reverse-engineering scripts either ported or clearly marked as
  legacy.

## Compatibility Checklist

- Existing `.shopme-memory` files still load.
- Existing product IDs returned by search can be added during the same session.
- Existing cart item IDs returned by cart can be passed to set quantity.
- Vendor auto-detection still works when exactly one vendor tab is open.
- `--vendor` still disambiguates multiple open vendor tabs.
- Browser launch still uses a persistent `~/.shopme-chrome` profile.
- MCP tool names remain stable.
- Raw API remains opt-in.
- Integration tests skip cleanly without a logged-in browser.

## Risks and Mitigations

- MCP SDK API churn: isolate MCP SDK usage inside `servers/groceries`.
- Browser/CDP differences: port browser helpers early and test against a live
  session before porting every vendor method.
- Accidental memory incompatibility: use fixture-based tests against existing
  `.shopme-memory` event lines.
- stdout pollution in MCP: centralize logging and use stderr for diagnostics.
- Large rewrite risk: keep Python and TypeScript side by side until the
  TypeScript CLI and MCP server pass smoke tests.

## Suggested First Implementation Slice

1. Create the npm workspace and TypeScript build setup.
2. Port shopping memory.
3. Add tests for memory summary, explain, record, and reject.
4. Add the `shopme` CLI bin for memory-only commands.
5. Confirm this works with:

```bash
npx @your-scope/shopme memory summary --vendor waitrose
```

That first slice proves package layout, npx launch, TypeScript tests, and
backward-compatible local data handling without touching live supermarket APIs.
