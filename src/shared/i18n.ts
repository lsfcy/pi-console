import { dialogsEn } from './locales/dialogs.js';
import { sessionsEn } from './locales/sessions.js';
import { mainEn } from './locales/main.js';
import { shellEn } from './locales/shell.js';

export type Language = 'zh-CN' | 'en-US';
/**
 * Source-string catalog: zh-CN is the source text, en-US maps known strings.
 * Unknown English strings fall back to the Chinese source until migrated.
 */
const coreEn: Record<string, string> = {
  'Pi Console': 'Pi Console',
  '设置': 'Settings',
  '会话 · 全部项目': 'Sessions · All projects',
  '会话监控 · 全部项目': 'Monitor · All projects',
  '返回上一步': 'Go back',
  '前进': 'Go forward',
  '显示或隐藏侧边栏': 'Show or hide sidebar',
  '在访达中打开当前项目目录': 'Reveal current project in Finder',
  '选择项目打开方式': 'Choose how to open the project',
  '打开': 'Open',
  '项目会话工作区': 'Project workspace',
  '自动发现本机 Pi 会话。': 'Discover local Pi sessions automatically.',
  '添加目录或选择项目开始工作。': 'Add a directory or pick a project to start.',
  '添加项目': 'Add project',
  '会话历史': 'Session history',
  '关闭此标签及其进程': 'Close this tab and its process',
  '临时 · 不保存': 'Temporary · not saved',
  '搜索项目或会话': 'Search projects or sessions',
  '项目': 'Projects',
  '刷新本地历史': 'Refresh local history',
  '项目列表，可拖拽排序或右键上移下移': 'Project list: drag to reorder or right-click to move',
  '目录不存在': 'Directory missing',
  '暂无会话': 'No sessions yet',
  '没有匹配的会话': 'No matching sessions',
  '展开显示': 'Show more',
  '没有匹配的项目': 'No matching projects',
  '运行中': 'Running',
  '会话': 'Sessions',
  '会话监控': 'Monitor',
  '搜索项目、路径或会话标题': 'Search projects, paths or session titles',
  'Pi 已在本应用打开': 'Pi is open in this app',
  '会话操作': 'Session actions',
  '管理会话：': 'Manage session: ',
  '删除会话…': 'Delete session…',
  '删除会话：': 'Delete session: ',
  '保存会话后才能置顶': 'Save the session before pinning',
  '置顶会话（项目与全局）': 'Pin session (project and global)',
  '取消置顶（项目与全局）': 'Unpin session (project and global)',
  '会话：': 'Sessions: ',
  '项目列表': 'Project list',
  '临时会话': 'Temporary session',
  '会话历史与终端标签': 'Session history and terminal tabs',
  '当前项目会话和终端标签': 'Sessions and terminals in this project',
  '新建会话': 'New session',
  '关闭终端：': 'Close terminal: ',
  '查看会话': 'View session',
  '没有可重新打开的后台会话': 'No background sessions to reopen',
  '没有需要处理的会话': 'No sessions need attention',
  '设置自动保存 · 不修改 Pi 全局配置': 'Settings save automatically · Pi global config is untouched',
  '全部项目 · 已保存历史与 GUI 内运行中的会话': 'All projects · saved history and sessions running in this app',
  '全部项目 · token、缓存、成本与会话活动': 'All projects · tokens, cache, cost and activity',
  '自动发现本机 Pi 项目与会话': 'Discover local Pi projects and sessions',
  '临时 · 不保存历史 · ': 'Temporary · no history · ',
  '新建': 'New',
  '终端': 'Terminal',
  '切换标签': 'Switch tabs',
  '换行': 'New line',
  '快捷键': 'Shortcuts',
  '面板': 'Palette',
  '全部': 'All',
  '收藏': 'Favorites',
  '项目：': 'Project: ',
  '时间': 'Time',
  '全部项目': 'All projects',
  '最近 7 天': 'Last 7 days',
  '最近 1 个月': 'Last month',
  '最近一个月': 'Last month',
  '最近三个月': 'Last 3 months',
  '全部时间': 'All time',
  '编辑项目': 'Edit project',
  '项目名称': 'Project name',
  '项目目录': 'Project directory',
  '选择目录…': 'Choose directory…',
  '取消': 'Cancel',
  '保存': 'Save',
  '关闭': 'Close',
  '关于 Pi Console': 'About Pi Console',
  '命令面板': 'Command palette',
  '搜索会话、项目或命令': 'Search sessions, projects or commands',
  '命令': 'Commands',
  '没有匹配项': 'No matches',
  '↑↓ 选择 · ↵ 打开 · Esc 关闭': '↑↓ select · ↵ open · Esc close',
  '上下文': 'Context',
};
export const en: Record<string, string> = { ...coreEn, ...dialogsEn, ...sessionsEn, ...mainEn, ...shellEn };
let language: Language = 'zh-CN';
export function setLanguage(value: Language) { language = value === 'en-US' ? 'en-US' : 'zh-CN'; }
export function getLanguage() { return language; }
export function t(source: string, vars?: Record<string, string | number>) {
  const template = language === 'en-US' ? (en[source] ?? source) : source;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => key in vars ? String(vars[key]) : match);
}
