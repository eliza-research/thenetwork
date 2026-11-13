// The spec studio's page. The working copy of every spec lives here until it is published; tools/studio/server.ts
// writes it, keeps the manifest, and runs the check, the agents and the sign-off.

// --- the document, as tools/studio/doc.ts reads and writes it --------------------------------------

const fenceFor = (code) => "`".repeat(Math.max(3, ...(code.match(/`{3,}/g) ?? []).map((m) => m.length + 1)));
/** A rule's body from its items: one blank line around each, prose trimmed, empty items dropped. */
const writeBody = (items) => items.filter((i) => i.text.trim()).map((i) => {
  if (!i.quint) return `\n${i.text.trim()}\n`;
  const f = fenceFor(i.text);
  return `\n${f}quint\n${i.text.replace(/\s+$/, "")}\n${f}\n`;
}).join("") + "\n";
const writeText = (text) => (text.trim() ? `\n${text.trim()}\n\n` : "\n");
/** The spec's text. `tidy` puts a blank line before every heading, for a spec that was edited: a story or rule moved
 * to the end of another may have had nothing after it. */
function writeDoc(doc, tidy = false) {
  let text = (doc.title === null ? "" : `# ${doc.title}\n`) + doc.body;
  const heading = (line) => { if (tidy && text && !text.endsWith("\n\n")) text += text.endsWith("\n") ? "\n" : "\n\n"; text += line; };
  for (const s of doc.sections) {
    if (s.title !== null) heading(`## ${s.title}\n`);
    text += s.body;
    for (const r of s.rules) { heading(`### ${r.title}\n`); text += r.body; }
  }
  return text;
}
const storyKey = (title) => (title === null ? "" : `## ${title.trim()}`);
const ruleKey = (section, title) => `${section?.trim() ?? ""} / ${title.trim()}`;
const nodeId = (file, key) => `${file}\0${key}`;

// --- state ------------------------------------------------------------------------------------------

const S = {
  projects: [],
  project: new URLSearchParams(location.search).get("project"),
  snap: null,
  specs: [],
  sel: null,
  open: new Set(),
  editing: new Set(),
  q: "",
  attention: false,
  history: [],
  conflicts: [],
  publishing: false,
};
let uidCount = 0;
const uid = () => `n${++uidCount}`;
const draftKey = () => `studio:${S.snap?.project.root}`;

/** A spec as the server sent it, as a working copy whose nodes remember what they were. */
function working(spec) {
  const sections = spec.doc.sections.map((s) => {
    const section = { uid: uid(), origin: s.title === null ? null : nodeId(spec.file, storyKey(s.title)), title: s.title, body: s.body, rules: [] };
    section.rules = s.rules.map((r) => ({ uid: uid(), origin: nodeId(spec.file, ruleKey(s.title, r.title)), title: r.title, body: r.body, items: r.items }));
    return section;
  });
  const doc = { title: spec.doc.title, body: spec.doc.body, sections };
  const copy = { file: spec.file, name: spec.name, base: spec.hash, orig: spec.text, doc, deleted: false };
  remember(copy);
  return copy;
}
/** What each node was when loaded, so the page can mark what changed. */
function remember(spec) {
  spec.doc.sections.forEach((s, i) => {
    s.was = { title: s.title, body: s.body, file: spec.file, index: i };
    s.rules.forEach((r, j) => (r.was = { title: r.title, body: r.body, file: spec.file, section: s.origin, index: j }));
  });
}
/** The text a spec would be published as; one that was edited ends in a single newline. */
const textOf = (spec) => {
  if (spec.deleted) return null;
  const text = writeDoc(spec.doc);
  return text === spec.orig ? text : writeDoc(spec.doc, true).replace(/\n\n+$/, "\n");
};
const isDirty = (spec) => spec.deleted || spec.orig === null || textOf(spec) !== spec.orig;
const dirtySpecs = () => S.specs.filter(isDirty);
const sectionChanged = (spec, s, i) => !s.was || s.title !== s.was.title || s.body !== s.was.body || s.was.file !== spec.file || s.was.index !== i;
const ruleChanged = (spec, s, r, j) => !r.was || r.title !== r.was.title || r.body !== r.was.body || r.was.file !== spec.file || r.was.section !== s.origin || r.was.index !== j;

function saveDraft() {
  try {
    const dirty = dirtySpecs();
    if (dirty.length) localStorage.setItem(draftKey(), JSON.stringify({ specs: dirty, sel: S.sel }));
    else localStorage.removeItem(draftKey());
  } catch { /* storage unavailable: the draft lives only in this tab */ }
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(draftKey()) ?? "null"); } catch { return null; }
}

/** The specs on disk, with the specs this page changed kept and any that changed on disk underneath them noted. */
function merge(snap, mine) {
  // A story or rule keeps its place on the page (open, being edited) across a reload, by what it is called now.
  const uids = new Map(mine.flatMap((d) => d.doc.sections.flatMap((s) => [[nodeId(d.file, storyKey(s.title)), s.uid], ...s.rules.map((r) => [nodeId(d.file, ruleKey(s.title, r.title)), r.uid])])));
  const fresh = snap.specs.map(working);
  for (const f of fresh) for (const s of f.doc.sections) for (const n of [s, ...s.rules]) if (uids.has(n.origin)) n.uid = uids.get(n.origin);
  const out = [];
  S.conflicts = [];
  for (const d of mine) {
    if (!isDirty(d)) continue;
    const f = snap.specs.find((x) => x.file === d.file);
    if ((f?.hash ?? null) !== d.base) S.conflicts.push(d.file);
    out.push(d);
  }
  for (const f of fresh) if (!out.some((o) => o.file === f.file)) out.push(f);
  out.sort((a, b) => a.file.localeCompare(b.file));
  for (const s of out) for (const sec of s.doc.sections) { sec.uid ??= uid(); for (const r of sec.rules) r.uid ??= uid(); }
  uidCount = Math.max(uidCount, ...out.flatMap((s) => s.doc.sections.flatMap((x) => [x.uid, ...x.rules.map((r) => r.uid)])).map((u) => Number(u.slice(1)) || 0));
  return out;
}

// --- server -----------------------------------------------------------------------------------------

async function api(path, body) {
  const res = await fetch(`/api/${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(S.project)}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? res.statusText), { status: res.status, body: json });
  return json;
}

async function refresh(force = false) {
  if (S.publishing) return; // publishing refreshes once it is done
  const snap = await api("project");
  if (S.publishing) return;
  // Keep the working objects that the active editor's handlers close over until typing stops.
  const typing = document.getElementById("doc").contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  const first = !S.snap;
  S.snap = snap;
  if (typing && !force && !first) { renderRail(); renderBuild(); return; }
  const draft = first ? loadDraft() : null;
  S.specs = merge(snap, first ? draft?.specs ?? [] : S.specs);
  if (first && draft?.specs?.some(isDirty)) toast("Unpublished changes restored");
  if (!S.specs.some((s) => s.file === S.sel)) S.sel = draft?.sel && S.specs.some((s) => s.file === draft.sel) ? draft.sel : S.specs[0]?.file ?? null;
  render();
}

// --- small helpers -----------------------------------------------------------------------------------

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const ICONS = {
  grip: "M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01",
  chev: "M6 4l4 4-4 4",
  edit: "M10.5 3.5l2 2L6 12H4v-2z",
  trash: "M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8",
  plus: "M8 3.5v9M3.5 8h9",
  check: "M3.5 8.5l3 3 6-7",
  close: "M4 4l8 8M12 4l-8 8",
  play: "M5 3.5l7 4.5-7 4.5z",
  stop: "M4.5 4.5h7v7h-7z",
  open: "M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5",
  copy: "M5.5 5.5h7v7h-7zM3.5 10.5v-7h7",
  move: "M8 2.5v11M5 5.5l3-3 3 3M5 10.5l3 3 3-3",
  up: "M8 12.5v-9M4.5 7L8 3.5 11.5 7",
  down: "M8 3.5v9M4.5 9L8 12.5 11.5 9",
  undo: "M5.5 4L3 6.5 5.5 9M3 6.5h6.5a3 3 0 010 6H7",
};
const icon = (name) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "i");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path d="${ICONS[name]}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
};
const iconButton = (name, label, onclick, cls = "") => h("button", { class: `icon ${cls}`, type: "button", title: label, "aria-label": label, onclick: (e) => { e.stopPropagation(); onclick(e); } }, icon(name));
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let toastTimer;
function toast(text, action) {
  const el = document.getElementById("toast");
  el.replaceChildren(h("span", {}, text), action ? h("button", { type: "button", onclick: () => { action.run(); el.classList.remove("show"); } }, action.label) : "");
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), action ? 6000 : 2600);
}

/** Markdown, as far as specs use it: paragraphs, quotes, lists, code and emphasis. */
function markdown(text) {
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  const out = [];
  const blocks = text.trim().split(/\n\s*\n/);
  for (const block of blocks) {
    if (/^\s*(`{3,}|~{3,})/.test(block)) out.push(`<pre class="code">${esc(block.split("\n").slice(1, -1).join("\n"))}</pre>`);
    else if (/^>/.test(block)) out.push(`<blockquote>${inline(block.replace(/^>\s?/gm, ""))}</blockquote>`);
    else if (/^\s*[-*] /.test(block)) out.push(`<ul>${block.split(/\n(?=\s*[-*] )/).map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`);
    else if (/^\|/.test(block)) out.push(`<pre class="code">${esc(block)}</pre>`);
    else out.push(`<p>${inline(block)}</p>`);
  }
  return out.join("");
}

