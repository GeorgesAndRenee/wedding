// =====================================================================
// Same project as the guest-facing site — use the same two values
// from app.js. See README.md for where to find them.
// =====================================================================
const SUPABASE_URL = "https://hhuremghrfgpxyjjxtrq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_-yS_D38jzS-5j1Xwk2Qn4A_Ug-hkqHW";

const BUCKET = "wedding-photos";
const TABLE = "photos";

// ---------------------------------------------------------------------

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginScreen = document.getElementById("login-screen");
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("admin-email");
const passwordInput = document.getElementById("admin-password");
const loginError = document.getElementById("login-error");
const loginBtn = document.getElementById("login-btn");

const adminScreen = document.getElementById("admin-screen");
const photoCountEl = document.getElementById("photo-count");
const adminGrid = document.getElementById("admin-grid");
const emptyState = document.getElementById("empty-state");
const adminStatus = document.getElementById("admin-status");
const downloadAllBtn = document.getElementById("download-all-btn");
const logoutBtn = document.getElementById("logout-btn");
const nameFilter = document.getElementById("name-filter");
const selectAllCheckbox = document.getElementById("select-all");
const bulkBar = document.getElementById("bulk-bar");
const bulkCountEl = document.getElementById("bulk-count");
const downloadSelectedBtn = document.getElementById("download-selected-btn");
const deleteSelectedBtn = document.getElementById("delete-selected-btn");

let rows = []; // every loaded photo record
let filteredRows = []; // rows currently shown, after the name filter
let urlByPath = {}; // storage_path -> signed preview URL
let selectedIds = new Set(); // ids checked via the per-photo checkboxes

/* --------------------------------- Auth --------------------------------- */

function showAdmin() {
  loginScreen.hidden = true;
  adminScreen.hidden = false;
  loadPhotos();
}
function showLogin() {
  adminScreen.hidden = true;
  loginScreen.hidden = false;
}

// Restore a session if this browser already logged in before
// (supabase-js keeps it in localStorage automatically).
client.auth.getSession().then(({ data }) => {
  if (data.session) showAdmin();
  else showLogin();
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  loginBtn.disabled = true;

  const { error } = await client.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value,
  });

  loginBtn.disabled = false;

  if (error) {
    loginError.textContent = "That email or password isn't right.";
    return;
  }
  passwordInput.value = "";
  showAdmin();
});

logoutBtn.addEventListener("click", async () => {
  await client.auth.signOut();
  rows = [];
  filteredRows = [];
  urlByPath = {};
  selectedIds.clear();
  adminGrid.innerHTML = "";
  showLogin();
});

/* -------------------------------- Loading -------------------------------- */

function slugify(text) {
  return (
    text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "guest"
  );
}

function baseFilename(row) {
  // storage_path is "<guest-folder>/<timestamp>-<shortid>-<originalname>"
  // (older uploads made before folders existed won't have the "/" part).
  const afterFolder = row.storage_path.includes("/")
    ? row.storage_path.split("/").slice(1).join("/")
    : row.storage_path;
  const match = afterFolder.match(/^(\d+)-([a-z0-9]+)-(.+)$/i);
  const shortId = match ? match[2] : Math.random().toString(36).slice(2, 8);
  const original = match ? match[3] : afterFolder;
  return `${shortId}-${original}`;
}

function friendlyFilename(row) {
  const namePart = (row.guest_name || "guest").trim().replace(/[^a-zA-Z0-9]+/g, "_");
  return `${namePart}-${baseFilename(row)}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/* ------------------------------- Filtering ------------------------------- */

function populateNameFilter() {
  const counts = {};
  for (const row of rows) {
    const key = row.guest_name || "A guest";
    counts[key] = (counts[key] || 0) + 1;
  }
  const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));

  const previousValue = nameFilter.value;
  nameFilter.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = `All guests (${rows.length})`;
  nameFilter.appendChild(allOption);

  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${name} (${counts[name]})`;
    nameFilter.appendChild(opt);
  }

  // Keep the previous selection if that guest still has photos
  if (names.includes(previousValue)) nameFilter.value = previousValue;
}

function applyFilter() {
  const selected = nameFilter.value;
  filteredRows = selected ? rows.filter((r) => (r.guest_name || "A guest") === selected) : rows;
  downloadAllBtn.textContent = selected ? "Download shown as ZIP" : "Download all as ZIP";
  renderGrid();
}

nameFilter.addEventListener("change", applyFilter);

function syncSelectAllCheckbox() {
  if (!filteredRows.length) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    return;
  }
  const selectedCount = filteredRows.filter((r) => selectedIds.has(r.id)).length;
  selectAllCheckbox.checked = selectedCount === filteredRows.length;
  selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < filteredRows.length;
}

function updateBulkBar() {
  const count = selectedIds.size;
  bulkBar.hidden = count === 0;
  bulkCountEl.textContent = count === 1 ? "1 photo selected" : `${count} photos selected`;
}

selectAllCheckbox.addEventListener("change", () => {
  if (selectAllCheckbox.checked) {
    filteredRows.forEach((r) => selectedIds.add(r.id));
  } else {
    filteredRows.forEach((r) => selectedIds.delete(r.id));
  }
  renderGrid();
});

function renderGrid() {
  adminGrid.innerHTML = "";

  photoCountEl.textContent =
    filteredRows.length === rows.length
      ? rows.length === 1
        ? "1 photo"
        : `${rows.length} photos`
      : `${filteredRows.length} of ${rows.length} photos`;

  emptyState.hidden = filteredRows.length > 0;
  for (const row of filteredRows) {
    adminGrid.appendChild(buildCard(row, urlByPath[row.storage_path]));
  }

  syncSelectAllCheckbox();
  updateBulkBar();
}

