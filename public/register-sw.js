"use strict";
const swAllowedHostnames = ["localhost", "127.0.0.1"];

async function registerSW() {
  if (!navigator.serviceWorker) {
    if (
      location.protocol !== "https:" &&
      !swAllowedHostnames.includes(location.hostname)
    )
      throw new Error("Service workers cannot be registered without https.");
    throw new Error("Your browser doesn't support service workers.");
  }

  // Nuke old IDB schemas from v1
  try {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name === "$scramjet") {
        indexedDB.deleteDatabase("$scramjet");
      }
    }
  } catch (_) {}

  // Unregister any stale SWs with different script URLs
  const existingRegs = await navigator.serviceWorker.getRegistrations();
  for (const r of existingRegs) {
    if (r.active && !r.active.scriptURL.endsWith("/sw.js")) {
      await r.unregister();
    }
  }

  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

  // If there's a newer version waiting, push it to activate
  function nudgeWaiting() {
    if (reg.waiting) reg.waiting.postMessage({ type: "skipWaiting" });
  }
  nudgeWaiting();
  reg.addEventListener("updatefound", () => {
    const sw = reg.installing;
    if (sw) {
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed") nudgeWaiting();
      });
    }
  });

  // Trigger update check to pick up new SW code
  try { await reg.update(); } catch (_) {}
  nudgeWaiting();

  await navigator.serviceWorker.ready;

  // If we don't have a controller yet, or if a new SW is about to take over,
  // wait for the controllerchange event
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", resolve, {
        once: true,
      });
      setTimeout(resolve, 500);
    });
  } else if (reg.waiting || reg.installing) {
    // A new SW version is pending — wait for it to take over
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", resolve, {
        once: true,
      });
      nudgeWaiting();
      setTimeout(resolve, 1000);
    });
  }

  // Final check: if we still don't have a controller, the page needs a reload
  // because the SW can only intercept fetches for pages it controls.
  if (!navigator.serviceWorker.controller) {
    // One-shot reload to let the new SW claim this page
    if (!sessionStorage.getItem("__sw_reload")) {
      sessionStorage.setItem("__sw_reload", "1");
      location.reload();
      return null;
    }
    sessionStorage.removeItem("__sw_reload");
  } else {
    sessionStorage.removeItem("__sw_reload");
  }

  return navigator.serviceWorker.controller;
}