const KEYWORDS = /^(pure|def|val|type|import|from|if|else|match|and|or|not|implies|iff|all|any|Set|List|Map|int|bool|str|true|false|module|as)$/;
/** Quint, coloured: keywords, the names a block defines, strings, numbers and comments. */
function highlight(code) {
  const tokens = /(\/\/.*)|("(?:[^"\\\n]|\\.)*")|\b(\d+)\b|\b([A-Za-z_]\w*)\b/g;
  const out = [];
  let end = 0;
  for (const match of code.matchAll(tokens)) {
    const [text, com, str, num, word] = match;
    out.push(esc(code.slice(end, match.index)));
    const kind = com ? "com" : str ? "str" : num ? "num" : KEYWORDS.test(word) ? "kw"
      : /\b(def|val|type)\s+$/.test(code.slice(Math.max(0, match.index - 6), match.index)) ? "def" : null;
    out.push(kind ? `<span class="${kind}">${esc(text)}</span>` : esc(text));
    end = match.index + text.length;
  }
  return out.join("") + esc(code.slice(end));
}

/** What a rule's Quint defines, read off the names (AGENTS.md, "What goes in the Quint blocks"). */
const KINDS = [
  ["type", /^\s*type\s+\w+/m, "T", "a type"],
  ["initial", /^\s*pure\s+val\s+initial\b/m, "●", "the initial state"],
  ["guard", /^\s*pure\s+def\s+can[A-Z]/m, "?", "a guard"],
  ["transition", null, "→", "a transition"],
  ["always", /^\s*pure\s+def\s+always[A-Z]/m, "□", "an always rule"],
  ["step", /^\s*pure\s+def\s+step[A-Z]/m, "Δ", "a step rule"],
  ["sometimes", /^\s*pure\s+def\s+sometimes[A-Z]/m, "◇", "a sometimes rule"],
  ["law", /^\s*pure\s+def\s+law[A-Z]/m, "∀", "a law"],
];
function kindsOf(rule) {
  const code = rule.items.filter((i) => i.quint).map((i) => i.text).join("\n");
  return KINDS.filter(([kind, re]) => kind === "transition"
    ? [...code.matchAll(/^\s*pure\s+def\s+(\w+)\s*\(\s*\w+\s*:\s*(\w+)[^)]*\)\s*:\s*(\w+)/gm)].some((m) => m[2] === m[3] && !/^(always|step|sometimes|law|can)[A-Z]/.test(m[1]))
    : re.test(code));
}

// --- what the checks say about each story and rule ----------------------------------------------------

