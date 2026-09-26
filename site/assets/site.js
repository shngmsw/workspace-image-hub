// Loaded without defer: <html lang> must be settled before first paint, or the page flashes Japanese.
(() => {
  const KEY = "wih-lp-lang";
  const LANGS = ["ja", "en"];
  const TITLES = {
    ja: "Workspace Image Hub — ドライブの画像を、変わらない直リンクに",
    en: "Workspace Image Hub — Permanent WebP links for Google Workspace",
  };
  const COPY = {
    ja: { idle: "コピー", done: "コピーしました", failed: "コピーできませんでした" },
    en: { idle: "Copy", done: "Copied", failed: "Could not copy" },
  };
  const root = document.documentElement;
  const isLang = (value) => LANGS.includes(value);

  // Storage can be missing or throw (private windows, blocked site data); the page works without it.
  const readStored = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const writeStored = (value) => {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // Not remembered this time; nothing else depends on it.
    }
  };

  const fromUrl = new URLSearchParams(location.search).get("lang");
  const stored = readStored();
  let lang = isLang(fromUrl) ? fromUrl : isLang(stored) ? stored : "ja";

  root.classList.add("js");
  root.lang = lang;
  document.title = TITLES[lang];

  const labelCopy = (button) => {
    const state = button.dataset.state ?? "idle";
    button.querySelector(".copy-label").textContent = COPY[lang][state];
  };

  const render = () => {
    root.lang = lang;
    document.title = TITLES[lang];
    for (const el of document.querySelectorAll("[data-aria-ja]")) {
      el.setAttribute("aria-label", lang === "ja" ? el.dataset.ariaJa : el.dataset.ariaEn);
    }
    for (const button of document.querySelectorAll("[data-set-lang]")) {
      button.setAttribute("aria-pressed", String(button.dataset.setLang === lang));
    }
    for (const button of document.querySelectorAll(".copy")) labelCopy(button);
  };

  const setLang = (next) => {
    if (!isLang(next) || next === lang) return;
    lang = next;
    writeStored(next);
    // An explicit ?lang= would win on reload, so keep it in step with the choice.
    const url = new URL(location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", next);
      history.replaceState(null, "", url);
    }
    render();
  };

  const copy = async (button) => {
    const code = button.closest(".code").querySelector("pre").textContent;
    let state = "done";
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      state = "failed";
    }
    button.dataset.state = state;
    labelCopy(button);
    document.getElementById("live").textContent = COPY[lang][state];
    clearTimeout(button.resetTimer);
    button.resetTimer = setTimeout(() => {
      button.dataset.state = "idle";
      labelCopy(button);
    }, 1800);
  };

  document.addEventListener("DOMContentLoaded", () => {
    for (const button of document.querySelectorAll("[data-set-lang]")) {
      button.addEventListener("click", () => {
        setLang(button.dataset.setLang);
      });
    }
    if (navigator.clipboard) {
      for (const button of document.querySelectorAll(".copy")) {
        button.hidden = false;
        button.addEventListener("click", () => {
          void copy(button);
        });
      }
    }
    render();
  });
})();
