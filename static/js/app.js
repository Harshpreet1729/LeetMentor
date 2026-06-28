(function () {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.getElementById("site-nav");

  if (!toggle || !nav) {
    return;
  }

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    toggle.setAttribute("aria-label", expanded ? "Open navigation menu" : "Close navigation menu");
    nav.classList.toggle("is-open", !expanded);
  });
})();
