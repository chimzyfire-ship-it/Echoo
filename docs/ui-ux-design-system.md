# Echoo UI / UX Design System

Source of truth for Echoo's mobile-first interface. The landing page (`index.html`)
is the reference implementation; every other page should match it. This document
captures the tokens, type scale, spacing, components, and viewport rules that make
the app feel like one calm, native piece.

When in doubt, open `index.html` and match it exactly.

---

## 1. Principles

- **Minimalist.** One accent color, lots of air, quiet surfaces. Never decorate.
- **Small, quiet labels.** Type weights stay light. Section labels and meta text
  are small and low-contrast — they support, never shout.
- **No heavy pills.** Pills are reserved for the search field and the bottom nav.
  Status / location cues are flat underlined caps or a single dot, never boxed.
- **Native-app feel.** Locked viewport, no horizontal scroll, no rubber-band
  bounce, no tap-highlight flash. It should read like an installed app.
- **One shell, many pages.** Every page lives inside the same `430px` app shell
  with the same topbar, the same floating nav, and the same dark gradient field.

---

## 2. Color tokens

Single-accent palette. There is no gold, rose, mint, or ember anymore — those were
the old multi-accent system and have been retired.

```css
:root {
  color-scheme: dark;

  --ink: #f8f5ef; /* primary text — warm off-white */
  --muted: #aaa29a; /* secondary text — hero copy, descriptions */
  --soft: rgba(248, 245, 239, 0.72); /* tertiary text */
  --line: rgba(248, 245, 239, 0.12); /* hairline borders */
  --line-strong: rgba(248, 245, 239, 0.2);
  --glass: rgba(30, 30, 29, 0.72); /* glass surfaces */

  --peach: #f7d5b2; /* THE accent — CTAs, active states, dots */
  --black: #050505; /* page base */
  --panel: #131313; /* card / panel base */
}
```

**Rules**

- `--peach` is the only accent. Use it for: the primary button, the active nav
  item, the active filter underline, section tags, and status dots.
- Text on peach is `#111` (near-black), never `--ink`.
- Surfaces use `rgba(248, 245, 239, 0.05–0.08)` over the gradient — never solid
  white panels.
- Ink values use `248, 245, 239` (warm) in all rgba derived from `--ink`. Do not
  mix in the old `248, 242, 231` (cooler) values.

### Page background

A near-black field built from layered gradients on `.app-shell`, not a photo:

```css
.app-shell {
  background:
    radial-gradient(
      circle at 50% -4%,
      rgba(255, 255, 255, 0.14),
      transparent 18rem
    ),
    radial-gradient(
      circle at 16% 46%,
      rgba(255, 212, 166, 0.08),
      transparent 14rem
    ),
    linear-gradient(145deg, #161716 0%, #080808 44%, #030303 100%);
}
```

Plus a vignette via `.app-shell::after`. Optional faint texture (webp) lives on
`.app-shell::before` at `0.1` opacity with `saturate(0.2) contrast(1.2)`.

---

## 3. Type scale

Family stack (set on `:root`):

```
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

| Role               | Size                        | Weight | Line-height | Letter-spacing | Color        |
| ------------------ | --------------------------- | ------ | ----------- | -------------- | ------------ |
| Hero H1            | `clamp(45px, 13.2vw, 58px)` | 820    | 1.02        | 0              | `--ink`      |
| Hero H1 (discover) | `clamp(42px, 13vw, 56px)`   | 820    | 1.02        | 0              | `--ink`      |
| Hero tagline       | `clamp(18px, 5vw, 23px)`    | 520    | 1.24        | 0              | `--muted`    |
| Hero copy          | 15px                        | 520    | 1.42        | 0              | `--muted`    |
| Section head H2    | 21px                        | 650    | 1           | 0              | `--ink`      |
| Card title H3      | 24px                        | 680    | 1           | 0              | `--ink`      |
| List item title    | 20px                        | 620    | 1           | 0              | `--ink`      |
| Sound / place      | 16–17px                     | 620    | 1.1         | 0              | `--ink`      |
| Brief H3           | 21px                        | 650    | 1           | 0              | `--ink`      |
| Body / copy        | 13–15px                     | 520    | 1.28–1.42   | 0              | `--soft`/60% |
| Meta / labels      | 11–12px                     | 520    | 1           | 0.04em         | 42–52% ink   |
| Section eyebrow    | 12px                        | 650    | 1           | 0.04em         | 50% ink      |
| Tag (caps)         | 10px                        | 650    | 1           | 0.04em         | `--peach`    |

**Weights stay in the 520–820 band.** Do not use 900–950 — that was the old heavy
system. The visual interest comes from size and spacing, not weight.

Caps (`text-transform: uppercase`) only on small labels: tags, eyebrows,
location-note, city-pill. Add `letter-spacing: 0.04–0.08em` whenever you uppercase.

---

## 4. Spacing & layout

```
App shell:    width: min(100vw, 430px);  overflow: hidden;  min-height: 100svh
Page padding: top    calc(28px + env(safe-area-inset-top))
              sides  27px
              bottom calc(110px + env(safe-area-inset-bottom))  /* clears the floating nav */
