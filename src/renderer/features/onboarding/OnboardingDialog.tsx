import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n.js';
import { bindings, format, projectCommands } from '../../../shared/shortcuts.js';
import { useWorkspace } from '../../state/AppContext.js';
import { Dialog } from '../../components/Dialog.js';
import { Icon } from '../../components/Icon.js';

type GuideStep = { title: string; icon: string; description: string; rows: { label: string; commands: string[]; system?: string }[]; note: string };
const steps: GuideStep[] = [
  {
    title: '项目与会话', icon: 'terminal',
    description: '先确保终端里可以运行 pi。在侧栏选择已有项目，或点击「添加项目」选择工作目录，然后新建第一个会话。',
    rows: [
      { label: '新建 Pi 会话', commands: ['new-tab'] },
      { label: '临时会话 · 不保存历史', commands: ['new-temporary-tab'] },
      { label: '在系统终端打开当前项目', commands: ['open-terminal'] }
    ],
    note: '每个标签都是独立的 Pi 会话；也可以点击历史会话接着上次工作。'
  },
  {
    title: '键盘导航', icon: 'sidebar',
    description: '长按 ⌘ 0.5 秒即可查看项目编号和导航提示；快捷键立即生效，不必等提示出现。',
    rows: [
      { label: '切换侧栏会话 · 上 / 下', commands: ['sidebar-previous', 'sidebar-next'] },
      { label: '切换标签 · 左 / 右', commands: ['previous-tab', 'next-tab'] },
      { label: '切换前十个可见项目', commands: projectCommands.map(command => command.id) }
    ],
    note: '已打开的会话立即切换；未打开的历史会话需松开 ⌘ 后按 Enter 确认，Esc 取消。普通文本框保留方向键编辑。'
  },
  {
    title: '快速找到任务', icon: 'search',
    description: '不用逐个翻项目：在命令面板搜索项目、会话或操作，也可以直接跳到需要你处理的会话。',
    rows: [
      { label: '打开命令面板', commands: ['search'] },
      { label: '待处理会话 · 下一个 / 上一个', commands: ['next-attention', 'previous-attention'] },
      { label: '查看运行中会话', commands: ['running-recent'] },
      { label: '查看全部会话', commands: ['recent'] }
    ],
    note: '待处理会话优先显示等待输入，其次是错误、未读完成和运行中的任务。'
  },
  {
    title: '离开与查阅', icon: 'info',
    description: '关闭标签会结束 Pi，隐藏窗口不会。退出应用时，可选择保留 Pi 在后台继续运行，下次打开后重新连接。',
    rows: [
      { label: '关闭标签并结束 Pi 进程', commands: ['close-tab'] },
      { label: '隐藏窗口 · 进程继续运行', commands: ['hide-window'] },
      { label: '退出 · 选择保留或结束进程', commands: [], system: 'Command+Q' },
      { label: '查看或修改快捷键', commands: ['shortcut-help'] },
      { label: '打开设置', commands: ['settings'] }
    ],
    note: '任务仍在进行时，关闭标签会要求确认。引导展示当前快捷键配置；「未设置」表示该快捷键已停用。'
  }
];

export function OnboardingDialog() {
  const app = useWorkspace(), [step, setStep] = useState(0), heading = useRef<HTMLHeadingElement>(null), pageRef = useRef<HTMLElement>(null);
  const page = steps[step], keys = bindings(app.preferences.shortcuts);
  useEffect(() => { if (app.onboardingOpen) setStep(0); }, [app.onboardingOpen]);
  useEffect(() => {
    if (app.onboardingOpen) { pageRef.current?.scrollTo({ top: 0 }); heading.current?.focus({ preventScroll: true }); }
  }, [app.onboardingOpen, step]);
  const move = (direction: number) => setStep(value => Math.max(0, Math.min(steps.length - 1, value + direction)));
  return <Dialog id="onboarding-dialog" className="onboarding-dialog" open={app.onboardingOpen} onDismiss={app.dismissOnboarding}
    onCancel={event => { event.preventDefault(); app.dismissOnboarding(); }} labelledBy="onboarding-title" describedBy="onboarding-description">
    <div onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
    }}>
      <div className="dialog-heading"><h2 id="onboarding-title">{t('新手引导')}</h2>
        <button id="onboarding-skip" type="button" className="button button-quiet" onClick={app.dismissOnboarding}>{t('跳过引导')} <kbd>Esc</kbd></button>
      </div>
      <ol className="onboarding-steps" aria-label={t('引导步骤')}>{steps.map((item, index) => <li key={item.title}>
        <button type="button" data-onboarding-step={index} aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}>
          <span>{index + 1}</span>{t(item.title)}
        </button>
      </li>)}</ol>
      <section className="onboarding-page" ref={pageRef} aria-labelledby="onboarding-step-title">
        <div className="onboarding-page-heading"><Icon name={page.icon} /><h3 id="onboarding-step-title" tabIndex={-1} ref={heading}>{t(page.title)}</h3></div>
        <p id="onboarding-description">{t(page.description)}</p>
        <dl className="onboarding-shortcuts">{page.rows.map(row => <div className="onboarding-shortcut" key={row.label}>
          <dt>{t(row.label)}</dt><dd>{row.commands.map(command => <kbd key={command} data-onboarding-shortcut={command}>{format(keys[command])}</kbd>)}
            {row.system && <kbd>{format(row.system)}</kbd>}</dd>
        </div>)}</dl>
        <p className="onboarding-note"><Icon name="info" />{t(page.note)}</p>
      </section>
      <div className="onboarding-footer"><span>{t('第 {current} / {total} 步', { current: step + 1, total: steps.length })} · <kbd>← →</kbd> {t('翻页')}</span>
        <div className="dialog-actions"><button id="onboarding-previous" type="button" className="button button-quiet" disabled={step === 0} onClick={() => move(-1)}>{t('上一步')}</button>
          <button id="onboarding-next" type="button" className="button button-primary" onClick={() => step === steps.length - 1 ? app.dismissOnboarding() : move(1)}>{t(step === steps.length - 1 ? '开始使用' : '下一步')}</button></div>
      </div>
      <p className="onboarding-reopen">{t('关闭引导后即可使用这些快捷键；可从「设置 → 新手引导」重新查看。')}</p>
    </div>
  </Dialog>;
}
