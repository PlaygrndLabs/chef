# UI kit

This app is a React single-page app on Cloudflare Workers. The Worker answers the JSON routes each feature serves under `/api`; every other page address gets the same small HTML shell, which loads the app's React client (`/client.js`, built by `npm run build` from every feature's `pages.tsx`). Moving between pages happens in the browser and never reloads the app.

`shared/ui.tsx` gives every page the same polished look (in the style of shadcn/ui) in light and dark mode, with no fonts, CSS frameworks or CDNs to load.

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

- A `Page` is `{ path, title, nav?, component }`. `path` may have parameters (`/todos/:id`); the component gets them as `params`, or from `useParams()`. `title` becomes the tab title. Pages with `nav: true` show in the app's top bar.
- `/` opens the page whose path is `/`; without one it opens the first `nav` page (or the first page), so the app never shows a list of its pages.
- A page nobody built yet says so, with a link home.
- Move between pages with `<Link to="/todos">` (from `shared/ui.tsx`), a plain `<a href="/todos">`, or `navigate("/todos")`. `useLocation()` gives the open `path` and its `search` params.
- Load data with `useLoad(() => api(...), deps)`: it returns `{ data, error, loading, reload }` and loads again when `deps` change.
- `api(path, { method?, body?, headers? })` calls the app's routes: an object `body` is sent as JSON (the method is `POST` when there is a body, `GET` otherwise), and it resolves to the parsed JSON answer. When the request fails it throws an `Error` whose message is never empty: the route's `{ error }`, or the status ("The request failed (500 Internal Server Error). Try again."), or "Could not reach the app" when the network is down. `message(error)` gives that text; `<ErrorText error={error} />` shows it in an alert, and renders nothing for `null`.
- `toast(message, "danger"?)` shows a short message at the bottom.
- `<Icon name="plus" label? className? />` renders a Lucide icon. Names: plus minus x check check-circle circle trash pencil save search filter chevron-right chevron-left chevron-down chevron-up arrow-left arrow-right external-link link more-horizontal menu home inbox list list-checks calendar clock user users mail send message bell star heart tag folder file image copy download upload refresh eye lock log-out settings globe map-pin chart trending-up cart zap sun moon info alert loader sparkles.

## The app's look

A feature may export `look` from `look.ts` (or `<role>/look.ts`): `{ brand?, accent?, width?, style? }`. `brand` names the app in the top bar, `accent` is one brand color, `width` is `narrow` (28rem), `normal` (42rem), `wide` (64rem) or `full`, and `style` is extra CSS. Chef's client applies every feature's look to the whole app.

## Classes

- Layout: `container` (set by the app), `page-header` (h1 plus a one-line `p`), `hero`, `section`, `stack` / `stack-sm` / `stack-lg` (vertical gaps), `row` / `row-sm` (horizontal), `between`, `end`, `wrap`, `grow`, `top`, `grid` (auto columns), `grid-2`, `grid-3`.
- Surfaces: `card` with optional `card-header` and `card-footer`; `a.card` lifts on hover; `topbar`.
- Buttons: `btn` (primary), plus `btn-accent`, `btn-secondary`, `btn-outline`, `btn-ghost`, `btn-danger`; sizes `btn-sm`, `btn-lg`; `btn-icon` for a square icon button (give it `aria-label`); `btn-block`.
- Forms: `field` wraps a `label` and an `input` / `select` / `textarea`, with `hint` or `error` below; `input-group` puts an input and a button on one line; `search` wraps an icon and an input. Mark a bad field with `aria-invalid="true"`.
- Lists: `ul.list` of `li` rows; put row buttons in `div.actions`; `done` strikes a finished item through.
- Data: `table-wrap` around a `table.table`, `stat` with `value` and `label`, `progress` with an inner `span` whose width is the share, `avatar`.
- Status: `badge` (`badge-accent`, `badge-success`, `badge-warning`, `badge-danger`, `badge-info`, `badge-outline`), `dot`, `alert` (`alert-success`, `alert-warning`, `alert-danger`, `alert-info`), `empty` (an icon, a `strong` title, a line of text, an optional button).
- Other: `tabs` (buttons with `aria-selected="true"` or `.active`), `dialog`, `skeleton`, `spin`, `muted`, `small`, `tiny`, `strong`, `center`, `mono`, `truncate`.

Colors come from CSS variables: `--bg`, `--fg`, `--card`, `--muted`, `--muted-bg`, `--border`, `--primary`, `--accent`, `--danger`, `--success`, `--warning`, `--info`, `--radius`, `--shadow`. Extra CSS in a `look.ts` `style` uses these so dark mode keeps working. In JSX, classes go in `className`.

## Design rules

- Open each page with a `page-header`: a short h1 and one line saying what the page is for.
- Put content on surfaces: a `card` for forms and details, a `list` for items, a `table-wrap` for data with columns.
- One primary button per view; other actions are `btn-outline`, `btn-ghost` or icon buttons.
- Give buttons an icon and a word ("Add", "Save"). An icon-only button needs `aria-label`.
- Show an `empty` state with an icon and a hint when there is nothing yet, and a `skeleton` or disabled button while loading or saving.
- Report errors with `<ErrorText error={error} />` or `toast(message(error), "danger")`, never with `alert()`.
- Pick one `accent` color that fits the app (in a feature's `look.ts`) and use it for highlights, not for everything.
- Keep pages responsive: grids collapse on phones, and nothing should scroll sideways.
- Do not load fonts, CSS frameworks or scripts from other sites; the app must work offline.
