import { createApp, type NovaRequest, type NovaResponse } from "nova-http";

declare module "nova-http" {
  interface HookEvents {
    "example:observed": { value: number };
  }

  interface RequestLocals {
    example?: { value: number };
  }
}

const app = createApp();

const listener = ({ value }: { value: number }) => {
  value satisfies number;
};

app.addHook("example:observed", listener);
app.removeHook("example:observed", listener);

app.hooks.emitHook("example:observed", { value: 1 });

app.get("/example", (req: NovaRequest, res: NovaResponse) => {
  req.context.example = { value: 1 };
  req.context.example.value satisfies number;
  res.end();
});

// @ts-expect-error Unknown extension events remain type errors.
app.addHook("example:missing", () => {});
