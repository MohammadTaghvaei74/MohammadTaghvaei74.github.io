# Sorena design contrast gate

`tests/design_contrast.test.cjs` is a deterministic, source-level guard for the shared light palette. Run it with:

```sh
node --test tests/design_contrast.test.cjs
```

It implements the WCAG 2.x relative-luminance formula (no browser, network, font, or screenshot dependency) and checks:

- AA normal-text contrast (`>= 4.50:1`) for shared text/status tokens on the supported light surfaces.
- AA contrast for the actual observation-status and options-CTA declarations.
- A `3.00:1` non-text contrast floor for the focus indicator.
- The audited failing pairs remain explicit regression fixtures, so a future palette change cannot make the assertion itself vacuous.

## Audit findings and handoff recommendations

| Pair | Measured ratio | Recommendation |
| --- | ---: | --- |
| `#82938f` on `#f4f6ef` | `2.957:1` | Do not use this as normal-size unavailable/subtle text. Point the presentation class at the AA-safe muted token (the current shared `--ds-muted` is `#536b68`) or another value at/above `4.50:1`. |
| `#fff` on `#e97845` | `2.902:1` | Keep orange as the semantic accent/chart meaning, but use the dark ink foreground (`#102b30` gives `5.132:1`) for orange controls. If white text is a hard requirement, use a separately scoped darker presentation background rather than changing chart series colors. |
| `#33966b` on `#fff` | `3.674:1` | Preserve this green for chart/series identity where it is needed, but use the dedicated dark positive status text token (`#28754e`, `5.608:1`) for text on white/light surfaces. |
| `#d85c68` on `#fff` | `3.716:1` | Preserve this red for chart/series identity where it is needed, but use the dedicated dark negative status text token (`#a92c3b`, `6.751:1`) for text on white/light surfaces. |

These are presentation changes only: semantic status attributes and chart series assignments must remain intact. In particular, do not globally replace chart stroke/fill colors merely to improve text contrast; split text color from series color when a class currently serves both roles.

## Current baseline

Before the primary worker's shared-token changes, the deterministic suite is intentionally **red** only for the unavailable-comparison presentation rule, which still resolves to `#82938f` on light surfaces. The failure is the expected `2.957:1` result above. The status rules, orange CTA, and focus indicator already pass the gate in this checkout.

The primary worker should rerun the test after updating the shared presentation class/token. A green result is required before the browser gate or any publish step.
