import { useEffect, useMemo, useState } from "react";

export type Route = "console" | "settings";

function normalizeHash(hash: string): Route {
  const value = hash.replace(/^#/, "");
  if (value === "settings") return "settings";
  return "console";
}

export function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const route = useMemo<Route>(() => normalizeHash(hash), [hash]);

  function navigate(next: Route) {
    window.location.hash = next === "console" ? "" : "#settings";
  }

  return { route, navigate };
}

