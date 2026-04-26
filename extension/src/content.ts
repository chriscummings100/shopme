// Runs in ISOLATED world — bridges interceptor postMessages to the background service worker.

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== '__shopme_body__') return;
  chrome.runtime.sendMessage({ type: 'body_capture', data: event.data.data });
});
