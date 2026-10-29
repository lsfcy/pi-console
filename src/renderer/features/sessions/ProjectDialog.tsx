import { t } from '../../../shared/i18n.js';
import { useEffect, useLayoutEffect, useState } from 'react';
import type { Project } from '../../../shared/contracts.js';
import { message } from '../../../shared/errors.js';
import { useWorkspace } from '../../state/AppContext.js';
import { Dialog } from '../../components/Dialog.js';
import { Icon } from '../../components/Icon.js';
export function ProjectDialog() {
  const app = useWorkspace(), project = app.projects.find(p => p.id === app.projectEditTarget);
  return <ProjectEditor project={project} />;
}
function ProjectEditor({ project }: { project?: Project }) {
  const app = useWorkspace();
  const [name, setName] = useState(project?.name || ''), [directory, setDirectory] = useState(project?.path || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useLayoutEffect(() => { setName(project?.name || ''); setDirectory(project?.path || ''); setError(''); }, [project?.id]);
  const close = () => { if (!busy) { app.projectEditTarget = null; app.publish(); } };
  useEffect(() => { if (project) requestAnimationFrame(() => { const input = document.getElementById('project-edit-name') as HTMLInputElement; input?.focus(); input?.select(); }); }, [project?.id]);
  return <Dialog id="project-dialog" className="project-dialog" open={Boolean(project)} onDismiss={close} onCancel={event => { if (busy) event.preventDefault(); }}>
    <form id="project-form" onSubmit={event => {
      event.preventDefault(); if (!project || busy) return;
      setBusy(true); setError('');
      void app.bridge.updateProject(project.id, { name, path: directory }).then(snapshot => {
        app.applySnapshot(snapshot); app.projectEditTarget = null; app.publish();
      }).catch(reason => setError(message(reason))).finally(() => setBusy(false));
    }}>
      <div className="dialog-heading"><h2>{t("编辑项目")}</h2><button id="project-edit-close" type="button" className="icon-button" aria-label={t("取消编辑项目")} disabled={busy} onClick={close}><Icon name="close" /></button></div>
      <label htmlFor="project-edit-name">{t("项目名称")}</label><input id="project-edit-name" className="text-input" maxLength={160} required autoComplete="off" value={name} disabled={busy} onChange={event => setName(event.target.value)} />
      <label htmlFor="project-edit-path">{t("项目目录")}</label><div className="project-directory-field"><input id="project-edit-path" className="text-input" maxLength={4096} required autoComplete="off" spellCheck={false} aria-describedby="project-edit-help"
        value={directory} disabled={busy} onChange={event => setDirectory(event.target.value)} />
        <button id="project-choose-directory" className="button button-secondary" type="button" disabled={busy} onClick={() => {
          if (!project) return;
          void app.bridge.chooseProjectDirectory(project.id).then(value => { if (value && app.projectEditTarget === project.id) setDirectory(value); }).catch(reason => setError(message(reason)));
        }}>{t("选择目录…")}</button></div>
      <p id="project-edit-help" className="field-help">{t("只修改项目配置，不移动文件或历史；修改目录前需关闭该项目的 Pi / Shell，运行中仍可改名。")}</p>
      <p id="project-edit-error" className="form-error" role="alert" hidden={!error}>{t(error)}</p>
      <div className="dialog-actions"><button id="project-edit-cancel" className="button button-secondary" type="button" disabled={busy} onClick={close}>{t("取消")}</button>
        <button id="project-edit-save" className="button button-primary" type="submit" disabled={busy}>{t("保存")}</button></div>
    </form>
  </Dialog>;
}
