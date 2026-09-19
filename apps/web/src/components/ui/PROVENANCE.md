# Project-owned UI primitives

`button.tsx` and `sheet.tsx` adapt the recorded canonical shadcn radix-nova registry payloads, inspected as data without running a CLI:

- https://ui.shadcn.com/r/styles/radix-nova/button.json — SHA256 `c07a8feb7b7ed07ad5279023e45ce23ed7b5b94c7dba3de5c08f30a2aa037de3`
- https://ui.shadcn.com/r/styles/radix-nova/sheet.json — SHA256 `2bd0d9a16075ad5d9179b575d71ea1967ba73b1fb39400018b519dd9989607e2`

Adaptations: local `cn`/Button imports, named React type imports, named Lucide icons, only consumed outline/ghost Button variants, 44px minimum controls, Spanish close label, and a left-side mobile-only Sheet. The existing Command Ledger CSS owns the palette and scrolling geometry. No decorative blur, animation dependency, unused side/size variants or gallery runtime imports. Sheet composes the canonical Dialog portal/overlay/content/title/close; Radix owns trapping, scroll locking and ordinary opener restoration. MobileNavigation owns breakpoint closure, visible focus in its scroll region, and Escape precedence for the existing account disclosure.

Installed target metadata/types were inspected: `radix-ui@1.6.7` (MIT), `class-variance-authority@0.7.1` (Apache-2.0), `lucide-react@1.45.0` (ISC). Existing `clsx@2.1.1` and `tailwind-merge@3.6.0` supply `cn`. Exact resolutions/integrities remain in the frozen lockfile; local metadata/license hashes are inspection evidence, not exhaustive tarball verification. These primitives are reached by the authenticated MobileNavigation, not a separate preview shell.

Stable `radix-ui/dialog` and `radix-ui/slot` exports replace the umbrella entrypoint to avoid unrelated entrypoint inclusion. Bundle impact awaits measurement from the final configured gate build.

## Login foundations — complete-shadcn-migration Task 1

Owner: Votus. Reference inspection used the pinned `shadcn@4.21.0` CLI
(`add input label --cwd apps/web --dry-run/--view`), as recorded in
`odd/tasks/complete-shadcn-migration.md`; no generation or installation was
performed for this adaptation. Canonical radix-nova items:

- https://ui.shadcn.com/r/styles/radix-nova/input.json
- https://ui.shadcn.com/r/styles/radix-nova/label.json
- https://ui.shadcn.com/r/styles/radix-nova/button.json (existing foundation)

The registry URLs are mutable, not content pins. Input/Label raw payload bytes
were not retained in this work unit, so no reproducible payload SHA256 is claimed.
The Button/Sheet hashes above are prior recorded inspection evidence, not newly
verified hashes.

Reviewed adaptations: `input.tsx` preserves native props/type and `data-slot`;
`label.tsx` composes Radix Root with native props and `data-slot`. Both use the
local `@/lib/utils` boundary and named React type imports. Label uses the stable
`radix-ui/label` export, not the umbrella entrypoint. Only consumed styles ship:
48px/full-width Input geometry, Votus surfaces/ink, disabled states, and danger
borders for `aria-invalid`. No registry shadow, focus ring, animation dependency,
or unused variants were copied. The existing global focus-visible outline remains
the focus indicator. Narrow important utilities override unlayered legacy native
control defaults without changing other routes or existing Button variants.

Button adds only `solid`; outline/ghost defaults and mobile callers are unchanged.
LoginForm is the real production caller through `/login`, retaining native named
uncontrolled fields, autocomplete, required validation, server `formAction`, pending
state, and error ARIA/text. Domain layout and the persistent feedback row remain;
only retired login-specific input/submit rules were removed. Error text and its
existing rail now use `--danger`, independently of focus.

No dependencies added. Input uses React 19.2.8 (MIT) and existing `cn` helpers:
clsx 2.1.1 (MIT), tailwind-merge 3.6.0 (MIT). Label additionally uses radix-ui 1.6.7
(MIT). Button retains class-variance-authority 0.7.1 (Apache-2.0). Canonical copied
source is covered by the shadcn MIT notice below. Frozen lockfile resolutions remain
authoritative.

Bundle measurement is pending the parent's configured production build: compare
before/after `/login` initial client JavaScript from the same build's route/chunk
manifest, counting shared chunks once; report raw and gzip bytes and percentage
delta using the same compression settings. Also compare the authenticated shell
because Button is shared. No size improvement or completed measurement is claimed.
Behavioral browser GREEN remains the parent's focused auth gate; unit tests alone
do not prove computed colors or layout.

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
