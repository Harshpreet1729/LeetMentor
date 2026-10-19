let csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

export async function request(url, payload, signal) {
  const timeout = AbortSignal.timeout(90000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  if (!csrfToken) {
    // Vite proxies this to Django's home view; no extra backend endpoint is needed.
    const page = await fetch("/django-csrf", { credentials: "same-origin", signal: requestSignal });
    if (!page.ok) throw new Error("Cannot connect to Django. Start it on localhost:8000.");
    const html = new DOMParser().parseFromString(await page.text(), "text/html");
    csrfToken = html.querySelector('meta[name="csrf-token"]')?.content;
    if (!csrfToken) throw new Error("Could not get Django's CSRF token. Refresh and try again.");
  }

  const response = await fetch(url, {
    method: payload === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: requestSignal,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    if (response.status === 403) throw new Error("The session security check failed. Refresh the page and try again.");
    throw new Error("The server could not answer. Please try again.");
  }
  if (!response.ok || !data.ok) throw new Error(data.message || "Request failed. Please try again.");
  return data;
}
