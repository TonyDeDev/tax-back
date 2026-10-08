# TaxBack Style Reference (based on Depot)
> Dark server-rack terminal. A near-black developer console where one green LED signals action and the rest of the UI whispers in graphite.

**Theme:** dark (the light variant and all token values live in `theme.css`)

This reference was extracted from the Depot marketing site and adopted as the TaxBack visual language.
Depot-specific components (CI workflow panel, customer logo grid, Similar Brands) are kept as inspiration only.
`theme.css` holds the tokens and wins on any conflict with this document.

Source measurements are normalized; roles and recommendations are interpreted. Font summary lists are independent, not paired by position. HTML examples are reconstructions, not source components.

Depot uses a developer-console language: a near-black canvas, hairline green-tinted borders, and a single vivid green accent that lights up the only button on the page. The interface feels like a terminal that grew up into a marketing site - compact, monospace-adjacent, and confident in its restraint. Typography splits into three Red Hat families: Display for tight tracked-out headlines, Text for slightly letter-spaced body copy, and Mono for code and terminal-style labels, creating a tri-tonal typographic system. Surfaces stack in barely-perceptible lifts of near-black, separated by thin 1px hairline borders with subtle green ambient glows - no drop shadows, just inset top highlights. Color appears sparingly: green for actions and status, blue for inline links, and a soft violet for secondary decorative accents. The whole system reads as 'infrastructure you can trust' rather than 'consumer app you enjoy'.

## Tokens - Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Signal Green | `#71d083` | `--color-signal-green` | Primary CTA fill; also small status signals (status dots, featured labels, tags) and gain text. Never large surfaces |
| LED Green | `#366740` | `--color-led-green` | Green supporting accent for decorative details and low-frequency emphasis. Do not promote it to the primary CTA color |
| Moss Border | `#2d5736` | `--color-moss-border` | Subtle green-tinted border accent for highlighted cards and notification states - keeps the green theme at low intensity |
| Forest Wash | `#1d3a24` | `--color-forest-wash` | Tinted card background for highlighted/featured panels - dark green surface that sets apart spotlighted content |
| Fern Ground | `#1b2a1e` | `--color-fern-ground` | Tinted highlight surface for featured/active cards and tag backgrounds. Do not promote it to the primary CTA color |
| Link Blue | `#70b8ff` | `--color-link-blue` | Blue supporting accent for decorative details and low-frequency emphasis. Do not promote it to the primary CTA color |
| Lilac Accent | `#baa7ff` | `--color-lilac-accent` | Decorative icon accent and secondary highlight - soft violet for visual variety in feature icons and subtle UI flourishes |
| Plum Edge | `#291f43` | `--color-plum-edge` | Muted violet border tint for tag/label outlines - secondary border color for grouped metadata |
| Iris Border | `#473876` | `--color-iris-border` | Mid-violet link and body accent - used for inline code links and grouped label borders |
| Lavender Mist | `#e2ddfe` | `--color-lavender-mist` | Pale lavender text accent for highlighted inline labels and decorative typography touches |
| Carbon | `#04040b` | `--color-carbon` | Page canvas - the base near-black that everything sits on |
| Graphite | `#121113` | `--color-graphite` | First surface lift - card backgrounds, nav header surface, elevated panels |
| Obsidian | `#1a191b` | `--color-obsidian` | Second surface lift - nested cards, secondary panels, footer surface |
| Slate | `#232225` | `--color-slate` | Supporting neutral for secondary UI, dividers, and muted labels. Do not promote it to the primary CTA color |
| Basalt | `#2b292d` | `--color-basalt` | Borders and dividers - the primary hairline color separating surfaces and defining card edges |
| Iron | `#323035` | `--color-iron` | Supporting neutral for secondary UI, dividers, and muted labels. Do not promote it to the primary CTA color |
| Pewter | `#3c393f` | `--color-pewter` | Supporting neutral for secondary UI, dividers, and muted labels. Do not promote it to the primary CTA color |
| Steel | `#49474e` | `--color-steel` | Mid-gray borders and muted icon strokes - subtle structural lines |
| Fog | `#7c7a85` | `--color-fog` | Muted body text, footer text, nav inactive items, secondary copy |
| Silver | `#b5b2bc` | `--color-silver` | Secondary text, placeholder text, button text on dark fills, icon outlines |
| Ash | `#eeeef0` | `--color-ash` | Primary body text - the brightest text, high-contrast off-white for reading copy |
| Chalk | `#e5e5e5` | `--color-chalk` | Headings and display type - a slightly softer neutral white, chosen for style rather than brightness |

