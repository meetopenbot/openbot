export interface UIBlockOptions {
  placement?: "inline" | "sidebar" | "attention";
  id?: string;
  meta?: Record<string, any>;
}

export interface UIBlock {
  type: "ui-block";
  widget: string;
  props: Record<string, any>;
  placement: "inline" | "sidebar" | "attention";
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
  placement: options.placement ?? "inline",
  id: options.id,
  meta: options.meta,
});

export const uiEvent = (block: UIBlock) => ({
  type: "ui",
  data: block,
});
