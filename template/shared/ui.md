# UI kit

This app is a React single-page app on Cloudflare Workers. The Worker answers the JSON routes each feature serves under `/api`; every other page address gets a small HTML shell, which loads the app's React client (`/client.js`, built by `npm run build` from every feature's `pages.tsx`). Moving between pages happens in the browser and never reloads the app.

`shared/ui.tsx` gives every page the same polished look (in the style of shadcn/ui) in light and dark mode, with no CSS frameworks or CDNs to load. The app's look (below) sets its fonts, colors and shapes.

## Pages

A feature's pages live in `features/<id>/pages.tsx` (or `features/<id>/<role>/pages.tsx` in a role's folder):

```tsx
import { useState } from "react";
import type { Page } from "../../shared/app.tsx";
import { api, ErrorText, Icon, useLoad } from "../../shared/ui.tsx";

interface Todo {
  readonly id: string;
  readonly title: string;
}

function Todos() {
  const todos = useLoad(() => api<Todo[]>("/api/todos"));
  const [title, setTitle] = useState("");
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Todos</h1>
          <p>Plan your day, one item at a time.</p>
        </div>
      </header>
      <form
        className="card input-group"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          try {
            await api("/api/todos", { body: { title } });
            setTitle("");
            await todos.reload();
          } catch (problem) {
            setError(problem);
          }
        }}
      >
        <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs doing?" aria-label="New todo" required />
        <button className="btn">
          <Icon name="plus" /> Add
        </button>
      </form>
      <ErrorText error={error ?? todos.error} />
      <ul className="list">
        {(todos.data ?? []).map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    </>
  );
}

export const pages: readonly Page[] = [{ path: "/todos", title: "Todos", nav: true, component: Todos }];
```

- A `Page` is `{ path, title, description?, nav?, bare?, component }`. `path` may have parameters (`/todos/:id`); the component gets them as `params`, or from `useParams()`. `title` becomes the tab title. `description` is one plain sentence about the page. `npm run build` writes every page without parameters as its own HTML file carrying its title and description, so search engines and link previews (chat apps, social posts) show them, and Cloudflare serves that file without running the Worker. Pages with `nav: true` show in the app's top bar. A page that draws its own header, such as a landing page with its own nav, sets `bare: true` so the app's top bar does not show above it twice.
- `/` opens the page whose path is `/`; without one it opens the first `nav` page (or the first page), so the app never shows a list of its pages.
- A page nobody built yet says so, with a link home.
- Move between pages with `<Link to="/todos">` (from `shared/ui.tsx`), a plain `<a href="/todos">`, or `navigate("/todos")`. `useLocation()` gives the open `path` and its `search` params.
- Load data with `useLoad(() => api(...), deps)`: it returns `{ data, error, loading, reload }` and loads again when `deps` change.
- `api(path, { method?, body?, headers? })` calls the app's routes: an object `body` is sent as JSON (the method is `POST` when there is a body, `GET` otherwise), and it resolves to the parsed JSON answer. When the request fails it throws an `Error` whose message is never empty: the route's `{ error }`, or the status ("The request failed (500 Internal Server Error). Try again."), or "Could not reach the app" when the network is down. `message(error)` gives that text; `<ErrorText error={error} />` shows it in an alert, and renders nothing for `null`.
- `toast(message, "danger"?)` shows a short message at the bottom.
- `<Icon name="plus" label? className? />` renders a Lucide icon. Names: plus minus x check check-circle circle trash pencil save search filter chevron-right chevron-left chevron-down chevron-up arrow-left arrow-right external-link link more-horizontal menu home inbox list list-checks calendar clock user users mail send message bell star heart tag folder file image copy download upload refresh eye lock log-out settings globe map-pin chart trending-up cart zap sun moon info alert loader sparkles.

## The app's look

