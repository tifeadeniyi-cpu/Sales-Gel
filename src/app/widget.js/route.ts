/**
 * Embeddable chat launcher: <script src="https://…/widget.js" data-key="wc_…" async></script>
 * Adds a button that opens the SalesGel chat in an iframe served from this origin, so the visitor's
 * session and messages never touch the host page.
 */
const SCRIPT = `(function () {
  var s = document.currentScript; if (!s) return;
  var key = s.getAttribute("data-key"); if (!key || window.__salesgelChat) return;
  window.__salesgelChat = true;
  var origin = new URL(s.src).origin;
  var color = s.getAttribute("data-color") || "#0053ee";
  var btn = document.createElement("button");
  btn.type = "button"; btn.setAttribute("aria-label", "Open chat"); btn.setAttribute("aria-expanded", "false");
  btn.style.cssText = "position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;z-index:2147483646;box-shadow:0 6px 20px rgba(0,0,0,.25);background:" + color + ";color:#fff;font:600 22px/56px system-ui,sans-serif";
  btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var frame = null;
  function toggle() {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.title = "Chat"; frame.src = origin + "/chat/" + encodeURIComponent(key) + "?page=" + encodeURIComponent(location.href);
      frame.style.cssText = "position:fixed;right:20px;bottom:88px;width:min(380px,calc(100vw - 40px));height:min(560px,calc(100vh - 120px));border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:2147483647;background:#fff;display:none";
      document.body.appendChild(frame);
    }
    var open = frame.style.display === "none";
    frame.style.display = open ? "block" : "none";
    btn.setAttribute("aria-expanded", String(open));
  }
  btn.addEventListener("click", toggle);
  document.body.appendChild(btn);
})();`;

export function GET() {
  return new Response(SCRIPT, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
}
