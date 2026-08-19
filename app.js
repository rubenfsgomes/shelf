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
      <div class="card-drag"><p class="card-thought">${escapeHtml(surfaced.text)}</p></div>
      <div class="actions">
        <button class="act did" id="did">Did it</button>
        <button class="act" id="later">Not now</button>
        <button class="act letgo" id="letgo">Let it go</button>
      </div>
    </section>
  `);
  render(view);

  // shared by both the tap targets and the swipe gesture below
  async function doDid() {
    await saveThought(markDone(surfaced));
    showRest("Nice.", "One less open loop.");
  }
  function doLater() {
    showRest("Okay.", "It'll come back around.");
  }
  async function doLetGo() {
    // commit immediately (nothing lost if the tab closes), offer a brief undo
    await saveThought(kill(surfaced));
    showRest("Let go.", "You don't have to carry that one.");
    showUndoToast("Let go.", async () => {
      await saveThought({ ...surfaced, status: "open" });
      showCapture();
    });
  }

  view.querySelector("#did").addEventListener("click", doDid);
  view.querySelector("#later").addEventListener("click", doLater);
  view.querySelector("#letgo").addEventListener("click", doLetGo);

  attachSwipe(view.querySelector(".card-drag"), { onDid: doDid, onLater: doLater, onLetGo: doLetGo });
}

/* ---------- swipe: right = did it, left = not now, down = let it go ---------- */
function attachSwipe(card, { onDid, onLater, onLetGo }) {
  const THRESH_X = 100;
  const THRESH_Y = 90;
  let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false, pointerId = null;

  function onDown(e) {
    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    dx = dy = 0;
    card.setPointerCapture(pointerId);
    card.style.transition = "none";
    card.classList.add("dragging");
  }
  function onMove(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    const rot = dx / 18;
    const dragY = Math.max(dy, dy * 0.4); // resist upward drag, let downward drag through
    card.style.transform = `translate(${dx}px, ${dragY}px) rotate(${rot}deg)`;
    card.style.opacity = String(Math.max(0.25, 1 - (Math.abs(dx) + Math.max(dy, 0)) / 420));
  }
  function onUp(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    card.classList.remove("dragging");
    const horiz = Math.abs(dx) > Math.abs(dy);
    if (horiz && dx > THRESH_X) return commit("right", onDid);
    if (horiz && dx < -THRESH_X) return commit("left", onLater);
    if (!horiz && dy > THRESH_Y) return commit("down", onLetGo);
    snapBack();
  }
  function onCancel(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    card.classList.remove("dragging");
    snapBack();
  }
  function commit(dir, action) {
    const flyX = dir === "right" ? 520 : dir === "left" ? -520 : dx;
    const flyY = dir === "down" ? 560 : Math.max(dy, 0);
    card.style.transition = "transform 0.3s var(--ease), opacity 0.3s var(--ease)";
    card.style.transform = `translate(${flyX}px, ${flyY}px) rotate(${dx / 18}deg)`;
    card.style.opacity = "0";
    setTimeout(action, 260);
  }
  function snapBack() {
    card.style.transition = "transform 0.3s var(--ease), opacity 0.3s var(--ease)";
    card.style.transform = "";
    card.style.opacity = "";
  }

  card.addEventListener("pointerdown", onDown);
  card.addEventListener("pointermove", onMove);
  card.addEventListener("pointerup", onUp);
  card.addEventListener("pointercancel", onCancel);
}

/* ---------- undo toast: for actions that shouldn't feel final-final ---------- */
function showUndoToast(message, onUndo, duration = 4500) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const toast = el(`
    <div class="toast">
      <span>${escapeHtml(message)}</span>
      <button class="undo">Undo</button>
    </div>
  `);
  document.getElementById("app").appendChild(toast);

  let dismissed = false;
  const timer = setTimeout(dismiss, duration);
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 200);
  }
  toast.querySelector(".undo").addEventListener("click", async () => {
    dismiss();
    await onUndo();
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
