# Design system: The Network (ntwrk.party)

Black and white, much empty space, one typeface. The accent is ink: black on a light page, white on a
dark page. The brand is calm, plain and trusted.

- **Brand.** `primary` is the ink: the highlighted word of the headline, the main action, links and the
  focus `ring`. `primary-foreground` is the page color on it. `accent` is a quiet gray fill for hover and
  selection.

## Shared rules (all four brands)

The four brands use the same key set and the same non-color tokens. Only the colors differ.

- **Surfaces.** `background` is the page, `card` a raised panel, `popover` anything floating. `muted` and
  `secondary` are quiet fills. `accent` is the hover and selection fill.
- **Text.** `foreground` is the default. `muted-foreground` is for text that is less important. Each
  `x-foreground` is the text color on `x`. Each pair meets WCAG AA in the two themes.
- **Edges.** `border` divides and can be faint. `input` is the edge of a control. It has a contrast of
  3:1 or more on `background` and on `card` in the two themes (WCAG 1.4.11).
- **Meaning.** `primary` is the one brand color. `destructive`, `ok` and `warn` show state. Do not use
  them as decoration.
- **Shape.** One `radius`. `rounded-sm`, `-md`, `-lg` and `-xl` come from it. Three shadows, by elevation.
- **Type.** `font.sans` is Host Grotesk for all text. `font.mono` is for the agent prompt.
- **Motion.** `fast` for hover and press, `base` for most changes, `slow` for items that come into view.
  `ease.standard` for changes, `ease.out` for items that come into view.
- **Dark.** The theme follows the system. A `.dark` or `.light` class on an ancestor overrides it.

Use the token name (`bg-primary`, `var(--primary)`), not the value.

## Changing it

`tokens.json` is the source. The build makes the CSS in `generated/` and the table below from it. The
build does not read this prose. To change a token, write the change as a list in a file:

```json
[{ "path": "color.light.primary", "value": "oklch(0.2 0 0)", "reason": "softer ink" }]
```

- `node ../../../../tools/vibestack/vibestack/design/cli.ts apply changes.json`, run in this directory,
  refuses an unknown path, an invalid value or a pair below AA. It prints each token before and after.
- Add `--write` to update `tokens.json`, the CSS and the table.
- Change a non-color token in all four brands. `node build.ts check` in the package fails when the key
  sets of the brands differ.

<!-- tokens:start -->
| Color | Light | Dark |
| --- | --- | --- |
| `background` | oklch(0.985 0 0) | oklch(0.15 0 0) |
| `foreground` | oklch(0.16 0 0) | oklch(0.96 0 0) |
| `card` | oklch(1 0 0) | oklch(0.19 0 0) |
| `card-foreground` | oklch(0.16 0 0) | oklch(0.96 0 0) |
| `popover` | oklch(1 0 0) | oklch(0.19 0 0) |
| `popover-foreground` | oklch(0.16 0 0) | oklch(0.96 0 0) |
| `primary` | oklch(0.16 0 0) | oklch(0.96 0 0) |
| `primary-foreground` | oklch(0.985 0 0) | oklch(0.15 0 0) |
| `secondary` | oklch(0.955 0 0) | oklch(0.24 0 0) |
| `secondary-foreground` | oklch(0.16 0 0) | oklch(0.96 0 0) |
| `muted` | oklch(0.955 0 0) | oklch(0.24 0 0) |
| `muted-foreground` | oklch(0.43 0 0) | oklch(0.74 0 0) |
| `accent` | oklch(0.93 0 0) | oklch(0.28 0 0) |
| `accent-foreground` | oklch(0.16 0 0) | oklch(0.96 0 0) |
| `destructive` | oklch(0.5 0.18 27) | oklch(0.71 0.166 22) |
| `destructive-foreground` | oklch(0.985 0 0) | oklch(0.15 0 0) |
| `border` | oklch(0.87 0 0) | oklch(0.3 0 0) |
| `input` | oklch(0.6 0 0) | oklch(0.52 0 0) |
| `ring` | oklch(0.16 0 0) | oklch(0.96 0 0) |
| `ok` | oklch(0.5 0.13 150) | oklch(0.78 0.17 150) |
| `warn` | oklch(0.53 0.13 55) | oklch(0.82 0.15 75) |
| `info` | oklch(0.5 0.13 255) | oklch(0.82 0.09 253) |
| `inverse` | oklch(0.16 0 0) | oklch(0.96 0 0) |
| `inverse-foreground` | oklch(0.985 0 0) | oklch(0.15 0 0) |

| Token | Value |
| --- | --- |
| `radius` | 0.75rem |
| `font.sans` | "Host Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif |
| `font.mono` | ui-monospace, SFMono-Regular, Menlo, Consolas, monospace |
| `shadow.sm` | 0 1px 2px oklch(0 0 0 / 0.08) |
| `shadow.md` | 0 4px 12px oklch(0 0 0 / 0.12) |
| `shadow.lg` | 0 12px 32px oklch(0 0 0 / 0.18) |
| `breakpoint.sm` | 30rem |
| `breakpoint.md` | 48rem |
| `breakpoint.lg` | 64rem |
| `breakpoint.xl` | 70rem |
| `duration.fast` | 160ms |
| `duration.base` | 200ms |
| `duration.slow` | 620ms |
| `ease.standard` | cubic-bezier(0.22, 1, 0.36, 1) |
| `ease.out` | cubic-bezier(0.16, 1, 0.3, 1) |
<!-- tokens:end -->
