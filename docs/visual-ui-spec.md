# Visual UI specification: Gym Floor Focus

Status: Proposed  
Product: Weekly Practice Log  
Platform: responsive web app, mobile primary  
Source reviewed: `main` at `a25d7f658a8e9b8af57d7c47f360f29945ecb57e`

## 1. Context and traceability

Weekly Practice Log is a private, local-first training journal for a recurring six-day program. Its primary user is an athlete moving through a workout on a phone, often between sets, with limited attention and one-handed input. The primary task is to record weight, reps, and RPE quickly while seeing the last relevant performance. Weekly review, routine editing, history, export, and backup remain available but are secondary during a live session.

The existing information architecture, exercise order, URL-based day selection, local persistence, live timer, dialogs, Ocean Sunset palette, Inter typography, 44px targets, focus behavior, and reduced-motion support are authoritative and remain intact.

### Design pressures

| Pressure | Priority | Design response |
| --- | --- | --- |
| Fast set entry with limited attention | High | Give the current exercise and set grid the strongest local hierarchy; keep labels aligned and numeric fields visually distinct. |
| One-handed mobile use | High | Keep primary workout controls within easy reach, preserve 44px targets, and place destructive actions away from common forward actions. |
| Repeated dense data | High | Use shared baselines, tabular numerals, restrained separators, and fewer competing card surfaces. |
| Clear workout state | High | Make elapsed/rest state persistent and visually distinct; use text and icon cues in addition to color. |
| Prior performance at decision time | Medium | Present the previous result as a compact comparison strip immediately above set entry. |
| Routine management and data ownership | Medium | Group utility actions under one clearly labeled menu outside the active logging path. |
| Brand expression | Low | Retain Ocean Sunset as a restrained semantic accent system. |

## 2. Direction and platform

**Platform system:** web native with iOS-inspired ergonomics. This does not claim native iOS compliance.

**Primary direction:** utilitarian.  
**Supporting qualities:** data-dense and premium.

The interface should feel calm, precise, and athletic. “Premium” comes from alignment, restraint, typography, and responsive feedback. Color is reserved for state and action. Decoration never competes with the workout.

Selected principles: hierarchy, density, alignment, consistency, feedback, ergonomics, progressive disclosure, and responsive adaptation.

## 3. Foundations

### Typography

Continue using Inter with tabular numerals for training data.

| Role | Mobile | Desktop | Weight | Use |
| --- | --- | --- | --- | --- |
| Display | 28/32 | 32/36 | 750 | Active day or timer |
| Title | 20/26 | 22/28 | 700 | Exercise name |
| Section | 15/20 | 16/22 | 700 | Weekly progress, dialog titles |
| Body | 14/20 | 15/22 | 450 | Instructions and descriptions |
| Data | 17/22 | 17/22 | 650 | Weight, reps, RPE inputs |
| Label | 11/14 | 12/16 | 650 | Columns, chips, metadata |

Use sentence case. Keep uppercasing limited to short column headings. Do not use text below 11px for meaningful visible content.

### Color roles

The existing Ocean Sunset palette remains the source of truth.

| Semantic role | Token |
| --- | --- |
| Primary text / strongest surface | `ocean-deep #2F4858` |
| Primary action / focus / selected | `ocean-blue #33658A` |
| Completed / calm live state | `ocean-mist #86BBB8` |
| Attention / rest completion / milestone | `sun-gold #F6AE2D` |
| Destructive / error / irreversible warning | `sunset-orange #F26419` |
| Page | `surface #F7FAFA` |
| Raised surface | `card #FFFFFF` |
| Secondary text | `muted #536875` |
| Divider | `hairline rgba(47,72,88,.14)` |

Do not use gold or orange as general decoration. Every colored state also needs an icon, label, or structural cue.

### Spacing and shape

Use a 4px base grid with primary steps of 4, 8, 12, 16, 24, and 32px. Keep 16px card radius and 11px control radius. Use full pills only for compact status chips. Main content is capped at 880px; logging columns remain capped at 520px for scanning.

Prefer one parent surface with grouped content over nested cards. Use elevation only for sticky or modal layers:

- Base cards: border plus `0 2px 10px rgba(47,72,88,.05)`.
- Sticky live layer: `0 8px 24px rgba(47,72,88,.10)`.
- Dialogs: `0 24px 60px rgba(47,72,88,.18)`.

### Iconography

Continue using Lucide at 18–20px with a consistent 1.75–2px stroke. Pair unfamiliar icons with visible labels. Icons must not replace text for Finish workout, Start workout, Backup and restore, or destructive actions.

### Motion

Use 150ms for color and control feedback and 200ms for sheets or disclosure. Completion may use a single scale/fade no longer than 240ms. Never animate the set grid position while a numeric keyboard is open. Respect `prefers-reduced-motion`.

## 4. Components

### App header

Show product name and the current week. Place History, Routine, Export, and Backup and restore inside a single “Tools” menu on mobile. On desktop, History and Routine may remain visible while export and backup stay grouped. Save state remains a quiet text status and must never shift surrounding controls.

### Weekly progress rail

Keep the six days as navigation. On mobile, use a horizontally scrollable rail with one compact item per day rather than a 3×2 grid. Each item shows short day label, workout name, and completion icon. The active item uses a 2px blue indicator plus `aria-current`; completion uses a filled check. On desktop, show all six in one row.

This lowers vertical cost and lets the workout begin above the fold. Long custom names truncate visually but remain available through accessible names.

### Day hero

Combine active day name, muscle focus, completion state, and Start workout into one section. Start workout is the sole filled primary button before a session begins. “Mark complete” is a secondary action until a live session finishes it automatically.

