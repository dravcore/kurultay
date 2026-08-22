# Design

The visual and interaction language of the Kurul web app: principles, tokens, layout, motion, states, and copy.

> 🌐 English (canonical) | [Türkçe](tr/design.md)

## Contents

- [1. Design principles](#1-design-principles)
- [2. Identity](#2-identity)
- [3. Design tokens](#3-design-tokens)
- [4. Layout and density](#4-layout-and-density)
- [5. Interaction patterns](#5-interaction-patterns)
- [6. States](#6-states)
- [7. UI writing](#7-ui-writing)
- [8. Charts and dashboard](#8-charts-and-dashboard)
- [9. Accessibility](#9-accessibility)
- [10. Cross-references](#10-cross-references)

> **Status.** Colour, type, and spacing tokens below are **validated in product**
> (`apps/web/app/globals.css`). Interaction patterns that are still aspirational are called
> out inline; do not treat every sentence as shipped behaviour.

## 1. Design principles

1. **Density with breathing room.** A board is a working surface. Rows are compact and the air
   goes _between_ groups, never inside them — 36px rows, 300px columns, four cards on a
   laptop. Not Trello-airy, not Jira-cramped.
2. **Keyboard-first, pointer-equal.** Every interaction has a keyboard path, drag and drop
   included. Focus is always visible and never trapped where it does not belong.
3. **One signature, quiet surroundings.** Exactly one element carries the identity (§2);
   everything else is disciplined neutrals. What does not help someone find, move, or decide
   about work gets cut.
4. **Both themes are first-class.** Dark is _selected_, not derived. Every color goes through
   a token; a raw hex in a component is a defect ([coding-standards.md](coding-standards.md#styling)).
5. **States are direction, not mood.** Empty screens invite an action, errors say what
   happened and what to do next, loading looks like the thing that is loading.
6. **Strings are design material.** Copy is designed like spacing, written from the user's
   side of the screen, and ships through the i18n layer from day one (§7).

## 2. Identity

Kurul is named for the council that convenes, decides, and divides the work — and, until
v0.2.0, for the _kurultay_ that gave the project its first name: the grand assembly where
clans gather, banners are planted, matters are decided. The identity still comes from _that_
world — banner (_sancak_), seal (_damga_), steppe — not from generic productivity-tool
language. The name got shorter; the visual language did not change.

**Signature element — the sancak rail:** a 2px copper rule on the leading edge of whatever is
currently in play (active sidebar item, focused column, selected card, the open panel's
leading edge, the insertion point during a drag). It is the only place the signature color
appears at full strength in the app chrome, and it _moves_, sliding between positions rather
than blinking. Chosen over a colored header or tinted background because it costs no layout,
survives at 36px row height, reads instantly in a dense column — and is literally the banner
planted where the assembly is meeting.

| Signature copper may appear                          | Must not appear                                    |
| ---------------------------------------------------- | -------------------------------------------------- |
| The sancak rail (active / selected / drop target)    | Page or section backgrounds, headers, hero washes  |
| Primary action buttons — at most one per view        | Secondary and tertiary buttons                     |
| Focus ring, selection ring, meter and progress fills | Card borders, dividers, table headers              |
| Links inside body copy                               | Labels, priority badges, status badges, avatars    |
| Wordmark and empty-state marks                       | Charts, except as the single **emphasis** hue (§8) |

If two copper things are visible at once and neither is a primary action, one is wrong.

| Iconography                                    | Rule                                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark, empty states, auth and marketing art | **Damga-inspired marks** — geometric single-stroke tamga forms on a 24px grid, 1.5px stroke, one per surface, max 96px. Hand-authored SVG; never a product icon. |
| All product UI                                 | **lucide** (ships with shadcn/ui) — 16px in dense rows, 20px in the sidebar, 1.5px stroke, `currentColor` only                                                   |

**Anti-brief.** Deliberately _not_: warm-cream ground with a serif and terracotta accent;
near-black with an acid accent; broadsheet hairlines at zero radius. Kurul's neutrals run
cool green-gray precisely so the warm copper has something to sit against — warm accent on
warm ground is both the current default look and a way to make the accent vanish.

## 3. Design tokens

Proposals for Phase 3, named to the shadcn/ui CSS-variable convention so `components/ui/`
stays unmodified generated output. **Caution:** in shadcn's vocabulary `--primary` is the
brand action color and `--accent` is the subtle hover surface, so Kurul's signature copper
is `--primary` and `--accent` stays a quiet neutral tint. Do not rename shadcn's variables.

### Neutrals and accent

A low-chroma green-gray ("felt") ramp. Light mode's canvas is a step of gray and cards are
white, so elevation reads without shadows.

| Role                                     | Token                          | Light                 | Dark                  |
| ---------------------------------------- | ------------------------------ | --------------------- | --------------------- |
| Canvas                                   | `--background`                 | `#F7F8F7`             | `#0E100F`             |
| Card / panel surface                     | `--card`, `--popover`          | `#FFFFFF`             | `#161918`             |
| Raised surface (hover, drag preview)     | `--muted`                      | `#F1F3F1`             | `#1D2120`             |
| Border · border-strong                   | `--border` · `--border-strong` | `#D6DAD8` · `#B9BFBC` | `#2A2F2D` · `#383E3B` |
| Text, primary                            | `--foreground`                 | `#191C1B`             | `#E8ECEA`             |
| Text, secondary                          | `--foreground-secondary`       | `#545A57`             | `#B3BAB6`             |
| Text, muted                              | `--muted-foreground`           | `#6B726E`             | `#8A928E`             |
| Text, disabled / placeholder             | `--foreground-disabled`        | `#8A918D`             | `#6E7773`             |
| Primary action surface                   | `--primary`                    | `#A85A28`             | `#D98A4E`             |
| Text on primary                          | `--primary-foreground`         | `#FFFFFF`             | `#0E100F`             |
| Rail, focus ring, link                   | `--signature`, `--ring`        | `#A85A28`             | `#D98A4E`             |
| Signature tint (selected row, drop zone) | `--signature-subtle`           | `#F6EDE5`             | `#241A12`             |

Measured on the card surface — text: light 17.2 / 7.1 / 4.9:1, dark 14.9 / 9.0 / 5.6:1.
Copper: light carries white text at 5.05:1 and reads as text on canvas at 4.74:1; dark carries
ink at 7.00:1 and reads on the dark surface at 6.49:1. All clear AA.

### Semantic scales — status and priority

One reserved severity family serves both, always shipped with an **icon and a word**, never
color alone. Priority is an ordered scalar kept separate from labels; its order is carried by
escalating chroma, so it survives colorblindness, grayscale print, and being described aloud.

| Meaning                        | Priority | Token                                 | Light     | Dark      | Contrast L / D | Icon           |
| ------------------------------ | -------- | ------------------------------------- | --------- | --------- | -------------- | -------------- |
| Neutral / inactive             | `LOW`    | `--priority-low`                      | `#6B726E` | `#8A928E` | 4.9 / 5.6      | `chevron-down` |
| Info                           | `MEDIUM` | `--status-info`, `--priority-medium`  | `#3F6B99` | `#6BA3E8` | 5.6 / 6.8      | `minus`        |
| Good / done                    | —        | `--status-good`                       | `#1F7A4D` | `#3FBF85` | 5.3 / 7.6      | `check`        |
| Warning / due soon             | `HIGH`   | `--status-warning`, `--priority-high` | `#8A5A00` | `#D9A227` | 5.9 / 7.7      | `chevron-up`   |
| Danger / overdue / destructive | `URGENT` | `--status-danger`, `--destructive`    | `#C0281F` | `#F0665C` | 5.9 / 5.7      | `chevrons-up`  |

Priority renders as a full-chroma icon plus text; labels render as a tinted chip with a
colored dot — different weights, so a red priority and a red label never read alike.
`Label.color` stores a **slot name** (`slot-1`…`slot-8`), never a hex, so a label's chip and
its bar in a chart are one identity resolved per theme (§8).

### Typography — proposal

Open-source, self-hostable, complete Latin Extended-A: Turkish (`ı İ ğ ş ç ö ü`) must render
correctly since it is the first translation pack — a requirement that eliminated most of the
fashionable display faces. All three are self-hosted at build time via `next/font/google`
(Next downloads and embeds the files — equivalent to `next/font/local` without committing
binary font assets to the repo).

| Role      | Face                                                       | Where                                                                     | Why this one                                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display   | **Fraunces** (variable, OFL), `WONK 0 SOFT 0`, high `opsz` | Wordmark, auth, marketing, empty-state headlines. Never inside the board. | High-contrast and carved rather than calligraphic — it reads like something stamped into a seal, which is the _damga_ register. Its axes let us dial the quirk to zero and keep only the engraving.                                      |
| Body / UI | **Archivo** (variable, OFL)                                | Everything in the product                                                 | A signage grotesque: tall x-height, economical widths, legible at 12–13px. A board is hundreds of short strings in narrow columns — a signage problem. Chosen over Inter and Geist, which are correct but read as the framework default. |
| Mono      | **JetBrains Mono** (OFL), `0.92em`                         | Ids, shortcuts, code                                                      | Unambiguous `0/O` and `1/l/I` — a UUIDv7 legibility tool, not a style choice                                                                                                                                                             |

| Step                   | Size / line       | Weight    | Use                                                         |
| ---------------------- | ----------------- | --------- | ----------------------------------------------------------- |
| `display`              | 40 / 44           | 600       | One per auth or marketing screen                            |
| `title-lg` · `title`   | 20 / 28 · 16 / 24 | 600       | Page and panel titles · section and dialog titles           |
| `body` · `body-strong` | 13 / 18           | 400 · 550 | **UI baseline** — fields and rows · card titles, active nav |
| `small` · `micro`      | 12 / 16 · 11 / 14 | 400 · 500 | Metadata, timestamps · chips, counts, axis ticks            |

`tabular-nums` on columns of numbers, axis ticks, and table cells — never on a hero figure or
a stat-tile value.

### Spacing, radius, elevation

| System    | Values                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spacing   | `2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 48` — 4px base with a 2px half-step; the half-step is what makes a dense row survive                                                                                                                               |
| Radius    | `sm 4` chips · `md 6` buttons, inputs, cards · `lg 10` panels, dialogs · `full` avatars. Tighter than the shadcn default; large radii read soft and cost usable width.                                                                                       |
| Border    | 1px hairline `--border`; 2px only for the sancak rail and focus rings                                                                                                                                                                                        |
| Elevation | **Borders first, shadows last.** Light depth = white card on gray canvas + hairline; dark depth = a lighter surface step, because shadows do not read on dark and a glow is worse. Real shadows exist in three places only: dialogs, popovers, drag preview. |

## 4. Layout and density

App shell per the `(app)` route group in [architecture.md §4](architecture.md#4-appsweb--structure).

| Region             | Spec                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell height       | Exactly `100dvh`, `overflow: hidden` — never `min-height`. Every page owns its own scroller.                                                                |
| Sidebar            | 240px, workspace switcher pinned at top; collapses to a 56px icon rail below 1280px and on demand; off-canvas below 768px                                   |
| Topbar             | 48px sticky — board name, filter entry, overflow (presence avatars are not shipped yet); **56px below 768px**, where it also carries the navigation trigger |
| Board canvas       | Full-bleed, horizontal scroll; column headers stick on vertical scroll                                                                                      |
| Column             | 300px fixed (280 min / 320 max on wide screens), 12px gap, 40px sticky header with name + count + `⋯` (48px below 768px)                                    |
| Card               | 10px 12px padding, 8px gap, min 56px (title only), typical 72–92px; title clamps at 3 lines so nothing exceeds ~140px                                       |
| Card content order | Priority icon + title · label dots · meta row (due date, estimate, assignees)                                                                               |
| List / table row   | 36px; 44px below 768px                                                                                                                                      |
| Settings and forms | 720px max width — prose is read, not scanned                                                                                                                |
| Touch target       | **44px minimum below 768px**, on every interactive element without exception                                                                                |

**The shell is exactly one viewport tall, and this is load-bearing.** `min-height: 100dvh`
would say "at least" and bound nothing below it — which is what it did, and why a column's
`overflow-y-auto` never clipped: the document grew instead, reaching 27 425px on a 1 000-task
board. Per-column scrolling, the sticky column header and drag autoscroll all depend on the
column having a bounded box, so all three were inert. `100dvh` and not `100vh`: on a phone
`100vh` is the viewport with the browser chrome retracted, so a `vh`-sized shell is taller than
the screen and pushes the topbar under the address bar on first paint. The consequence to
respect when adding a page: **the document does not scroll anywhere in the app**, so a new
route under `(app)` must declare its own `flex-1 overflow-y-auto`, exactly as the dashboard,
settings and notifications pages do.

**Below 768px the sidebar is off-canvas** — a hamburger in the topbar opening the same
`SidebarBody` in a drawer, not a second navigation with its own list of links. The drawer is
the app's `Dialog` primitive docked to the left edge (`DialogDrawerContent`), which is a
deliberate refusal to hand-roll one: the focus trap, `Escape`, returning focus to the trigger,
inerting the page behind and the scroll lock are the whole substance of an off-canvas panel,
and a parallel implementation is a second place for one of them to be missing. It slides at
220ms on `--ease-drawer`, and cross-fades instead under `prefers-reduced-motion`.

**44px, not 40, and keyed on width rather than on pointer type.** 44px is WCAG 2.5.5 (AAA) and
the figure the roadmap holds this layout to. It is keyed on `max-md` — the same breakpoint the
drawer uses — rather than on `pointer: coarse`, so one condition governs the whole mobile
layout instead of two that can disagree; a 360px window on a desktop getting 44px targets costs
nothing. The floor lives in the `Button` and `Input` variants and in the dropdown item classes,
not at the call sites, so there is one list to read. Sizes above the breakpoint are untouched.
It is **measured, not asserted**: `e2e/tests/mobile-navigation.spec.ts` sweeps every button,
link, input and menu item on the board and in the drawer at 360px and fails on any box under
44px in either axis. jsdom lays nothing out, so a unit test cannot make this claim.

**Touch drag is by the grip.** The card body belongs to the column's scroller — the wrapper
carrying dnd-kit's listeners has no `touch-action`, so the browser claims a vertical gesture
there — and the grip declares `touch-action: none`, which is what hands that one 44px region to
dnd-kit instead. This is a division, not a limitation: a column that cannot be scrolled with a
thumb is worse than a card that cannot be dragged from its middle. Both halves are asserted.

**Task detail: a right-side panel, not a modal.** ~480px wide (`min` 420px / `max` 640px via
CSS), **non-modal** — the board stays visible and clickable behind it on desktop. Below the
Tailwind `md` breakpoint (768px) it becomes a fullscreen sheet (`fixed inset-0`). Drag-resize
of the panel width is not implemented; the CSS bounds are fixed. Confirmations, board
creation, and destructive actions stay **dialogs**; those genuinely need to block.

| Why a panel |                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context     | The point of a board is the surrounding cards; a modal deletes them                                                                                                        |
| Flow        | Triage is open → edit → next. A panel keeps the next card one click away instead of a dismiss plus a click.                                                                |
| Realtime    | A card moving under a modal is invisible; behind a panel it is visible                                                                                                     |
| Routing     | Deep-linkable at `board/[boardId]/task/[taskId]` — both soft navigation and a hard load render `BoardView` with the task selected (no Next.js intercepting/`@modal` route) |

## 5. Interaction patterns

| Drag and drop | Rule                                                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lift          | Card scales to `1.02`, tilts `1deg`, takes the one drag shadow; the source leaves a `--muted` ghost at the same height, so the board never reflows mid-drag                                                                         |
| Drop target   | The insertion gap opens to card height and shows the **sancak rail** at its leading edge; the destination column takes a `--signature-subtle` wash. No dashed outlines.                                                             |
| Commit        | Optimistic — the card lands instantly, `PATCH .../tasks/:taskId/position` follows                                                                                                                                                   |
| Failure       | Card animates back to its original position (220ms, `--ease-in-out`) and a toast says what happened with a **Try again** control. Never leave the optimistic state standing.                                                        |
| Keyboard      | `@dnd-kit` `KeyboardSensor` — `Space` lifts, arrows move within and across columns, `Space` drops, `Esc` cancels. Each transition announced via `aria-live="polite"`: "Moved _Fix login redirect_ to In Progress, position 2 of 5." |
| Autoscroll    | Both axes, 24px edge zone                                                                                                                                                                                                           |

| Realtime change        | Surfacing (never a layout jump)                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote create / update | `--signature-subtle` background fading out over 1200ms. No movement, no size change. Color-only, so it survives `prefers-reduced-motion` unchanged. |
| Remote move            | Card animates to its new position over 220ms; during a local drag the update is queued and applied on drop                                          |
| Remote delete          | Fade to 0 over 160ms, then close the gap over 160ms — two beats, so the eye can follow                                                              |
| Presence · disconnect  | Not shipped yet (topbar/card presence). Disconnect: a quiet inline "Reconnecting…" bar, never a blocking overlay                                    |

**Keyboard baseline.** Focus is always visible: 2px `--ring` at 2px offset, and `outline: none`
without a replacement is a review blocker. Tab order follows visual order; the board is a
composite widget, so `Tab` reaches a column and arrows move within it. `Esc` closes the topmost
layer only and returns focus to whatever opened it. Reserved now, mapped in Phase 4+: `⌘K`
command palette, `C` create task, `/` filter, `?` help — nothing else claims a bare letter key.

**Motion.** Purposeful micro-interactions only, **at most one orchestrated moment per view** —
on the board that is the first paint of the columns, and nothing else.

| Case                                                | Duration             | Curve                                                     |
| --------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| Press feedback (`scale(0.97)`) · sancak rail moving | 100–160ms            | `--ease-out`                                              |
| Tooltip, small popover                              | 125–200ms            | `--ease-out`                                              |
| Dropdown, select, menu                              | 150–250ms            | `--ease-out`, `transform-origin: var(--transform-origin)` |
| Detail panel, sheet                                 | 220ms                | `--ease-drawer`                                           |
| Dialog · toast (`translateY(100%)`)                 | 200ms                | `--ease-out`, dialog origin centered                      |
| Card returning after a failed drop                  | 220ms                | `--ease-in-out`                                           |
| Column stagger on first board paint                 | 40ms between columns | `--ease-out`                                              |

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1); /* entering, exiting, default */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1); /* moving on screen */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1); /* panel and sheet */
```

- **No animation on keyboard-initiated actions** — the command palette opens instantly; it runs
  a hundred times a day and motion makes it feel slow.
- **`transform` and `opacity` only** (accordion height excepted). Never `transition: all`, never
  `scale(0)` — enter from `scale(0.96)` + `opacity: 0`. Never `ease-in` on UI: it delays the
  exact moment the user is watching.
- **Transitions, not keyframes**, for anything triggerable twice a second (toasts, toggles, the
  rail) — transitions retarget from the current value, keyframes restart from zero.
- Nothing over 300ms except the panel. Gate hover motion behind `@media (hover: hover) and
(pointer: fine)`. Springs (`{ duration: 0.5, bounce: 0.2 }`) only where a gesture carries
  velocity — drag preview, swipe-to-dismiss.
- **`prefers-reduced-motion: reduce`** drops movement and keeps opacity and color: the panel
  cross-fades, the rail jumps, the highlight is unchanged. Fewer and gentler, not zero.

## 6. States

**Empty states are invitations** — one damga mark and one primary action per screen. They name
the next move; they do not explain the feature. This is the only place damga marks appear.

| Surface               | Mark       | Headline                     | Body                                                                                                  | Action                           |
| --------------------- | ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------- |
| No boards yet         | Damga 96px | No boards yet                | A board is where the work gets divided. Start with one.                                               | Create board                     |
| Board has no columns  | Damga 96px | This board has no columns    | Columns are the stages work moves through. Start with To Do, In Progress, and Done, or name your own. | Add column · Use default columns |
| Empty column          | —          | —                            | 56px dashed drop zone: "Drop a task here"                                                             | Add task                         |
| Filters match nothing | —          | No tasks match these filters | Three filters are active.                                                                             | Clear filters                    |
| Dashboard, no data    | Damga 64px | Nothing to chart yet         | Charts fill in as tasks are created and moved.                                                        | Open a board                     |
| Notifications         | —          | You're caught up             | —                                                                                                     | —                                |

**Loading** uses skeletons that match the final layout in `--muted`, with a 1.6s opacity pulse
(1.0 → 0.6) and no shimmer sweep: the board renders column skeletons at real width with three
card skeletons at real card heights; the task panel opens immediately with the clicked card's
title already in place, so it is never blank; inline actions are optimistic. Spinners exist in
exactly one place — inside a pressed button, 14px, replacing the icon, after 400ms. List
content never gets one. Unknown-length work (import, export) gets a progress bar with a count.

**Errors** derive from the problem-JSON shape in [api-conventions.md](api-conventions.md#errors).
Per that contract the UI **branches on `statusCode` and `error`, never on `message` text** — so
user-facing strings come from the i18n catalog and the API `message` is logged, not shown. Only
`details[]` is surfaced, being field-level and safe. Name the object that failed, give the next
action as a real control, keep it to one sentence, and never print an id, a stack trace, or the
word "Oops".

| Status                         | Surface                                           | Copy                                                                                      |
| ------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `400` / `422` with `details[]` | Inline under each field; focus moves to the first | From `details[].constraint`, mapped to a catalog string: "Title can't be empty"           |
| `401`                          | Redirect to sign-in, keeping the return URL       | Your session ended. Sign in to pick up where you left off.                                |
| `403`                          | Inline on the blocked control                     | You need admin access to change columns. Ask a workspace owner.                           |
| `404` in panel                 | Replaces the panel body                           | This task no longer exists. Someone may have deleted it. → **Back to board**              |
| `409`                          | Dialog over the stale editor                      | Someone changed this task while you were editing. → **Reload** · **Copy my changes**      |
| `429` · `5xx`                  | Toast · error block where the content should be   | Too many requests. Try again in a few seconds. · The board couldn't load. → **Try again** |
| Offline                        | Persistent topbar strip                           | You're offline. Changes won't save until the connection is back.                          |

## 7. UI writing

From the user's side of the screen, active voice, sentence case.

| Instead of                 | Write                      | Why                                 |
| -------------------------- | -------------------------- | ----------------------------------- |
| Submit                     | Save changes               | Says what happens                   |
| Oops! Something went wrong | The board couldn't load.   | Names the object                    |
| Task successfully created! | Task created               | The button's verb, no exclamation   |
| Are you sure?              | Delete this board?         | The question is the consequence     |
| Invalid input              | Title can't be empty       | Specific beats clever               |
| Users / Org / Entity       | Members / Workspace / Task | Product vocabulary, not schema      |
| Socket disconnected        | Reconnecting…              | User-side naming                    |
| Position updated           | Moved to In Progress       | What they did, not what the row did |

- **One verb through a flow:** button **Create board** → dialog **Create board** → toast **Board
  created**. Buttons name their action, never Yes/No/OK; destructive ones name the object. The
  verb holds all the way to the failure: an **Add column** button does not fail with "Could not
  _create_ this column."
- **The third beat only exists where the screen cannot show the result.** A card lands under the
  cursor, a renamed column shows its new name, a deleted board leaves the grid — those confirm
  themselves, and a toast on top is noise. Confirm when the effect is off-screen (an inbox, a
  stored preference), when the thing that changed has no on-screen representation (a column's
  `category`), or when the change reaches further than the view admits (deleting a board label
  strips it from every task). Silence is the default; a message is the exception that has to
  earn itself.
- **One job per element.** A label labels, helper text explains, a placeholder shows an example
  — a placeholder is never a label.
- **Never expose internals** (`workspaceId`, `position`, "fractional index", "optimistic
  update"). Ids appear only behind a copy-id affordance, in mono.
- **Dates and durations:** relative near now ("in 2 days"), absolute beyond a week, exact value
  always in `title`. `estimatedMinutes` renders "2h 30m", never "150".

**Every error ends with a way out.** Naming the object that failed is only half the message; the
other half is the next move. Which half carries it is decided by one question — **could the
identical request succeed on a second attempt?**

|                   | **No** — the server explained itself                                                                        | **Yes** — the server did not                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Recovery lives in | **The sentence**                                                                                            | **The surface**                                                                       |
| The user gets     | The reason, then the one move that changes it: ask an admin, reload, use the other address, send a new link | The object that failed, then a control: `action` on a toast, **Try again** on a block |
| Typical causes    | `400` · `401` · `403` · `404` · `409`, a rejected credential, an expired link                               | network · timeout · `429` · `5xx`                                                     |
| Example           | You need admin access to change columns. Ask a workspace owner.                                             | The board couldn't load. → **Try again**                                              |

Two things keep the right-hand column honest. A control that re-fails on every press teaches the
user the product is broken, so an **explained** failure never gets one — re-sending a write the
server rejected on a `403`, or against a task that is gone, only repeats the toast. And when the
control that failed is **still on screen and still live** — a dialog's submit button, "Load more",
a select — that already _is_ the retry; a second one beside it is clutter, which is why the
create/rename/delete dialogs carry no action of their own.

Every user-visible string goes through **next-intl** from the first component, even though MVP
ships English-only. This is the _layer_, not the translations: the roadmap's Beyond-MVP "i18n in
the application UI" row is about shipping further language packs, and the plumbing lands with
the Phase 1 skeleton because retrofitting it costs far more than starting with it.

| i18n rule                     |                                                                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No hardcoded strings          | User-facing copy goes through `useTranslations` / `getTranslations` and `messages/*.json`. There is no ESLint rule forbidding JSX string literals yet — `messages/catalog.test.ts` catches missing/orphan keys for bound `t('…')` calls. |
| Keys                          | By domain, mirroring the component tree: `board.column.addAction`, `task.priority.urgent`, `errors.http.409`                                                                                                                             |
| Catalogs                      | `messages/en.json` is canonical; `messages/tr.json` ships beside it and `messages/catalog.test.ts` fails the build on a key one has and the other does not                                                                               |
| Plurals, interpolation        | ICU format (`{count, plural, …}`). Never concatenate sentence fragments — word order differs per language.                                                                                                                               |
| Dates, numbers, relative time | `Intl.*` via next-intl formatters with the active locale; no hand-formatted dates                                                                                                                                                        |
| Casing                        | **No `text-transform: uppercase` on translated strings** — Turkish `i → İ` breaks under CSS casing. Write the intended casing into the catalog.                                                                                          |
| Layout                        | Assume ±35% string length; nothing is a fixed pixel width because the English fits                                                                                                                                                       |

## 8. Charts and dashboard

For the dashboard ([ROADMAP.md](../ROADMAP.md#shipped-mvp-summary), Phase 7), rendered with Recharts. Form is chosen by the
reader's job, before any color decision. Never a dual y-axis, never a pie past two slices,
never a generated ninth hue — fold the tail into "Other" or facet into small multiples.

| Aggregate                                      | Form                                                                             | Color job                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- |
| Open tasks, overdue count, completed this week | **Stat tile** — label, value, signed delta vs a named period, optional sparkline | none / emphasis            |
| Completion over time                           | **Line**, one series (10% area fill only if it is alone)                         | sequential                 |
| Created vs completed over time                 | **Two lines**, direct-labeled at the right edge                                  | categorical 1–2            |
| Tasks per column · per assignee                | **Horizontal bar**, sorted; assignees top 8 then "Other"                         | sequential                 |
| Priority breakdown                             | **Horizontal stacked bar**, one row, LOW→URGENT                                  | the priority scale (§3)    |
| Label distribution                             | **Horizontal bar**                                                               | categorical, by label slot |
| Column composition over time                   | **Stacked area / column**, ≤ 6 series                                            | categorical                |
| More than ~7 categories that all matter        | **Table**, or table plus chart                                                   | —                          |

Palette validated against Kurul's own surfaces (`#FFFFFF` light, `#161918` dark). These slots
also back `Label.color`.

| Slot | Hue    | Light     | Dark      |     | Slot | Hue     | Light     | Dark      |
| ---- | ------ | --------- | --------- | --- | ---- | ------- | --------- | --------- |
| 1    | blue   | `#2A78D6` | `#3987E5` |     | 5    | magenta | `#E87BA4` | `#D55181` |
| 2    | orange | `#EB6834` | `#D95926` |     | 6    | green   | `#008300` | `#008300` |
| 3    | aqua   | `#1BAF7A` | `#199E70` |     | 7    | violet  | `#4A3AA7` | `#9085E9` |
| 4    | yellow | `#EDA100` | `#C98500` |     | 8    | red     | `#E34948` | `#E66767` |

Validator — **light**: lightness band, chroma, CVD (worst adjacent ΔE 9.1) and normal-vision
(19.6) all PASS; contrast WARN on slots 3/4/5 below 3:1 on white, so **direct labels or the
table view are mandatory** wherever those appear. **Dark**: all six checks PASS, worst adjacent
CVD ΔE 8.4.

| Rule                   |                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Slot assignment        | Fixed order, assigned in sequence, **never cycled**. Color follows the entity, not its rank — filtering out a series must not repaint the survivors.                                                                                                                                 |
| Series cap             | 6 soft / 8 hard for bars, lines, stacks; **3** for scatter, bubble, and small multiples (the all-pairs gate)                                                                                                                                                                         |
| Sequential · diverging | One hue, blue, light→dark for magnitude · blue ↔ red with a **neutral gray** midpoint (`#F0EFEC` / `#383835`), only for "vs target" views                                                                                                                                            |
| Emphasis               | One series in `--signature` copper, the rest in `--foreground-disabled`. The only copper in a chart, and the right answer whenever the story is "this one".                                                                                                                          |
| Status and priority    | Reserved — never reused as "series 4"                                                                                                                                                                                                                                                |
| Marks                  | Bars ≤ 24px thick, 4px rounded data-end, square at the baseline, 2px surface-colored gap between adjacent bars and stacked segments; lines 2px round cap/join; markers ≥ 8px with a 2px surface ring                                                                                 |
| Grid and axes          | Horizontal gridlines only, 1px solid `--border`, never dashed. No chart border, no background fill. Ticks rounded to clean numbers, thousands-separated, `tabular-nums`, in `--muted-foreground`.                                                                                    |
| Legend and labels      | Legend always present at 2+ series, none for one — the title names it. Direct labels are selective (endpoint, extreme, or the one series that is the story), never a number on every point. **Text wears text tokens, never the series hue**; identity comes from the dot beside it. |
| Tooltip                | Default-on: crosshair + tooltip on line and area, per-mark on bar and cell. Card surface, 1px border, `sm` radius, 8px padding, series dot + name + `tabular-nums` value, hit target larger than the mark.                                                                           |
| Filters and table view | Filters in one row above the charts, never inside a chart. Every chart has a "View as table" affordance — also the relief channel for the light-mode contrast WARN.                                                                                                                  |

**Stat tiles.** Label in `small` `--muted-foreground`, sentence case, no trailing colon · value
in Archivo 600 at 28px with **proportional** figures, auto-compacted (`1,284` / `12.9K`) · delta
signed against a named period, colored by _direction × whether up is good_ (more overdue tasks
is not good news) and paired with an arrow · optional 12-point sparkline in
`--foreground-disabled` with the current period in copper. **At most one hero figure per view**,
≥48px, in Archivo — never Fraunces; a display face on a number reads as decoration.

## 9. Accessibility

Target **WCAG 2.1 AA** in both themes, verified per token pair rather than per screenshot.

| Requirement                       | Floor                              | Applies to                                                         |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Body text on its surface          | 4.5:1                              | Every foreground/surface pair in §3 — all measured above the floor |
| Large text (≥18.66px bold / 24px) | 3:1                                | Titles, hero figures                                               |
| Component boundaries and states   | 3:1                                | Input borders, focus ring, sancak rail, chart marks                |
| Disabled text                     | exempt, held to 3:1 anyway         | Placeholders, disabled controls                                    |
| Chart marks on the chart surface  | 3:1, or direct labels / table view | Light slots 3, 4, 5 take the relief route                          |

| Rule                        |                                                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard parity             | Every pointer interaction has a keyboard path, drag and drop included (§5). If a feature can only be done by dragging, it is unfinished.                                                                                         |
| Color is never alone        | Priority and status ship an icon and a word; labels carry their name in the chip; series get a legend and, at ≤4 series, direct labels; the rail is accompanied by `aria-current` and a weight change                            |
| Focus management            | The non-modal panel moves focus to its heading on open and returns it to the originating card on close, without trapping. Dialogs _do_ trap, restore focus on close, and close on `Esc`; popovers return focus to their trigger. |
| Announcements               | Drag transitions, optimistic failures, realtime arrivals, and toasts go through `aria-live="polite"`; only a session-ending error is `assertive`                                                                                 |
| Reduced motion              | Respected everywhere and never removes a state change — the state still changes, it just stops moving                                                                                                                            |
| Structure                   | One `h1` per route; landmarks for sidebar, main, panel; the board as a labelled composite widget; column counts exposed as text, not inferred                                                                                    |
| Zoom, reflow, forced colors | Usable at 200% — the sidebar collapses and the panel becomes a sheet rather than the board scrolling in two directions. `forced-colors: active` keeps borders and focus rings; charts fall back to the table view.               |

## 10. Cross-references

| Document                                                               | What it binds here                                                                                                                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [coding-standards.md](coding-standards.md#nextjs-appsweb)              | `components/ui/` is shadcn output only — tokens are edited in the theme, never in a primitive; no arbitrary hex in components; conditional classes through `cn()` |
| [architecture.md](architecture.md#4-appsweb--structure)                | The `(auth)` / `(app)` route groups and the `board/`, `task/`, `dashboard/`, `layout/` component domains this document lays out                                   |
| [api-conventions.md](api-conventions.md#errors)                        | The problem-JSON shape error copy derives from, and the rule to branch on `statusCode`                                                                            |
| [Shipped MVP summary](../ROADMAP.md#shipped-mvp-summary)               | Phase 3 lands tokens, shell, and board chrome; Phase 4 the drag interaction and detail panel; Phase 5 priority and label rendering; Phase 7 the charts            |
| [`decisions/0003-frontend-stack.md`](decisions/0003-frontend-stack.md) | Next.js 16 + Tailwind + shadcn/ui + @dnd-kit + Recharts — the toolkit every rule above is written against                                                         |
| [tech-stack.md](tech-stack.md)                                         | Why that toolkit                                                                                                                                                  |
