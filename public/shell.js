// Shared page shell: theme (applied before paint), theme toggle, copy buttons, small helpers.
(function () {
  const root = document.documentElement;
  const stored = (() => { try { return localStorage.getItem("tw-theme"); } catch { return null; } })();
  if (stored === "light" || stored === "dark") root.dataset.theme = stored;

  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>';

  window.TW = {
    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]),
    usd: (n) => `$${n > 0 && n < 0.01 ? n.toFixed(4) : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    time: (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""),
    modeClass: (v) => (v.startsWith("live") ? "live" : v === "sandbox" ? "sandbox" : ""),
    tierName: { 0: "Code rules", 1: "SERV", 2: "Reppo", 3: "Passkey" },
  };

  document.addEventListener("DOMContentLoaded", () => {
    for (const b of document.querySelectorAll("[data-theme-toggle]")) {
      const paint = () => {
        const dark = isDark();
        b.innerHTML = dark ? SUN : MOON;
        b.setAttribute("aria-pressed", String(dark));
      };
      paint();
      b.addEventListener("click", () => {
        root.dataset.theme = isDark() ? "light" : "dark";
        try { localStorage.setItem("tw-theme", root.dataset.theme); } catch {}
        paint();
        document.dispatchEvent(new Event("themechange"));
      });
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
    }
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest(".copy");
      if (!btn) return;
      const text = btn.closest(".codeblock")?.querySelector("pre")?.innerText ?? "";
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
      } catch {
        const pre = btn.closest(".codeblock")?.querySelector("pre");
        if (pre) {
          const range = document.createRange();
          range.selectNodeContents(pre);
          getSelection()?.removeAllRanges();
          getSelection()?.addRange(range);
        }
        btn.textContent = "Text selected";
      }
      setTimeout(() => (btn.textContent = "Copy"), 1400);
    });
  });
})();
