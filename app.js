// =====================================================================
// CONFIGURE THESE TWO VALUES — see README.md for where to find them.
// Both are meant to be public: Supabase's "anon" key is safe to expose
// in client-side code, because access is controlled by the Row Level
// Security policies you set up in the dashboard/SQL editor, not by
// keeping this key secret.
// =====================================================================
const SUPABASE_URL = "https://hhuremghrfgpxyjjxtrq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_-yS_D38jzS-5j1Xwk2Qn4A_Ug-hkqHW";

const BUCKET = "wedding-photos";
const TABLE = "photos";

// Client-side limits (also set matching limits on the bucket itself
// in the Supabase dashboard — see README.md — since anyone can bypass
// checks that only run in the browser).
const MAX_FILES_PER_BATCH = 15;
const MAX_FILE_SIZE_MB = 15;

// ---------------------------------------------------------------------

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileListEl = document.getElementById("file-list");
const nameInput = document.getElementById("guest-name");
const uploadForm = document.getElementById("upload-form");
const uploadBtn = document.getElementById("upload-btn");
const statusEl = document.getElementById("form-status");
const photoGrid = document.getElementById("photo-grid");
const emptyState = document.getElementById("empty-state");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxCaption = document.getElementById("lightbox-caption");
const lightboxClose = document.getElementById("lightbox-close");

// selectedFiles holds { file, id, status } — status: "ready" | "uploading" | "done" | "error"
let selectedFiles = [];

/* --------------------------- Dropzone / file picking --------------------------- */

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

["dragover", "dragenter"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dropzone--active");
  })
);
["dragleave", "dragend", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, () => dropzone.classList.remove("dropzone--active"))
);
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  addFiles(Array.from(e.dataTransfer.files || []));
});

fileInput.addEventListener("change", () => {
  addFiles(Array.from(fileInput.files || []));
  fileInput.value = ""; // allow picking the same file again later
});

function addFiles(files) {
  const room = MAX_FILES_PER_BATCH - selectedFiles.length;
  if (room <= 0) {
    setStatus(`You can add up to ${MAX_FILES_PER_BATCH} photos at a time.`, "error");
    return;
  }

  const accepted = [];
  for (const file of files.slice(0, room)) {
    if (!file.type.startsWith("image/")) continue;
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setStatus(`"${file.name}" is over ${MAX_FILE_SIZE_MB}MB and was skipped.`, "error");
      continue;
    }
    accepted.push({ file, id: crypto.randomUUID(), status: "ready" });
  }

  selectedFiles = selectedFiles.concat(accepted);
  renderFileList();
  updateUploadButton();
}

function removeFile(id) {
  selectedFiles = selectedFiles.filter((f) => f.id !== id);
  renderFileList();
  updateUploadButton();
}

function renderFileList() {
  fileListEl.innerHTML = "";
  for (const entry of selectedFiles) {
    const li = document.createElement("li");
    li.className = "file-item";

    const thumb = document.createElement("img");
    thumb.className = "file-item__thumb";
    thumb.src = URL.createObjectURL(entry.file);
    thumb.alt = "";
    li.appendChild(thumb);

    const name = document.createElement("span");
    name.className = "file-item__name";
    name.textContent = entry.file.name;
    li.appendChild(name);

    const status = document.createElement("span");
    status.className = "file-item__status";
    if (entry.status === "uploading") { status.textContent = "Uploading…"; }
    else if (entry.status === "done") { status.textContent = "Uploaded"; status.classList.add("file-item__status--done"); }
    else if (entry.status === "error") { status.textContent = "Failed"; status.classList.add("file-item__status--error"); }
    li.appendChild(status);

    if (entry.status === "ready" || entry.status === "error") {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "file-item__remove";
      removeBtn.setAttribute("aria-label", `Remove ${entry.file.name}`);
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => removeFile(entry.id));
      li.appendChild(removeBtn);
    }

    fileListEl.appendChild(li);
  }
}

function updateUploadButton() {
  const hasName = nameInput.value.trim().length > 0;
  const hasFiles = selectedFiles.some((f) => f.status === "ready" || f.status === "error");
  uploadBtn.disabled = !(hasName && hasFiles);
}
nameInput.addEventListener("input", updateUploadButton);

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.classList.remove("form-status--error", "form-status--success");
  if (kind) statusEl.classList.add(`form-status--${kind}`);
}

/* --------------------------------- Upload --------------------------------- */

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const guestName = nameInput.value.trim();
  const toUpload = selectedFiles.filter((f) => f.status === "ready" || f.status === "error");
  if (!guestName || toUpload.length === 0) return;

  uploadBtn.disabled = true;
  let successCount = 0;

  for (const entry of toUpload) {
    entry.status = "uploading";
    renderFileList();

    try {
      const safeName = entry.file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const path = `${Date.now()}-${entry.id.slice(0, 8)}-${safeName}`;

      const { error: uploadError } = await client.storage
        .from(BUCKET)
        .upload(path, entry.file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      const { data: urlData } = client.storage.from(BUCKET).getPublicUrl(path);

      const { error: insertError } = await client.from(TABLE).insert({
        guest_name: guestName,
        url: urlData.publicUrl,
        storage_path: path,
      });
      if (insertError) throw insertError;

      entry.status = "done";
      successCount++;
    } catch (err) {
      console.error(err);
      entry.status = "error";
    }
    renderFileList();
  }

  selectedFiles = selectedFiles.filter((f) => f.status !== "done");

  if (successCount === toUpload.length) {
    setStatus("Thank you! Your photos are in the gallery below.", "success");
    uploadForm.reset();
    nameInput.value = guestName; // keep the name filled in for a second batch
  } else if (successCount > 0) {
    setStatus("Some photos uploaded, but a few failed. You can try those again.", "error");
  } else {
    setStatus("That didn't go through. Please check your connection and try again.", "error");
  }

  renderFileList();
  updateUploadButton();
});

/* --------------------------------- Gallery --------------------------------- */

function escapeForAlt(text) {
  return text.replace(/\s+/g, " ").trim();
}

function buildPhotoCard(row) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "photo-card";

  const img = document.createElement("img");
  img.src = row.url;
  img.alt = `Photo shared by ${escapeForAlt(row.guest_name || "a guest")}`;
  img.loading = "lazy";
  card.appendChild(img);

  const label = document.createElement("span");
  label.className = "photo-card__name";
  label.textContent = row.guest_name || "A guest"; // textContent — never innerHTML — so a guest's
  card.appendChild(label);                          // name can never inject markup into the page

  card.addEventListener("click", () => openLightbox(row));
  return card;
}

function openLightbox(row) {
  lightboxImg.src = row.url;
  lightboxImg.alt = `Photo shared by ${escapeForAlt(row.guest_name || "a guest")}`;
  lightboxCaption.textContent = row.guest_name || "A guest";
  lightbox.hidden = false;
}
function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.src = "";
}
lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

async function loadGallery() {
  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error(error);
    return;
  }

  photoGrid.innerHTML = "";
  if (!data.length) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;
  for (const row of data) {
    photoGrid.appendChild(buildPhotoCard(row));
  }
}

// Live updates: as soon as any guest's upload lands in the table,
// everyone currently viewing the page sees it appear immediately.
client
  .channel("public:photos")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: TABLE }, (payload) => {
    emptyState.hidden = true;
    photoGrid.prepend(buildPhotoCard(payload.new));
  })
  .subscribe();

loadGallery();
