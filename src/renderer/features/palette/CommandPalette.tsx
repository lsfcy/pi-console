import { t } from '../../../shared/i18n.js';
import { useEffect, useRef, useState } from 'react';
import type { HistorySession } from '../../../shared/contracts.js';
import { relativeSessionTime } from '../../../shared/format.js';
import { statusFor } from '../../../shared/view-model.js';
import { recentRows } from '../../state/selectors.js';
import { useWorkspace } from '../../state/AppContext.js';

type Kind = 'session' | 'project' | 'command';
interface Item { id: string; kind: Kind; title: string; detail: string; run: () => void }
const kindLabel: Record<Kind, string> = { session: '会话', project: '项目', command: '命令' };
const commands: [string, string][] = [
  ['new-tab', '新建会话'], ['new-temporary-tab', '新建临时会话'], ['open-terminal', '在终端中打开当前项目'],
  ['running-recent', '运行中会话'], ['recent', '全部会话'],
  ['next-attention', '下一个待处理会话'],
  ['close-project-sessions', '结束当前项目所有会话…'],
  ['settings', '打开设置'], ['toggle-sidebar', '显示或隐藏侧边栏'], ['refresh', '刷新本地历史'],
  ['end-all', '结束全部会话…']
];
export function CommandPalette() {
  const app = useWorkspace(), [query, setQuery] = useState(''), [index, setIndex] = useState(0), input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const needle = query.trim().toLocaleLowerCase();
  const items: Item[] = [];
  for (const info of recentRows(app) as HistorySession[]) {
    const project = app.projects.find(item => item.id === info.projectId);
    if (needle && !(info.title + ' ' + (info.firstMessage || '') + ' ' + (project?.name || '')).toLocaleLowerCase().includes(needle)) continue;
    if (items.filter(item => item.kind === 'session').length >= 8) break;
    const detail = [project?.name, info.state ? statusFor(info.state).label : t('历史'), relativeSessionTime(info.modifiedAt)].filter(Boolean).join(' · ');
    items.push({ id: 'session:' + info.projectId + ':' + (info.key || info.terminalId), kind: 'session', title: info.title, detail, run: () => app.openHistoryItem(info) });
  }
  for (const project of app.projects) {
    if (needle && !(project.name + ' ' + project.path).toLocaleLowerCase().includes(needle)) continue;
    if (items.filter(item => item.kind === 'project').length >= 4) break;
    items.push({ id: 'project:' + project.id, kind: 'project', title: project.name, detail: project.path, run: () => app.selectProject(project.id) });
  }
  for (const [id, source] of commands) {
    const title = t(source);
    if (needle && !title.toLocaleLowerCase().includes(needle)) continue;
    if (items.filter(item => item.kind === 'command').length >= 6) break;
    items.push({ id: 'command:' + id, kind: 'command', title, detail: '', run: () => app.shortcut(id) });
  }
  const current = Math.min(index, Math.max(0, items.length - 1));
  const run = (item: Item) => { app.closePalette(); item.run(); };
  return <div className="palette-backdrop" onMouseDown={() => app.closePalette()}>
    <section className="palette" role="dialog" aria-modal="true" aria-label={t("命令面板")} onMouseDown={event => event.stopPropagation()}>
      <input ref={input} id="palette-input" className="palette-input" type="text" autoComplete="off" spellCheck={false}
        role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
        aria-activedescendant={items[current] ? 'palette-option-' + current : undefined}
        placeholder={t("搜索会话、项目或命令")} aria-label={t("搜索会话、项目或命令")} value={query}
        onChange={event => { setQuery(event.target.value); setIndex(0); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(items.length ? (current + 1) % items.length : 0); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(items.length ? (current - 1 + items.length) % items.length : 0); }
          else if (event.key === 'Enter') { event.preventDefault(); if (items[current]) run(items[current]); }
          else if (event.key === 'Escape') { event.preventDefault(); app.closePalette(); }
        }} />
      <div className="palette-list" id="palette-list" role="listbox" aria-label={t("命令面板结果")}>
        {items.map((item, position) => <button key={item.id} id={'palette-option-' + position} type="button" role="option" aria-selected={position === current}
          className={'palette-item' + (position === current ? ' selected' : '')} onMouseEnter={() => setIndex(position)} onClick={() => run(item)}>
          <span className="palette-kind">{t(kindLabel[item.kind])}</span>
          <span className="palette-title">{item.title}</span>
          <span className="palette-detail">{item.detail}</span>
        </button>)}
        {!items.length && <p className="palette-empty">{t("没有匹配项")}</p>}
      </div>
      <p className="palette-help">{t("↑↓ 选择 · ↵ 打开 · Esc 关闭")}</p>
    </section>
  </div>;
}
