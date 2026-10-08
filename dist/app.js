/* Leaflet displays OSM tiles; submitted searches use our Python endpoint.
   Accounts and private memories are stored through our Python server and Supabase. */
"use strict";
const $ = (s) => document.querySelector(s);
let currentUser = null,
  accountVersion = 0,
  saving = false,
  flights = [],
  flightLayer = null,
  flightVersion = 0,
  viewVersion = 0,
  entries = [],
  selected = null,
  editing = false,
  dirty = false,
  deleteId = null;
let map,
  pinLayer,
  activeURLs = [],
  searchRequest = 0;
const key = (p) => `${Number(p.lng).toFixed(3)},${Number(p.lat).toFixed(3)}`;
const animalCharacters = {
  mouse: "🐭",
  cow: "🐮",
  tiger: "🐯",
  bunny: "🐰",
  dragon: "🐲",
  snake: "🐍",
  horse: "🐴",
  sheep: "🐑",
  monkey: "🐵",
  chicken: "🐔",
  dog: "🐶",
  pig: "🐷",
};
let savedAvatar = "bunny",
  avatarVersion = 0;
function updateAvatar(animal) {
  avatarVersion++;
  $("#account-avatar").textContent =
    animalCharacters[animal] || animalCharacters.bunny;
}
async function restoreAvatar() {
  const version = avatarVersion;
  try {
    const data = await api("/api/profile");
    if (currentUser && version === avatarVersion) {
      savedAvatar = data.profile?.avatar || "bunny";
      updateAvatar(savedAvatar);
    }
  } catch {
    /* The default character keeps the header usable if profile loading fails. */
  }
}
function toast(message, success = false) {
  $("#toast").textContent = success ? `✓ ${message}` : message;
  $("#toast").classList.toggle("save-success", success);
  $("#toast").classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("visible"), 3500);
}
function clearURLs() {
  activeURLs.forEach(URL.revokeObjectURL);
  activeURLs = [];
}
function url(blob) {
  if (typeof blob === "string") return `/api/photos/${blob}`;
  const u = URL.createObjectURL(blob);
  activeURLs.push(u);
  return u;
}
function canLeave() {
  if (saving) return false;
  if (!dirty) return true;
  if (!confirm("Discard your unsaved changes?")) return false;
  updateAvatar(savedAvatar);
  return true;
}
function panel() {
  viewVersion++;
  clearURLs();
  editing = false;
  dirty = false;
  $("#panel").classList.add("open");
  $("#panel-content").replaceChildren();
  return $("#panel-content");
}
function text(tag, value, parent, cls) {
  const e = document.createElement(tag);
  e.textContent = value;
  if (cls) e.className = cls;
  parent.append(e);
  return e;
}
function button(label, fn, parent, cls) {
  const b = text("button", label, parent, cls);
  b.type = "button";
  b.onclick = fn;
  return b;
}
function heading(title, subtitle) {
  const p = panel();
  const titleNode = text("h2", title, p);
  titleNode.tabIndex = -1;
  if (!$("#journal-page").hidden) titleNode.focus({ preventScroll: true });
  if (subtitle) text("p", subtitle, p, "empty-text");
  return p;
}
function focusPlace(p) {
  if (!map) return;
  if (p.bounds)
    map.fitBounds(p.bounds, { padding: [45, 45], maxZoom: 16, animate: false });
  else map.setView([p.lat, p.lng], 14, { animate: false });
}
function select(p, focus = false) {
  if (!canLeave()) return;
  closeSearch(false);
  selected = { name: p.name.slice(0, 160), lng: p.lng, lat: p.lat };
  $("#search-results").replaceChildren();
  if (focus) focusPlace(p);
  showPlace();
  renderPins();
}
function showWelcome() {
  selected = null;
  const p = heading(
    "Every place has a story.",
    "Your map is waiting for its first memory. Search for somewhere you’ve been, or tap a place on the map.",
  );
  text("div", "✳", p, "empty-art");
  text("p", "Start somewhere special", p, "eyebrow");
  const suggestions = text("div", "", p, "suggestions");
  ["Paris", "Tokyo", "New York", "Bali"].forEach((name) =>
    button(
      name,
      () =>
        select(
          window.FEILOU_PLACES.find((p) => p.name.startsWith(name)),
          true,
        ),
      suggestions,
    ),
  );
}
function showAll() {
  if (!canLeave()) return;
  activeMenu("all-memories");
  selected = null;
  renderPins();
  if (!entries.length) {
    const p = heading(
      "Your collected moments.",
      "No memories yet. Find a place on the map and save your first story.",
    );
    button("Explore the map", showMap, p, "primary");
    return;
  }
  const p = heading(
    "Your collected moments.",
    `${entries.length} ${entries.length === 1 ? "memory" : "memories"}, newest travel dates first.`,
  );
  const stats = text("div", "", p, "memory-stats");
  text("span", `▤ ${entries.length} memories`, stats);
  text("span", `⌖ ${new Set(entries.map(key)).size} places remembered`, stats);
  text(
    "span",
    `▧ ${entries.reduce((total, entry) => total + entry.photos.length, 0)} photos collected`,
    stats,
  );
  const flightCount = text("span", "✈ Flights …", stats);
  loadFlights()
    .then(() => {
      if (flightCount.isConnected)
        flightCount.textContent = `✈ ${flights.length} flights`;
    })
    .catch(() => {
      if (flightCount.isConnected)
        flightCount.textContent = "✈ Flights unavailable";
    });
  let gallery, month;

  [...entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach((entry) => {
      const entryMonth = entry.date.slice(0, 7);
      if (entryMonth !== month) {
        month = entryMonth;
        const group = text("section", "", p, "memory-month");
        text(
          "h3",
          new Date(entry.date + "T12:00:00").toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          }),
          group,
          "memory-month-title",
        );
        gallery = text("div", "", group, "memory-gallery");
      }
      const card = button(
        "",
        () => select(entry, true),
        gallery,
        "memory-postcard",
      );
      card.setAttribute(
        "aria-label",
        `Open ${entry.title}, ${entry.name}, ${entry.date}`,
      );
      text("span", "", card, "postcard-tape").setAttribute(
        "aria-hidden",
        "true",
      );
      if (entry.photos.length > 1) {
        card.classList.add("has-photo-stack");
        const backPhoto = document.createElement("img");
        backPhoto.className = "postcard-stack-photo";
        backPhoto.alt = "";
        backPhoto.loading = "lazy";
        backPhoto.src = url(entry.photos[entry.photos.length - 2]);
        backPhoto.onerror = () => {
          backPhoto.hidden = true;
        };
        card.append(backPhoto);
      }
      const cover = text("span", "", card, "postcard-cover");
      const fallback = text("span", "✳", cover, "postcard-art");
      fallback.setAttribute("aria-hidden", "true");
      if (entry.photos.length) {
        const image = document.createElement("img");
        image.src = url(entry.photos[entry.photos.length - 1]);
        image.alt = "";
        image.loading = "lazy";
        image.onload = () => {
          fallback.hidden = true;
        };
        image.onerror = () => {
          image.hidden = true;
        };
        cover.append(image);
        text("span", `▧ ${entry.photos.length}`, cover, "postcard-photo-count");
      }
      const body = text("span", "", card, "postcard-body");
      text(
        "span",
        `◷ ${new Date(entry.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`,
        body,
        "postcard-date",
      );
      text("strong", entry.title, body, "postcard-title");
      text("span", `⌖ ${entry.name}`, body, "postcard-location");
      text("span", entry.note, body, "postcard-note");
      text("span", "Open memory ↗", body, "postcard-open");
    });
}
function showPlace() {
  const group = entries.filter((e) => key(e) === key(selected));
  const p = heading(
    selected.name,
    `${selected.lat.toFixed(3)}° latitude · ${selected.lng.toFixed(3)}° longitude`,
  );
  button("+ Add a memory", () => editEntry(), p, "primary");
  if (!group.length) {
    text("div", "✳", p, "empty-art");
    text("h3", "You were here.", p);
    text(
      "p",
      "Keep the small things: the view from your window, a new friend, a really good coffee.",
      p,
      "empty-text",
    );
  }
  group
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach((e) => {
      const a = text("article", "", p, "entry");
      text("small", e.date, a);
      text("h3", e.title, a);
      e.photos.forEach((photo) => {
        const img = document.createElement("img");
        img.className = "entry-photo";
        img.src = url(photo);
        img.alt = `Photo from ${e.title}`;
        img.onclick = () => {
          const d = document.createElement("dialog");
          const full = document.createElement("img");
          full.src = img.src;
          full.alt = img.alt;
          full.style = "max-width:80vw;max-height:75vh;object-fit:contain";
          d.append(full);
          button(
            "Close photo",
            () => {
              d.close();
              d.remove();
            },
            d,
          );
          d.addEventListener("close", () => d.remove());
          document.body.append(d);
          d.showModal();
        };
        a.append(img);
      });
      text("p", e.note, a);
      const actions = text("div", "", a, "entry-actions");
      button("Edit", () => editEntry(e), actions);
      button(
        "Delete",
        () => {
          deleteId = e.id;
          $("#delete-dialog").showModal();
        },
        actions,
      );
    });
}
// New uploads carry a server timestamp; older photos fall back to entry creation.
function latestPlacePhoto(memories) {
  let latest = null;
  for (const entry of memories) {
    (entry.photos || []).forEach((photo, index) => {
      const stamp =
        typeof photo === "string" &&
        photo
          .split("/")
          .pop()
          .match(/^(\d{13})_/);
      const uploadedAt = stamp
        ? Number(stamp[1])
        : Date.parse(entry.created_at || entry.date) || 0;
      if (
        !latest ||
        uploadedAt > latest.uploadedAt ||
        (uploadedAt === latest.uploadedAt && index > latest.index)
      )
        latest = { photo, title: entry.title, uploadedAt, index };
    });
  }
  return latest;
}
function renderPins() {
  $("#count").textContent = entries.length;
  if (!pinLayer) return;
  pinLayer.clearLayers();
  const groups = new Map();
  entries.forEach((e) => {
    const k = key(e);
    if (!groups.has(k)) groups.set(k, { ...e, count: 0, memories: [] });
    groups.get(k).count++;
    groups.get(k).memories.push(e);
  });
  if (selected && !groups.has(key(selected)))
    groups.set(key(selected), { ...selected, count: 0 });
  groups.forEach((p) => {
    const label = `${p.name}, ${p.count} memories`;
    const marker = L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: "memory-pin",
        html: `<span>${p.count || "+"}</span>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      }),
      title: label,
      alt: label,
      keyboard: true,
    }).addTo(pinLayer);
    marker.getElement()?.setAttribute("aria-label", label);
    marker.on("click", () => select(p));
    const latest = latestPlacePhoto(p.memories || []);
    if (latest && typeof latest.photo === "string") {
      const preview = document.createElement("div");
      preview.className = "pin-photo-preview";
      const image = document.createElement("img");
      image.alt = `Latest photo at ${p.name}: ${latest.title}`;
      const status = text(
        "span",
        "Loading photo…",
        preview,
        "pin-photo-status",
      );
      preview.prepend(image);
      text("strong", p.name, preview);
      text("small", latest.title, preview);
      image.onload = () => {
        status.hidden = true;
      };
      image.onerror = () => {
        image.hidden = true;
        status.textContent = "Photo unavailable";
      };
      marker.bindTooltip(preview, {
        direction: "top",
        offset: [0, -20],
        className: "photo-pin-tooltip",
        opacity: 1,
      });
      marker.on("tooltipopen", () => {
        if (!image.getAttribute("src"))
          image.src = `/api/photos/${latest.photo}`;
      });
      const pin = marker.getElement();
      pin?.addEventListener("focus", () => marker.openTooltip());
      pin?.addEventListener("blur", () => marker.closeTooltip());
      pin?.addEventListener("keydown", (event) => {
        if (event.key === "Escape") marker.closeTooltip();
      });
    }
  });
}
// A session change invalidates outstanding requests from the previous account.
function setUser(user) {
  accountVersion++;
  currentUser = user;
  entries = [];
  flights = [];
  flightVersion++;
  flightLayer?.clearLayers();
  activeMenu(null);
  selected = null;
  dirty = false;
  clearURLs();
  document.querySelectorAll("dialog").forEach((dialog) => dialog.close());
  $("#account-button").textContent = user ? "Sign out" : "Sign in";
  $("#account-email").textContent = user?.username || "";
  $("#account-profile").hidden = !user;
  savedAvatar = "bunny";
  updateAvatar(savedAvatar);
  if (user) restoreAvatar();
  $(".storage-note").textContent = user
    ? "Your private memories are saved to your account."
    : "Sign in to save your own notes and photos.";
  showWelcome();
  renderPins();
}
async function api(path, method = "GET", data) {
  const version = accountVersion;
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers:
      method === "GET"
        ? {}
        : {
            "Content-Type": "application/json",
            "X-Feilou-Request": "1",
          },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  if (version !== accountVersion)
    throw Error("Account changed. Please try again.");
  if (response.status === 401) {
    setUser(null);
    toast("Your session ended. Please sign in again.");
  }
  if (!response.ok)
    throw Error(result.error || "Could not complete the request.");
  return result;
}
async function reload() {
  if (!currentUser) return;
  const result = await api("/api/entries");
  entries = result.entries;
  renderPins();
}
function photoData(photo) {
  if (typeof photo === "string") return Promise.resolve(photo);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ data: reader.result.split(",")[1] });
    reader.onerror = () => reject(Error("Could not read this photo."));
    reader.readAsDataURL(photo);
  });
}
function openAccount() {
  if (!canLeave()) return;
  closeNavigation();
  closeSearch(false);
  $("#auth-message").textContent = "";
  $("#auth-dialog").showModal();
  $("#auth-username").focus();
}
$("#account-button").onclick = async () => {
  if (!currentUser) return openAccount();
  if (!canLeave()) return;
  try {
    await api("/api/auth/logout", "POST", {});
    setUser(null);
    toast("Signed out.");
  } catch (error) {
    toast(error.message);
  }
};
$("#auth-close").onclick = () => $("#auth-dialog").close();
function setAuthMode(mode) {
  $("#auth-mode").value = mode;
  $("#auth-message").textContent = "";
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.authMode === mode),
    );
  });
  const signup = mode === "signup";
  $("#auth-submit").textContent = signup ? "Create account" : "Sign in";
  $("#auth-username").maxLength = signup ? 32 : 254;
  $("#auth-username").setCustomValidity("");
  $("#auth-password").value = "";
  $("#auth-password").autocomplete = signup
    ? "new-password"
    : "current-password";
}
document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.onclick = () => setAuthMode(button.dataset.authMode);
});
$("#auth-form").onsubmit = async (event) => {
  event.preventDefault();
  const submit = $("#auth-submit");
  submit.disabled = true;
  document
    .querySelectorAll("[data-auth-mode]")
    .forEach((b) => (b.disabled = true));
  $("#auth-message").textContent = "Connecting…";
  try {
    const result = await api(`/api/auth/${$("#auth-mode").value}`, "POST", {
      username: $("#auth-username").value.trim(),
      password: $("#auth-password").value,
    });
    $("#auth-password").value = "";
    if (!result.user) {
      $("#auth-message").textContent = result.message;
      return;
    }
    setUser(result.user);
    toast("Signed in. Loading your memories…");
    await reload();
    loadFlights().catch(() => {});
    showMap();
    toast("Welcome to your little corner of the world.");
  } catch (error) {
    $("#auth-message").textContent = error.message;
    toast(error.message);
  } finally {
    submit.disabled = false;
    document
      .querySelectorAll("[data-auth-mode]")
      .forEach((b) => (b.disabled = false));
  }
};
function editEntry(entry) {
  if (!currentUser) return openAccount();
  panel();
  editing = true;
  $("#panel-content").append($("#editor-template").content.cloneNode(true));
  let photos = entry ? [...entry.photos] : [];
  $("#editor-heading").textContent = entry
    ? "Revisit this moment."
    : "A moment worth keeping.";
  $("#editor-location").textContent = selected.name;
  $("#location").value = entry?.name || selected.name;
  $("#title").value = entry?.title || "";
  $("#date").value =
    entry?.date ||
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  $("#note").value = entry?.note || "";
  $("#back").onclick = () => {
    if (canLeave()) showPlace();
  };
  $("#entry-form").oninput = () => (dirty = true);
  function previews() {
    clearURLs();
    const box = $("#photo-previews");
    box.replaceChildren();
    photos.forEach((photo, i) => {
      const wrap = text("div", "", box, "preview");
      const img = document.createElement("img");
      img.src = url(photo);
      img.alt = `Selected photo ${i + 1}`;
      wrap.append(img);
      const b = button(
        "×",
        () => {
          photos.splice(i, 1);
          dirty = true;
          previews();
        },
        wrap,
      );
      b.setAttribute("aria-label", `Remove photo ${i + 1}`);
    });
  }
  $("#photos").onchange = async (event) => {
    const files = [...event.target.files];
    const error = $("#form-error");
    error.textContent = "";
    if (photos.length + files.length > 4) {
      error.textContent = "Choose up to four photos in total.";
      event.target.value = "";
      return;
    }
    try {
      for (const file of files) {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > 5 * 1024 * 1024
        )
          throw Error("Please use JPG, PNG or WebP photos under 5 MB each.");
        await validateImage(file);
      }
      photos.push(...files);
      dirty = true;
      previews();
    } catch (e) {
      error.textContent = e.message;
    }
    event.target.value = "";
  };
  $("#entry-form").onsubmit = async (event) => {
    event.preventDefault();
    const save = $("#save-entry");
    const error = $("#form-error");
    const title = $("#title").value.trim(),
      name = $("#location").value.trim(),
      note = $("#note").value.trim();
    if (!title || !name || !note) {
      error.textContent = "Please fill in the title, place, and story.";
      return;
    }
    saving = true;
    save.disabled = true;
    save.textContent = "Saving…";
    try {
      const result = await api(
        entry ? `/api/entries/${entry.id}` : "/api/entries",
        entry ? "PUT" : "POST",
        {
          title,
          name,
          date: $("#date").value,
          note,
          lng: selected.lng,
          lat: selected.lat,
          photos: await Promise.all(photos.map(photoData)),
        },
      );
      // Use the committed response immediately; a later refresh reads the database.
      entries = [
        ...entries.filter((e) => e.id !== result.entry.id),
        result.entry,
      ];
      renderPins();
      selected.name = name;
      dirty = false;
      showPlace();
      toast("Memory tucked away.", true);
    } catch (e) {
      error.textContent = e.message;
      toast(e.message);
      save.disabled = false;
      save.textContent = "Save this memory";
    } finally {
      saving = false;
    }
  };
  previews();
  $("#title").focus();
}
async function validateImage(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!{ "image/jpeg": jpg, "image/png": png, "image/webp": webp }[file.type])
    throw Error("That file does not appear to be a valid photo.");
  const bitmap = await createImageBitmap(file);
  const tooLarge = bitmap.width * bitmap.height > 40000000;
  bitmap.close();
  if (tooLarge)
    throw Error("Please choose a photo smaller than 40 megapixels.");
}
async function search() {
  const q = $("#search").value.trim();
  const results = $("#search-results");
  results.replaceChildren();
  if (q.length < 2) {
    text("p", "Enter at least two characters.", results);
    return;
  }
  const request = ++searchRequest;
  const submit = $("#search-form button");
  submit.disabled = true;
  submit.textContent = "Finding…";
  text("p", "Looking for your place…", results);
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (request !== searchRequest) return;
    if (!response.ok) throw Error(data.error || "Search is unavailable.");
    results.replaceChildren();
    const saved = entries.filter((e) =>
      e.name.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
    );
    const seen = new Set();
    [
      ...saved,
      ...data.results.map((p) => ({
        ...p,
        label: p.name,
        name: p.name.split(",")[0].slice(0, 160),
      })),
    ].forEach((p) => {
      if (seen.has(key(p))) return;
      seen.add(key(p));
      button(p.label || p.name, () => select(p, true), results);
    });
    if (!seen.size)
      text(
        "p",
        "No places found. Add a city or country to your search, or choose a point on the map.",
        results,
      );
  } catch (error) {
    if (request !== searchRequest) return;
    results.replaceChildren();
    text(
      "p",
      error.name === "TimeoutError"
        ? "Search timed out. Please try again."
        : error instanceof SyntaxError
          ? "Search needs the Python server. Run python3 server.py."
          : error.message,
      results,
    );
  } finally {
    if (request === searchRequest) {
      submit.disabled = false;
      submit.textContent = "Find";
    }
  }
}
// The opening search card owns focus until dismissed; outside clicks never drop a pin.
function openSearch() {
  if (!canLeave()) return;
  $("#search-overlay").hidden = false;
  $("#panel").inert = true;
  $("#map").inert = true;
  $("header").inert = true;
  $("#journal-menu").inert = true;
  $("#open-search").inert = true;
  $("#search").focus();
}
function closeSearch(focusMap = true) {
  $("#search-overlay").hidden = true;
  $("#panel").inert = false;
  $("#map").inert = false;
  $("header").inert = false;
  $("#journal-menu").inert = false;
  $("#open-search").inert = false;
  if (focusMap) $("#map").focus();
}
$("#open-search").onclick = openSearch;
$("#explore-map").onclick = () => closeSearch();
$("#search-overlay").onclick = (e) => {
  if (e.target === $("#search-overlay")) closeSearch();
};
$("#search-overlay").onkeydown = (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeSearch();
    return;
  }
  if (e.key === "Tab") {
    const items = [
      ...$("#search-overlay").querySelectorAll("input,button,a[href]"),
    ].filter((e) => !e.disabled);
    const first = items[0],
      last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
};
$("#search").oninput = () => {
  searchRequest++;
  $("#search-results").replaceChildren();
  $("#search-form button").disabled = false;
  $("#search-form button").textContent = "Find";
};
$("#search-form").onsubmit = (e) => {
  e.preventDefault();
  search();
};
$("#search").onkeydown = (e) => {
  if (e.key === "Escape") $("#search-results").replaceChildren();
  if (e.key === "ArrowDown") {
    $("#search-results button")?.focus();
    e.preventDefault();
  }
};
$("#zoom-in").onclick = () => map?.zoomIn();
$("#zoom-out").onclick = () => map?.zoomOut();
$("#reset-map").onclick = () => map?.setView([20, 0], 2);
$("#all-memories").onclick = async () => {
  if (!currentUser) return openAccount();
  if (!canLeave()) return;
  const version = viewVersion;
  try {
    await reload();
    if (version === viewVersion) showAll();
  } catch (error) {
    toast(error.message);
  }
};
$("#close-panel").onclick = () => {
  if (canLeave()) {
    $("#panel").classList.remove("open");
    dirty = false;
  }
};
$("#cancel-delete").onclick = () => $("#delete-dialog").close();
$("#confirm-delete").onclick = async () => {
  const b = $("#confirm-delete");
  b.disabled = true;
  try {
    await api(`/api/entries/${deleteId}`, "DELETE", {});
    entries = entries.filter((e) => e.id !== deleteId);
    renderPins();
    $("#delete-dialog").close();
    showPlace();
    toast("Memory deleted.");
  } catch (e) {
    toast("Could not delete. Please try again.");
  } finally {
    b.disabled = false;
  }
};
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
// Reuse the editor in full-page sections and in the map’s location panel.
function closeNavigation() {
  document.body.classList.remove("nav-open");
  $("#menu-toggle").setAttribute("aria-expanded", "false");
  $("#menu-toggle").setAttribute("aria-label", "Open navigation");
  $("#menu-backdrop").hidden = true;
}
$("#menu-toggle").onclick = () => {
  const open = !document.body.classList.contains("nav-open");
  document.body.classList.toggle("nav-open", open);
  $("#menu-toggle").setAttribute("aria-expanded", String(open));
  $("#menu-toggle").setAttribute(
    "aria-label",
    open ? "Close navigation" : "Open navigation",
  );
  $("#menu-backdrop").hidden = !open;
};
$("#menu-backdrop").onclick = closeNavigation;
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("nav-open")) {
    closeNavigation();
    $("#menu-toggle").focus();
  }
});
const pageNames = {
  "map-menu": "map",
  "all-memories": "memories",
  "flight-menu": "flights",
  "profile-menu": "profile",
};
function activeMenu(id) {
  closeNavigation();
  id = id || "map-menu";
  const isMap = id === "map-menu";
  const content = $("#panel-content");
  const destination = isMap ? $("#panel") : $("#journal-page");
  if (content.parentElement !== destination) {
    if (isMap) destination.insertBefore(content, $(".storage-note"));
    else destination.append(content);
  }
  $("#journal-page").hidden = isMap;
  $(".map-area").hidden = !isMap;
  $("#panel").hidden = !isMap;
  document.body.dataset.page = pageNames[id];
  document.title = `${id === "map-menu" ? "Map" : id === "all-memories" ? "Memories" : id === "flight-menu" ? "Flight tracker" : "Profile"} · 飞喽`;
  document.querySelectorAll("#journal-menu button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.id === id));
    if (b.id === id) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (isMap) requestAnimationFrame(() => map?.invalidateSize());
}
function showMap() {
  if (!canLeave()) return;
  viewVersion++;
  dirty = false;
  activeMenu("map-menu");
  showWelcome();
  $("#panel").classList.remove("open");
}
$("#map-menu").onclick = showMap;
$(".brand").onclick = (event) => {
  event.preventDefault();
  showMap();
};

function sectionError(message, retry) {
  const p = heading("Could not load this page.", message);
  button("Try again", retry, p, "primary");
}
async function loadFlights() {
  if (!currentUser) return;
  const version = ++flightVersion;
  const data = await api("/api/flights");
  if (version !== flightVersion) return;
  flights = data.flights;
  renderFlights();
}
// Unwrap longitude so a Pacific crossing takes the short path across the date line.
function flightPoints(flight) {
  const start = [flight.origin_lat, flight.origin_lng];
  let endLng = flight.destination_lng;
  while (endLng - start[1] > 180) endLng -= 360;
  while (endLng - start[1] < -180) endLng += 360;
  const bend = Math.min(8, Math.abs(endLng - start[1]) * 0.12);
  return Array.from({ length: 49 }, (_, i) => {
    const t = i / 48;
    return [
      Math.max(
        -89,
        Math.min(
          89,
          start[0] +
            (flight.destination_lat - start[0]) * t +
            Math.sin(Math.PI * t) * bend,
        ),
      ),
      start[1] + (endLng - start[1]) * t,
    ];
  });
}
function renderFlights() {
  if (!flightLayer) return;
  flightLayer.clearLayers();
  flights.forEach((flight) => {
    const points = flightPoints(flight);
    const angle =
      (Math.atan2(
        -(points[25][0] - points[23][0]),
        (points[25][1] - points[23][1]) *
          Math.cos((points[24][0] * Math.PI) / 180),
      ) *
        180) /
      Math.PI;
    for (const offset of [-360, 0, 360]) {
      const shifted = points.map(([lat, lng]) => [lat, lng + offset]);
      const line = L.polyline(shifted, {
        color: "#b96e4b",
        weight: 3,
        opacity: 0.8,
        dashArray: "7 7",
        bubblingMouseEvents: false,
      }).addTo(flightLayer);
      const label = document.createElement("span");
      label.textContent = `${flight.flight_number}: ${flight.origin} → ${flight.destination}`;
      line.bindTooltip(label);
      line.on("click", () => {
        if (canLeave()) showFlightDetail(flight, false);
      });
      const marker = L.marker(shifted[24], {
        icon: L.divIcon({
          className: "flight-plane",
          html: `<span aria-hidden="true" style="transform:rotate(${angle}deg)">✈</span>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
        title: label.textContent,
        alt: label.textContent,
        keyboard: true,
      }).addTo(flightLayer);
      marker.on("click", () => {
        if (canLeave()) showFlightDetail(flight, false);
      });
    }
  });
}
async function showFlights() {
  if (!currentUser) return openAccount();
  if (!canLeave()) return;
  activeMenu("flight-menu");
  heading("Your flight book.", "Loading your flights…");
  const version = viewVersion;
  try {
    await loadFlights();
    if (version !== viewVersion) return;
    const p = heading(
      "Your flight book.",
      "Fill in a boarding pass and trace your travels. Routes are illustrations, not live flight tracking.",
    );
    button("+ Add a flight", () => editFlight(), p, "primary");
    if (!flights.length)
      text(
        "p",
        "No flights yet. Your next adventure starts here.",
        p,
        "empty-text",
      );
    [...flights]
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((f) => {
        const card = button("", () => showFlightDetail(f), p, "boarding-card");
        text("small", `${f.date} · ${f.flight_number}`, card);
        text("strong", `${f.origin} → ${f.destination}`, card);
        text("span", f.airline || "A journey to remember", card);
      });
  } catch (error) {
    if (version === viewVersion) sectionError(error.message, showFlights);
  }
}
// Built from text nodes so saved place names cannot inject markup.
function boardingPass(flight, parent) {
  const ticket = text("div", "", parent, "boarding-ticket");
  const main = text("div", "", ticket, "ticket-main");
  const top = text("div", "", main, "ticket-top");
  const brand = text("div", "", top);
  text("span", "飞喽 / FEILOU", brand, "ticket-brand");
  text("h3", "BOARDING PASS", brand, "ticket-title");
  const stamp = text("div", "", top, "ticket-stamp");
  text("span", "✈", stamp);
  text("small", "MEMORIES AIRLINES", stamp);
  const route = text("div", "", main, "ticket-route");
  const origin = text("div", "", route);
  text("small", "FROM", origin, "ticket-label");
  text("strong", flight.origin, origin);
  text("span", "✈", route, "ticket-route-plane").setAttribute(
    "aria-hidden",
    "true",
  );
  const destination = text("div", "", route);
  text("small", "TO", destination, "ticket-label");
  text("strong", flight.destination, destination);
  const fields = text("dl", "", main, "ticket-fields");
  for (const [label, value] of [
    ["DATE", flight.date],
    ["FLIGHT", flight.flight_number],
    ["SEAT", flight.seat || "—"],
    ["AIRLINE", flight.airline || "Not recorded"],
  ]) {
    const item = text("div", "", fields);
    text("dt", label, item, "ticket-label");
    text("dd", value, item);
  }
  text("span", "A little keepsake of a big adventure", main, "ticket-caption");
  const stub = text("div", "", ticket, "ticket-stub");
  text("span", "YOUR JOURNEY", stub, "ticket-label");
  text("strong", flight.flight_number, stub, "ticket-stub-flight");
  text("span", flight.date, stub);
  text("span", `SEAT  ${flight.seat || "—"}`, stub, "ticket-stub-seat");
  text("div", "", stub, "ticket-barcode").setAttribute("aria-hidden", "true");
  text("small", "TRAVEL JOURNAL · SOUVENIR", stub, "ticket-caption");
  return ticket;
}
function showFlightDetail(flight, focus = true) {
  activeMenu("flight-menu");
  const p = heading(
    "Boarding pass",
    `${flight.date} · ${flight.flight_number}`,
  );
  boardingPass(flight, p);
  text("p", "Illustrated route · not the actual flown path", p, "empty-text");
  if (focus && map)
    map.fitBounds(flightPoints(flight), { padding: [45, 45], maxZoom: 7 });
  button(
    "View route on map",
    () => {
      showMap();
      requestAnimationFrame(() =>
        map?.fitBounds(flightPoints(flight), { padding: [45, 45], maxZoom: 7 }),
      );
    },
    p,
    "primary",
  );
  button("Edit boarding pass", () => editFlight(flight), p);
  button(
    "Delete flight",
    async () => {
      if (!confirm("Delete this flight and its route from your account?"))
        return;
      try {
        await api(`/api/flights/${flight.id}`, "DELETE", {});
        flightVersion++;
        flights = flights.filter((f) => f.id !== flight.id);
        renderFlights();
        showFlights();
        toast("Flight deleted.");
      } catch (error) {
        toast(error.message);
      }
    },
    p,
    "danger",
  );
  button("← All flights", showFlights, p, "text-button");
}
function field(
  form,
  label,
  name,
  value = "",
  type = "text",
  limit = 100,
  required = false,
) {
  const id = `extra-${name}`;
  const labelNode = text("label", label, form);
  labelNode.htmlFor = id;
  const input = document.createElement(
    type === "textarea" ? "textarea" : "input",
  );
  if (type !== "textarea") input.type = type;
  input.id = id;
  input.name = name;
  input.value = value || "";
  input.maxLength = limit;
  input.required = required;
  form.append(input);
  return input;
}
function editFlight(flight) {
  const p = heading(
    flight ? "Revisit your flight." : "One boarding pass, one adventure.",
    "Enter your flight details, then search for each airport or city.",
  );
  const form = text("form", "", p, "extra-form flight-form");
  field(
    form,
    "Flight number",
    "flight_number",
    flight?.flight_number,
    "text",
    20,
    true,
  );
  field(form, "Airline (optional)", "airline", flight?.airline, "text", 80);
  field(
    form,
    "Travel date",
    "date",
    flight?.date ||
      new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10),
    "date",
    10,
    true,
  );
  field(form, "Seat (optional)", "seat", flight?.seat, "text", 10);
  const chosen = {};
  for (const side of ["origin", "destination"]) {
    if (flight)
      chosen[side] = {
        name: flight[side],
        lat: flight[side + "_lat"],
        lng: flight[side + "_lng"],
      };
    const box = text("fieldset", "", form, "flight-location");
    text("legend", side === "origin" ? "From" : "To", box);
    const input = field(
      box,
      "Airport or city",
      side,
      flight?.[side],
      "search",
      160,
      true,
    );
    const status = text(
      "p",
      flight ? "Selected: " + flight[side] : "Search and select a result.",
      box,
      "location-status",
    );
    status.setAttribute("aria-live", "polite");
    const results = text("div", "", box, "flight-results");
    let sequence = 0;
    const find = button(
      "Find place",
      async () => {
        const query = input.value.trim();
        if (query.length < 2) {
          status.textContent = "Enter at least two characters.";
          return;
        }
        const request = ++sequence;
        find.disabled = true;
        status.textContent = "Finding places…";
        results.replaceChildren();
        try {
          const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
          if (request !== sequence || !form.isConnected) return;
          status.textContent = data.results.length
            ? "Choose the correct place:"
            : "No results. Try the full airport name and city.";
          data.results.forEach((place) =>
            button(
              place.name,
              () => {
                chosen[side] = {
                  name: place.name.slice(0, 160),
                  lat: place.lat,
                  lng: place.lng,
                };
                input.value = chosen[side].name;
                status.textContent = "Selected: " + chosen[side].name;
                results.replaceChildren();
                dirty = true;
              },
              results,
            ),
          );
        } catch (error) {
          if (request === sequence) status.textContent = error.message;
        } finally {
          find.disabled = false;
        }
      },
      box,
    );
    input.oninput = () => {
      sequence++;
      delete chosen[side];
      results.replaceChildren();
      status.textContent = "Search and select a result.";
    };
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        find.click();
      }
    };
  }
  const error = text("p", "", form, "form-error");
  error.setAttribute("role", "alert");
  const submit = text("button", "Save flight", form, "primary");
  submit.type = "submit";
  button("Cancel", showFlights, p, "text-button");
  form.oninput = () => {
    dirty = true;
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!chosen.origin || !chosen.destination) {
      error.textContent =
        "Choose a search result for both departure and arrival.";
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    for (const side of ["origin", "destination"]) {
      data[side] = chosen[side].name;
      data[side + "_lat"] = chosen[side].lat;
      data[side + "_lng"] = chosen[side].lng;
    }
    saving = true;
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      const result = await api(
        flight ? `/api/flights/${flight.id}` : "/api/flights",
        flight ? "PUT" : "POST",
        data,
      );
      flightVersion++;
      flights = [
        ...flights.filter((f) => f.id !== result.flight.id),
        result.flight,
      ];
      dirty = false;
      renderFlights();
      showFlightDetail(result.flight);
      toast("Flight saved. Your route is on the map.", true);
    } catch (e) {
      error.textContent = e.message;
    } finally {
      saving = false;
      submit.disabled = false;
      submit.textContent = "Save flight";
    }
  };
}
async function showProfile() {
  if (!currentUser) return openAccount();
  if (!canLeave()) return;
  activeMenu("profile-menu");
  heading("Your traveler profile.", "Loading your profile…");
  const version = viewVersion;
  try {
    const data = await api("/api/profile");
    if (version !== viewVersion) return;
    const p = heading(
      "Your traveler profile.",
      "Only you can see these details. All fields are optional.",
    );
    text("p", `Username: ${currentUser.username}`, p, "location-caption");
    const profile = data.profile || {};
    savedAvatar = profile.avatar || "bunny";
    updateAvatar(savedAvatar);
    const form = text("form", "", p, "extra-form");
    const avatarPicker = text("fieldset", "", form, "animal-picker");
    text("legend", "Choose your travel companion", avatarPicker);
    text(
      "p",
      "Pick an animal to preview it above your username. Save profile to keep it.",
      avatarPicker,
      "animal-hint",
    );
    const avatarPreview = text(
      "div",
      animalCharacters[profile.avatar] || animalCharacters.bunny,
      avatarPicker,
      "animal-preview",
    );
    avatarPreview.setAttribute("aria-hidden", "true");
    const choices = text("div", "", avatarPicker, "animal-choices");
    for (const [name, emoji] of Object.entries(animalCharacters)) {
      const label = text("label", "", choices, "animal-choice");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "avatar";
      radio.value = name;
      radio.checked = name === (profile.avatar || "bunny");
      label.append(radio);
      text("span", emoji, label, "animal-icon").setAttribute(
        "aria-hidden",
        "true",
      );
      text("span", name[0].toUpperCase() + name.slice(1), label);
      radio.onchange = () => {
        avatarPreview.textContent = emoji;
        updateAvatar(name);
        dirty = true;
      };
    }
    field(form, "Name", "name", profile.name, "text", 100);
    const birthday = field(
      form,
      "Birthday",
      "birthday",
      profile.birthday,
      "date",
    );
    birthday.max = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
    field(form, "Hometown", "hometown", profile.hometown, "text", 120);
    field(
      form,
      "Country / region you’re from",
      "home_country",
      profile.home_country,
      "text",
      80,
    );
    field(form, "A little about you", "bio", profile.bio, "textarea", 1000);
    const status = text("p", "", form, "form-error");
    status.setAttribute("role", "status");
    const submit = text("button", "Save profile", form, "primary");
    submit.type = "submit";
    form.oninput = () => {
      dirty = true;
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      saving = true;
      submit.disabled = true;
      status.textContent = "Saving…";
      try {
        const submitted = Object.fromEntries(new FormData(form));
        const saved = await api("/api/profile", "PUT", submitted);
        if (saved.profile?.avatar !== submitted.avatar) {
          throw Error("Your animal was not saved. Restart the Python server to load the latest code and confirm profile-avatar.sql has been run in Supabase. Then save again.");
        }
        dirty = false;
        savedAvatar = saved.profile.avatar;
        updateAvatar(savedAvatar);
        status.textContent = "Profile saved.";
        toast("Profile saved.", true);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        saving = false;
        submit.disabled = false;
      }
    };
  } catch (error) {
    if (version === viewVersion) sectionError(error.message, showProfile);
  }
}
$("#flight-menu").onclick = showFlights;
$("#profile-menu").onclick = showProfile;
$("#account-profile").onclick = showProfile;

