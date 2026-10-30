/** Compile-only regression tests: removing a constraint makes @ts-expect-error fail. */
import type { PiGuiAPI, TerminalState, ApplicationEvent, SessionMark, Project } from '../../src/shared/contracts.js';
declare const api: PiGuiAPI;
declare const state: TerminalState;
declare const event: ApplicationEvent;
const favorite: SessionMark = {projectId:'project',sessionKey:'file',favorite:true,pinned:true};
const pinned: Project = {id:'project',name:'Project',path:'/project',pinned:true};
void favorite; void pinned;
// @ts-expect-error Persisted marks omit disabled flags rather than storing false.
const disabled: SessionMark = {projectId:'project',sessionKey:'file',favorite:false};
void disabled;
// @ts-expect-error The removed toolbar action must not stay on the public bridge.
api.openIterm('project');
// @ts-expect-error The removed Finder toolbar bridge must not stay public.
api.openDirectory('project');
// @ts-expect-error Main-workspace terminals no longer have a lower-panel height.
api.setPreferences({shellHeight:300});

api.createPi('project', { resume: true, sessionKey: 'session' });
api.createPi('project', { ephemeral: true });
api.createPi('project', { resume: false, sessionKey: 'session', fork: true });
api.openProject('project', 'vscode');
// @ts-expect-error Applications are a fixed allowlist, never an arbitrary command.
api.openProject('project', 'exec-anything');
// @ts-expect-error Fork must be boolean.
api.createPi('project', { fork: 'true' });
api.readVersion(true);
api.checkAppUpdate(true);
api.setPreferences({ checkAppUpdates: false });
api.setPreferences({ onboardingSeen: true });
// @ts-expect-error Onboarding persistence only accepts booleans.
api.setPreferences({ onboardingSeen: 'true' });
// @ts-expect-error Update check accepts only a boolean force flag.
api.checkAppUpdate('force');
// @ts-expect-error Startup update preference must be boolean.
api.setPreferences({ checkAppUpdates: 'yes' });
// @ts-expect-error Temporary session mode must be boolean.
api.createPi('project', { ephemeral: 'true' });
// @ts-expect-error Version refresh does not accept arbitrary values.
api.readVersion('force');
api.setPreferences({ workspaceTheme: 'dark', confirmClose: false });
api.historyMenu('project', null, { terminalId: state.id, runId: state.runId, sessionId: state.sessionId, unread: true });
api.setSessionUnread('project', 'session', true);
api.setSessionMark('project', 'session', 'favorite', true);
// @ts-expect-error Marks only accept the two supported scopes.
api.setSessionMark('project', 'session', 'projectWide', true);
// @ts-expect-error Read state must be a boolean.
api.setSessionUnread('project', 'session', 'unread');
// @ts-expect-error Menu targets cannot supply arbitrary file paths.
api.historyMenu('project', null, { file: '/tmp/session.jsonl' });
api.resize(state.id, state.runId, 100, 30);
// @ts-expect-error IPC dimensions must be numeric.
api.resize(state.id, state.runId, '100', 30);
// @ts-expect-error Only known themes may cross the bridge.
api.setPreferences({ workspaceTheme: 'sepia' });
// @ts-expect-error Unknown settings are rejected before runtime.
api.setPreferences({ unknownSetting: true });
// @ts-expect-error An input write must include its run identity.
api.input(state.id, 'text');
// @ts-expect-error Statuses cannot silently introduce new protocol values.
api.reportStatus(state.id, state.runId, 'finished', '');
// @ts-expect-error Only the three official update targets are supported.
api.runUpdate('upgrade-everything');
// @ts-expect-error Project edits cannot replace a project's identity.
api.updateProject('project', { id: 'replacement' });

if (event.type === 'state') event.state.runId;
if (event.type === 'notice') {
  event.message;
  // @ts-expect-error Event payloads must be narrowed by the discriminator.
  event.state;
}