Section gap:  28px between sections, 12px within a section
Card gap:     12px (grid), 8px tight
```

- Sides use **27px** of horizontal padding (page or shell). On screens ≤374px,
  drop to 20px and tighten card gaps.
- Bottom padding must clear the floating nav (~72px tall + 12px offset) — use
  `calc(110px + env(safe-area-inset-bottom))` on any scrollable page.
- Always honor safe-area insets on top and bottom for notched devices.

---

## 5. Viewport stability (apply on every page)

This block is mandatory in every `<style>`. It is what kills horizontal scroll,
iOS rubber-band bounce, and the blue tap highlight — the "native-app feel."

```css
html,
body {
  max-width: 100%;
  overflow-x: hidden;
  overflow-x: clip; /* clips without breaking position:sticky */
  overscroll-behavior-y: none; /* kill iOS rubber-band bounce */
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
}
body {
  position: relative;
  overflow-wrap: break-word;
}
img,
video,
svg,
canvas,
iframe,
table {
  max-width: 100%;
}
```

And the meta tag:

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

If a page scrolls horizontally, this block is missing or a child is overflowing.

---

## 6. Components

### Topbar

Wordmark left, profile circle right. No text logo, no "Sign in" text link.

```html
<header class="topbar" aria-label="Echoo">
  <a class="brand" href="index.html" aria-label="Echoo home">
    <img src="assets/echoo-wordmark.png" alt="echoo" />
  </a>
  <a class="profile-link" href="auth.html" aria-label="Open your profile"></a>
</header>
```

- `.brand img`: 96px wide, `brightness(1.2) contrast(1.05)`.
- `.profile-link`: 34×34 circle, 2px ink border at 0.7 opacity, CSS-drawn head +
  shoulders via `::before`/`::after`.
- On long-feed pages (discover) the topbar may be `position: sticky; top: 0` with
  a `rgba(8,8,8,0.6)` glass background. On the landing it is non-sticky.

### Search pill

Glass capsule, search glyph, 50px peach send button. Single row.

```html
<form class="search" id="search-form" aria-label="Search Echoo">
  <span class="search-glyph" aria-hidden="true"></span>
  <input id="query" placeholder="Search Ontario tonight" />
  <button class="primary" type="submit" aria-label="Search"></button>
</form>
```

- min-height 60px, `border-radius: 999px`, padding `9px 9px 9px 19px`.
- Glass background `linear-gradient(180deg, rgba(42,42,41,0.78), rgba(29,29,28,0.76))`,
  `backdrop-filter: blur(22px)`.
- On `:focus-within`, add a `0 0 0 4px rgba(247,213,178,0.08)` ring + peach border.
- `.search-glyph`: 24px circle drawn with border + a rotated handle `::after`.
- `.primary`: 50×50 peach circle; the arrow is drawn with `::before` (shaft) and
  `::after` (chevron). No text.

> If a page reuses `.primary` as a text CTA (e.g. inside a `.brief` panel),
> override it: `.brief .primary { width:auto; height:46px; padding:0 18px;
  border-radius:999px; font-size:13px; font-weight:680 }` and `content: none` its
> pseudo-elements.

### Cards

- **Radius 14px** for feature cards, list cards, briefs. (Radius 8 is retired.)
- **Pick card** (landing): 2-col grid, min-height 156px, image as `::before`,
  dark gradient `::after`, a small `.meta` chip bottom-left.
- **Feature card** (discover rail): min-height 292px, image absolute, gradient
  scrim, title + one-line description.
- **List / event card**: 96px thumb + text. Title 20px/620, 2-line clamped copy,
  small meta row.
- Card surface: `rgba(248, 245, 239, 0.05)`, hover → `0.08`. Shadow soft:
  `0 12–16px 30–36px rgba(0,0,0,0.2–0.26)`.

### Vibe row (landing only)

5-column circle icons. `.vibe-icon` is `clamp(54px, 15vw, 66px)`, round,
`rgba(255,255,255,0.055)` fill, peach glyph. SVG 30px, stroke 1.8.

### Bottom navigation (global)

Floating glass pill, 4 icon items. **Identical markup + CSS on every page** — only
the `.active` class moves.

```html
<nav class="bottom-nav" aria-label="Main navigation">
  <a class="nav-link" href="index.html">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3Z" />
    </svg>
    <span>Home</span>
  </a>
  <a class="nav-link active" href="events.html" aria-current="page">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4 4" />
    </svg>
    <span>Discover</span>
  </a>
  <a class="nav-link" href="tickets.html">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 9a3 3 0 0 0 0 6v3h18v-3a3 3 0 0 0 0-6V6H3Z" />
      <path d="M13 6v12" />
    </svg>
    <span>Tickets</span>
  </a>
  <a class="nav-link" href="auth.html">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
    <span>Profile</span>
  </a>