/** Failing check results by the spec file and the rule key they cite. */
function failures() {
  const byKey = new Map();
  const bySpec = new Map();
  for (const r of S.snap?.check?.results ?? []) {
    if (r.ok || r.stage === "review" || r.stage === "skipped") continue;
    const text = `${r.summary}\n${r.detail}`;
    const file = r.where?.startsWith("spec/") ? r.where : r.where?.endsWith(".ts") && !r.where.startsWith("src") ? `spec/${r.where.replace(/\.ts$/, ".md")}` : null;
    if (file) bySpec.set(file, [...(bySpec.get(file) ?? []), r]);
    for (const m of text.matchAll(/"([^"]+)" \((spec\/\w+\.md):\d+\)/g)) {
      const id = nodeId(m[2], m[1]);
      byKey.set(id, [...(byKey.get(id) ?? []), `${r.stage}: ${r.summary}`]);
    }
  }
  return { byKey, bySpec };
}
const reviewOf = (spec, key) => S.snap?.specs.find((s) => s.file === spec.file)?.review?.[key];

// --- editing operations ---------------------------------------------------------------------------------

const current = () => S.specs.find((s) => s.file === S.sel);
function find(uidWanted) {
  for (const spec of S.specs) for (const [i, s] of spec.doc.sections.entries()) {
    if (s.uid === uidWanted) return { spec, section: s, index: i };
    const j = s.rules.findIndex((r) => r.uid === uidWanted);
    if (j >= 0) return { spec, section: s, rule: s.rules[j], index: j };
  }
}
/** Every structural change is undoable. */
function change(fn, message) {
  S.history.push(JSON.stringify(S.specs));
  if (S.history.length > 50) S.history.shift();
  fn();
  saveDraft();
  render();
  if (message) toast(message, { label: "Undo", run: undo });
}
function undo() {
  const was = S.history.pop();
  if (!was) return;
  S.specs = JSON.parse(was);
  saveDraft();
  render();
}
/** Typing changes only the working copy and the counts; the document is not redrawn under the caret. */
function edited() {
  saveDraft();
  renderRail();
  renderBuild();
  document.querySelectorAll("[data-uid]").forEach((el) => {
    const f = find(el.dataset.uid);
    if (!f) return;
    el.classList.toggle("changed", f.rule ? ruleChanged(f.spec, f.section, f.rule, f.index) : sectionChanged(f.spec, f.section, f.index));
    const title = el.querySelector(":scope > .row .title");
    if (title) title.textContent = (f.rule ?? f.section).title?.trim() || "Untitled";
  });
}

function addStory(spec, at = spec.doc.sections.length) {
  const s = { uid: uid(), origin: null, title: "Story: ", body: "\n", rules: [] };
  change(() => { spec.doc.sections.splice(at, 0, s); S.open.add(s.uid); S.editing.add(s.uid); });
  focusLater(`[data-uid="${s.uid}"] input.heading`);
}
function addRule(section) {
  const r = { uid: uid(), origin: null, title: "", body: "\n", items: [] };
  change(() => { section.rules.push(r); S.open.add(section.uid); S.open.add(r.uid); S.editing.add(r.uid); });
  focusLater(`[data-uid="${r.uid}"] input.heading`);
}
function removeNode(uidWanted) {
  const f = find(uidWanted);
  if (!f) return;
  const title = (f.rule ?? f.section).title?.trim() || "untitled";
  change(() => (f.rule ? f.section.rules.splice(f.index, 1) : f.spec.doc.sections.splice(f.index, 1)), `Deleted “${title}”`);
}
/** Move a story or rule before or after another, or into a story, or to the end of another spec. */
function move(dragUid, target) {
  const from = find(dragUid);
  if (!from || dragUid === target.uid) return;
  change(() => {
    const node = from.rule ? from.section.rules.splice(from.index, 1)[0] : from.spec.doc.sections.splice(from.index, 1)[0];
    if (target.spec) {
      const spec = S.specs.find((s) => s.file === target.spec);
      if (from.rule) {
        if (!spec.doc.sections.length) spec.doc.sections.push({ uid: uid(), origin: null, title: "Story: ", body: "\n", rules: [] });
        spec.doc.sections[spec.doc.sections.length - 1].rules.push(node);
      } else spec.doc.sections.push(node);
      return;
    }
    const to = find(target.uid);
    if (from.rule && !to.rule) to.section.rules.splice(target.where === "before" ? 0 : to.section.rules.length, 0, node);
    else if (from.rule) to.section.rules.splice(to.index + (target.where === "after" ? 1 : 0), 0, node);
    else to.spec.doc.sections.splice((to.rule ? to.spec.doc.sections.indexOf(to.section) : to.index) + (target.where === "after" ? 1 : 0), 0, node);
  });
}
function nudge(uidWanted, by) {
  const f = find(uidWanted);
  if (!f) return;
  const list = f.rule ? f.section.rules : f.spec.doc.sections;
  const to = f.index + by;
  if (to < 0 || to >= list.length) return;
  change(() => list.splice(to, 0, list.splice(f.index, 1)[0]));
  focusLater(`[data-uid="${uidWanted}"] > .row`);
}
/** Focus after the next redraw, with the caret at the end of any text already there. */
const focusLater = (selector) => setTimeout(() => {
  const el = document.querySelector(selector);
  el?.focus();
  if (el && "selectionStart" in el && el.value !== undefined) el.selectionStart = el.selectionEnd = el.value.length;
}, 0);

// --- rendering ------------------------------------------------------------------------------------------

function render() {
  renderRail();
  renderDoc();
  renderBuild();
}

