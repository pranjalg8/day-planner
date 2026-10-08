// Tiny toast with optional action button (e.g. Undo). One toast at a time.
let timer = null;

export function showToast(message, { actionLabel, onAction, ms = 8000 } = {}) {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  clearTimeout(timer);
  host.innerHTML = "";
  const t = document.createElement("div");
  t.className = "toast";
  const span = document.createElement("span");
  span.textContent = message;
  t.appendChild(span);
  if (actionLabel && onAction) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    b.textContent = actionLabel;
    b.addEventListener("click", () => {
      clearTimeout(timer);
      host.innerHTML = "";
      onAction();
    });
    t.appendChild(b);
  }
  host.appendChild(t);
  timer = setTimeout(() => { host.innerHTML = ""; }, ms);
}
