---
name: design
description: Design or review anything a person looks at, built from a spec in this repository: a page, screen, component, chart, dashboard, report or CLI output. Use before writing UI code, when choosing a layout or visual direction, and when reviewing UI for clutter, wordiness or missing spec content.
---

# Design from the spec

## Before you draw

1. **Inventory.** For each story in `spec/<name>.md`, write down what the user
   must see or do, and the rule behind it. That list is the whole content:
   everything on it ships; no page, section, setting or sample content off it does.
2. **Cut.** For each item ask: does the user need to see this, here, now? What
   do they need that is not on the list? Remove what fails; add what is missing.
3. **Three directions.** Sketch three different approaches (layout, hierarchy,
   brand treatment), a sentence or a rough SVG each. Pick the one that shows the
   inventory with the fewest elements and the clearest identity.

## Rules

| Instead of | Use |
|---|---|
| Text a visual can carry | A chart, icon, color, shape or SVG |
| A number inside a sentence | The number alone, large, or a bar or meter |
| A status word | Color, shape or icon, with the word as its accessible name |
| A paragraph explaining a flow | A diagram |
| A label repeating what the element shows | Nothing |
| A chip, pill, badge, eyebrow or divider | Position, weight or color, or nothing |
| Filler in empty space | Whitespace |

- **Few words.** No explanations, disclaimers, helper text, sub-headers,
  taglines or detail lines under titles. One heading per view at most.
- **Accessible.** Every visual keeps its meaning in `aria-label` or `alt`. Text
  contrast meets WCAG AA.
- **Untested.** Words, layout and styles get no tests. A journey test through
  the UI asserts what the user can do and what the state became, not what the
  page says (AGENTS.md, "Tests").
- **One system.** One type pairing, a small palette with one accent and one
  spacing scale, as shared tokens. Extend an existing component before adding one.

## Review: two or three passes

Reread the rules above before each pass, then ask:

- What could go with no story losing anything? Remove it.
- What text could be a visual? What visual could be smaller?
- What from the inventory is missing?
- Does the eye land first on what matters most?

Stop when a pass changes nothing. Report the chosen direction in one line, and
anything cut that the user might expect to see.
