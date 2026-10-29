import { t } from '../shared/i18n.js';
import { execFile } from 'node:child_process';
import * as errors from '../shared/errors.js';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import type { ProjectOpenTarget } from '../shared/contracts.js';
import type { App, BrowserWindow } from 'electron';
import { terminalEnvironment } from './terminal-manager.cjs';
const exec = promisify(execFile);
const ITERM_SCRIPT = `on run argv
  set workDir to item 1 of argv
  tell application "iTerm"
    activate
    if (count of windows) is 0 then
      set targetWindow to (create window with default profile)
    else
      set targetWindow to current window
      tell targetWindow to create tab with default profile
    end if
    tell current session of targetWindow
      write text "cd -- " & quoted form of workDir
    end tell
  end tell
end run`;
async function piVersion({ env = process.env, shell = os.userInfo().shell || '/bin/zsh' } = {}) {
  const { stdout } = await exec(shell, ['-ilc', 'pi --version'], { env: terminalEnvironment(env), timeout: 8000, maxBuffer: 64 * 1024 });
  return stdout.trim().split('\n').at(-1)?.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || t('未知版本');
}
async function openIterm(directory: string) {
  try { await exec('/usr/bin/osascript', ['-e', ITERM_SCRIPT, directory], { timeout: 20000, maxBuffer: 64 * 1024 }); }
  catch (error) { throw new Error(errors.killed(error) ? t('无法打开 iTerm2。请确认已安装，并在“系统设置 → 隐私与安全性 → 自动化”中允许 Pi Console 控制 iTerm2。 操作已超时。\n{detail}', { detail: errors.message(error) }) : t('无法打开 iTerm2。请确认已安装，并在“系统设置 → 隐私与安全性 → 自动化”中允许 Pi Console 控制 iTerm2。\n{detail}', { detail: errors.message(error) })); }
}
const projectApplications = { finder: 'Finder', vscode: 'Visual Studio Code', idea: 'IntelliJ IDEA', sourcetree: 'Sourcetree', terminal: 'Terminal' } as const;
async function openProject(directory: string, target: ProjectOpenTarget,
  run: (command: string, args: string[]) => Promise<unknown> = (command, args) => exec(command, args, { timeout: 8000, maxBuffer: 64 * 1024 })) {
  if (!path.isAbsolute(directory)) throw new Error(t('无效的项目目录。'));
  if (!Object.hasOwn(projectApplications, target)) throw new Error(t('不支持的打开方式。'));
  const application = projectApplications[target as keyof typeof projectApplications];
  try { await run('/usr/bin/open', ['-a', application, directory]); }
  catch (error) { throw new Error(t('无法使用 {application} 打开项目，请确认已安装该应用。\n{detail}', { application, detail: errors.message(error) })); }
}
/** Register the running bundle before Electron asks macOS for notification authorization. */
async function registerApplication(application: string, run: (command: string, args: string[]) => Promise<unknown> =
  (command, args) => exec(command, args, { timeout: 8000, maxBuffer: 64 * 1024 })) {
  if (!path.isAbsolute(application) || !application.endsWith('.app')) throw new Error(t('无效的应用路径。'));
  await run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', application]);
}
function focusWindow(window: BrowserWindow | undefined, application: Pick<App, 'focus'>) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
  application.focus({ steal: true });
}
/** One cached value and one in-flight read; update completion is the invalidation boundary. */
class VersionCache {
  value: string | null = null;
  private pending: Promise<string> | null = null;
  private generation = 0;
  constructor(private read: () => Promise<string>) {}
  get(force = false): Promise<string> {
    if (this.pending) return this.pending;
    if (!force && this.value !== null) return Promise.resolve(this.value);
    const generation = this.generation;
    const pending = Promise.resolve().then(this.read).then(value => {
      if (generation === this.generation) this.value = value;
      return value;
    }).finally(() => { if (this.pending === pending) this.pending = null; });
    this.pending = pending;
    return pending;
  }
  invalidate() { this.value = null; this.pending = null; this.generation++; }
}
export { piVersion, openIterm, openProject, ITERM_SCRIPT, VersionCache, registerApplication, focusWindow };