// A local illustrated atlas at world scale; detailed tiles return as you zoom in.
async function addWorldIllustration() {
  try {
    const response = await fetch("assets/world-style.json");
    if (!response.ok) return;
    const shapes = await response.json();
    const colors = {
      north: "#e7b895",
      south: "#e2c879",
      europe: "#c4b8d9",
      africa: "#dfa69a",
      asia: "#b9ce9e",
      oceania: "#91c6bf",
      antarctica: "#dce6e8",
    };
    const pane = map.createPane("atlas");
    pane.style.zIndex = 250;
    pane.style.pointerEvents = "none";
    const renderer = L.canvas({ pane: "atlas", padding: 0.3 });
    const atlas = L.layerGroup();
    for (const offset of [-360, 0, 360]) {
      for (const shape of shapes) {
        L.polygon(
          shape.points.map(([lat, lng]) => [lat, lng + offset]),
          {
            renderer,
            pane: "atlas",
            interactive: false,
            color: "#fff9e9",
            weight: 0.7,
            fillColor: colors[shape.region],
            fillOpacity: 1,
            smoothFactor: 1.5,
          },
        ).addTo(atlas);
      }
      for (const [name, lat, lng, kind] of [
        ["NORTH AMERICA", 43, -105, "land"],
        ["SOUTH AMERICA", -18, -60, "land"],
        ["EUROPE", 53, 18, "land"],
        ["AFRICA", 5, 20, "land"],
        ["ASIA", 38, 90, "land"],
        ["OCEANIA", -26, 137, "land"],
        ["Pacific Ocean", 5, -143, "ocean"],
        ["Atlantic Ocean", 12, -35, "ocean"],
        ["Indian Ocean", -28, 77, "ocean"],
      ]) {
        L.marker([lat, lng + offset], {
          pane: "atlas",
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: `atlas-label atlas-${kind}`,
            html: `<span>${name}</span>`,
            iconSize: [130, 30],
            iconAnchor: [65, 15],
          }),
        }).addTo(atlas);
      }
    }
    const update = () => {
      const zoom = map.getZoom();
      const illustrated = zoom <= 4;
      if (illustrated && !map.hasLayer(atlas)) atlas.addTo(map);
      if (!illustrated && map.hasLayer(atlas)) map.removeLayer(atlas);
      $(".map-area").classList.toggle("illustrated-world", illustrated);
      map.getPane("tilePane").style.opacity = illustrated ? "0" : "1";
      pane.querySelectorAll(".atlas-label").forEach((label) => {
        label.style.opacity = zoom <= 3 ? "1" : "0";
      });
    };
    map.on("zoomend", update);
    update();
  } catch {
    // A missing decorative asset must never prevent the normal map from working.
  }
}

