const dot = document.getElementById('dot')!;
const label = document.getElementById('label')!;
const info = document.getElementById('info')!;

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

  const parts: string[] = [];
  if (response.capturing) parts.push('Capturing traffic');
  if (response.capturedCount > 0) parts.push(`${response.capturedCount} requests captured`);
  info.textContent = parts.join(' · ');
});
