// A failed native attachment request redirects this hidden frame back to the
// app. Use data-only messaging; never insert URL parameters into HTML or code.
const params = new URLSearchParams(window.location.search);
window.parent.postMessage({
  type: 'revora-recording-download-error',
  request_id: params.get('request_id'),
  error: params.get('message') || 'The recording download failed. Please try again.',
}, window.location.origin);
