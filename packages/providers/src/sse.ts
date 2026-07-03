export async function* readSseData(response: Response): AsyncGenerator<string> {
  if (!response.body) {
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = extractData(frame);
      if (data !== undefined) {
        yield data;
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) {
    const data = extractData(buffer);
    if (data !== undefined) {
      yield data;
    }
  }
}

function extractData(frame: string): string | undefined {
  const lines = frame.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) {
    return undefined;
  }
  return dataLines.join("\n");
}