function renderRail() {
  const fails = failures().bySpec;
  const rail = document.getElementById("rail");
  const newName = h("input", { placeholder: "new spec", "aria-label": "Name of a new spec", pattern: "[a-z][A-Za-z0-9]*", onkeydown: (e) => e.key === "Enter" && create() });
  const create = async () => {
    const name = newName.value.trim();
    if (!name) return newName.focus();
    if (dirtySpecs().length) return toast("Publish or discard your changes first");
    try { const { file } = await api("spec", { name }); S.sel = file; await refresh(); toast(`Wrote ${file}`); } catch (e) { toast(e.message); }
  };
  rail.replaceChildren(
    h("select", { class: "project", "aria-label": "Project", onchange: (e) => { location.search = `?project=${encodeURIComponent(e.target.value)}`; } },
      S.projects.map((p) => h("option", { value: p.id, selected: p.id === S.project }, p.id === "." ? p.name : `${p.name} (example)`))),
    h("ul", { class: "specs" }, S.specs.map((spec) => {
      const review = Object.keys(S.snap?.specs.find((s) => s.file === spec.file)?.review ?? {}).length;
      const status = isDirty(spec) ? ["dirty", "unpublished changes"] : fails.has(spec.file) ? ["bad", "failing checks"] : review ? ["review", `${review} to review`] : ["", ""];
      const li = h("li", { class: `spec${spec.deleted ? " deleted" : ""}`, "aria-current": spec.file === S.sel ? "true" : "false", tabindex: 0,
        onclick: () => { S.sel = spec.file; render(); }, onkeydown: (e) => e.key === "Enter" && (S.sel = spec.file, render()) },
        h("span", { class: `dot ${status[0]}`, role: "img", "aria-label": status[1] || "in step", title: status[1] }),
        h("span", { class: "name" }, spec.name),
        h("span", { class: "count", title: "stories · rules" }, `${spec.doc.sections.length}·${spec.doc.sections.reduce((n, s) => n + s.rules.length, 0)}`),
        spec.deleted ? iconButton("undo", `Keep ${spec.name}`, () => change(() => (spec.deleted = false)))
          : iconButton("trash", `Delete ${spec.name}`, () => change(() => (spec.deleted = true), `${spec.file} will be deleted on publish`), "danger"));
      // A story dropped on a spec moves to its end.
      li.addEventListener("dragover", (e) => { if (drag?.kind === "section" && find(drag.uid)?.spec.file !== spec.file) { e.preventDefault(); li.classList.add("drop"); } });
      li.addEventListener("dragleave", () => li.classList.remove("drop"));
      li.addEventListener("drop", (e) => { e.preventDefault(); li.classList.remove("drop"); move(drag.uid, { spec: spec.file }); });
      return li;
    })),
    h("div", { class: "newspec" }, newName, iconButton("plus", "Add spec", create)),
  );
}

let drag = null;
function draggable(el, uidWanted, kind) {
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    drag = { uid: uidWanted, kind };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", uidWanted);
    requestAnimationFrame(() => el.classList.add("dragging"));
  });
  el.addEventListener("dragend", () => { el.classList.remove("dragging"); drag = null; clearDrops(); });
}
const clearDrops = () => document.querySelectorAll(".drop-before,.drop-after,.drop-into,.drop").forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-into", "drop"));
/** Where a drag over `el` would land: before or after it, by the half of it the pointer is over. */
function dropTarget(el, uidWanted, accepts) {
  el.addEventListener("dragover", (e) => {
    if (!drag || !accepts(drag.kind) || drag.uid === uidWanted) return;
    e.preventDefault();
    e.stopPropagation();
    clearDrops();
    const box = el.getBoundingClientRect();
    const into = drag.kind === "rule" && el.classList.contains("section");
    el.classList.add(into ? "drop-into" : e.clientY < box.top + box.height / 2 ? "drop-before" : "drop-after");
  });
  el.addEventListener("drop", (e) => {
    if (!drag || !accepts(drag.kind)) return;
    e.preventDefault();
    e.stopPropagation();
    const where = el.classList.contains("drop-before") ? "before" : "after";
    clearDrops();
    move(drag.uid, { uid: uidWanted, where });
  });
}

/** An auto-growing text box bound to `get` and `set`. */
function textBox(value, set, { code = false, placeholder = "", label } = {}) {
  const ta = h("textarea", { class: code ? "code" : "", spellcheck: !code, placeholder, "aria-label": label, rows: 1 });
  ta.value = value;
  const grow = () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; };
  ta.addEventListener("input", () => { grow(); set(ta.value); edited(); });
  ta.addEventListener("keydown", (e) => {
    if (code && e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
      ta.dispatchEvent(new Event("input"));
    }
  });
  setTimeout(grow, 0);
  return ta;
}

function headingInput(value, set, label) {
  const input = h("input", { class: "heading", value, "aria-label": label, placeholder: label });
  input.addEventListener("input", () => { set(input.value); input.classList.toggle("invalid", !input.value.trim()); edited(); });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    input.closest(".edit")?.querySelector("textarea")?.focus();
  });
  return input;
}

function matches(text) {
  return !S.q || text.toLowerCase().includes(S.q.toLowerCase());
}

function renderDoc() {
  const doc = document.getElementById("doc");
  const spec = current();
  const scroll = doc.scrollTop;
  const active = document.activeElement?.closest?.("[data-uid]")?.dataset.uid;
  if (!spec) {
    doc.replaceChildren(h("div", { class: "empty" }, "No specs yet: name one on the left."));
    return;
  }
  const { byKey, bySpec } = failures();
  const search = h("input", { class: "search", type: "search", placeholder: "Search  /", value: S.q, "aria-label": "Search stories and rules", oninput: (e) => { S.q = e.target.value; renderDoc(); focusLater(".search"); } });
  const anyOpen = spec.doc.sections.some((s) => S.open.has(s.uid));
  const toolbar = h("div", { class: "toolbar" }, search,
    h("button", { class: "btn toggle", type: "button", "aria-pressed": String(S.attention), title: "Only what changed or needs review", onclick: () => { S.attention = !S.attention; renderDoc(); } }, "Needs attention"),
    h("button", { class: "btn", type: "button", onclick: () => { for (const s of spec.doc.sections) for (const id of [s.uid, ...s.rules.map((r) => r.uid)]) anyOpen ? S.open.delete(id) : S.open.add(id); renderDoc(); } }, anyOpen ? "Collapse" : "Expand"));

  const conflict = S.conflicts.includes(spec.file) && h("div", { class: "banner" }, h("span", {}, `${spec.file} changed on disk while you were editing it.`),
    h("button", { class: "btn", type: "button", onclick: () => keepMine(spec.file) }, "Keep mine"),
    h("button", { class: "btn", type: "button", onclick: () => takeTheirs(spec.file) }, "Take disk"));
  const problem = S.snap?.problem && h("pre", { class: "problem" }, S.snap.problem);
  const specFails = bySpec.get(spec.file)?.filter((r) => !/"[^"]+" \(spec\//.test(`${r.summary}\n${r.detail}`));

  const headEditing = S.editing.has("head");
  const head = h("div", { class: "head", "data-uid": "head" }, headEditing
    ? h("div", { class: "edit" },
      headingInput(spec.doc.title ?? "", (v) => (spec.doc.title = v), "Title"),
      textBox(spec.doc.body.trim(), (v) => (spec.doc.body = writeText(v)), { label: "What the application is for" }),
      h("div", { class: "bar" }, h("span", { class: "spacer" }), h("button", { class: "btn", type: "button", onclick: () => { S.editing.delete("head"); renderDoc(); } }, icon("check"), "Done")))
    : [h("h1", { ondblclick: () => editNode("head"), title: "Double-click to edit" }, spec.doc.title ?? spec.name, " ", iconButton("edit", "Edit title and introduction", () => editNode("head"))),
      spec.doc.body.trim() && h("div", { class: "intro prose", html: markdown(spec.doc.body) })]);

  const sections = spec.doc.sections.map((s, i) => renderSection(spec, s, i, byKey)).filter(Boolean);
  doc.replaceChildren(toolbar, conflict || "", problem || "",
    specFails?.length ? h("div", { class: "banner bad" }, h("span", {}, specFails.map((r) => `${r.stage}: ${r.summary}`).join("\n"))) : "",
    spec.deleted ? h("div", { class: "banner bad" }, h("span", {}, "Deleted on publish."), h("button", { class: "btn", type: "button", onclick: () => change(() => (spec.deleted = false)) }, "Keep")) : "",
    head, ...sections,
    !S.q && !S.attention ? h("div", { class: "add newstory" }, h("button", { class: "btn", type: "button", onclick: () => addStory(spec) }, icon("plus"), "Story")) : "",
    sections.length || !(S.q || S.attention) ? "" : h("div", { class: "empty" }, "Nothing matches."));
  doc.scrollTop = scroll;
  if (active && !document.activeElement?.closest?.("[data-uid]")) document.querySelector(`[data-uid="${active}"] > .row`)?.focus({ preventScroll: true });
}