### Live session dock

Use a sticky compact dock below the viewport header. Default row: state label, elapsed time, Pause/Resume, and Finish. During rest, expand a second row with the rest countdown, +30s, and Skip. Rest completion changes the label to “Rest done · Next set” and uses gold edge/background plus the Timer icon. At widths below 380px, Finish remains full label and lower-priority controls wrap below it.

### Exercise section

Treat each exercise as a clear section on one continuous workout surface. Anatomy:

1. Exercise number and editable name
2. Muscle group, unilateral, and substitution chips
3. Prior-performance strip
4. Column headings
5. Set rows
6. Inline actions

Only the active/focused exercise receives a blue 2px leading edge and a slightly raised surface. Other sections use a hairline separator. This reduces the stacked-card effect while retaining grouping.

Editable names need a visible edit affordance. Show the future-template consequence after edit or while focused, rather than as persistent paragraph text.

### Prior-performance strip

Use a tinted mist strip directly above the set grid:

- Label: “Last time”
- Primary value: first-set summary
- Secondary value: date/week and set count
- Action: Repeat last

Keep the prior note on a second line only when present. Empty state: “First entry for this exercise” with no disabled action.

### Set grid

Preserve the table model and labels. Increase entered data to the Data type role. Empty inputs remain white; a complete set uses a subtle mist tint and a visible check at the row edge. Focus uses the global 3px blue outline and must not be clipped.

Use one remove control per set. It stays quiet until hover/focus; on touch it remains visible. Require confirmation only when the row contains logged data. Empty new rows may be removed immediately.

For unilateral exercises, use a single bordered group with explicit “Left” and “Right” row labels rather than “1L” and “R”. Keep weight, reps, and RPE columns aligned across both rows.

Keyboard behavior stays: Enter advances across fields and creates/focuses the next row after the final field.

### Exercise actions

Order actions by frequency:

1. Add set
2. Repeat last, when available
3. Substitute
4. Undo swap, when relevant

Use Add set as a bordered button. Present Substitute and Undo swap in a compact overflow menu on screens below 380px. Every action retains a 44px target.

### Dialogs and sheets

Retain bottom sheets on mobile and centered dialogs on desktop. Use a persistent title, concise description, close control, and a sticky action footer for long content. Destructive restore confirmation must name the file and use orange only for the final destructive action. Focus trap, Escape close, and opener restoration remain required.

## 5. Screen application

### Ready state

The first mobile viewport should contain the compact header, weekly rail, active day hero, and the beginning of the first exercise. The dominant action is Start workout. Utilities are grouped under Tools.

### Active workout

The live session dock replaces Start workout. The first incomplete set of the current exercise becomes the visual focus. Completing a row adds a check and starts rest without moving focus unexpectedly.

### Completed day

The hero displays a check and “Workout complete.” The primary action becomes “Review workout.” Reopening or editing logged data remains possible and autosaves.

### Empty, loading, error, and offline

| State | Treatment |
| --- | --- |
| Hydrating | Skeleton preserves header, progress rail, and first exercise geometry. |
| No prior entry | Compact “First entry for this exercise” strip. |
| Save in progress | Quiet “Saving…” text with no spinner-induced layout shift. |
| Save error | Persistent inline banner near the header with Retry and Backup actions; logging remains available. |
| IndexedDB fallback | One dismissible notice explaining that storage is limited on this browser. |
| Export with no data | Non-blocking status announcement; do not create a blank download. |
| Invalid restore | Error stays inside the sheet, close to the file control. |
| Successful restore | Confirmation state names the restored backup date and offers Done. |
| Disabled | Reduced emphasis plus semantic `disabled`; never opacity alone for meaning. |

## 6. Responsive behavior

- **320–379px:** horizontal day rail; utility menu; compact exercise actions; 12px page gutters; set grid retains all columns.
- **380–639px:** 16px gutters; Repeat last can remain inline; live controls wrap only when needed.
- **640–899px:** all six days visible; 20px gutters; dialogs center when content permits.
- **900px and above:** 880px centered log; utilities can expand; set data remains capped at 520px to avoid wide scanning.

At 200% browser zoom, controls and content reflow without horizontal page scrolling. A local horizontal scroll area is allowed only for the day rail.

## 7. Accessibility and validation

Acceptance checks:

- All text and meaningful UI meet WCAG 2.2 AA contrast.
- Keyboard order follows visual order; every control has a visible focus indicator.
- Touch targets are at least 44×44px with adequate separation.
- Completion, selection, save, timer, error, and destructive states never rely on color alone.
- Numeric inputs expose exercise, set number, side when relevant, and field in their accessible name.
- Dynamic save and completion messages use appropriate live regions without announcing timer ticks.
- Sheets and dialogs trap focus, close with Escape, and restore focus.
- Text scaling and long custom names do not clip actions.
- Reduced motion removes nonessential movement.
- Validate at 320px, 390px, 768px, 1280px, 200% zoom, keyboard only, and with an automated axe scan.

## 8. Implementation sequence

1. Establish semantic tokens for typography, elevation, spacing, status, and control variants.
2. Compact the header and replace the weekly grid with the responsive progress rail.
3. Introduce the day hero and revise the live session dock hierarchy.
4. Refactor exercise sections, prior-performance strips, and unilateral row labels.
5. Group secondary utilities and responsive exercise actions.
6. Add the complete-set treatment and logged-row removal confirmation.
7. Verify every state and breakpoint against the existing browser flow before merging.

No data model or workout behavior change is required for the visual system. The only interaction changes are utility grouping, responsive action grouping, clearer logged-row deletion recovery, and explicit active-exercise emphasis.
