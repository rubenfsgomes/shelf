import { surfaceOne, markSurfaced, markDone, kill } from "./surfacing.js";

/* ---------- storage: one IndexedDB object store, promise-wrapped ---------- */
const DB_NAME = "shelf";
const STORE = "thoughts";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function allThoughts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveThought(t) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(t);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function openCount() {
  return (await allThoughts()).filter((t) => t.status === "open").length;
}

/* ---------- tiny DOM helpers ---------- */
const stage = document.getElementById("stage");
const tabCapture = document.getElementById("tab-capture");
const tabSurface = document.getElementById("tab-surface");

function el(html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild;
}
function render(node) {
  stage.replaceChildren(node);
}
function setTab(which) {
  tabCapture.setAttribute("aria-selected", String(which === "capture"));
  tabSurface.setAttribute("aria-selected", String(which === "surface"));
}

/* ---------- capture view ---------- */
async function showCapture() {
  setTab("capture");
  const count = await openCount();
  const view = el(`
    <section class="capture rise">
      <label for="entry">What's on your mind?</label>
      <textarea id="entry" placeholder="Set it down here…" autocomplete="off"></textarea>
      <button class="primary" id="shelf" disabled>Shelf it</button>
      <div class="capture-foot">
        <span id="count">${count === 0 ? "Shelf is clear" : `${count} on the shelf`}</span>
        <button class="linkish" id="go-surface">Surface one &rarr;</button>
      </div>
    </section>
  `);
  render(view);

  const entry = view.querySelector("#entry");
  const shelf = view.querySelector("#shelf");
  const onInput = () => (shelf.disabled = entry.value.trim().length === 0);
  entry.addEventListener("input", onInput);
  entry.focus();

  shelf.addEventListener("click", async () => {
    const text = entry.value.trim();
    if (!text) return;
    await saveThought({
      id: crypto.randomUUID(),
      text,
      createdAt: Date.now(),
      lastSurfacedAt: null,
      surfaceCount: 0,
      status: "open",
    });
    entry.value = "";
    shelf.disabled = true;
    shelf.textContent = "Shelved";
    view.querySelector("#count").textContent = `${await openCount()} on the shelf`;
    setTimeout(() => (shelf.textContent = "Shelf it"), 900);
    entry.focus();
  });

  view.querySelector("#go-surface").addEventListener("click", showSurface);
}

/* ---------- surface view: draw one, hand it back ---------- */
async function showSurface() {
  setTab("surface");
  const thoughts = await allThoughts();
  const picked = surfaceOne(thoughts);

  if (!picked) return showRest("Nothing to surface.", "Your shelf is clear. Breathe.", { none: true });

  // mark surfaced the moment it's shown — "Not now" then needs no extra state change
  const surfaced = markSurfaced(picked);
  await saveThought(surfaced);

  const view = el(`
    <section class="rise">
      <p class="card-thought">${escapeHtml(surfaced.text)}</p>
      <div class="actions">
        <button class="act did" id="did">Did it</button>
        <button class="act" id="later">Not now</button>
        <button class="act letgo" id="letgo">Let it go</button>
      </div>
    </section>
  `);
  render(view);

  view.querySelector("#did").addEventListener("click", async () => {
    await saveThought(markDone(surfaced));
    showRest("Nice.", "One less open loop.");
  });
  view.querySelector("#later").addEventListener("click", () =>
    showRest("Okay.", "It'll come back around."),
  );
  view.querySelector("#letgo").addEventListener("click", async () => {
    await saveThought(kill(surfaced));
    showRest("Let go.", "You don't have to carry that one.");
  });
}

/* ---------- rest / empty: always an invitation to act ---------- */
function showRest(heading, sub, { none = false } = {}) {
  const view = el(`
    <section class="rest rise">
      <h2>${escapeHtml(heading)}</h2>
      <p>${escapeHtml(sub)}</p>
      <button class="primary" id="another">${none ? "Add a thought" : "Surface another"}</button>
      <button class="linkish" id="back">Back to capture</button>
    </section>
  `);
  render(view);
  view.querySelector("#another").addEventListener("click", none ? showCapture : showSurface);
  view.querySelector("#back").addEventListener("click", showCapture);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

/* ---------- wire tabs + boot ---------- */
tabCapture.addEventListener("click", showCapture);
tabSurface.addEventListener("click", showSurface);
showCapture();
