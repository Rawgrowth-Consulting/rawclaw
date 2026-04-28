import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {}
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener("change", cb)
  return () => mql.removeEventListener("change", cb)
}

function getSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches
}

function getServerSnapshot() {
  return false
}

// useSyncExternalStore subscribes to the matchMedia store directly, so we
// don't need a useEffect that mirrors the value into useState (which trips
// React 19's set-state-in-effect rule).
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
