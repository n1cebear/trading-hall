# Design guidelines — Trading Hall

Every UI change in this project (by a human or an agent) follows this file.

## Frontend aesthetics (source guideline)

<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:

**Typography:** Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.

**Color & Theme:** Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.

**Motion:** Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions.

**Backgrounds:** Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely designed for the context. Vary between light and dark themes, different fonts, different aesthetics. You still tend to converge on common choices (Space Grotesk, for example) across generations. Avoid this: it is critical that you think outside the box!
</frontend_aesthetics>

## How this project applies it — "Obsidian & Lapis"

The app is a villager trading hall and enchanting workshop, so the look borrows from the **enchanting table**: obsidian, lapis lazuli, emerald currency, old tomes and the floating Standard Galactic runes.

### Typography
| Role | Font | Token | Used for |
|---|---|---|---|
| Display + data | **Monocraft** (open-source, modelled on Minecraft's UI lettering; bundled in `fonts/`, SIL OFL) | `--display`, `--mono` | Page titles, brand, prices, counts, numerals |
| Body | **Bricolage Grotesque** | `--font` | All other UI text |

(The first draft used Jacquard 24 blackletter; the user rejected it.)

### Icons
Real Minecraft textures only, via `TH.icon` (js/core/icons.js), loaded at runtime from the InventivetalentDev/minecraft-assets mirror (1.21.11) and never copied into the repo. Professions use their workstation block. Enchanted things get the masked glint. Avoid emoji pictographs; plain UI symbols (✓ ✕ ↻) are fine sparingly.

### Controls: "inventory slots"
Inputs, checkboxes, steppers and slider tracks are **sunken slots** (dark top-left inner edge, light bottom-right). Buttons, stepper keys and slider thumbs are **raised blocks**. The slider copies the Minecraft options-menu slider. Use the shared classes in styles.css (`.field`, `.check`, `.switch`, `.slider`, `.stepper`, `.price`, `.lvl-chips`); never ship browser-default controls.

### Landing page (Overview)
`js/modules/overview.js` + `css/overview.css`: a hidden module (`hidden: true`, not a nav tab) shown when the URL has no hash and when the logo is clicked (`<a class="brand" href="#/">`). Nothing remembers the last tab: arriving fresh always lands here. One card per tool in its feature colour with a real texture on a glow pedestal, a short pitch, a live progress stat from the module's `badge(state)`, and a block-style CTA. Trims is marked "preview", Builds "soon". The grid is 4 across on wide screens, 2x2 below 1180px and one column below 700px.

### Layout
Prefer vertical **strips** (full-width rows of equal height) over uneven card grids for lists.

### Language
Game terms (enchantments, items, villagers, trims) use Mojang's official translations through `TH.i18n`. The tool's own UI text stays English.

### Colour
- **Dark (default), "Obsidian":** near-black violet-obsidian base. **Lapis** is for links; **gold** is for prices and treasure (never themed); the **glint** (`--enchant`) is the masked enchanted-item shimmer. Everything else that is "active" follows the **per-feature accent** below.
- **Light, "Parchment":** warm paper and sepia ink, using the same hues in deeper shades. It reads like a written ledger, not a white SaaS page.
- **Per-feature accent.** Every tool owns one colour and it drives *all* highlights inside it: primary buttons, checkboxes and check marks, switches, slider thumbs, selected / active states, focus rings, progress bars and rings, the active nav marker and badges, text selection. `app.js` sets `<html data-tool="hall|enchanting|trims|builds|overview">` on every route; `styles.css` derives the whole family (`--accent`, `--accent-2`, `--accent-deep`, `--accent-ink`, `--accent-soft`, `--select`, `--select-soft`, `--glow-b`) from one value, `--tc`, under `:root[data-tool]`. Only the four palette tokens `--c-hall/--c-ench/--c-trim/--c-build/--c-home` (plus `--on-accent`, `--mix-hi`) differ per theme.

  | Tool | `data-tool` | Colour | Dark / light | Source |
  |---|---|---|---|---|
  | Trading Hall | `hall` | **emerald** | `#17dd62` / `#0b7a35` | the emerald item (`#41f384` highlight, `#17dd62` body, `#00aa2c` / `#007b18` shades) |
  | Enchanting | `enchanting` | **enchant purple** | `#b07cff` / `#7b3fc4` | the enchantment glint |
  | Trims | `trims` | **diamond blue** | `#4aedd9` / `#0d7d76` | the diamond item (`#a1fbe8`, `#4aedd9`, `#2cb5a9`) |
  | Builds | `builds` | **orange** (copper / orange concrete) | `#ff8a3d` / `#b85a12` | terracotta and copper tones; placeholder tab marked "soon" |
  | Overview | `overview` | **gold** | `#f5c04a` / `#8f5f0c` | neutral landing colour |

- **Module CSS uses only the tokens** (`var(--accent)`, `var(--select)`, ...) for primary, selected, checked and focus states, so it recolours itself. Do not hard-code greens or violets, and do not use `--lapis` for focus. Gold stays for prices; `--tier-*` and profession / trim colours are data colours and are not themed.
- Each nav tab shows its own feature colour (underline, icon glow, badge) via `.nav-item[data-tool]` so the system reads clearly even when another tool is active.
- Never use purple gradients as decoration; purple appears only as Enchanting's accent and the enchant glint.
- Always use tokens (`var(--...)`); never hard-code a colour in module CSS except for data colours like profession or trim colours.

### Shape and surface
- Small radii (`--radius: 6px`) for a blocky feel. Panels have a 1px top highlight and a darker bottom edge, like an inventory slot.
- Primary buttons have a 3px "block" under-shadow that compresses on `:active`.

### Background
A layered, fixed atmosphere (`#atmosphere` in index.html, mobs built by `initAtmosphere()` in app.js):
- a faint pixel grid,
- a lapis glow at the top-left and an emerald glow at the bottom-right,
- minimal **mob faces** (blaze, creeper, zombie, skeleton, enderman, villager, ghast, spider, wolf, ...) rising slowly: small, low opacity (`--mob-op`), `image-rendering: pixelated`. Each is the 8x8 (or 8x10) front-of-head region cropped from the real entity skin with `background-size/position`; the table is `TH.icon.mobFaces` and the texture source is the same CDN mirror as `TH.icon` (`entity/...`), cached by sw.js and warmed with the icons. Local `file://` mode still uses the CDN for these.

Faces stop under `prefers-reduced-motion` (not even created).

### Chrome
- **Scrollbar:** themed (sunken track, raised block thumb; `scrollbar-color` + `::-webkit-scrollbar`), `scrollbar-gutter: stable` on `html` so layout never shifts.
- **Width:** `.app` is up to 1760px wide with small side padding so wide screens are used.
- **Top bar:** sticky, `z-index: 60`; its full-bleed blurred band is a `::before` layer so it sits above content and the atmosphere without trapping fixed children.
- **Logo:** pixel hourglass on ONE 7s timeline: sand rises bottom to top, then the glass flips into the identical start state (all shading is 180-degree symmetric). The glow is a drop-shadow on the sand groups, so lighting follows the sand level and the loop has no seam.
- **Progress badges:** a module's `badge(state)` returns a string or `{ done, total }`; the object renders as a `.nav-badge.is-progress` pill (fill bar = share done; complete = solid feature accent). Module sub-tabs reuse `.nav-badge`.
- **Mobile (<= 640px):** the section nav becomes a fixed bottom tab bar (icon over label), the language picker collapses to its icon, the save indicator shrinks to its dot and the backup button moves into the menu.

### Motion
- **One orchestrated entrance per tab switch:** direct children of `.module` fade and rise with staggered `animation-delay` (the `.enter` class, added by app.js only when the tab changes, never on re-render).
- **Shared reveal helper:** `TH.util.reveal(container, { items, from, step, max })` replays that same entrance (the `rise` keyframes, via the `.th-rv` class + `--i` stagger index, capped at 12) on part of a page for *structural* in-module changes: switching material or item, a mode switch, applying a preset, re-sorting a list. It restarts cleanly when called repeatedly, cleans its classes up on `animationend`, and does nothing under `prefers-reduced-motion`. Never call it for typing, level-chip clicks or other small edits. Other modules guard with `TH.util.reveal && TH.util.reveal(el)`.
- Micro-interactions: button press depth, the enchant glint sweep on perfect or locked items, and checkbox pop.
- Respect `prefers-reduced-motion` everywhere.

## Roadmap

- **Builds (TBD):** orange-accented build planner: define a build, get a materials list in blocks / stacks / shulker boxes, tick off what is gathered. Today a "soon" placeholder tab (`js/modules/builds.js`).
- **Trims = a preview tool**, not a catalogue: a HUD plus a real 3D character wearing the chosen armor and trim; per-pattern mini previews in the chosen armor + trim material; and a final materials list (templates, ingots, armor) for what is selected.
- **Optional style toggle** (e.g. neumorphism): a token-set switch on a `data-style` attribute on `<html>` (like `data-theme`), overriding surface, shadow and radius tokens only, never component CSS.

### Hall layout editor (`js/modules/hall-canvas.js`)
"Your hall" is an infinite, zoomable canvas (Figma-like), not a fixed grid. Tiles live in world px (`hall.layout.pos`, 72px tiles on an 80px snap grid); the view (`hall.ui.view`) persists pan/zoom/snap/guides/minimap. During gestures only transforms change; the store is written once on release. Snap + smart guides by default (Alt bypasses), overlaps resolve to the nearest free spot, drop-onto swaps, undo/redo, align/distribute, tidy up, minimap, `?` shortcut overlay. Zoomed below 50% tiles show icons only.
