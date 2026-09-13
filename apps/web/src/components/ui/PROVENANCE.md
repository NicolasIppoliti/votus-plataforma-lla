# Project-owned mobile navigation primitives

`button.tsx` and `sheet.tsx` adapt the recorded canonical shadcn radix-nova registry payloads, inspected as data without running a CLI:

- https://ui.shadcn.com/r/styles/radix-nova/button.json — SHA256 `c07a8feb7b7ed07ad5279023e45ce23ed7b5b94c7dba3de5c08f30a2aa037de3`
- https://ui.shadcn.com/r/styles/radix-nova/sheet.json — SHA256 `2bd0d9a16075ad5d9179b575d71ea1967ba73b1fb39400018b519dd9989607e2`

Adaptations: local `cn`/Button imports, named React type imports, named Lucide icons, only consumed outline/ghost Button variants, 44px minimum controls, Spanish close label, and a left-side mobile-only Sheet. The existing Command Ledger CSS owns the palette and scrolling geometry. No decorative blur, animation dependency, unused side/size variants or gallery runtime imports. Sheet composes the canonical Dialog portal/overlay/content/title/close; Radix owns trapping, scroll locking and ordinary opener restoration. MobileNavigation owns breakpoint closure, visible focus in its scroll region, and Escape precedence for the existing account disclosure.

Installed target metadata/types were inspected: `radix-ui@1.6.7` (MIT), `class-variance-authority@0.7.1` (Apache-2.0), `lucide-react@1.45.0` (ISC). Existing `clsx@2.1.1` and `tailwind-merge@3.6.0` supply `cn`. Exact resolutions/integrities remain in the frozen lockfile; local metadata/license hashes are inspection evidence, not exhaustive tarball verification. These primitives are reached by the authenticated MobileNavigation, not a separate preview shell.

Stable `radix-ui/dialog` and `radix-ui/slot` exports replace the umbrella entrypoint to avoid unrelated entrypoint inclusion. Bundle impact awaits measurement from the final configured gate build.

## Canonical source license

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
