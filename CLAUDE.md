# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

This repository is a freshly scaffolded TypeScript project. As of this writing it contains only `package.json`, `tsconfig.json`, and `node_modules` — there is no source code, no README, no tests, and no build/lint/test scripts wired up. The `npm test` script is the default placeholder (`exit 1`).

When architecture, scripts, or conventions are introduced, update this file accordingly rather than inferring them from the name "delivery-orchestrator".

## TypeScript Configuration Notes

`tsconfig.json` is stricter than the TS defaults in ways that affect how code should be written here:

- `"module": "nodenext"` with `"verbatimModuleSyntax": true` — type-only imports must use `import type`, and relative imports need explicit file extensions (`./foo.js`, not `./foo`).
- `"noUncheckedIndexedAccess": true` — indexed access (`arr[i]`, `obj[key]`) yields `T | undefined`; narrow before use.
- `"exactOptionalPropertyTypes": true` — `{ x?: string }` is not the same as `{ x?: string | undefined }`; don't assign `undefined` to optional properties unless the type explicitly includes it.
- `"jsx": "react-jsx"` is enabled, so `.tsx` files are supported without importing React.
- `"isolatedModules": true` and `"noUncheckedSideEffectImports": true` are on — each file must be independently transpilable, and side-effect-only imports must resolve.

No `rootDir`/`outDir` is set and `@types/node` is not installed; if Node APIs are needed, add `@types/node` and include `"node"` in `types`.
