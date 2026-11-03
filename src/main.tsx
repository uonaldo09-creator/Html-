import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ConvexAuthProvider } from "./lib/convexAuth";

createRoot(document.getElementById("root")!).render(
  <ConvexAuthProvider>
    <App />
  </ConvexAuthProvider>,
);
