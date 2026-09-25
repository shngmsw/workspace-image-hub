import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <main className="p-6">Image Hub</main>
  </StrictMode>,
);
