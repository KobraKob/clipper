# Chop Shop visual system

## Identity

Chop Shop uses a high-contrast cut-room language: near-black surfaces, warm white typography, Fire Red for emphasis, and Electric Yellow for primary actions. It avoids gradients, glass effects, decorative noise, fake metrics, and empty promotional cards.

## Color tokens

| Token | Value | Use |
|---|---|---|
| Paper | `#090909` | App background |
| Ink | `#F5F2E9` | Primary text |
| Muted | `#AAA69C` | Supporting text and metadata |
| Panel | `#141413` | Main cards and working surfaces |
| Panel raised | `#1D1C1A` | Nested panels and selected surfaces |
| Panel inset | `#080808` | Inputs, preview areas, code/log surfaces |
| Fire Red | `#E62727` | Brand emphasis, section markers, error identity |
| Electric Yellow | `#FFDE00` | Primary actions, active selection, focus emphasis |
| Line | `rgba(245, 242, 233, .13)` | Dividers and quiet borders |

Use red and yellow as functional accents, not as full-page backgrounds. Keep status colors meaningful: success, warning, and failure remain distinguishable.

## Typography

- Display: self-hosted Barlow Condensed, weights 600/700/800.
- Interface: self-hosted Figtree variable font.
- Large display text is uppercase, tight, and deliberately short.
- Body text uses readable line height and restrained tracking.
- Numbers and progress values should use tabular numerals where available.

No third-party font requests are required.

## Layout and spacing

- Primary hero: 1.618:1 column ratio, with copy taking the wider column and portrait the narrower column.
- Studio section: approximately 1.618:1 for source form and utility navigation.
- Page headings: eyebrow, title, concise explanation, then page actions.
- Spacing steps: 5, 8, 13, 21, 34, 55, 89 px.
- Keep form controls close to their labels and actions. Keep destructive actions visually separate from primary actions.
- Use a responsive single-column layout on narrow screens; retain touch-friendly controls and horizontal navigation where appropriate.

Golden-ratio proportions are a layout guide, not a reason to force asymmetry into dense data tables or forms.

## Screen structure

- **Home:** portrait-led hero, source ingestion form, eight real pipeline stages, and direct routes to library/calendar.
- **Library:** clear project heading, existing search/filter/sort controls, batch uploader, and project cards.
- **Job workspace:** existing processing state, clip review, editing, metadata, and export controls inside the shared page shell.
- **Calendar:** existing month/week/queue views, filters, inspector, and scheduling form.
- **Shared shell:** persistent navigation to Create, Process, Library, and Calendar.

## Interaction and accessibility

- All navigation uses real route links.
- All actions remain wired to existing handlers and APIs.
- Inputs retain labels and keyboard access.
- Focus indicators use Electric Yellow with offset.
- Status and progress messages retain live-region semantics.
- Reduced-motion preference disables nonessential transitions.
- Do not replace real loading, empty, failure, or success states with decorative mock content.

## Asset handling

The founder portrait is stored at `web/public/images/founder-portrait.webp`, optimized for the hero display. The original uploaded portrait is not modified in the user's files.
