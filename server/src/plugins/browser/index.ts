import { MelonyPlugin, Event } from "melony";
import { z } from "zod";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { generateText, LanguageModel, Output } from "ai";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const browserToolDefinitions = {
  browser_act: {
    description:
      "Perform a browser action like clicking, typing, or navigating using natural language.",
    inputSchema: z.object({
      instruction: z
        .string()
        .describe(
          "The action to perform, e.g. 'click the login button' or 'type pizza in the search box'"
        ),
    }),
  },
  browser_extract: {
    description:
      "Extract structured data from the page using natural language instructions.",
    inputSchema: z.object({
      instruction: z
        .string()
        .describe(
          "What data to extract, e.g. 'get all product titles and prices'"
        ),
    }),
  },
  browser_observe: {
    description:
      "Observe the current page and get a list of possible actions in natural language.",
    inputSchema: z.object({}),
  },
  browser_state_update: {
    description: "Get a fresh screenshot and page info from the browser.",
    inputSchema: z.object({}),
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserPluginOptions {
  headless?: boolean;
  userDataDir?: string;
  channel?: string;
  model?: LanguageModel;
}

export interface BrowserStatusEvent extends Event {
  type: "browser:status";
  data: { message: string; severity?: "info" | "success" | "error" };
}

export interface BrowserStateUpdateEvent extends Event {
  type: "browser:state-update";
  data: {
    url: string;
    title: string;
    screenshot?: string;
    pagesCount: number;
  };
}

// ---------------------------------------------------------------------------
// BrowserManager – lifecycle for Playwright browser / context / pages
// ---------------------------------------------------------------------------

class BrowserManager {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private pages: Page[] = [];
  private headless: boolean;

  constructor(private options: BrowserPluginOptions) {
    this.headless = options.headless ?? true;
  }

  async ensureBrowser(headlessOverride?: boolean) {
    if (headlessOverride !== undefined) this.headless = headlessOverride;
    if (this.browser) return this.browser;

    if (this.options.userDataDir) {
      this.context = await chromium.launchPersistentContext(
        this.options.userDataDir,
        { headless: this.headless, channel: this.options.channel }
      );
      this.browser = this.context.browser() ?? undefined;
      this.pages = this.context.pages();
    } else {
      this.browser = await chromium.launch({
        headless: this.headless,
        channel: this.options.channel,
      });
      this.context = await this.browser.newContext();
    }
    return this.browser;
  }

  async ensurePage(headlessOverride?: boolean) {
    await this.ensureBrowser(headlessOverride);
    if (this.pages.length === 0) {
      const page = await this.context!.newPage();
      this.pages.push(page);
    }
    return this.pages[0];
  }

  getPages() {
    return this.pages;
  }

  isHeadless() {
    return this.headless;
  }

  async relaunch(headless: boolean) {
    await this.cleanup();
    await this.ensureBrowser(headless);
  }

  async cleanup() {
    if (this.context) await this.context.close();
    else if (this.browser) await this.browser.close();
    this.browser = undefined;
    this.context = undefined;
    this.pages = [];
  }
}

// ---------------------------------------------------------------------------
// SmartBrowser – LLM-powered act / observe / extract
// ---------------------------------------------------------------------------

class SmartBrowser {
  constructor(
    private model: LanguageModel | undefined,
    private manager: BrowserManager
  ) {}

  // -- helpers --------------------------------------------------------------

  private async waitForStable(page: Page) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 3000 });
      await page
        .waitForLoadState("networkidle", { timeout: 3000 })
        .catch(() => {});
      await page
        .waitForFunction(
          () => !document.querySelector('[aria-busy="true"], .loading, .spinner'),
          { timeout: 2000 }
        )
        .catch(() => {});
    } catch {
      /* best effort */
    }
    await page.waitForTimeout(500);
  }

  private async clickById(page: Page, id: string) {
    const loc = page.locator(`[data-melony-id="${id}"]`).first();
    await loc.waitFor({ state: "attached", timeout: 10_000 });
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await loc.click({ timeout: 10_000 });
  }

  private async typeById(page: Page, id: string, text: string) {
    const loc = page.locator(`[data-melony-id="${id}"]`).first();
    await loc.waitFor({ state: "attached", timeout: 10_000 });
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await loc.fill(text, { timeout: 10_000 });
  }

  private async scroll(page: Page, direction: "up" | "down") {
    await page.evaluate((dir: string) => {
      const amount =
        dir === "up"
          ? -window.innerHeight * 0.8
          : window.innerHeight * 0.8;
      window.scrollBy(0, amount);
    }, direction);
    await page.waitForTimeout(500);
  }

  // -- page map (injects data-melony-id & builds semantic tree) -------------

  async getPageMap(page: Page) {
    // Polyfill esbuild/tsx __name helper (it doesn't exist in browser context)
    await page.evaluate('window.__name=window.__name||function(t){return t}');

    // Inject IDs on interactive elements
    await page.evaluate(() => {
      document
        .querySelectorAll("[data-melony-id]")
        .forEach((el) => el.removeAttribute("data-melony-id"));

      const selector =
        'button, a, input, select, textarea, [role="button"], [role="link"], ' +
        '[role="checkbox"], [role="menuitem"], [role="tab"], [role="treeitem"], ' +
        '[role="option"], [role="switch"], [role="radio"], [contenteditable="true"]';

      let id = 0;
      document.querySelectorAll(selector).forEach((el) => {
        const s = window.getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") return;
        el.setAttribute("data-melony-id", String(id++));
      });
    });

    // Build semantic page map
    return page.evaluate(() => {
      const vW = window.innerWidth;
      const vH = window.innerHeight;
      const scrollY = window.scrollY;
      const totalHeight = document.body.scrollHeight;
      const MAX_NODES = 1500;
      let count = 0;

      type Section =
        | "header"
        | "footer"
        | "navigation"
        | "main"
        | "sidebar"
        | "popups"
        | "other";

      const sections: Record<Section, any[]> = {
        header: [],
        sidebar: [],
        navigation: [],
        main: [],
        footer: [],
        popups: [],
        other: [],
      };

      const classifySection = (
        el: Element,
        style: CSSStyleDeclaration
      ): Section | null => {
        const tag = el.tagName;
        const role = el.getAttribute("role");
        const id = (el.id || "").toLowerCase();
        const cls = (
          typeof el.className === "string" ? el.className : ""
        ).toLowerCase();

        if (tag === "HEADER" || role === "banner") return "header";
        if (tag === "FOOTER" || role === "contentinfo") return "footer";
        if (tag === "NAV" || role === "navigation") return "navigation";
        if (tag === "MAIN" || role === "main") return "main";
        if (
          tag === "ASIDE" ||
          role === "complementary" ||
          id.includes("sidebar") ||
          cls.includes("sidebar")
        )
          return "sidebar";
        if (
          role === "dialog" ||
          role === "alertdialog" ||
          cls.includes("modal") ||
          cls.includes("popup")
        )
          return "popups";

        if (style.position === "fixed" || style.position === "sticky") {
          const r = el.getBoundingClientRect();
          if (r.top <= 50 && r.width > vW * 0.8) return "header";
          if (r.bottom >= vH - 50 && r.width > vW * 0.8) return "footer";
        }
        return null;
      };

      const buildTree = (
        el: Element,
        depth = 0,
        currentSection?: Section
      ): any => {
        if (count > MAX_NODES || depth > 15) return null;
        if (
          ["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME"].includes(el.tagName)
        )
          return null;

        const style = window.getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          el.getAttribute("aria-hidden") === "true"
        )
          return null;

        const rect = el.getBoundingClientRect();
        const inViewport =
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < vH &&
          rect.left < vW;
        if (!inViewport && rect.top > vH * 3) return null;

        const melonyId = el.getAttribute("data-melony-id");
        const isInteractive = !!melonyId;
        const role = el.getAttribute("role");
        const isHeading = /^H[1-6]$/.test(el.tagName);

        const directText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3 && n.textContent?.trim())
          .map((n) => n.textContent!.trim())
          .join(" ");

        const section =
          depth < 6 ? classifySection(el, style) : null;
        const active: Section = section || currentSection || "other";

        const children = Array.from(el.children)
          .map((c) => buildTree(c, depth + 1, active))
          .filter(Boolean);

        const interestingRoles = [
          "heading",
          "img",
          "alert",
          "dialog",
          "status",
          "gridcell",
          "list",
        ];
        const isInteresting =
          isInteractive ||
          isHeading ||
          directText ||
          children.length > 0 ||
          interestingRoles.includes(role || "");

        if (
          !isInteresting &&
          !el.getAttribute("aria-label") &&
          !el.getAttribute("title")
        )
          return null;

        // Flatten container-only nodes
        if (
          !isInteractive &&
          !directText &&
          children.length === 1 &&
          !section &&
          !isHeading &&
          !role
        )
          return children[0];

        count++;
        const node: any = {
          tag: el.tagName,
          id: melonyId || undefined,
          text:
            isInteractive || isHeading
              ? (el as HTMLElement).innerText?.trim().slice(0, 100)
              : directText || undefined,
          role: role || undefined,
          label:
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            undefined,
          inViewport,
        };

        if (el.tagName === "INPUT") {
          node.type = (el as HTMLInputElement).type;
          node.value = (el as HTMLInputElement).value;
        }
        if (children.length > 0) node.children = children;

        if (section && depth < 6) {
          sections[section].push(node);
          return null;
        }
        return node;
      };

      const remaining = buildTree(document.body);
      if (remaining) sections.other.push(remaining);

      return {
        url: window.location.href,
        title: document.title,
        scroll: {
          y: scrollY,
          percentage: Math.round(
            (scrollY / (totalHeight - vH || 1)) * 100
          ),
          totalHeight,
        },
        sections: Object.fromEntries(
          Object.entries(sections).filter(([, v]) => v.length > 0)
        ),
      };
    });
  }

  // -- act (LLM decides what to do) ----------------------------------------

  private static actionSchema = z.object({
    action: z.enum([
      "click",
      "type",
      "press",
      "wait",
      "navigate",
      "scroll",
      "done",
    ]),
    elementId: z.string().nullable().describe("data-melony-id of the element"),
    text: z.string().nullable().describe("Text for 'type' action"),
    key: z.string().nullable().describe("Key for 'press' action"),
    url: z.string().nullable().describe("URL for 'navigate' action"),
    direction: z.enum(["up", "down"]).nullable(),
    reasoning: z.string().describe("Brief explanation"),
  });

  async act(
    page: Page,
    instruction: string
  ): Promise<{ success?: boolean; action?: string; reasoning?: string; message?: string }> {
    if (!this.model) throw new Error("LanguageModel required for 'act'");

    const run = async (
      retry = 0,
      lastError?: string
    ): Promise<any> => {
      await this.waitForStable(page);
      const screenshot = await page
        .screenshot({ type: "jpeg", quality: 60 })
        .catch(() => null);
      const state = await this.getPageMap(page);

      const { output } = await generateText({
        model: this.model!,
        output: Output.object({ schema: SmartBrowser.actionSchema }),
        messages: [
          {
            role: "system",
            content: `You are an expert browser agent. Your task: "${instruction}"
Current URL: ${state.url}  |  Title: ${state.title}  |  Scroll: ${state.scroll.percentage}%

The DOM is grouped by semantic sections. Elements have numeric IDs for clicking/typing.
- Prefer elements in 'main' or 'navigation'.
- If the target isn't visible, scroll or look for inViewport:false elements.
- Handle popups/modals first if present.
- Use action 'done' when the task is complete.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `DOM:\n${JSON.stringify(state.sections, null, 2)}`,
              },
              ...(screenshot
                ? [{ type: "image" as const, image: screenshot }]
                : []),
              ...(lastError
                ? [{ type: "text" as const, text: `Previous error: ${lastError}` }]
                : []),
            ],
          },
        ],
      });

      if (!output) throw new Error("LLM returned no structured output");
      if (output.action === "done")
        return { success: true, message: output.reasoning };

      try {
        switch (output.action) {
          case "click":
            await this.clickById(page, output.elementId!);
            break;
          case "type":
            await this.typeById(page, output.elementId!, output.text!);
            break;
          case "press":
            await page.keyboard.press(output.key!);
            break;
          case "scroll":
            await this.scroll(page, output.direction || "down");
            break;
          case "navigate":
            await page.goto(output.url!);
            break;
          case "wait":
            await page.waitForTimeout(2000);
            break;
        }
        return { action: output.action, reasoning: output.reasoning };
      } catch (e: any) {
        if (retry < 1) return run(retry + 1, e.message);
        throw e;
      }
    };

    return run();
  }

  // -- observe (LLM suggests possible actions) ------------------------------

  async observe(page: Page) {
    if (!this.model) throw new Error("LanguageModel required for 'observe'");
    await this.waitForStable(page);

    const state = await this.getPageMap(page);
    const screenshot = await page
      .screenshot({ type: "jpeg", quality: 60 })
      .catch(() => null);

    const { output } = await generateText({
      model: this.model,
      output: Output.object({
        schema: z.object({
          observations: z.array(
            z.string().describe("Natural language instruction for 'act'")
          ),
        }),
      }),
      messages: [
        {
          role: "system",
          content: `You are an expert browser analyst.
Current URL: ${state.url}  |  Title: ${state.title}  |  Scroll: ${state.scroll.percentage}%

Suggest 5 logical, high-level actions a user might want to take.
Each should be a natural language instruction passable to 'browser_act'.
Focus on primary content and navigation. Handle modals first if open.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `DOM:\n${JSON.stringify(state.sections, null, 2)}`,
            },
            ...(screenshot
              ? [{ type: "image" as const, image: screenshot }]
              : []),
          ],
        },
      ],
    });

    return output;
  }

  // -- extract (LLM pulls structured data from page text) -------------------

  async extract(page: Page, instruction: string) {
    if (!this.model) throw new Error("LanguageModel required for 'extract'");
    await this.waitForStable(page);

    const content = await page.evaluate(() => document.body.innerText);

    const { output } = await generateText({
      model: this.model,
      output: Output.object({
        schema: z.object({
          data: z.string(),
          confidence: z.number(),
        }),
      }),
      prompt: `Extract "${instruction}" from:\n${content.slice(0, 15_000)}`,
    });

    if (!output) throw new Error("LLM returned no structured output");

    try {
      return { ...output, data: JSON.parse(output.data) };
    } catch {
      return output;
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export const browserPlugin = (
  options: BrowserPluginOptions = {}
): MelonyPlugin<any, any> => {
  const manager = new BrowserManager(options);
  const smart = new SmartBrowser(options.model, manager);

  return (builder) => {
    // -- helpers ------------------------------------------------------------

    async function* yieldState(
      page: Page,
      opts: { screenshot?: boolean } = { screenshot: true }
    ) {
      try {
        const url = page.url();
        const title = await page.title();
        let base64: string | undefined;

        if (opts.screenshot) {
          const buf = await page
            .screenshot({ type: "jpeg", quality: 60 })
            .catch(() => null);
          if (buf) base64 = buf.toString("base64");
        }

        yield {
          type: "browser:state-update",
          data: {
            url,
            title,
            screenshot: base64,
            pagesCount: manager.getPages().length,
          },
        } as BrowserStateUpdateEvent;
      } catch (e) {
        console.error("Browser state update failed", e);
      }
    }

    function actionResult(
      action: string,
      toolCallId: string,
      data: Record<string, unknown>
    ) {
      return {
        type: "action:taskResult",
        data: { action, toolCallId, result: data },
      };
    }

    // -- browser_act --------------------------------------------------------

    builder.on("action:browser_act" as any, async function* (event) {
      const { toolCallId, instruction } = event.data;
      yield {
        type: "browser:status",
        data: { message: `Performing: ${instruction}` },
      } as BrowserStatusEvent;

      try {
        const page = await manager.ensurePage();
        const res = await smart.act(page, instruction);
        yield* yieldState(page);
        yield actionResult("browser_act", toolCallId, { success: true, ...res });
      } catch (error: any) {
        yield actionResult("browser_act", toolCallId, { error: error.message });
      }
    });

    // -- browser_extract ----------------------------------------------------

    builder.on("action:browser_extract" as any, async function* (event) {
      const { toolCallId, instruction } = event.data;
      yield {
        type: "browser:status",
        data: { message: `Extracting: ${instruction}` },
      } as BrowserStatusEvent;

      try {
        const page = await manager.ensurePage();
        const res = await smart.extract(page, instruction);
        yield {
          type: "browser:status",
          data: {
            message: `Extracted: ${JSON.stringify(res, null, 2)}`,
            severity: "success",
          },
        } as BrowserStatusEvent;
        yield* yieldState(page, { screenshot: false });
        yield actionResult("browser_extract", toolCallId, { success: true, ...res });
      } catch (error: any) {
        yield actionResult("browser_extract", toolCallId, { error: error.message });
      }
    });

    // -- browser_observe ----------------------------------------------------

    builder.on("action:browser_observe" as any, async function* (event) {
      const { toolCallId } = event.data;
      yield {
        type: "browser:status",
        data: { message: "Observing page…" },
      } as BrowserStatusEvent;

      try {
        const page = await manager.ensurePage();
        const res = await smart.observe(page);
        const observations = (res as any)?.observations;

        yield {
          type: "browser:status",
          data: {
            message: observations
              ? `Possible actions:\n${observations.map((o: string) => `• ${o}`).join("\n")}`
              : `Observations: ${JSON.stringify(res, null, 2)}`,
            severity: "success",
          },
        } as BrowserStatusEvent;

        yield* yieldState(page);
        yield actionResult("browser_observe", toolCallId, { success: true, ...res });
      } catch (error: any) {
        yield actionResult("browser_observe", toolCallId, { error: error.message });
      }
    });

    // -- browser_state_update -----------------------------------------------

    builder.on("action:browser_state_update" as any, async function* (event) {
      const { toolCallId } = event.data;
      yield {
        type: "browser:status",
        data: { message: "Updating browser state…" },
      } as BrowserStatusEvent;

      try {
        const page = await manager.ensurePage();
        yield* yieldState(page);
        yield actionResult("browser_state_update", toolCallId, { success: true });
      } catch (error: any) {
        yield actionResult("browser_state_update", toolCallId, {
          error: error.message,
        });
      }
    });

    // -- browser_cleanup (internal) -----------------------------------------

    builder.on("action:browser_cleanup" as any, async function* (event) {
      const { toolCallId } = event.data;
      try {
        await manager.cleanup();
        yield actionResult("browser_cleanup", toolCallId, {
          success: true,
          message: "Browser closed",
        });
      } catch (error: any) {
        yield actionResult("browser_cleanup", toolCallId, { error: error.message });
      }
    });

    // -- browser_show (internal – switch to headed mode) --------------------

    builder.on("action:browser_show" as any, async function* (event) {
      const { toolCallId } = event.data;
      yield {
        type: "browser:status",
        data: { message: "Showing browser…" },
      } as BrowserStatusEvent;

      try {
        const page = await manager.ensurePage();
        let activePage = page;
        let res = { message: "Browser is active", url: page.url() };

        if (manager.isHeadless()) {
          const url = page.url();
          await manager.relaunch(false);
          const newPage = await manager.ensurePage(false);
          activePage = newPage;
          if (url) await newPage.goto(url);
          res = { message: "Browser opened (headed)", url: newPage.url() };
        }

        yield* yieldState(activePage);
        yield actionResult("browser_show", toolCallId, { success: true, ...res });
      } catch (error: any) {
        yield actionResult("browser_show", toolCallId, { error: error.message });
      }
    });
  };
};
