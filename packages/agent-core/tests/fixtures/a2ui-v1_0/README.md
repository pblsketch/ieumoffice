# A2UI v1.0 schemas (test fixtures)

These files are copies of the official A2UI v1.0 JSON schemas, used only by
`tests/a2ui-conformance.test.ts` to check that what the question card accepts
and returns is real A2UI. They are test data: nothing in `src/` imports them and
they are not part of the application or its installer.

- Source: https://github.com/a2ui-project/a2ui
- Commit: `c26be2dd087b541c46e0296c164ae13bf35f7836`
- License: Apache License 2.0, Copyright 2024 Google LLC (see the repository's
  `LICENSE`; the repository root `NOTICE` records the attribution)

| File                      | Upstream path                                     |
| ------------------------- | ------------------------------------------------- |
| `agent_to_renderer.json`  | `specification/v1_0/json/agent_to_renderer.json`  |
| `renderer_to_agent.json`  | `specification/v1_0/json/renderer_to_agent.json`  |
| `common_types.json`       | `specification/v1_0/json/common_types.json`       |
| `catalog_definition.json` | `specification/v1_0/json/catalog_definition.json` |
| `basic_catalog_v1.json`   | `catalogs/basic/v1/catalog.json`                  |

The JSON files are byte-identical to upstream (they are listed in
`.prettierignore`). Do not edit them; to update, copy the files again from a
newer commit and change the commit above.
