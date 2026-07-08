export async function postJson(endpoint: string, body: unknown, headers?: Record<string, string>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `OTLP export failed (${response.status} ${response.statusText}) to ${endpoint}: ${text.slice(0, 200)}`,
    );
  }
}
