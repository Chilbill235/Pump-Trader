"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Resets the scroll position to the top whenever the route changes.
 * This stops the iOS Safari bug where the scroll position persists
 * across client-side navigations and feels broken.
 */
export function ScrollToTop() {
  const pathname = usePathname();
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}
