// First: in dev it installs React Refresh before any component module runs; in a build it is empty.
import "@vitejs/plugin-react/preamble";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/fragment-mono/latin-400.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { readBoot } from "./boot";

const root = document.getElementById("root");
if (root === null) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <App boot={readBoot()} />
  </StrictMode>,
);