The look is the app's design system: one set of fonts, colors, materials and shapes every page shares, and the only place they are written. Every color, gradient, texture and font a page uses lives in the look under a name, and pages use it by name (`var(--blush)`, `material-hero`, the display and body fonts); the look check fails on a color or a font written anywhere else in a feature, so the design system always holds everything the app uses. A feature may export `look` from `look.ts` (or `<role>/look.ts`), and Chef's client merges every feature's look into one. The first feature that shapes the app writes it; later features keep what is there and add only what is new.

`look` is `{ brand?, description?, scheme?, fonts?, colors?, materials?, radius?, accent?, width?, gate?, references?, style? }`:

- `brand` names the app in the top bar and in every page's title. `description` is one sentence about the app that pages without their own use and that link previews of the app's home show.
- `scheme` is `"light"` or `"dark"` when the brand truly has one look only. By default leave it out so the app follows the visitor's setting, and design the dark look as carefully as the light one: every color you set needs a `dark` value, and the look check shows both.
- `fonts` is `{ display?, body?, mono? }`, each a name from `shared/fonts.ts`. `display` sets `h1`, `h2` and the `display` class, `body` sets everything else, `mono` sets code. The fonts ship with the app and load from its own address. Condensed display: Anton, Bebas Neue, Big Shoulders Display, Archivo (also wide, with `font-stretch`). Characterful sans: Bricolage Grotesque, Syne, Unbounded, Space Grotesk. Serif display: DM Serif Display, Fraunces, Instrument Serif, Playfair Display. Body: Inter, Geist, Manrope, DM Sans, IBM Plex Sans, Outfit, Source Serif 4. Persian and Arabic: Vazirmatn. Mono: JetBrains Mono, Geist Mono, IBM Plex Mono.
- `colors` is `{ light?, dark? }`, each mapping the kit's color names (`bg`, `fg`, `card`, `muted`, `muted-bg`, `border`, `input`, `ring`, `primary`, `primary-fg`, `accent`, `danger`, `success`, `warning`, `info`) to CSS colors. Every kit class follows them. Add the brand's own colors under names of your own (`blush`, `leaf`, `ink-2`), in light and dark; each becomes `var(--<name>)`.
- `materials` names the surfaces that are more than one color: gradients, glass, grain, image fills, such as `{ hero: "radial-gradient(circle at 30% 20%, var(--leaf), transparent 60%), var(--ink)" }`. Build them from the look's colors so they follow light and dark. Each becomes `var(--material-<name>)` and a `material-<name>` class that sets it as the background.
- `radius` is the corner size, from `"0"` (square) to `"1.5rem"`. `accent` is one brand color for highlights. `width` is `narrow` (28rem), `normal` (42rem), `wide` (64rem) or `full`. `style` is extra CSS that uses the kit's variables.
- `gate` is part of the name of the button a first-time visitor presses before the page shows, such as an age check (`"21 or older"`) or a cookie notice. The look check then looks at the gate and, after pressing it, at the page behind it.
- `references` lists the sites or images the look was matched to, such as `["https://ploy.ai"]`. Chef shows them with the look in the project's Design settings.

```ts
export const look = {
  brand: "Ashgrove",
  scheme: "light",
  fonts: { display: "Anton", body: "Inter" },
  colors: { light: { bg: "#f4f4f4", fg: "#1a1a1a", primary: "#111111", "primary-fg": "#ffffff", accent: "#ff6fb5" } },
  radius: "1.5rem",
  width: "full",
} as const;
```

## Pages people see first

A landing page, a home page or an onboarding screen is judged on how it looks. Build it the way a designer would, in the same turn as the code:

1. Decide the direction before writing markup: a palette, a pair of fonts and one layout idea that comes from the subject. When the request names a site, a screenshot or a style, match it. Write the direction into the look.
   - For a site, run `npm run app -- ref https://site --out /tmp/ref` first. It saves screenshots of the site (`ref-desktop-top.png` is its hero) and prints its fonts with the closest ones in `shared/fonts.ts`, its colors, buttons and corners, and a starting look. Open the screenshots, then adjust the look by eye.
   - For an image (a screenshot or a mockup), run the same command on its link, its file or, for an image the person attached (a `Reference image: uploads/<name>` line in the request), on `uploads/<name>`. It saves the image as `/tmp/ref/ref-image.<ext>` and prints its page, text, surface and accent colors and a starting look. Open the image and read the fonts (serif or sans, condensed or wide, weight), corners and buttons off it, picking the closest fonts in `shared/fonts.ts`.
