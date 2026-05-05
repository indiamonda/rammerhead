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
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;

  if (navigator.serviceWorker.controller) return;

  // SW is active but not yet controlling this page — wait for it to claim
  await new Promise((resolve) => {
    navigator.serviceWorker.addEventListener("controllerchange", resolve, {
      once: true,
    });
    // If the SW is waiting (e.g. update scenario), nudge it
    const waiting = reg.waiting || reg.active;
    if (waiting && waiting.state === "activated") {
      // Already activated but hasn't claimed — give it a moment
      setTimeout(resolve, 100);
    }
  });
}