function editNode(id) {
  S.editing.add(id);
  S.open.add(id);
  renderDoc();
  focusLater(`[data-uid="${id}"] input.heading`);
}

/** The marks a story or rule carries: unpublished, failing a check, or waiting for review. */
function statusOf(changed, fails, review) {
  return fails?.length ? ["bad", fails.join("\n")] : review ? ["review", review] : changed ? ["dirty", "unpublished change"] : ["", ""];
}

function renderSection(spec, s, i, byKey) {
  const key = storyKey(s.title);
  const review = reviewOf(spec, key);
  const changed = sectionChanged(spec, s, i);
  const ruleViews = s.rules.map((r, j) => renderRule(spec, s, r, j, byKey)).filter(Boolean);
  const own = matches(`${s.title ?? ""}\n${s.body}`) && (!S.attention || changed || review);
  if (!own && !ruleViews.length) return null;
  const open = S.open.has(s.uid) || S.q || S.attention;
  const editing = S.editing.has(s.uid);
  const story = s.title?.startsWith("Story:");
  const [cls, label] = statusOf(changed, undefined, review);
  const row = h("div", { class: `row${editing ? " editing" : ""}`, tabindex: 0, onkeydown: (e) => keys(e, s.uid) },
    h("span", { class: "grip", title: "Drag to reorder, or to another spec", "aria-hidden": "true" }, icon("grip")),
    h("span", { class: `chev${open ? " open" : ""}`, "aria-hidden": "true", onclick: () => toggle(s.uid) }, icon("chev")),
    h("span", { class: "title", onclick: () => toggle(s.uid), ondblclick: () => editNode(s.uid) }, s.title === null ? "Before the first story" : s.title.trim() || "Untitled"),
    h("span", { class: "meta", title: "rules" }, s.rules.length),
    h("span", { class: `dot ${cls}`, role: "img", "aria-label": label || "in step", title: label }),
    h("span", { class: "actions" },
      s.title !== null && iconButton("edit", "Edit story", () => editNode(s.uid)),
      iconButton("plus", "Add rule", () => addRule(s)),
      moveMenu(s.uid, "section"),
      iconButton("trash", "Delete story and its rules", () => removeNode(s.uid), "danger")));
  const card = h("section", { class: `section${story || s.title === null ? "" : " group"}${changed ? " changed" : ""}`, "data-uid": s.uid, "aria-label": s.title ?? "Rules" }, row,
    open && editing && s.title !== null ? h("div", { class: "body edit" },
      headingInput(s.title, (v) => (s.title = v), "Story: As a … I want …"),
      textBox(s.body.trim(), (v) => (s.body = writeText(v)), { placeholder: "> As a …, I want …, so that …", label: "Story text" }),
      review ? h("div", { class: "status review" }, review) : "",
      h("div", { class: "bar" }, h("span", { class: "spacer" }), h("button", { class: "btn", type: "button", onclick: () => { S.editing.delete(s.uid); renderDoc(); } }, icon("check"), "Done")))
      : open && s.body.trim() ? h("div", { class: "story prose", html: markdown(s.body), ondblclick: () => s.title !== null && editNode(s.uid) }) : "",
    open && review && !editing ? h("div", { class: "story status review" }, review) : "",
    open ? h("ul", { class: "rules" }, ruleViews, !S.q && !S.attention ? h("li", { class: "add" }, h("button", { class: "btn", type: "button", onclick: () => addRule(s) }, icon("plus"), "Rule")) : "") : "");
  draggable(card, s.uid, "section");
  dropTarget(card, s.uid, (k) => k === "section" || k === "rule");
  return card;
}