2. Build the hero first (headline, one supporting line, the primary action) and check it before adding the sections below it, one at a time.
3. Run `npm run app -- look /path --out /tmp/look`. It opens each page on a phone and a desktop, in light and dark, prints every problem (text covered or cut off, low contrast, a page that scrolls sideways, a font that did not load) and saves full-page screenshots you can open, past the look's `gate` too, so there is no need for screenshot scripts of your own. Chef runs the same check before it merges a change, on the pages the change touches, so fix every `FAIL` before handing in.
4. Give every flourish a reason. Big type, color blocks and generous space beat ornaments.

## Classes

- Layout: `container` (set by the app), `page-header` (h1 plus a one-line `p`), `hero`, `section`, `stack` / `stack-sm` / `stack-lg` (vertical gaps), `row` / `row-sm` (horizontal), `between`, `end`, `wrap`, `grow`, `top`, `grid` (auto columns), `grid-2`, `grid-3`.
- Surfaces: `card` with optional `card-header` and `card-footer`; `a.card` lifts on hover; `topbar`.
- Buttons: `btn` (primary), plus `btn-accent`, `btn-secondary`, `btn-outline`, `btn-ghost`, `btn-danger`; sizes `btn-sm`, `btn-lg`; `btn-icon` for a square icon button (give it `aria-label`); `btn-block`.
- Forms: `field` wraps a `label` and an `input` / `select` / `textarea`, with `hint` or `error` below; `input-group` puts an input and a button on one line; `search` wraps an icon and an input. Mark a bad field with `aria-invalid="true"`.
- Lists: `ul.list` of `li` rows; put row buttons in `div.actions`; `done` strikes a finished item through.
- Data: `table-wrap` around a `table.table` (add `stacked` and give each `td` a `data-label` naming its column, and on a phone each row becomes a card of label and value pairs instead of a table that scrolls sideways), `stat` with `value` and `label`, `progress` with an inner `span` whose width is the share, `avatar`.
- Status: `badge` (`badge-accent`, `badge-success`, `badge-warning`, `badge-danger`, `badge-info`, `badge-outline`), `dot`, `alert` (`alert-success`, `alert-warning`, `alert-danger`, `alert-info`), `empty` (an icon, a `strong` title, a line of text, an optional button).
- Other: `tabs` (buttons with `aria-selected="true"` or `.active`), `dialog`, `skeleton`, `spin`, `muted`, `small`, `tiny`, `strong`, `center`, `mono`, `truncate`.

Colors come from CSS variables: `--bg`, `--fg`, `--card`, `--muted`, `--muted-bg`, `--border`, `--primary`, `--accent`, `--danger`, `--success`, `--warning`, `--info`, `--radius`, `--shadow`. Set them through the look's `colors`; extra CSS in its `style` uses these variables so both color schemes keep working. In JSX, classes go in `className`.

## Design rules

- Open each page with a `page-header`: a short h1 and one line saying what the page is for.
- Put content on surfaces: a `card` for forms and details, a `list` for items, a `table-wrap` for data with columns.
- One primary button per view; other actions are `btn-outline`, `btn-ghost` or icon buttons.
- Give buttons an icon and a word ("Add", "Save"). An icon-only button needs `aria-label`.
- Show an `empty` state with an icon and a hint when there is nothing yet, and a `skeleton` or disabled button while loading or saving.
- Report errors with `<ErrorText error={error} />` or `toast(message(error), "danger")`, never with `alert()`.
- Pick one `accent` color that fits the app (in the look) and use it for highlights, not for everything.
- Keep pages responsive: grids collapse on phones, and nothing should scroll sideways.
- Use only the fonts in `shared/fonts.ts`. Do not load fonts, CSS frameworks or scripts from other sites; the app must work offline.
