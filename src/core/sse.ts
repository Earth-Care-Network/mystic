/** Server-sent events, read incrementally from any chunked body. */
export type SseMessage = { event: string; data: string };

export class SseParser {
  private buffer = "";

  /** Feed one decoded chunk; returns every complete message it closed. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    const out: SseMessage[] = [];
    let at: number;
    while ((at = this.buffer.indexOf("\n\n")) !== -1) {
      const block = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length) out.push({ event, data: data.join("\n") });
    }
    return out;
  }
}

/** Every SSE message of a fetch Response body. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const m of parser.push(decoder.decode(value, { stream: true }))) yield m;
  }
  for (const m of parser.push("\n\n")) yield m;
}