async function init() {
  $("#account-button").disabled = true;
  showWelcome();
  $("#panel").classList.remove("open");
  try {
    const response = await fetch("/api/map-config");
    if (!response.ok) throw Error("configuration");
    const config = await response.json();
    map = L.map("map", {
      zoomControl: false,
      worldCopyJump: true,
      minZoom: 1,
      maxZoom: 19,
    }).setView([20, 0], 2);
    const tiles = L.tileLayer(config.tileUrl, {
      maxZoom: 19,
      attribution: "",
      detectRetina: false,
    }).addTo(map);
    const attribution = document.createElement("a");
    attribution.href = "https://www.openstreetmap.org/copyright";
    attribution.textContent = config.attribution;
    map.attributionControl.addAttribution(attribution.outerHTML);
    tiles.on("tileerror", () => {
      $("#map-status").textContent =
        "Some map tiles could not load. Check your connection.";
    });
    pinLayer = L.layerGroup().addTo(map);
    flightLayer = L.layerGroup().addTo(map);
    map.on("click", (event) => {
      const point = event.latlng.wrap();
      select({ name: "A place to remember", lat: point.lat, lng: point.lng });
    });
    $("#map-status").textContent =
      "Drag to explore · Zoom for streets · Tap to remember";
    renderPins();
    addWorldIllustration();
  } catch {
    $("#map-status").textContent =
      "Map unavailable. Start the app with python3 server.py and refresh.";
  }
  try {
    const session = await api("/api/auth/session");
    setUser(session.user);
    if (!session.configured) {
      $(".storage-note").textContent =
        "Accounts aren’t connected yet. You can still explore the map.";
    }
    if (session.user) {
      await reload();
      loadFlights().catch(() => {});
    }
    $("#panel").classList.remove("open");
  } catch (error) {
    toast(error.message);
  }
  $("#account-button").disabled = false;
  if (!currentUser) {
    setAuthMode("login");
    openAccount();
  }
}
init();
