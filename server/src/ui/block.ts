export interface UIBlockOptions {
  placement?: "thread" | "sidebar" | "attention";
  id?: string;
  meta?: Record<string, any>;
}

export interface UIBlock {
  type: "ui-block";
  widget: string;
  props: Record<string, any>;
  placement: "thread" | "sidebar" | "attention";
  id?: string;
  meta?: Record<string, any>;
}

export const block = (
  widget: string,
  props: Record<string, any>,
  options: UIBlockOptions = {}
): UIBlock => ({
  type: "ui-block",
  widget,
  props,
  placement: options.placement ?? "thread",
  id: options.id,
  meta: options.meta,
});

export const uiEvent = (block: UIBlock) => ({
  type: "ui",
  data: block,
});
