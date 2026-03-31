export class ChatClient {
  private url: string;
  private abortController: AbortController | null = null;

  constructor({ url }: { url: string }) {
    this.url = url;
  }

  async *send(payload: any, options: { conversationId: string }) {
    this.abortController = new AbortController();
    
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: payload,
        ...options,
      }),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Chat request failed: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const content = line.trim();
          if (content.startsWith("data: ")) {
            const jsonStr = content.slice(6).trim();
            if (jsonStr) {
              try {
                const chunk = JSON.parse(jsonStr);
                if (chunk && typeof chunk === "object" && "type" in chunk) {
                  yield chunk;
                }
              } catch (e) {
                console.error("Error parsing chat chunk:", e, line);
              }
            }
          }
        }
      }

      // Handle any remaining content in the buffer
      if (buffer.trim().startsWith("data: ")) {
        const jsonStr = buffer.trim().slice(6).trim();
        if (jsonStr) {
          try {
            const chunk = JSON.parse(jsonStr);
            if (chunk && typeof chunk === "object" && "type" in chunk) {
              yield chunk;
            }
          } catch (e) {
            console.error("Error parsing final chat chunk:", e, buffer);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  stop() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
