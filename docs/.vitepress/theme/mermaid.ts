// Serialize initialization and rendering: Mermaid's configuration is global.
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;

export function renderMermaid(source: string, dark: boolean) {
  const result = queue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: dark ? "base" : "default",
      themeVariables: dark
        ? {
            darkMode: true,
            background: "#14191f",
            primaryColor: "#1c2b3e",
            primaryTextColor: "#e0e6ed",
            primaryBorderColor: "#587aa3",
            secondaryColor: "#1c232d",
            secondaryTextColor: "#e0e6ed",
            secondaryBorderColor: "#526174",
            tertiaryColor: "#191f27",
            tertiaryTextColor: "#abb6c4",
            tertiaryBorderColor: "#303a47",
            lineColor: "#93a8c1",
            textColor: "#e0e6ed",
            edgeLabelBackground: "#191f27",
            clusterBkg: "#191f27",
            clusterBorder: "#303a47",
            actorLineColor: "#526174",
            signalColor: "#93a8c1",
            signalTextColor: "#e0e6ed",
            noteBkgColor: "#253044",
            noteTextColor: "#e0e6ed",
            noteBorderColor: "#587aa3",
            fontFamily: '"Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
            dropShadow: "none",
          }
        : {},
    });
    return mermaid.render(`nova-mermaid-${nextId++}`, source);
  });
  queue = result.catch(() => {});
  return result;
}