## Tokens - Typography

### Red Hat Display Variable - Display and heading type - used at 48-60px for hero headlines with weight 700, at 36px for section headings with weight 600. The negative tracking at display sizes (-0.025em) tightens the letterforms for a compressed, industrial look. Weight drops to 400-500 for subheadings and feature card titles. Substitute: Inter, Space Grotesk · `--font-red-hat-display-variable`
- **Substitute:** Inter, Space Grotesk
- **Weights:** 400, 500, 600, 700
- **Sizes:** 14, 16, 18, 20, 36, 48, 60
- **Line height:** 1.00, 1.11, 1.38, 1.40, 1.50
- **Letter spacing:** -0.0250em at display sizes (36-60px), 0 at body sizes
- **Role:** Display and heading type - used at 48-60px for hero headlines with weight 700, at 36px for section headings with weight 600. The negative tracking at display sizes (-0.025em) tightens the letterforms for a compressed, industrial look. Weight drops to 400-500 for subheadings and feature card titles. Substitute: Inter, Space Grotesk

### Red Hat Text Variable - Body and UI text - the workhorse family for paragraphs, nav items, button labels, and all functional text. The positive tracking (0.025em) at all sizes is a signature choice: body copy breathes with slightly loosened letterspacing, which gives the dense dark UI an airy, readable quality. Weight 500-600 for emphasis, 400 for default body. Substitute: Inter, IBM Plex Sans · `--font-red-hat-text-variable`
- **Substitute:** Inter, IBM Plex Sans
- **Weights:** 400, 500, 600, 700
- **Sizes:** 10, 12, 14, 15, 16, 18, 20
- **Line height:** 1.00, 1.33, 1.40, 1.43, 1.50, 1.56, 1.63
- **Letter spacing:** 0.0250em across all sizes
- **Role:** Body and UI text - the workhorse family for paragraphs, nav items, button labels, and all functional text. The positive tracking (0.025em) at all sizes is a signature choice: body copy breathes with slightly loosened letterspacing, which gives the dense dark UI an airy, readable quality. Weight 500-600 for emphasis, 400 for default body. Substitute: Inter, IBM Plex Sans

### Red Hat Mono Variable - Code snippets, terminal-style labels, build status indicators - the monospace voice for developer-context content. Appears in the CI workflow comparison section for job names like 'Job picked up', 'Install dependencies'. Substitute: JetBrains Mono, IBM Plex Mono · `--font-red-hat-mono-variable`
- **Substitute:** JetBrains Mono, IBM Plex Mono
- **Weights:** 400
- **Sizes:** 14, 18
- **Line height:** 1.43, 1.56
- **Letter spacing:** normal
- **Role:** Code snippets, terminal-style labels, build status indicators - the monospace voice for developer-context content. Appears in the CI workflow comparison section for job names like 'Job picked up', 'Install dependencies'. Substitute: JetBrains Mono, IBM Plex Mono

### Type Scale

