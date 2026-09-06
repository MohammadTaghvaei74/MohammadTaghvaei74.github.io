"use strict";

document.documentElement.classList.add("js");

const menuToggle = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#navigation");
menuToggle.hidden = false;

function closeMenu() {
  menuToggle.setAttribute("aria-expanded", "false");
  navigation.classList.remove("is-open");
  menuToggle.querySelector("span").textContent = "+";
}

menuToggle.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  navigation.classList.toggle("is-open", isOpen);
  menuToggle.querySelector("span").textContent = isOpen ? "-" : "+";
});

navigation.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    menuToggle.getAttribute("aria-expanded") === "true"
  ) {
    closeMenu();
    menuToggle.focus();
  }
});
window.matchMedia("(min-width: 601px)").addEventListener("change", closeMenu);

const filters = document.querySelector(".filters");
const projectCards = [...document.querySelectorAll("[data-category]")];
filters.hidden = false;
filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  const category = button.dataset.filter;
  filters.querySelectorAll("button").forEach((filter) => {
    const selected = filter === button;
    filter.classList.toggle("active", selected);
    filter.setAttribute("aria-pressed", String(selected));
  });
  projectCards.forEach((card) => {
    card.hidden = category !== "all" && card.dataset.category !== category;
    // Filtered results should appear immediately, before scroll observation.
    card.classList.remove("is-pending");
  });
  document.querySelector(".portfolio-note").hidden = category !== "all";
  const count = projectCards.filter((card) => !card.hidden).length;
  document.querySelector("#filter-status").textContent =
    `${count} products shown.`;
});

const copyButton = document.querySelector("#copy-email");
if (navigator.clipboard && window.isSecureContext) {
  copyButton.hidden = false;
  copyButton.addEventListener("click", async () => {
    const status = document.querySelector("#copy-status");
    try {
      await navigator.clipboard.writeText("m.taghvaei74@gmail.com");
      status.textContent = "Email address copied.";
    } catch {
      status.textContent =
        "Could not copy. Select the email address to copy it.";
    }
  });
}

document.querySelector("#year").textContent = new Date().getFullYear();

// Content stays visible without JavaScript or when reduced motion is preferred.
if (
  "IntersectionObserver" in window &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches
) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.remove("is-pending");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08 },
  );
  document.querySelectorAll(".reveal").forEach((element) => {
    element.classList.add("is-pending");
    observer.observe(element);
  });
}