function renderRule(spec, s, r, j, byKey) {
  const key = ruleKey(s.title, r.title);
  const review = reviewOf(spec, key);
  const fails = byKey.get(nodeId(spec.file, key));
  const changed = ruleChanged(spec, s, r, j);
  if (!matches(`${r.title}\n${r.body}`) || (S.attention && !changed && !review && !fails)) return null;
  const open = S.open.has(r.uid);
  const editing = S.editing.has(r.uid);
  const [cls, label] = statusOf(changed, fails, review);
  const dupe = s.rules.some((x) => x !== r && x.title.trim() === r.title.trim());
  const row = h("div", { class: `row${editing ? " editing" : ""}`, tabindex: 0, onkeydown: (e) => keys(e, r.uid) },
    h("span", { class: "grip", title: "Drag to reorder, or into another story", "aria-hidden": "true" }, icon("grip")),
    h("span", { class: `chev${open ? " open" : ""}`, "aria-hidden": "true", onclick: () => toggle(r.uid) }, icon("chev")),
    h("span", { class: "title", onclick: () => toggle(r.uid), ondblclick: () => editNode(r.uid), style: dupe ? "color: var(--bad)" : undefined, title: dupe ? "Two rules of a story may not share a heading" : undefined }, r.title.trim() || "Untitled"),
    h("span", { class: "kinds" }, kindsOf(r).map(([, , glyph, name]) => h("span", { title: name, role: "img", "aria-label": name }, glyph))),
    h("span", { class: `dot ${cls}`, role: "img", "aria-label": label || "in step", title: label }),
    h("span", { class: "actions" }, iconButton("edit", "Edit rule", () => editNode(r.uid)), moveMenu(r.uid, "rule"), iconButton("trash", "Delete rule", () => removeNode(r.uid), "danger")));
  const quints = r.items.filter((i) => i.quint);
  const body = !open ? "" : editing ? renderRuleEditor(r) : h("div", { class: "body" },
    r.items.map((i) => (i.quint ? h("pre", { class: "code", html: highlight(i.text) }) : h("div", { class: "prose", html: markdown(i.text) }))),
    !quints.length ? h("div", { class: "status review" }, "No Quint yet: the agent writes it on sync.") : "",
    review ? h("div", { class: "status review" }, review) : "",
    fails ? fails.map((f) => h("div", { class: "status bad" }, f)) : "");
  const li = h("li", { class: `rule${open ? " open" : ""}${changed ? " changed" : ""}`, "data-uid": r.uid, ondblclick: (e) => { if (!editing && e.target.closest(".body")) editNode(r.uid); } }, row, body);
  draggable(li, r.uid, "rule");
  dropTarget(li, r.uid, (k) => k === "rule");
  return li;
}

function renderRuleEditor(r) {
  const set = () => (r.body = writeBody(r.items));
  const items = h("div", { class: "edit" });
  const draw = () => {
    items.replaceChildren(
      headingInput(r.title, (v) => (r.title = v), "One checkable sentence"),
      ...r.items.map((item, k) => h("div", { class: "item" },
        textBox(item.text, (v) => { item.text = v; set(); }, { code: item.quint, placeholder: item.quint ? "pure def …" : "Prose (optional)", label: item.quint ? "Quint" : "Prose" }),
        h("div", { class: "side" },
          k > 0 && iconButton("up", "Move up", () => { r.items.splice(k - 1, 0, r.items.splice(k, 1)[0]); set(); draw(); edited(); }),
          iconButton("close", "Remove", () => { r.items.splice(k, 1); set(); draw(); edited(); }, "danger")))),
      h("div", { class: "bar" },
        h("button", { class: "btn", type: "button", onclick: () => { r.items.push({ quint: false, text: "" }); draw(); } }, icon("plus"), "Prose"),
        h("button", { class: "btn", type: "button", onclick: () => { r.items.push({ quint: true, text: "" }); draw(); focusLater(`[data-uid="${r.uid}"] textarea.code:last-of-type`); } }, icon("plus"), "Quint"),
        h("span", { class: "spacer" }),
        h("button", { class: "btn", type: "button", onclick: () => { S.editing.delete(r.uid); renderDoc(); } }, icon("check"), "Done")));
  };
  if (!r.items.length) r.items.push({ quint: false, text: "" });
  draw();
  return h("div", { class: "body" }, items);
}

/** "Move to…": every story of every spec for a rule, every spec for a story. Keyboard users' drag and drop. */
function moveMenu(uidWanted, kind) {
  const select = h("select", { class: "icon", title: "Move to…", "aria-label": "Move to", style: "width: 26px; appearance: none; cursor: pointer", onclick: (e) => e.stopPropagation(),
    onchange: (e) => {
      const [type, value] = e.target.value.split(":");
      if (type === "spec") move(uidWanted, { spec: value });
      else move(uidWanted, { uid: value, where: "after" });
    } },
  h("option", { value: "", selected: true, disabled: true }, "⇅"),
  kind === "rule"
    ? S.specs.filter((s) => !s.deleted).map((spec) => h("optgroup", { label: spec.name }, spec.doc.sections.map((s) => h("option", { value: `section:${s.uid}` }, s.title?.trim() || "(top)"))))
    : S.specs.filter((s) => !s.deleted && s.file !== find(uidWanted)?.spec.file).map((spec) => h("option", { value: `spec:${spec.file}` }, `to ${spec.name}`)));
  return select;
}

function toggle(id) {
  S.open.has(id) ? S.open.delete(id) : S.open.add(id);
  renderDoc();
}
function keys(e, id) {
  if (e.target !== e.currentTarget) return;
  if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); nudge(id, -1); }
  else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); nudge(id, 1); }
  else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(id); focusLater(`[data-uid="${id}"] > .row`); }
  else if (e.key === "e") { e.preventDefault(); editNode(id); }
  else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeNode(id); }
}

function keepMine(file) {
  const fresh = S.snap.specs.find((s) => s.file === file);
  const mine = S.specs.find((s) => s.file === file);
  mine.base = fresh?.hash ?? null;
  mine.orig = fresh?.text ?? null;
  S.conflicts = S.conflicts.filter((f) => f !== file);
  saveDraft();
  render();
}
function takeTheirs(file) {
  const fresh = S.snap.specs.find((s) => s.file === file);
  S.specs = S.specs.flatMap((s) => (s.file !== file ? [s] : fresh ? [working(fresh)] : []));
  S.conflicts = S.conflicts.filter((f) => f !== file);
  saveDraft();
  render();
}

// --- the build panel ------------------------------------------------------------------------------------

const STAGES = ["model", "always", "sometimes", "replay", "types", "proof", "tests", "review"];

