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

### Layout
Prefer vertical **strips** (full-width rows of equal height) over uneven card grids for lists.

### Language
Game terms (enchantments, items, villagers, trims) use Mojang's official translations through `TH.i18n`. The tool's own UI text stays English.

### Colour
- **Dark (default), "Obsidian":** near-black violet-obsidian base, with **emerald** as the one dominant action colour, **lapis** for focus and links, **gold** for prices and treasure, **glint** violet reserved for enchanted or "perfect" states, and **select** (`--select` / `--select-soft`, violet-indigo, deeper in light mode) for every shared selected / highlighted / active state (active nav tab, selected segment, text selection). Select is deliberately a different hue from the glint.
- **Light, "Parchment":** warm paper and sepia ink, using the same accents in deeper shades. It reads like a written ledger, not a white SaaS page.
- Never use purple gradients as decoration. Glint violet only ever means *enchanted*; select violet only ever means *selected*.
- Always use tokens (`var(--…)`); never hard-code a colour in module CSS except for data colours like profession or trim colours.

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
- **Progress badges:** a module's `badge(state)` returns a string or `{ done, total }`; the object renders as a `.nav-badge.is-progress` pill (fill bar = share done; complete = solid emerald). Module sub-tabs reuse `.nav-badge`.
- **Mobile (<= 640px):** the section nav becomes a fixed bottom tab bar (icon over label), the language picker collapses to its icon, the save indicator shrinks to its dot and the backup button moves into the menu.

### Motion
- **One orchestrated entrance per tab switch:** direct children of `.module` fade and rise with staggered `animation-delay` (the `.enter` class, added by app.js only when the tab changes, never on re-render).
- Micro-interactions: button press depth, the enchant glint sweep on perfect or locked items, and checkbox pop.
- Respect `prefers-reduced-motion` everywhere.

## Roadmap

- **Trims = a preview tool**, not a catalogue: a HUD plus a real 3D character wearing the chosen armor and trim; per-pattern mini previews in the chosen armor + trim material; and a final materials list (templates, ingots, armor) for what is selected.
- **Optional style toggle** (e.g. neumorphism): a token-set switch on a `data-style` attribute on `<html>` (like `data-theme`), overriding surface, shadow and radius tokens only, never component CSS.
