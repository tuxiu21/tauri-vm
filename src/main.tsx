import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { maybeRunE2EInvokeSuite } from "./app/e2eRunner";

void maybeRunE2EInvokeSuite();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
