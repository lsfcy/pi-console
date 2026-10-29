import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// This extension runs in Pi, not Electron. Send source messages and variables; the main process translates replies.
class GuiBridgeError extends Error {
  vars: Record<string, string | number>;
  constructor(message: string, vars: Record<string, string | number> = {}) { super(message); this.vars = vars; }
}

export default function (pi: ExtensionAPI) {
  const token = process.env.PI_GUI_BRIDGE_TOKEN;
  if (!token) return;
  let unsubscribe: (() => void) | undefined;
  function emit(ctx: ExtensionContext, extra: Record<string, unknown> = {}) {
    if (ctx.mode !== "tui") return;
    const value = {
      token, sessionId: ctx.sessionManager.getSessionId(),
      sessionFile: ctx.sessionManager.getSessionFile() ?? null,
      name: (pi.getSessionName() ?? "").slice(0, 160), cwd: ctx.cwd,
      appearance: ctx.ui.theme.appearance, ...extra
    };
    const encoded = Buffer.from(JSON.stringify(value)).toString("base64");
    if (encoded.length > 16384) throw new Error("GUI bridge payload exceeds the protocol limit.");
    process.stdout.write("\x1b]7502;" + encoded + "\x1b\\");
  }
  function theme(ctx: ExtensionContext, name: unknown) {
    if (name !== "light" && name !== "dark") throw new GuiBridgeError("无效的 GUI 主题。");
    const loaded = ctx.ui.getTheme(name);
    if (!loaded) throw new GuiBridgeError("Pi 主题不可用：{name}", { name });
    const result = ctx.ui.setTheme(loaded);
    if (!result.success) throw new GuiBridgeError(result.error ? "Pi 主题切换失败：{detail}" : "Pi 主题切换失败。", result.error ? { detail: result.error } : {});
  }
  pi.on("session_start", (_event, ctx) => {
    unsubscribe?.(); unsubscribe = undefined;
    if (ctx.mode !== "tui") return;
    theme(ctx, process.env.PI_GUI_THEME === "light" ? "light" : "dark");
    unsubscribe = ctx.ui.onTerminalInput(data => {
      const match = /^\x1b\]7503;([A-Za-z0-9+/=]{1,16384})(?:\x07|\x1b\\)$/.exec(data);
      if (!match) return;
      let command: any;
      try { command = JSON.parse(Buffer.from(match[1], "base64").toString("utf8")); } catch { return { consume: true }; }
      if (command.token !== token) return { consume: true };
      try {
        if (command.action === "rename") {
          if (command.sessionId !== ctx.sessionManager.getSessionId()) throw new GuiBridgeError("会话已切换，请刷新后重试");
          if (typeof command.name !== "string" || !command.name.trim() || command.name.length > 160) throw new GuiBridgeError("会话名称无效。");
          pi.setSessionName(command.name.replace(/[\r\n]/g, " ").trim());
        } else if (command.action === "theme") theme(ctx, command.theme);
        else throw new GuiBridgeError("未知的 GUI 命令。");
        emit(ctx, { requestId: command.requestId, ok: true });
      } catch (error) {
        const source = error instanceof GuiBridgeError ? error : new GuiBridgeError("Pi 操作失败：{detail}", { detail: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
        emit(ctx, { requestId: command.requestId, ok: false, error: source.message, errorVars: source.vars });
      }
      return { consume: true };
    });
    emit(ctx);
  });
  pi.on("session_info_changed", (_event, ctx) => emit(ctx));
  pi.on("message_end", (event, ctx) => {
    if (event.message.role === "user" || event.message.role === "assistant") emit(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => emit(ctx));
  pi.on("session_shutdown", (_event, _ctx) => {
    unsubscribe?.(); unsubscribe = undefined;
  });
}
