import type { ShortcutOverrides } from './contracts.js';
import { t } from './i18n.js';
const definitions: [string, string, string | null, string][] = [
  ['running-recent', '运行中会话', 'Command+R', '导航'],
  ['recent', '全部会话', 'Command+Shift+P', '导航'],
  ['search', '命令面板', 'Command+K', '导航'],
  ['next-attention', '下一个待处理会话', 'Command+J', '导航'],
  ['previous-attention', '上一个待处理会话', 'Command+Shift+J', '导航'],
  ['back', '返回上一步', 'Command+[', '导航'],
  ['forward', '前进', 'Command+]', '导航'],
  ['settings', '打开设置', 'Command+,', '导航'],
  ['shortcut-help', '查看快捷键', 'Command+/', '导航'],
  ['new-tab', '新建会话标签页', 'Command+N', '会话与窗口'],
  ['new-temporary-tab', '新建临时会话（不保存历史）', 'Command+Shift+N', '会话与窗口'],
  ['close-tab', '关闭当前标签并结束 Pi 进程', 'Command+W', '会话与窗口'],
  ['previous-tab', '上个会话标签', 'Command+Left', '会话与窗口'],
  ['next-tab', '下个会话标签', 'Command+Right', '会话与窗口'],
  ['open-terminal', '在终端中打开当前项目', 'Command+T', '会话与窗口'],
  ['toggle-sidebar', '显示/隐藏侧边栏', 'Command+Alt+S', '会话与窗口'],
  ['add', '添加项目', null, '会话与窗口'],
  ['refresh', '刷新本地历史', 'Command+Shift+R', '会话与窗口'],
  ['close-project-sessions', '结束当前项目所有会话…', null, '会话与窗口'],
  ['hide-window', '隐藏窗口（进程继续运行）', 'Command+Shift+H', '会话与窗口'],
  ['font-larger', '增大终端字体', 'Command+=', '外观'],
  ['font-smaller', '减小终端字体', 'Command+-', '外观'],
  ['sidebar-previous', '上一个侧栏会话', 'Command+Up', '导航'],
  ['sidebar-next', '下一个侧栏会话', 'Command+Down', '导航']
];
export const projectCommands = Array.from({length:10}, (_, index) => {
  const digit = (index + 1) % 10;
  return {id:`project-${digit}`, label:`切换到第 ${index + 1} 个项目`, accelerator:`Command+${digit}`, group:'项目'};
});
export const commands = [...definitions.map(([id, label, accelerator, group]) => ({id, label, accelerator, group})), ...projectCommands];
export const defaults: ShortcutOverrides = Object.fromEntries(commands.map(item => [item.id, item.accelerator]));
const modifiers = ['Command', 'Control', 'Alt', 'Shift'];
const names = ['Left','Right','Up','Down','Space','Return','Backspace','Delete','Home','End','PageUp','PageDown'];
const reserved = new Set(['Command+C','Command+V','Command+X','Command+A','Command+Z','Command+Shift+Z',
  'Command+Q','Command+H','Command+Alt+H','Command+M','Command+Control+F','Command+Shift+Q',
  'Command+Space','Command+Alt+Space','Command+Shift+3','Command+Shift+4','Command+Shift+5','Command+Shift+6',
  'Command+Control+Shift+3','Command+Control+Shift+4','Command+Control+Shift+5','Command+Control+Shift+6',
  'Command+Shift+Left','Command+Shift+Right','Command+Shift+Up','Command+Shift+Down']);
export function normalize(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 70) throw new Error(t('无效的快捷键。'));
  const parts = value.split('+'), key = parts.pop();
  if (!parts.includes('Command') || new Set(parts).size !== parts.length || parts.some(part => !modifiers.includes(part)) ||
      !(/^[A-Z0-9,./;\[\]'=\-`\\]$/.test(key || '') || names.includes(key || '') || /^F(?:[1-9]|1[0-2])$/.test(key || ''))) {
    throw new Error(t('应用快捷键需包含 ⌘；单独使用 Ctrl 或 Option 保留给 Pi 和文本输入。'));
  }
  const result = modifiers.filter(part => parts.includes(part)).concat(key!).join('+');
  if (reserved.has(result)) throw new Error(t('该快捷键保留给系统或文本编辑，请选择其他组合。'));
  return result;
}
export function validateOverrides(overrides: unknown): ShortcutOverrides {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) ||
      Object.keys(overrides).some(id => !Object.hasOwn(defaults, id))) throw new Error(t('无效的快捷键设置。'));
  const result: ShortcutOverrides = {};
  for (const [id, value] of Object.entries(overrides)) {
    const normalized = normalize(value);
    if (normalized !== defaults[id]) result[id] = normalized;
  }
  const occupied = new Map();
  for (const command of commands) {
    const value = Object.hasOwn(result, command.id) ? result[command.id] : command.accelerator;
    if (!value) continue;
    if (occupied.has(value)) throw new Error(t('快捷键冲突：「{first}」与「{second}」使用相同组合。', { first: command.label, second: occupied.get(value) || '' }));
    occupied.set(value, command.label);
  }
  return result;
}
export function bindings(overrides: ShortcutOverrides = {}) { return {...defaults, ...validateOverrides(overrides)}; }
const codes: Record<string, string> = {BracketLeft:'[',BracketRight:']',Comma:',',Period:'.',Slash:'/',Semicolon:';',Quote:"'",Equal:'=',Minus:'-',Backquote:'`',Backslash:'\\',
  ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down',Enter:'Return',Space:'Space'};
export function fromEvent(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>) {
  if (event.isComposing || !event.metaKey) return null;
  const code = event.code || '';
  // Use physical keys even when Option changes the character on macOS.
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^(?:Digit|Numpad)[0-9]$/.test(code) ? code.slice(-1) :
    codes[code] || code || codes[event.key] || (event.key?.length === 1 ? event.key.toUpperCase() : event.key);
  if (!key || ['Meta','Control','Alt','Shift','Dead'].includes(key)) return null;
  const value = [event.metaKey && 'Command', event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+');
  // Let recording report reserved combinations via validateOverrides instead of a generic error.
  if (reserved.has(value)) return value;
  try { return normalize(value); } catch { return null; }
}
export function match(event: Parameters<typeof fromEvent>[0], overrides: ShortcutOverrides = {}) {
  const value = fromEvent(event);
  if (!value) return null;
  return Object.entries(bindings(overrides)).find(([,accelerator]) => accelerator === value)?.[0] || null;
}
export function format(value: string | null | undefined) {
  if (!value) return t('未设置');
  const labels: Record<string, string> = {Command:'⌘',Control:'⌃',Alt:'⌥',Shift:'⇧',Left:'←',Right:'→',Up:'↑',Down:'↓',Space:t('空格'),Return:'↵',Backspace:'⌫',Delete:'⌦'};
  return value.split('+').map(part => labels[part] || part).join(' ');
}