function renderBuild() {
  const build = document.getElementById("build");
  const snap = S.snap;
  if (!snap) return;
  const dirty = dirtySpecs();
  const job = snap.job;
  const running = job?.status === "running";
  const check = snap.check;
  const manifest = snap.manifest;
  const results = check?.results ?? [];
  const blocking = results.filter((r) => !r.ok && r.stage !== "review");
  const reviews = results.filter((r) => !r.ok && r.stage === "review");
  const unformal = reviews.some((r) => /story has no rules|not formalized/.test(r.detail));
  const reviewCount = snap.specs.reduce((n, s) => n + Object.keys(s.review).length, 0);
  const canSignOff = check && !blocking.length && reviews.length && !unformal && !dirty.length && !manifest;

  const stage = (name, state, mark, label) => h("div", { class: `stage ${state}` }, h("div", { class: "node", role: "img", "aria-label": `${name}: ${label}`, title: label }, mark), name);
  const pipeline = h("div", { class: "pipeline", "aria-label": "Where the project stands" },
    stage("Edit", dirty.length ? "active" : "idle", dirty.length || "", dirty.length ? `${dirty.length} specs changed` : "nothing unpublished"),
    stage("Publish", dirty.length ? "todo" : manifest ? "ok" : "idle", "", dirty.length ? "waiting to publish" : manifest ? "published" : "nothing to publish"),
    stage("Sync", running && job.kind === "agent" ? "running" : manifest ? "todo" : "ok", manifest ? manifest.changes.length : "", manifest ? `${manifest.changes.length} changes for the agent` : "in step"),
    stage("Check", running && job.kind === "check" ? "running" : !check ? "idle" : blocking.length ? "bad" : "ok", blocking.length || "", !check ? "not run yet" : blocking.length ? `${blocking.length} failing` : "passing"),
    stage("Sign off", running && job.kind === "accept" ? "running" : reviewCount ? "todo" : check?.ok ? "ok" : "idle", reviewCount || "", reviewCount ? `${reviewCount} to review` : "nothing to review"));

  const publishBlock = h("div", { class: "block" },
    h("div", { class: "buttons" },
      h("button", { class: "btn primary", type: "button", disabled: running || !dirty.length, onclick: openPublish, title: "⌘S" }, icon("check"), dirty.length ? `Publish ${dirty.length}` : "Publish"),
      dirty.length ? h("button", { class: "btn", type: "button", onclick: discard }, "Discard") : ""));

  const sign = { added: "+", deleted: "−", changed: "~" };
  const manifestBlock = manifest && h("div", { class: "block" },
    h("h2", {}, "To sync", h("span", { class: "spacer" }), h("button", { class: "btn", type: "button", title: "The agent has synced these; start a new manifest", onclick: markSynced }, "Mark synced")),
    h("ul", { class: "changes" }, manifest.changes.map((c) => h("li", {}, h("span", { class: `sign ${c.action}`, "aria-label": c.action }, sign[c.action]),
      h("span", {}, c.kind === "spec" ? c.key : c.key.replace(/^## /, "").replace(/^Story: /, ""), c.what.length ? h("div", { class: "what" }, c.what.join(" · ")) : "")))),
    manifest.regenerate.length ? h("div", { class: "what" }, `↻ ${manifest.regenerate.map((r) => r.gen).join(", ")}`) : "");

  const agents = h("div", { class: "block" },
    h("h2", {}, "Agent", h("span", { class: "spacer" }), iconButton("copy", "Copy the sync prompt", copyPrompt)),
    snap.agents.map((a) => h("div", { class: "agent" },
      h("span", { class: "label" }, a.label),
      h("button", { class: "btn", type: "button", disabled: running || !a.available || dirty.length > 0, title: !a.available ? `${a.label} is not installed` : dirty.length ? "Publish first" : `Run ${a.label} here on the sync prompt`, onclick: () => start("agent", { agent: a.id }) }, icon("play"), "Run"),
      a.link ? h("a", { class: "btn", href: a.link, title: `Open ${a.label} on the sync prompt in a new chat` }, icon("open"), "Open") : "")));

  const jobBlock = job && h("div", { class: "job" },
    h("div", { class: "top" },
      h("span", { class: `dot ${running ? "dirty" : job.status === "passed" ? "ok" : "bad"}`, role: "img", "aria-label": job.status }),
      h("span", { class: "label" }, job.label),
      h("span", { class: "meta", id: "elapsed" }, elapsed(job)),
      running ? iconButton("stop", "Stop", () => api("stop", {})) : ""),
    h("pre", { id: "log" }, job.log.join("\n") || "…"));

  const checkBlock = h("div", { class: "block" },
    h("h2", {}, "Check", h("span", { class: "spacer" }), check ? h("span", { class: "meta" }, new Date(check.finished).toLocaleTimeString()) : ""),
    check ? h("div", { class: "stages" }, STAGES.map((st) => {
      const of = results.filter((r) => r.stage === st);
      const skipped = results.some((r) => r.stage === "skipped" && r.summary.includes(st));
      const state = of.some((r) => !r.ok) ? (st === "review" ? "review" : "bad") : of.length ? "ok" : skipped ? "" : "";
      return h("span", { class: state, title: of.map((r) => r.summary).join("\n") || (skipped ? "skipped" : "") }, st);
    })) : "",
    check ? h("div", { class: "next" }, check.next) : "",
    blocking.length ? h("div", { class: "results" }, blocking.map((r) => h("details", {}, h("summary", {}, `${r.stage}: ${r.summary}`), r.detail ? h("pre", {}, r.detail) : ""))) : "",
    h("div", { class: "buttons" },
      h("button", { class: "btn", type: "button", disabled: running, onclick: () => start("check") }, icon("play"), "Run check"),
      h("button", { class: "btn", type: "button", disabled: running || !canSignOff, title: canSignOff ? "Record the reviewed rules (npm run accept)" : "Only when every stage but review passes and nothing is unpublished or unsynced", onclick: signOff }, icon("check"), "Sign off")));

  build.replaceChildren(pipeline, publishBlock, manifestBlock || "", agents, jobBlock || "", checkBlock);
  const log = document.getElementById("log");
  if (log) log.scrollTop = log.scrollHeight;
}
const elapsed = (job) => { const s = Math.round(((job.finished ?? Date.now()) - job.started) / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
setInterval(() => { const el = document.getElementById("elapsed"); if (el && S.snap?.job?.status === "running") el.textContent = elapsed(S.snap.job); }, 1000);

async function start(kind, body = {}) {
  try { await api(kind, body); } catch (e) { toast(e.message); }
}
async function copyPrompt() {
  try { await navigator.clipboard.writeText(S.snap.prompt); toast("Sync prompt copied"); } catch { toast("Could not copy"); }
}
async function markSynced() {
  await api("synced", {});
  await refresh();
}
async function signOff() {
  const count = S.snap.specs.reduce((n, s) => n + Object.keys(s.review).length, 0);
  if (!confirm(`Sign off ${count} stories and rules? Do so only once you have read each one's prose and Quint and found they say the same thing.`)) return;
  start("accept");
}
function discard() {
  if (!confirm(`Discard unpublished changes to ${dirtySpecs().map((s) => s.file).join(", ")}?`)) return;
  change(() => { S.specs = S.snap.specs.map(working); S.conflicts = []; S.editing.clear(); });
}

// --- publishing -------------------------------------------------------------------------------------------

/** Line diff by longest common subsequence, with three lines of context around each change. */
function diff(a, b) {
  const x = a.split("\n"), y = b.split("\n");
  const n = x.length, m = y.length;
  const t = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { ops.push([" ", x[i]]); i++; j++; }
    else if (j < m && (i >= n || t[i][j + 1] >= t[i + 1][j])) ops.push(["+", y[j++]]);
    else ops.push(["-", x[i++]]);
  }
  const near = ops.map((_, k) => ops.slice(Math.max(0, k - 3), k + 4).some(([op]) => op !== " "));
  const out = [];
  ops.forEach(([op, line], k) => {
    if (near[k]) out.push(h("div", { class: `l ${op === "+" ? "add" : op === "-" ? "del" : ""}` }, `${op} ${line}`));
    else if (near[k - 1] || k === 0) out.push(h("div", { class: "l gap" }, "…"));
  });
  return out;
}

/** Problems that would make the published spec mean something other than what the page shows. */
function problems(spec) {
  const out = [];
  if (spec.deleted) return out;
  const keys = new Set();
  for (const s of spec.doc.sections) {
    if (s.title !== null && !s.title.trim()) out.push("a story has no title");
    for (const r of s.rules) {
      if (!r.title.trim()) out.push(`a rule of “${s.title?.trim()}” has no heading`);
      const key = ruleKey(s.title, r.title);
      if (keys.has(key)) out.push(`two rules are called “${r.title.trim()}” in “${s.title?.trim()}”`);
      keys.add(key);
    }
  }
  const stories = spec.doc.sections.map((s) => storyKey(s.title)).filter(Boolean);
  if (new Set(stories).size !== stories.length) out.push("two stories share a title");
  return out.map((p) => `${spec.file}: ${p}`);
}

function openPublish() {
  const dirty = dirtySpecs();
  if (S.publishing || !dirty.length || S.snap?.job?.status === "running") return;
  const bad = dirty.flatMap(problems);
  const dialog = document.getElementById("dialog");
  dialog.replaceChildren(h("form", { method: "dialog" },
    h("header", {}, `Publish ${dirty.length === 1 ? dirty[0].file : `${dirty.length} specs`}`),
    h("div", { class: "content" },
      bad.length ? h("div", { class: "banner bad" }, h("span", {}, bad.join("\n"))) : "",
      dirty.map((spec) => h("div", { class: "diff" }, h("div", { class: "file" }, spec.deleted ? `${spec.file} (deleted)` : spec.orig === null ? `${spec.file} (new)` : spec.file),
        spec.deleted ? "" : diff(spec.orig ?? "", textOf(spec))))),
    h("footer", {},
      h("button", { class: "btn", value: "cancel" }, "Cancel"),
      h("button", { class: "btn primary", value: "publish", disabled: bad.length > 0, onclick: (e) => { e.preventDefault(); dialog.close(); publish(); } }, icon("check"), "Publish"))));
  dialog.showModal();
}

async function publish(force = false) {
  if (S.publishing) return;
  const dirty = dirtySpecs();
  const origins = [];
  for (const spec of dirty) if (!spec.deleted) for (const s of spec.doc.sections) {
    if (s.title !== null) origins.push([nodeId(spec.file, storyKey(s.title)), s.origin]);
    for (const r of s.rules) origins.push([nodeId(spec.file, ruleKey(s.title, r.title)), r.origin]);
  }
  S.publishing = true;
  try {
    await api("publish", { files: dirty.map((s) => ({ file: s.file, base: s.base, text: textOf(s) })), origins, force });
  } catch (e) {
    S.publishing = false;
    if (e.status === 409 && confirm(`${e.body.conflicts.join(", ")} changed on disk since you loaded it. Overwrite with your version?`)) return publish(true);
    return toast(e.message);
  }
  // What was published is what is on disk now; the reload takes each spec from there.
  for (const spec of dirty) spec.orig = textOf(spec);
  S.specs = S.specs.filter((s) => !s.deleted);
  S.editing.clear();
  S.history = [];
  S.publishing = false;
  try { localStorage.removeItem(draftKey()); } catch { /* nothing saved */ }
  await refresh(true);
  toast("Published");
}

// --- start -------------------------------------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");
  if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); openPublish(); }
  else if ((e.metaKey || e.ctrlKey) && e.key === "z" && !typing && S.history.length) { e.preventDefault(); undo(); }
  else if (e.key === "/" && !typing) { e.preventDefault(); document.querySelector(".search")?.focus(); }
  else if (e.key === "Escape" && typing && S.editing.size && !document.getElementById("dialog").open) {
    const id = document.activeElement.closest("[data-uid]")?.dataset.uid;
    if (id && S.editing.delete(id)) { renderDoc(); focusLater(`[data-uid="${id}"] > .row`); }
  }
});
document.addEventListener("focusout", (e) => {
  if (document.getElementById("doc").contains(e.target) && /^(INPUT|TEXTAREA)$/.test(e.target.tagName))
    setTimeout(() => refresh().catch((error) => toast(error.message)), 0);
});
window.addEventListener("beforeunload", (e) => { if (dirtySpecs().length) saveDraft(); });

const { projects, open } = await (await fetch("/api/projects")).json();
S.projects = projects;
S.project ??= open;
await refresh();
const events = new EventSource(`/api/events?project=${encodeURIComponent(S.project)}`);
events.addEventListener("files", () => refresh());
events.addEventListener("job", (e) => {
  const { job, check } = JSON.parse(e.data);
  const ended = S.snap.job?.status === "running" && job?.status !== "running";
  S.snap.job = job;
  S.snap.check = check;
  if (ended) refresh();
  else renderBuild();
});
