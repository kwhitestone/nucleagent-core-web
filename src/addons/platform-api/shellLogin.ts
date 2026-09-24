/**
 * Standalone no-session exit (login-ux-board §04): a branded interstitial, then
 * a hard navigation to the shell's /login. Only for standalone runs — an
 * embedded child must never navigate (the shell's /login is frame-ancestors 'none').
 * Kept byte-identical across core-web, deliverables-web and executor-web.
 */
const SHOW_AFTER_MS = 300;
const LINK_AFTER_MS = 1500;
const MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L4 7v10l8 5 8-5V7l-8-5z"/><path d="M12 22V12"/><path d="M4 7l8 5 8-5"/></svg>';
const STYLE = `
.shell-login-interstitial{position:fixed;inset:0;z-index:2147483647;display:grid;place-content:center;justify-items:center;
  text-align:center;padding:40px;background:var(--bg,#f6f8fc);color:var(--text-primary,#0f172a);font-family:inherit}
.shell-login-interstitial[hidden]{display:none}
.shell-login-interstitial .mark{width:44px;height:44px;margin-bottom:16px;border-radius:12px;display:grid;place-items:center;
  color:#fff;background:var(--grad-brand,linear-gradient(135deg,#14b8a6,#6366f1))}
.shell-login-interstitial .mark svg{width:22px;height:22px}
.shell-login-interstitial h1{font-size:15px;font-weight:700;margin:0}
.shell-login-interstitial p{font-size:12.5px;color:var(--text-secondary,#475569);margin:6px 0 0;max-width:34ch}
.shell-login-interstitial .dots{display:inline-flex;gap:3px;margin-top:14px}
.shell-login-interstitial .dots i{width:5px;height:5px;border-radius:50%;background:var(--text-tertiary,#94a3b8);animation:sli 1.2s infinite}
.shell-login-interstitial .dots i:nth-child(2){animation-delay:.2s}.shell-login-interstitial .dots i:nth-child(3){animation-delay:.4s}
.shell-login-interstitial a{margin-top:12px;font-size:12px;color:var(--accent,#0d9488)}
@keyframes sli{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.shell-login-interstitial .dots i{animation:none}}
@media (prefers-color-scheme:dark){.shell-login-interstitial{--bg:#0b1020;--text-primary:#e8ecf7;--text-secondary:#98a3bd;--text-tertiary:#6c7899}}`;

/*
 * Child route -> the shell's mount of it (nucleagent-web src/addons/*-remote/remote.ts).
 * Paths the shell does not mount fall back to that app's shell landing page.
 */
export function coreShellPath(childPath: string): string {
  const conversation = /^\/c\/([^/?#]+)/.exec(childPath);
  if (conversation) return `/chat/${conversation[1]}`;
  return /^\/(chat|creation|tasks|admin)(?=$|[/?#])/.test(childPath) ? childPath : "/chat";
}

export function deliverablesShellPath(childPath: string): string {
  return childPath.startsWith("/deliverables") ? childPath : "/deliverables";
}

/** The shell mounts executor-web's single dashboard at /executor. */
export function executorShellPath(): string {
  return "/executor";
}

/** The redirect value is a shell mount path (spec §5), never this app's own URL. */
export function shellLoginUrl(shellOrigin: string, shellPath: string): string {
  const url = new URL("/login", shellOrigin);
  if (shellPath.startsWith("/") && !shellPath.startsWith("//")) url.searchParams.set("redirect", shellPath);
  return url.href;
}

let leaving = false;

export function redirectToShellLogin(
  shellOrigin: string,
  shellPath: string,
  copy: { title: string; body: string },
): void {
  if (leaving) return;
  leaving = true;
  const href = shellLoginUrl(shellOrigin, shellPath);
  const card = document.createElement("div");
  card.className = "shell-login-interstitial";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  card.hidden = true;
  card.innerHTML = `<style>${STYLE}</style><span class="mark" aria-hidden="true">${MARK}</span><h1></h1><p></p><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><a hidden></a>`;
  card.querySelector("h1")!.textContent = copy.title;
  card.querySelector("p")!.textContent = copy.body;
  const link = card.querySelector("a")!;
  link.href = href;
  link.textContent = new URL(href).origin + "/login";
  document.body.append(card);
  setTimeout(() => { card.hidden = false; }, SHOW_AFTER_MS);
  setTimeout(() => { link.hidden = false; }, LINK_AFTER_MS);
  window.location.assign(href);
}
