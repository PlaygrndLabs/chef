import { apply, emptyState, features, memory, metrics, stuck } from "/state.js";
import { startTalk, transcript } from "/voice.js";

const $ = (id) => document.getElementById(id);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === "class") el.className = value;
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function badge(state) {
  return h("span", { class: `pill state-${state}` }, state);
}

function link(url) {
  return url ? h("a", { href: url, target: "_blank", rel: "noreferrer" }, url.replace(/^https?:\/\//, "")) : h("span", { class: "muted" }, "none");
}

const short = (id) => (id ? id.slice(0, 8) : "");

let state = emptyState();
let project = "";
let socket = null;
let poller = null;
let stopTalk = null;
let heard = [];

const percent = (value) => `${Math.round(value * 100)}%`;

function stat(label, value) {
  return h("div", { class: "stat" }, h("div", { class: "stat-value" }, String(value)), h("div", { class: "muted" }, label));
}

function render() {
  const m = metrics(state);
  $("metrics").replaceChildren(
    stat("merged features", m.mergedFeatures),
    stat("merges", m.merges),
    stat("reverts", m.reverts),
    stat("revert rate", percent(m.revertRate)),
    stat("human actions per merged feature", m.humanActionsPerMergedFeature.toFixed(2)),
    stat("attempt picks", m.picks),
    stat("lessons / recalls", `${m.lessons} / ${m.lessonRecalls}`),
    stat("corrections / lint rules", `${m.corrections} / ${m.rules}`),
    stat("rejected turns", Object.entries(m.rejections).map(([rule, count]) => `${rule} ${count}`).join(", ") || "0"),
  );
  $("features").replaceChildren(
    ...features(state).map((f) =>
      h(
        "tr",
        null,
        h("td", null, h("code", null, f.id)),
        h("td", null, badge(f.state)),
        h("td", null, String(f.sessions.length), f.dropped ? h("span", { class: "muted" }, ` (${f.dropped} dropped)`) : null),
        h("td", null, `${f.merges} / ${f.reverts}`),
        h("td", null, link(f.preview?.url)),
      ),
    ),
  );
  $("picks").replaceChildren(
    ...(state.picks.length
      ? [...state.picks].reverse().map((p) =>
          h(
            "li",
            null,
            h("code", null, p.featureId),
            " picked ",
            h("code", null, short(p.winner)),
            h("span", { class: "muted" }, ` by ${p.model}`),
            h("div", null, p.candidates.map((c) => `${short(c.sessionId)} ${c.passed}/${c.total}`).join(", ")),
            h("div", { class: "muted" }, p.reasons.join("; ")),
          ),
        )
      : [h("li", { class: "muted" }, "No parallel attempts yet.")]),
  );
  $("voice-requests").replaceChildren(
    ...[...state.voice].reverse().slice(0, 10).map((v) => h("li", null, h("span", { class: "muted" }, "said "), `"${v.prompt}"`, " → ", v.sessionId ? h("code", null, v.featureId ?? short(v.sessionId)) : v.intent)),
  );
  const learned = memory(state);
  $("lessons").replaceChildren(
    ...(learned.lessons.length
      ? [...learned.lessons].reverse().map((l) => h("li", null, h("code", null, l.path), h("span", { class: "muted" }, ` recalled ${l.recalls} times`)))
      : [h("li", { class: "muted" }, "No lessons yet. A lesson is written when a merge is reverted.")]),
  );
  $("rules").replaceChildren(
    ...(learned.rules.length
      ? [...learned.rules].reverse().map((r) => h("li", null, h("code", null, r.id), h("div", null, r.message), h("div", { class: "muted" }, `from sessions ${r.sessions.map(short).join(", ")}`)))
      : [h("li", { class: "muted" }, "No learned lint rules yet.")]),
  );
  const stuckSessions = stuck(state);
  $("stuck").replaceChildren(
    ...(stuckSessions.length
      ? stuckSessions.map((s) => h("li", null, h("code", null, s.featureId), " ", h("span", { class: "muted" }, short(s.id)), h("div", null, s.stuck ?? s.reason)))
      : [h("li", { class: "muted" }, "Nothing is stuck.")]),
  );
  $("sessions").replaceChildren(
    ...[...state.order].reverse().map((id) => {
      const s = state.sessions[id];
      return h(
        "div",
        { class: "card" },
        h("div", null, h("code", null, s.featureId), " ", badge(s.state)),
        h("div", { class: "muted" }, s.fork || short(s.id), s.attempt && s.attempt.of > 1 ? ` attempt ${s.attempt.index} of ${s.attempt.of}` : "", s.parent ? ` follows ${short(s.parent)}` : ""),
        s.recalled.length ? h("div", { class: "muted" }, `recalled ${s.recalled.join(", ")}`) : null,
        h("div", null, s.reason),
        h("div", null, s.commits.length === 1 ? "1 commit" : `${s.commits.length} commits`, s.commits.length ? h("span", { class: "muted" }, ` last ${short(s.commits[s.commits.length - 1].id)}`) : null),
        h("div", null, "preview ", link(s.preview?.url)),
        s.verdict ? h("div", null, s.verdict.approve ? "review approved" : `review rejected: ${s.verdict.reasons.join("; ")}`) : null,
        s.gate ? h("div", { class: "checks" }, ...(s.gate.checks ?? []).map((c) => h("span", { class: `pill ${c.ok ? "state-merged" : "state-stuck"}` }, c.name))) : null,
        s.rejections.length ? h("ul", { class: "list" }, ...s.rejections.map((r) => h("li", { class: "state-stuck" }, `${r.role} turn rejected (${r.rule}): ${r.paths.join(", ")}`))) : null,
        s.coder.length ? h("pre", null, s.coder.map((l) => `${l.kind === "text" ? "" : `[${l.kind}] `}${l.text}`).join("\n")) : null,
      );
    }),
  );
  $("merges").replaceChildren(
    ...[...state.merges.map((m) => ({ ...m, kind: "merged" })), ...state.reverts.map((r) => ({ ...r, kind: "reverted" }))]
      .sort((a, b) => b.at - a.at)
      .map((m) => h("li", null, m.kind === "merged" ? badge("merged") : badge("reverted"), " ", h("code", null, m.featureId), " ", h("span", { class: "muted" }, short(m.commitId)), " ", new Date(m.at).toLocaleString())),
  );
  $("log").replaceChildren(...[...state.log].reverse().slice(0, 150).map((e) => h("li", null, `${new Date(e.at).toLocaleTimeString()} ${e.type} ${e.featureId}`)));
}

function setConnection(text) {
  $("connection").textContent = text;
}

function receive(entry) {
  apply(state, entry);
  render();
}

async function poll() {
  try {
    const response = await fetch(`/api/projects/${project}/events?after=${state.lastSeq}`);
    if (response.ok) for (const entry of await response.json()) receive(entry);
  } catch {
    setConnection("offline");
  }
}

function connect() {
  socket?.close();
  clearInterval(poller);
  state = emptyState();
  render();
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${scheme}://${location.host}/agents/project-agent/${project}`);
  socket.addEventListener("open", () => setConnection("live"));
  socket.addEventListener("message", (message) => {
    try {
      receive(JSON.parse(message.data));
    } catch {
      setConnection("live");
    }
  });
  socket.addEventListener("close", () => {
    setConnection("polling");
    clearInterval(poller);
    poller = setInterval(poll, 3000);
    poll();
  });
}

function open(name) {
  project = name;
  $("project").value = name;
  history.replaceState(null, "", `?project=${encodeURIComponent(name)}`);
  connect();
}

$("project-form").addEventListener("submit", (event) => {
  event.preventDefault();
  open($("project").value.trim());
});

$("bootstrap").addEventListener("click", async () => {
  const response = await fetch(`/api/projects/${project}/bootstrap`, { method: "POST" });
  const body = await response.json();
  $("prompt-result").textContent = body.created ? `Bootstrapped main at ${short(body.commitId)}` : `Main already at ${short(body.commitId)}`;
});

$("prompt-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  const response = await fetch(`/api/projects/${project}/prompts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
  const body = await response.json();
  $("prompt-result").textContent = body.error ?? (body.sessionId ? `Session ${short(body.sessionId)} started` : body.answer ? `${body.answer.text}${body.answer.sources.length ? ` (from ${body.answer.sources.join(", ")})` : ""}` : `Routed: ${body.decision?.intent ?? "done"}`);
  if (response.ok) $("prompt").value = "";
});

function showHeard() {
  $("transcript").replaceChildren(...heard.map((line) => h("li", null, h("span", { class: "muted" }, `${line.speaker}: `), line.text)));
}

$("talk").addEventListener("click", async () => {
  if (stopTalk) {
    const stop = stopTalk;
    stopTalk = null;
    await stop();
    $("talk").textContent = "Talk";
    return;
  }
  heard = [];
  showHeard();
  $("talk").textContent = "Stop";
  try {
    stopTalk = await startTalk({
      project,
      onStatus: (status) => ($("voice-status").textContent = status),
      onEvent: (event) => {
        heard = transcript(heard, event);
        showHeard();
      },
    });
  } catch (error) {
    $("talk").textContent = "Talk";
    $("voice-status").textContent = error instanceof Error ? error.message : String(error);
  }
});

open(new URLSearchParams(location.search).get("project") || "demo");
