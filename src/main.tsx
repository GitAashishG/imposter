import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/fraunces/wght-italic.css";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/600.css";
import RootApp from "./RootApp";
import { ThemeProvider } from "./Appearance";
import "./theme.css";
import "./styles.css";
import "./appearance.css";
import "./roadmap.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <RootApp />
    </ThemeProvider>
  </React.StrictMode>,
);
