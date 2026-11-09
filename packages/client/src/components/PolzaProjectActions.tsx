import { projectDisplayName } from '@yep-anywhere/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useProjects } from '../hooks/useProjects';
import { useRemoteBasePath } from '../hooks/useRemoteBasePath';
import type { Project } from '../types';
import { ProjectSharingSection } from './ProjectSharingSection';
import { Modal } from './ui/Modal';
import './PolzaProjectActions.css';

type Panel = 'settings' | 'share' | null;
export function PolzaProjectActions({ project, compact = false }: { project: Project; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [panel, setPanel] = useState<Panel>(null);
  const [name, setName] = useState(projectDisplayName(project));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState(() => localStorage.getItem(`polza-project-pin:${project.id}`) === '1');
  const { refetch } = useProjects();
  const basePath = useRemoteBasePath();
  const navigate = useNavigate();
  const positionMenu = (menuHeight = 232) => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(264, window.innerWidth - 32);
    const left = Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16));
    const below = rect.bottom + 4;
    const top = below + menuHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - menuHeight - 4);
    setMenuPosition({ top, left });
  };
  useLayoutEffect(() => {
    if (open && menuRef.current) positionMenu(menuRef.current.getBoundingClientRect().height);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    const onResize = () => positionMenu(menuRef.current?.getBoundingClientRect().height);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);
  const saveName = async () => {
    if (!name.trim() || name.trim() === projectDisplayName(project)) { setPanel(null); return; }
    setBusy(true); setError(null);
    try { await api.updateProjectName(project.id, name.trim()); await refetch(); setPanel(null); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const hide = async () => {
    setOpen(false);
    if (!confirm(`Убрать «${projectDisplayName(project)}» из списка проектов? Файлы на сервере сохранятся.`)) return;
    setBusy(true); setError(null);
    try { await api.deleteProject(project.id); await refetch(); navigate(`${basePath}/projects`); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="polza-project-actions" onClick={event => event.stopPropagation()}>
    <button ref={triggerRef} className="polza-project-dots" type="button" aria-label={`Меню проекта ${projectDisplayName(project)}`} aria-expanded={open} onClick={() => { if (!open) positionMenu(); setOpen(value => !value); }}>···</button>
    {open && createPortal(<div ref={menuRef} className="polza-ui polza-project-popover" role="menu" style={menuPosition}>
      <button type="button" role="menuitem" onClick={() => { setPanel('share'); setOpen(false); }}>Поделиться проектом</button>
      <button type="button" role="menuitem" onClick={() => { setName(projectDisplayName(project)); setPanel('settings'); setOpen(false); }}>Переименовать</button>
      <button type="button" role="menuitem" onClick={() => { setPanel('settings'); setOpen(false); }}>Настройки проекта</button>
      <button type="button" role="menuitem" onClick={() => { const next = !pinned; localStorage.setItem(`polza-project-pin:${project.id}`, next ? '1' : '0'); setPinned(next); window.dispatchEvent(new Event('polza-project-pin-changed')); setOpen(false); }}>{pinned ? 'Открепить в этом браузере' : 'Закрепить в этом браузере'}</button>
      <button type="button" role="menuitem" className="danger" onClick={() => void hide()} disabled={busy}>Убрать из списка</button>
    </div>, document.body)}
    {error && !panel && <span role="alert" className="polza-project-error">{error}</span>}
    {panel && <Modal title={panel === 'share' ? 'Доступ к проекту' : 'Настройки проекта'} onClose={() => { setPanel(null); setError(null); }}>
      <div className="polza-project-settings">
        {panel === 'settings' && <>
          <label>Название проекта<input value={name} onChange={event => setName(event.target.value)} /></label>
          <label>Рабочая папка<input value={project.path} readOnly /></label>
          <p>Инструкции для Codex можно хранить в файле AGENTS.md этой рабочей папки.</p>
          <div className="polza-project-settings-actions"><button type="button" onClick={() => setPanel(null)}>Отмена</button><button type="button" disabled={busy || !name.trim()} onClick={() => void saveName()}>Сохранить</button></div>
        </>}
        {panel === 'share' && <ProjectSharingSection projectId={project.id} ownerUsername={project.ownerUsername} />}
        {error && <p role="alert" className="polza-project-error">{error}</p>}
      </div>
    </Modal>}
  </div>;
}