| Role | Family | Weight | Size | Line Height | Letter Spacing | Token |
|------|--------|--------|------|-------------|----------------|-------|
| caption | Red Hat Text | 500 | 12px | 1.5 | 0.025em | `--text-caption` |
| body-sm | Red Hat Text | 400 | 14px | 1.43 | 0.025em | `--text-body-sm` |
| body | Red Hat Text | 400 | 16px | 1.5 | 0.025em | `--text-body` |
| subheading | Red Hat Text or Display | 500 | 18px | 1.56 | 0.025em | `--text-subheading` |
| heading-sm | Red Hat Display | 600 | 20px | 1.4 | 0.025em | `--text-heading-sm` |
| heading | Red Hat Display | 600 | 36px | 1.11 | -0.025em | `--text-heading` |
| heading-lg | Red Hat Display | 700 | 48px | 1.11 | -0.025em | `--text-heading-lg` |
| display | Red Hat Display | 700 | 60px | 1 | -0.025em | `--text-display` |

Each `text-*` class sets size, line height, and letter spacing together (see `theme.css`).

## Tokens - Spacing & Shapes

**Base unit:** 4px (Tailwind's default spacing scale; common values are 8, 16, 24, 32, 48, 64px)

**Density:** comfortable

### Border Radius

| Element | Value |
|---------|-------|
| nav | 2px |
| tags | 2px |
| cards | 6px |
| icons | 2px |
| inputs | 6px |
| buttons | 6px |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| subtle | `rgba(255, 255, 255, 0.06) 0px 1px 0px 0px inset` | `--shadow-subtle` |

### Motion

Smooth and quiet: things fade and slide a few pixels, never bounce or overshoot.
The tokens live in `theme.css`, and the helpers live in `src/components/motion/`.

| Name | Value | Use |
|------|-------|-----|
| `--motion-fast` | 120ms | Hover colors, borders, tooltips, arrow nudges |
| `--motion-base` | 200ms | Menus, indicators sliding between tabs, row reordering |
| `--motion-slow` | 400ms | Page and section entrances, the disclaimer strip |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | State changes |

- Animate only `transform`, `opacity`, `color`, and `border-color`; never width, height, or layout properties.
- Entrances fade up 8px. Pages stagger their blocks 40ms apart, and stop staggering after the sixth.
- Hover lifts a border from Basalt to Pewter, and a card's surface one step up the ladder. Nothing moves except a 2px arrow nudge, and buttons scale to 0.98 when pressed.
- Signal Green may appear in motion only as a small, transient accent, such as the hero spotlight.
- With `prefers-reduced-motion`, only short opacity fades remain: no transforms, counters, or drifting.

### Layout

- **Page max-width:** 1200px
- **Section gap:** 64px
- **Card padding:** 24px
- **Element gap:** 16px

## Components

### Primary CTA Button
**Role:** The only filled button on the page - drives sign-up and trial starts

Filled with Signal Green (#71d083), border in LED Green (#366740) at 1px, text in Carbon (#04040b) weight 500, 6px radius, 10px 20px padding. Small font size (14px) with 0.025em tracking from Red Hat Text. The dark text on bright green creates maximum contrast - the button glows against the dark canvas.

### Ghost/Outline Button
**Role:** Secondary action - 'Talk to a human', alternative paths

Transparent background, 1px border in Basalt (#2b292d), text in Ash (#eeeef0) weight 500, 6px radius, 10px 20px padding. On hover the border lightens to Pewter (#3c393f). Same size and typography as the primary button so they pair evenly.

### Navigation Button (Inactive)
**Role:** Sign in and utility nav buttons in the header

Subtle dark fill in Obsidian (#1a191b), 1px border in Basalt (#2b292d), text in Ash (#eeeef0) at 14px weight 500, 6px radius, 8px 16px padding. Barely visible - designed to recede so the CTA 'Get started' dominates.

### Bottom Disclaimer Strip
**Role:** The one disclaimer in TaxBack ("Concept demo - not tax advice"), fixed to the bottom of the viewport

Slim full-width strip in Carbon (#04040b) with a 1px top border in Moss Border (#2d5736), 12px Red Hat Text in the muted text token, and a small close icon. Dismissal is remembered. It sits above the phone bottom nav, and pages reserve its height so it never covers content.

### Top Notification Banner
**Role:** Site-wide announcement bar (e.g. new product launches)

Full-bleed strip in Carbon (#04040b) with a 1px bottom border in Moss Border (#2d5736). Text at 13-14px in Ash with a sparkle emoji prefix. Links within are in Link Blue (#70b8ff). Height ~40px, centered content.

### Feature Card
**Role:** Product capability cards (Depot CI, Container Builds, GitHub Actions)

Background in Graphite (#121113), 1px border in Basalt (#2b292d), 6px radius, 24px padding. Top label in uppercase caption text (12px, letter-spacing 0.025em, weight 500) in Signal Green for the active/featured card or Fog gray for secondary. Title in Chalk at 18-20px weight 600. Content body in Silver at 14-15px. The active card may have a Moss Border (#2d5736) outline instead of Basalt.

### CI Workflow Comparison Panel
**Role:** Side-by-side build log comparison (GitHub Actions vs Depot CI)

Dark container in Graphite (#121113) with 1px border in Basalt, 6px radius. Header bar in Obsidian with a section label in Red Hat Mono 14px. Each workflow column separated by a 1px hairline in Iron (#323035). Job rows use Red Hat Mono for job names, Silver for status text, and Signal Green or Fog for status indicators (pending/success).

### Customer Logo Grid
**Role:** Social proof - company logos in a 5-column grid

Logos rendered in Chalk (#e5e5e5) or Silver (#b5b2bc) against the Carbon canvas, each in a grid cell of roughly equal width. Cell separators are 1px hairlines in Basalt (#2b292d) or transparent. Logos sit at their natural proportions, vertically centered. No card containers - the grid is flat.

### Section Header
**Role:** Slogan headlines and section titles

Display type in Red Hat Display weight 700, sizes 48-60px, letter-spacing -0.025em (-1.2px to -1.5px), line-height 1.0-1.11. Text in Chalk (#e5e5e5). No eyebrow text or subtitle decoration - the headline stands alone with maximum impact.

### Inline Link
**Role:** Text links within paragraphs and feature descriptions

Link Blue (#70b8ff) text at body size (16px), weight 400-500, no underline by default. May include a subtle arrow character (→, a UI glyph, not a dash). Within code/mono contexts, appears in Iris Border (#473876) or Lilac Accent (#baa7ff).

### Tag/Label
**Role:** Category labels, status badges, metadata pills

Small uppercase text in Red Hat Text 12px weight 500, letter-spacing 0.025em. Background in Fern Ground (#1b2a1e) or transparent, 1px border in Moss Border (#2d5736) or Plum Edge (#291f43), 2px radius, 4px 8px padding. Text in Signal Green or Lavender Mist depending on tag type.

### Nav Menu Item
**Role:** Primary navigation links in the header

Red Hat Text 14px weight 500 in Ash (#eeeef0), no background by default. Active/hover state may show a subtle dropdown indicator (chevron). Dropdown menus appear as dark panels in Graphite with Basalt borders, 6px radius.

### Status Indicator
**Role:** Build status dots and system state indicators

Small 6-8px circles in Signal Green (#71d083) for success/active, Fog (#7c7a85) for pending, or the negative color (#e5675c) for error states. Used inline with Red Hat Mono text in the CI workflow panel.

## Do's and Don'ts

### Do
- Use Signal Green (#71d083) as the fill of the one primary CTA per screen - it is the only element that should demand visual attention. Small status signals (dots, featured labels, tags) and gain text may also use it
- Maintain the tri-typographic system: Red Hat Display for headlines, Red Hat Text for body, Red Hat Mono for code/status - never substitute one for another
- Apply -0.025em letter-spacing to all display sizes (36px+) and +0.025em to all body sizes (10-20px) - the tracking contrast defines the typographic personality
- Stack surfaces using the four-level neutral ladder: Carbon (#04040b) -> Graphite (#121113) -> Obsidian (#1a191b) -> Slate (#232225), each with a 1px border in Basalt (#2b292d). Fern Ground (#1b2a1e) is a separate tinted highlight surface
- Use 6px radius for buttons and cards, 2px for tags and nav items - the small radii are a defining geometric choice, not an oversight
- Separate sections with 1px hairline borders in Basalt (#2b292d) rather than spacing alone - the hairlines create the developer-console feel
- Keep shadows off entirely - use the inset white highlight (rgba(255,255,255,0.06) 0px 1px 0px 0px inset) for surface edge definition instead of drop shadows

### Don't
- Never use Signal Green (#71d083) for large surfaces, secondary buttons, or decoration - beyond the primary CTA fill, status signals, and gain text, dilute it through the green scale (#366740, #2d5736, #1d3a24, #1b2a1e)
- Never apply drop shadows - the design system deliberately relies on hairline borders and surface level changes, not elevation shadows
- Never use a border radius above 6px - the system uses only 2px and 6px. Large pill shapes or rounded cards break the identity
- Never mix the letter-spacing direction - body text always has positive tracking (+0.025em) and display text always has negative tracking (-0.025em). Never flatten both to normal
- Never use Link Blue (#70b8ff) for buttons or CTAs - it is reserved for inline reading links only. Action elements must be green or neutral
- Never introduce a new accent color without strong reason - the system is built on green dominance with blue for links and violet for tertiary decoration. Adding a fourth chromatic breaks the 3-color identity
- Never use pure white (#ffffff) for text - always use Chalk (#e5e5e5) or Ash (#eeeef0) for the slight warmth and reduced contrast burn

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Carbon Canvas | `#04040b` | Page background - the deepest near-black that all content sits on |
| 1 | Graphite Card | `#121113` | First elevated surface - feature cards, content panels, nav dropdowns |
| 2 | Obsidian Panel | `#1a191b` | Secondary surface - nested panels, section dividers, footer surface |
| 3 | Slate Interactive | `#232225` | Interactive surfaces - button fills, input fields, hover states |
| Highlight | Fern Ground | `#1b2a1e` | Tinted highlight surface (outside the neutral ladder) - featured/active card backgrounds with green identity |

## Elevation

The design system intentionally avoids drop shadows. Elevation is communicated through three techniques only: (1) a four-level surface stack where each level is 3-8% lighter than the previous, (2) 1px hairline borders in Basalt (#2b292d) defining surface edges, and (3) a single inset top highlight (rgba(255,255,255,0.06) 0px 1px 0px 0px inset) on select elements to suggest a light source from above. This creates the feel of a flat dark terminal rather than a skeuomorphic card system.

## Imagery

Imagery is minimal and product-focused. The site relies on UI screenshots and terminal-style code blocks rather than photography or illustration. The CI workflow comparison panel is the key visual asset - it shows real build log data in a side-by-side format, making the product the hero. Customer logos appear as flat monochrome wordmarks in Chalk/Silver on the dark canvas, arranged in a clean 5-column grid with hairline dividers. No decorative photography, no lifestyle imagery, no 3D renders. Icons are thin-stroke and minimal, using Signal Green, Lilac Accent, or Silver. The overall visual density is text-dominant with product UI screenshots doing the heavy visual lifting.

## Layout

Full-width sections with content constrained to a ~1200px max-width centered container. The hero is left-aligned text with no hero image - the headline 'Build faster. Waste less time.' anchors the left side with CTAs below, letting the product comparison panel sit directly underneath as the visual proof. Section rhythm is defined by generous 64px vertical gaps between major sections, with each section flowing seamlessly into the next on the same Carbon canvas (no alternating dark/light bands). Feature cards appear in a 3-column grid for the capability highlights, then the CI workflow panel spans full width for the product demo. The customer logo section uses a flat 5-column grid with vertical and horizontal hairline dividers creating individual cells. Navigation is a sticky top bar with the logo left, menu center, and auth buttons right. The overall density is comfortable - sections breathe, but the dark surface and tight radii prevent it from feeling sparse.

## Agent Prompt Guide

Primary action: Signal Green (#71d083) fill with Carbon (#04040b) text, one per screen.

## Quick Color Reference

- **Background (canvas)**: #04040b (Carbon)
- **Card surface**: #121113 (Graphite)
- **Border/hairline**: #2b292d (Basalt)
- **Primary text**: #e5e5e5 (Chalk) for headings, #eeeef0 (Ash) for body
- **Muted text**: #7c7a85 (Fog)
- **Accent/brand**: #71d083 (Signal Green)
- **Primary CTA fill**: #71d083 (Signal Green), text #04040b (Carbon)
- **Link**: #70b8ff (Link Blue)

## Example Component Prompts

1. **Feature Card**: Graphite (#121113) background, 1px Basalt (#2b292d) border, 6px radius, 24px padding. Top label in uppercase 12px Red Hat Text weight 500, letter-spacing 0.3px, color Signal Green. Title at 20px Red Hat Display weight 600, color Chalk. Body at 14px Red Hat Text weight 400, color Silver, line-height 1.43.

2. **CI Workflow Panel**: Graphite (#121113) background, 1px Basalt border, 6px radius. Header bar in Obsidian (#1a191b) with 'CI WORKFLOW' label in Red Hat Mono 14px uppercase. Two columns separated by 1px Iron (#323035) hairline. Job rows: Red Hat Mono 14px for job names in Ash, status text in Silver, Signal Green dots for completed, Fog dots for pending.

3. **Customer Logo Grid**: 5-column grid on Carbon canvas. Each cell has 1px Basalt border on right and bottom. Logos rendered in Chalk (#e5e5e5) at natural size, vertically centered. No card backgrounds - the grid cells are transparent. Section padding 64px vertical.

4. **Tag/Label**: 2px radius, 1px Moss Border (#2d5736) border, Fern Ground (#1b2a1e) background, 4px 8px padding. Text in Red Hat Text 12px weight 500, uppercase, letter-spacing 0.3px, color Signal Green.

## Typographic Tracking Philosophy

The system uses a distinctive two-direction tracking approach that creates typographic contrast: body text (10-20px) runs at +0.025em (positive tracking) which gives the dense dark UI an airy, readable quality - letters breathe slightly apart. Display text (36px+) runs at -0.025em (negative tracking) which tightens headlines into a compressed, industrial block. This inversion is the opposite of most design systems and is a signature Depot choice. Never flatten both to normal tracking - the contrast between open body and tight display is what makes the typography feel intentional rather than default.

## Similar Brands

- **Vercel** - Same near-black canvas with hairline border separation, single accent color driving CTAs, and developer-focused minimalism with generous section spacing
- **Linear** - Dark-mode developer product UI with precise small radii (4-8px), a vivid single-color accent system, and ultra-precise hairline borders replacing shadows
- **Railway** - Infrastructure-tool aesthetic with dark surface stack, green/terminal-inspired accent color, and monospace text in feature comparisons
- **PlanetScale** - Dark developer-database marketing with restrained single-accent approach, left-aligned hero without imagery, and terminal-style product screenshots as social proof
- **Fly.io** - Dark-mode infrastructure branding with monospace UI elements, flat logo grid for customers, and developer-console visual language

## Quick Start

All tokens (palette, fonts, type scale, radius, shadow, and the light/dark semantic colors) live in `theme.css`.
Import it after `@import "tailwindcss";` in `src/app/globals.css`.
Do not copy token values into this document, so the two cannot drift apart.
