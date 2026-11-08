  // Highlight the section currently in view.
  const links = [...document.querySelectorAll("#docsNav a")];
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.remove("active"));
      byId.get(e.target.id)?.classList.add("active");
    }
  }, { rootMargin: "-90px 0px -70% 0px" });
  document.querySelectorAll(".prose section[id]").forEach((s) => io.observe(s));
