const dot = document.getElementById('dot')!;
const label = document.getElementById('label')!;
const info = document.getElementById('info')!;

function row(key: string, value: string | null, fallback = '—') {
  const val = value || fallback;
  const cls = value ? '' : ' class="none"';
  return `<tr><td>${key}</td><td${cls}>${val}</td></tr>`;
}

chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
  if (chrome.runtime.lastError || !response) {
    label.textContent = 'Service worker inactive';
    return;
  }

  if (response.connected) {
    dot.classList.add('connected');
    label.textContent = 'Connected to MCP host';
  } else {
    label.textContent = 'Disconnected';
  }

  const ping = response.lastPingTime
    ? new Date(response.lastPingTime).toLocaleTimeString()
    : null;

  info.innerHTML =
    row('Customer', response.customerId || null) +
    row('Order ID', response.orderId && response.orderId !== 'undefined' ? response.orderId : null) +
    row('Token', response.tokenPreview || null, 'not captured') +
    row('Last ping', ping, 'never');
});
