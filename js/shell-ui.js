/* ---------- Tema ---------- */
const THEME_KEY = "game_patch_radar_theme_v1";
function currentTheme() { try { const t = localStorage.getItem(THEME_KEY); return t === "light" || t === "dark" ? t : "auto"; } catch { return "auto"; } }
function applyTheme(t) {
 const root = document.documentElement;
 if (t === "light" || t === "dark") root.dataset.theme = t; else delete root.dataset.theme;
 const light = t === "light" || (t === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches);
 const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = light ? "#f3f6fa" : "#0c1118";
}
function renderTheme() {
 const row = $("themeRow"); row.innerHTML = "";
 for (const [t, label] of [["auto", "🌓 Automatico"], ["light", "☀️ Chiaro"], ["dark", "🌙 Scuro"]]) {
  row.append(h("button", {type: "button", class: "abtn" + (currentTheme() === t ? " on" : ""), onclick: () => {
   try { localStorage.setItem(THEME_KEY, t); } catch {}
   applyTheme(t); renderTheme();
  }}, label));
 }
}
applyTheme(currentTheme());

/* ---------- La barra in alto si nasconde scorrendo verso il basso ---------- */
(() => {
 const top = $("top"); let last = 0;
 window.addEventListener("scroll", () => {
  const y = window.scrollY;
  if (y > last + 8 && y > 90) top.classList.add("hide");
  else if (y < last - 8 || y < 60) top.classList.remove("hide");
  last = y;
 }, {passive: true});
})();

/* ---------- Trascina per aggiornare ---------- */
(() => {
 let y0 = null, dy = 0; const bar = $("ptr");
 const free = () => !anyOverlay() && window.scrollY <= 0;
 document.addEventListener("touchstart", e => { y0 = free() ? e.touches[0].clientY : null; dy = 0; }, {passive: true});
 document.addEventListener("touchmove", e => {
  if (y0 === null) return;
  dy = e.touches[0].clientY - y0;
  bar.style.opacity = dy > 20 ? Math.min(dy / 90, 1) : 0;
  bar.textContent = dy > 90 ? "↑ Rilascia per aggiornare" : "↓ Trascina per aggiornare";
 }, {passive: true});
 document.addEventListener("touchend", () => {
  bar.style.opacity = 0;
  if (y0 !== null && dy > 90) refreshAll(true);
  y0 = null; dy = 0;
 });
})();

/* ---------- Installazione come app (PWA) ---------- */
let installEvt = null;
const welcomeOpen = () => $("welcome").classList.contains("open");
async function installApp() {
 if (!installEvt) return;
 installEvt.prompt();
 try { await installEvt.userChoice; } catch {}
 installEvt = null; $("installBtn").hidden = true;
 if (welcomeOpen()) renderWelcome();
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("installBtn").hidden = false; if (welcomeOpen()) renderWelcome(); });
$("installBtn").addEventListener("click", installApp);
window.addEventListener("appinstalled", () => { $("installBtn").hidden = true; toast("✓ App installata: la trovi nel Launcher"); if (welcomeOpen()) renderWelcome(); });
if ("serviceWorker" in navigator && location.protocol !== "file:") {
 window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

