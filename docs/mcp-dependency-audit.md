# MCP dependency audit

Scope: direct web and ETL dependencies. MCP servers are optional development tools, not runtime dependencies; their configured versions do not change package lockfiles.

| Tool | Configuration | Verification |
| --- | --- | --- |
| shadcn | Existing `shadcn@4.21.0` stdio server | Configuration retained; connection not tested in this worktree. |
| Next DevTools | `next-devtools-mcp@0.4.0` stdio server | Pinned configuration; connection not tested in this worktree. |
| Playwright | `@playwright/mcp@0.0.82` stdio server | Pinned configuration; connection not tested in this worktree. Independent of `@playwright/test@1.63.0`. |
| Supabase | Project-scoped hosted endpoint with `read_only=true&features=database%2Cdocs` | Previously authenticated and verified read-only in the original checkout; **not reauthenticated or queried in this worktree**. Endpoint restrictions do not imply narrow OAuth grants. |

No separate MCP was added for ordinary UI libraries, linters, test runners, ETL libraries, or the archived PostgreSQL reference server. `npx -y` may fetch a pinned server when first launched. Do not treat configuration as proof of a successful connection. Consult [Next.js MCP](https://nextjs.org/docs/app/guides/mcp), [Playwright MCP](https://github.com/microsoft/playwright-mcp), [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp), and [shadcn MCP](https://ui.shadcn.com/docs/mcp) before changing server capabilities.
