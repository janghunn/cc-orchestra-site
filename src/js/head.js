/* cc-orchestra-site / head.js: inlined by the build as the first element of <head> on both pages.
   1. Pre-paint theme (kit theme-init.html, variant "system"): the saved choice, else the OS setting.
   2. Saved "Pause motion" choice, applied before first paint so nothing starts moving.
   3. EN page only (the build drops the marked block on /ko/): "?lang=en" records English and never
      redirects; otherwise a saved Korean choice sends the visitor to ko/ (keeping the #hash).
   4. KO page only (the build drops the marked block on /): first visit renders in the metric-matched
      fallback and fetches both S-Core Dream faces after the load event, then switches in one step
      (html.ko-font, see ko-font.css); later visits switch before first paint. */
(function (d, w) {
  var r = d.documentElement, t = null, m;
  try { t = w.localStorage.getItem("ppk-theme"); } catch (e) {}
  if (t !== "light" && t !== "dark") {
    m = r.getAttribute("data-theme-default") || "system";
    t = m === "light" || m === "dark" ? m
      : (w.matchMedia && w.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }
  r.setAttribute("data-theme", t);
  try { if (w.localStorage.getItem("ppk-motion") === "off") r.classList.add("motion-off"); } catch (e) {}
}(document, window));
/* @en-only */
(function (w) {
  try {
    if (/(?:^|[?&])lang=en(?:&|$)/.test(w.location.search)) w.localStorage.setItem("ppk-lang", "en");
    else if (w.localStorage.getItem("ppk-lang") === "ko") w.location.replace("ko/" + w.location.hash);
  } catch (e) {}
}(window));
/* @end-en-only */
/* @ko-only */
(function (d, w) {
  var r = d.documentElement, K = "ppk-kofont";
  function on() {
    r.classList.add("ko-font");
    try { w.localStorage.setItem(K, "1"); } catch (e) {}
  }
  try { if (w.localStorage.getItem(K) === "1") { r.classList.add("ko-font"); return; } } catch (e) {}
  var started = false;
  function go() {
    var f = d.fonts;
    if (started) return;
    started = true;
    if (!f || !f.load || !w.Promise) { on(); return; }
    w.Promise.all([f.load('400 1em "SCDream"'), f.load('700 1em "SCDream"')]).then(on, on);
  }
  /* start only once the page has painted (first contentful paint), so the 1.47 MB of OTF never
     delays first paint; the load event can come before the first frame on a fast connection */
  w.addEventListener("load", function () {
    var P = w.performance, O = w.PerformanceObserver;
    try {
      if (P && P.getEntriesByName && P.getEntriesByName("first-contentful-paint").length) { w.setTimeout(go, 0); return; }
      if (O) {
        var o = new O(function (l) {
          if (l.getEntriesByName("first-contentful-paint").length) { o.disconnect(); w.setTimeout(go, 0); }
        });
        o.observe({ type: "paint", buffered: true });
      }
    } catch (e) {}
    w.setTimeout(go, 3000);
  });
}(document, window));
/* @end-ko-only */