async function loadPhotos() {
  adminStatus.textContent = "Loading photos…";
  adminGrid.innerHTML = "";
  emptyState.hidden = true;

  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    adminStatus.textContent = "Couldn't load photos. Please refresh and try again.";
    console.error(error);
    return;
  }

  rows = data;

  if (!rows.length) {
    photoCountEl.textContent = "";
    nameFilter.innerHTML = '<option value="">All guests</option>';
    adminStatus.textContent = "";
    emptyState.hidden = false;
    downloadAllBtn.disabled = true;
    selectedIds.clear();
    bulkBar.hidden = true;
    return;
  }
  downloadAllBtn.disabled = false;

  // One batched call for preview URLs, valid for an hour, rather than
  // one request per photo.
  const paths = rows.map((r) => r.storage_path);
  const { data: signedUrls, error: signError } = await client.storage
    .from(BUCKET)
    .createSignedUrls(paths, 3600);

  if (signError) {
    adminStatus.textContent = "Loaded the list, but couldn't load previews.";
    console.error(signError);
  } else {
    adminStatus.textContent = "";
  }

  urlByPath = {};
  (signedUrls || []).forEach((entry) => {
    if (entry && !entry.error) urlByPath[entry.path] = entry.signedUrl;
  });

  populateNameFilter();
  applyFilter();
}

function buildCard(row, previewUrl) {
  const card = document.createElement("div");
  card.className = "admin-card";

  const thumb = document.createElement("div");
  thumb.className = "admin-card__thumb";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "admin-card__select";
  checkbox.setAttribute("aria-label", `Select photo from ${row.guest_name || "a guest"}`);
  checkbox.checked = selectedIds.has(row.id);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selectedIds.add(row.id);
    else selectedIds.delete(row.id);
    syncSelectAllCheckbox();
    updateBulkBar();
  });
  thumb.appendChild(checkbox);

  if (previewUrl) {
    const img = document.createElement("img");
    img.src = previewUrl;
    img.alt = `Photo shared by ${row.guest_name || "a guest"}`;
    img.loading = "lazy";
    thumb.appendChild(img);
  }
  card.appendChild(thumb);

  const meta = document.createElement("div");
  meta.className = "admin-card__meta";

  const name = document.createElement("p");
  name.className = "admin-card__name";
  name.textContent = row.guest_name || "A guest"; // textContent, not innerHTML
  meta.appendChild(name);

  const time = document.createElement("p");
  time.className = "admin-card__time";
  time.textContent = formatDate(row.created_at);
  meta.appendChild(time);

  card.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "admin-card__actions";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "admin-card__action";
  downloadBtn.textContent = "Download";
  downloadBtn.addEventListener("click", () => downloadSingle(row));
  actions.appendChild(downloadBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "admin-card__action admin-card__action--danger";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => deletePhotos([row]));
  actions.appendChild(deleteBtn);

  card.appendChild(actions);

  return card;
}

/* ------------------------------- Downloads ------------------------------- */

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadSingle(row) {
  const { data, error } = await client.storage.from(BUCKET).download(row.storage_path);
  if (error) {
    console.error(error);
    alert("Couldn't download that photo. Please try again.");
    return;
  }
  triggerBlobDownload(data, friendlyFilename(row));
}

async function downloadRowsAsZip(targetRows, zipName) {
  if (!targetRows.length) return;

  const zip = new JSZip();
  let done = 0;

  for (const row of targetRows) {
    adminStatus.textContent = `Zipping photo ${done + 1} of ${targetRows.length}…`;
    try {
      const { data, error } = await client.storage.from(BUCKET).download(row.storage_path);
      if (error) throw error;
      const folder = slugify(row.guest_name || "guest");
      zip.file(`${folder}/${baseFilename(row)}`, data);
    } catch (err) {
      console.error(err);
    }
    done++;
  }

  adminStatus.textContent = "Preparing your download…";
  const content = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(content, zipName);
  adminStatus.textContent = "";
}

downloadAllBtn.addEventListener("click", async () => {
  downloadAllBtn.disabled = true;
  const zipName = nameFilter.value ? `wedding-photos-${slugify(nameFilter.value)}.zip` : "wedding-photos.zip";
  await downloadRowsAsZip(filteredRows, zipName);
  downloadAllBtn.disabled = false;
});

downloadSelectedBtn.addEventListener("click", async () => {
  const targets = rows.filter((r) => selectedIds.has(r.id));
  downloadSelectedBtn.disabled = true;
  await downloadRowsAsZip(targets, "wedding-photos-selected.zip");
  downloadSelectedBtn.disabled = false;
});

/* -------------------------------- Deleting -------------------------------- */

async function deletePhotos(targetRows) {
  if (!targetRows.length) return;

  const confirmMsg =
    targetRows.length === 1
      ? "Delete this photo? This can't be undone."
      : `Delete these ${targetRows.length} photos? This can't be undone.`;
  if (!confirm(confirmMsg)) return;

  adminStatus.textContent =
    targetRows.length === 1 ? "Deleting photo…" : `Deleting ${targetRows.length} photos…`;

  const paths = targetRows.map((r) => r.storage_path);
  const ids = targetRows.map((r) => r.id);

  const { error: storageError } = await client.storage.from(BUCKET).remove(paths);
  if (storageError) console.error(storageError); // still try to remove the records below

  const { error: dbError } = await client.from(TABLE).delete().in("id", ids);
  if (dbError) {
    console.error(dbError);
    adminStatus.textContent = "Something went wrong deleting those photos. Please try again.";
    return;
  }

  for (const id of ids) selectedIds.delete(id);
  await loadPhotos();
}

deleteSelectedBtn.addEventListener("click", () => {
  const targets = rows.filter((r) => selectedIds.has(r.id));
  deletePhotos(targets);
});
