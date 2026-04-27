import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "katex/dist/katex.min.css";
import "./styles/global.css";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";

function enforceLightOnlyTheme() {
  const root = document.documentElement;
  root.style.colorScheme = "only light";
  root.dataset.mergeEduTheme = "light";

  const removeInjectedDarkStyles = () => {
    document
      .querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
        [
          "style[class*='darkreader' i]",
          "style[id*='darkreader' i]",
          "link[class*='darkreader' i]",
          "link[id*='darkreader' i]",
          "style[data-darkreader]",
          "style[data-darkreader-mode]",
          "style[data-darkreader-scheme]"
        ].join(",")
      )
      .forEach((node) => node.remove());

    root.removeAttribute("data-darkreader-mode");
    root.removeAttribute("data-darkreader-scheme");
    root.removeAttribute("data-darkreader-proxy-injected");
  };

  removeInjectedDarkStyles();
  new MutationObserver(removeInjectedDarkStyles).observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true
  });
}

enforceLightOnlyTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
