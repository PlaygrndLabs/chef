# UI kit

Every page in this app is built with `shared/ui.ts`. It gives each page the same polished look (in the style of shadcn/ui) in light and dark mode, with no packages, fonts or CDNs to load.

## Pages

```ts
import { html, icon, page } from "../../shared/ui.ts";

{ method: "GET", path: "/todos", handle: () => page({
  title: "Todos",
  accent: "#4f46e5",
  body: html`
    <header class="page-header">
      <div><h1>Todos</h1><p>Plan your day, one item at a time.</p></div>
    </header>
    <form class="card input-group" id="add">
      <input class="input" name="title" placeholder="What needs doing?" aria-label="New todo" required>
      <button class="btn">${icon("plus")} Add</button>
    </form>
    <ul class="list" id="items"></ul>`,
  script: CLIENT,
}) }
```

- `page(options)` returns the `Response`. Options: `title` (tab title), `body`, `script` (inline module script), `scripts` (script URLs), `style` (extra CSS), `width` (`narrow` 28rem, `normal` 42rem, `wide` 64rem, `full`), `accent` (one brand color for the app), `brand` and `nav` (`[{ href, label }]`) for a top bar, `current` (the nav href to highlight), `status`.
- `html` is a tagged template that escapes every value. Arrays render in order; `null`, `undefined` and booleans render nothing. Use `raw()` only for markup you built yourself.
- `icon(name, { label?, class? })` renders a Lucide icon. Names: plus minus x check check-circle circle trash pencil save search filter chevron-right chevron-left chevron-down chevron-up arrow-left arrow-right external-link link more-horizontal menu home inbox list list-checks calendar clock user users mail send message bell star heart tag folder file image copy download upload refresh eye lock log-out settings globe map-pin chart trending-up cart zap sun moon info alert loader sparkles.

## In the browser

Every page has `window.ui`: `ui.icon(name, { label?, class? })` returns the icon's markup, `ui.escape(text)` escapes text for `innerHTML`, and `ui.toast(message, "danger"?)` shows a short message at the bottom.

## Classes

- Layout: `container` (set by `page`), `page-header` (h1 plus a one-line `p`), `hero`, `section`, `stack` / `stack-sm` / `stack-lg` (vertical gaps), `row` / `row-sm` (horizontal), `between`, `end`, `wrap`, `grow`, `top`, `grid` (auto columns), `grid-2`, `grid-3`.
- Surfaces: `card` with optional `card-header` and `card-footer`; `a.card` lifts on hover; `topbar`.
- Buttons: `btn` (primary), plus `btn-accent`, `btn-secondary`, `btn-outline`, `btn-ghost`, `btn-danger`; sizes `btn-sm`, `btn-lg`; `btn-icon` for a square icon button (give it `aria-label`); `btn-block`.
- Forms: `field` wraps a `label` and an `input` / `select` / `textarea`, with `hint` or `error` below; `input-group` puts an input and a button on one line; `search` wraps an icon and an input. Mark a bad field with `aria-invalid="true"`.
- Lists: `ul.list` of `li` rows; put row buttons in `div.actions`; `done` strikes a finished item through.
- Data: `table-wrap` around a `table.table`, `stat` with `value` and `label`, `progress` with an inner `span` whose width is the share, `avatar`.
- Status: `badge` (`badge-accent`, `badge-success`, `badge-warning`, `badge-danger`, `badge-info`, `badge-outline`), `dot`, `alert` (`alert-success`, `alert-warning`, `alert-danger`, `alert-info`), `empty` (an icon, a `strong` title, a line of text, an optional button).
- Other: `tabs` (buttons with `aria-selected="true"` or `.active`), `dialog`, `skeleton`, `spin`, `muted`, `small`, `tiny`, `strong`, `center`, `mono`, `truncate`.

Colors come from CSS variables: `--bg`, `--fg`, `--card`, `--muted`, `--muted-bg`, `--border`, `--primary`, `--accent`, `--danger`, `--success`, `--warning`, `--info`, `--radius`, `--shadow`. Extra CSS in `style` uses these so dark mode keeps working.

## Design rules

- Open each page with a `page-header`: a short h1 and one line saying what the page is for.
- Put content on surfaces: a `card` for forms and details, a `list` for items, a `table-wrap` for data with columns.
- One primary button per view; other actions are `btn-outline`, `btn-ghost` or icon buttons.
- Give buttons an icon and a word ("Add", "Save"). An icon-only button needs `aria-label`.
- Show an `empty` state with an icon and a hint when there is nothing yet, and a `skeleton` or disabled button while loading or saving.
- Report errors in an `alert` or `ui.toast(message, "danger")`, never with `alert()`.
- Pick one `accent` color that fits the app and use it for highlights, not for everything.
- Keep pages responsive: grids collapse on phones, and nothing should scroll sideways.
- Do not load fonts, CSS frameworks or scripts from other sites; the app must work offline.