</nav>
```

- `position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%)`.
- `width: min(376px, calc(100% - 52px))`, `min-height: 72px`, `border-radius: 28px`.
- Glass `rgba(25, 25, 24, 0.82)`, `backdrop-filter: blur(26px)`.
- Item color 62% ink; `.active` → `--peach`, icon **filled** (`fill: currentColor;
stroke-width: 0`).
- **Routings are fixed:** Home → `index.html`, Discover → `events.html`,
  Tickets → `tickets.html`, Profile → `auth.html`. Do not add a 5th item.

### Modals & sheets (landing)

- `.sheet`: bottom-anchored toast card, `bottom: 96px`, slides up 18px.
- `.location-modal`: center modal, scale-in, `rgba(21,21,20,0.92)` glass,
  radius 24px, 22px padding, `0 24px 80px` shadow.
- `.modal-backdrop`: full-screen `rgba(0,0,0,0.64)`, `backdrop-filter: blur(10px)`.
- Buttons: 48px min-height pills; primary = peach fill, secondary = 6% ink fill
  with 12% ink border.

---

## 7. Iconography

All icons are inline SVG, `viewBox="0 0 24 24"`, monochrome via `currentColor`.

```
stroke: currentColor;
stroke-width: 1.8;
fill: none;
stroke-linecap: round;
stroke-linejoin: round;
```

- **Active nav icon is filled** (`fill: currentColor; stroke-width: 0`), not just
  recolored.
- Nav icons render at 27px; vibe icons at 30px.
- Never use a multi-color or raster icon. Never inherit a different stroke width.

---

## 8. Motion

- Transitions are short: `180ms ease` for hovers, sheets, focus rings.
- Modals: `200ms ease` opacity + transform; center modal scales `0.97 → 1`.
- Always respect reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

- Auto-scrolling rails (news carousel) pause on pointer/wheel/scroll interaction
  and resume after a short timeout.

---

## 9. Accessibility

- Every interactive icon-only element has an `aria-label`.
- The active nav item carries `aria-current="page"`.
- Inputs have visually-hidden `<label class="sr-only">` elements (see `.sr-only`
  in `index.html`).
- Color contrast: body copy stays above 4.5:1; meta/labels are decorative and may
  go lower, but never below 3:1.
- `aria-hidden="true"` on purely decorative SVGs and glyphs.

---

## 10. Apply-to-a-new-page checklist

When bringing any page onto the system, work through this in order:

1. **Meta + viewport** — `<meta name="viewport" content="width=device-width, initial-scale=1" />`.
2. **Viewport stability block** — paste the §5 block at the top of `<style>`.
3. **Tokens** — replace the page's `:root` with the §2 token set. Delete any
   `--gold/--rose/--mint/--ember/--dim/--bg/--shadow/--panel-strong`.
4. **Background** — body `#000` + `.app-shell` gradient/vignette. Remove any
   heavy photo background.
5. **App shell** — `.app-shell { width: min(100vw, 430px); overflow: hidden; min-height: 100svh }`.
6. **Topbar** — wordmark + profile circle (§6). Remove text logos and "Sign in".
7. **Type weights** — sweep every `900–950` down into the 520–820 band (§3).
8. **Accent** — every gold/rose/mint usage → `--peach`. Gradients → solid peach.
9. **Cards** — radius 8 → 14; soften shadows; surface to 5% ink.
10. **Search** — if present, use the glass pill (§6), not input + text button.
11. **Labels** — shrink section eyebrows/meta; remove boxed status pills; use a
    dot + caps for location cues.
12. **Bottom nav** — paste the exact 4-item nav (§6), move `.active` to the
    current page, keep routings fixed.
13. **Page padding** — sides 27px, bottom `calc(110px + safe-area)` to clear nav.
14. **Motion + a11y** — include the reduced-motion block; add aria labels.
15. **Prettier** — `npx prettier --write <page>.html && npx prettier --check`.

Keep JavaScript untouched unless a renamed class/id breaks a selector. When a
class is renamed, grep the page's `<script>` for the old name and update it.
