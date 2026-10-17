import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FilePlus2, FileSignature, FileText, Loader2, Send, Trash2, Undo2 } from 'lucide-react';
import { apiService, ApiError } from '../services/api';
import { LEGAL_SCOPES, LEGAL_TYPE_LABEL, LegalDocument, LegalType } from '../lib/platformParse';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { SkeletonCard } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { PageHeader } from './ui/PageToolbar';
import { ErrorBanner, Pill, TextInput, dateOnly, errorText, useLoad } from './platform/common';

type Scope = keyof typeof LEGAL_SCOPES;
const COPY: Record<Scope, { title: string; subtitle: string; icon: React.ElementType }> = {
  legal: { title: 'Documents légaux', subtitle: 'Conditions d’utilisation, confidentialité et remboursements, avec leurs versions.', icon: FileText },
  contracts: { title: 'Contrats', subtitle: 'Les contrats signés avec les restaurants et les livreurs, avec leurs versions.', icon: FileSignature },
};

/** Groups the versions of each document type, newest first. */
export const groupVersions = (docs: LegalDocument[], types: readonly LegalType[]): Array<{ type: LegalType; versions: LegalDocument[]; active: LegalDocument | null }> =>
  types.map((type) => {
    const versions = docs.filter((d) => d.type === type).sort((a, b) => b.version - a.version);
    return { type, versions, active: versions.find((d) => d.isActive) ?? null };
  });

interface Editing { id: string | null; type: LegalType; readOnly: boolean; version?: number }

const DocumentDrawer: React.FC<{ editing: Editing | null; seed: { title: string; content: string } | null; onClose: () => void; onSaved: () => void; onAuthError: (e: unknown) => void }> = ({ editing, seed, onClose, onSaved, onAuthError }) => {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [errors, setErrors] = useState<{ title?: string; content?: string }>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setErrors({}); setGeneral('');
    if (!editing.id) { setTitle(seed?.title ?? LEGAL_TYPE_LABEL[editing.type]); setContent(seed?.content ?? ''); return; }
    setLoadingDoc(true);
    apiService.fetchLegalDocument(editing.id).then((d) => { setTitle(d.title); setContent(d.content); }).catch((e) => { onAuthError(e); setGeneral(errorText(e)); }).finally(() => setLoadingDoc(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, editing?.type]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (title.trim().length < 3) { setErrors({ title: 'Donnez un titre (3 caractères minimum).' }); return; }
    if (content.trim().length < 20) { setErrors({ content: 'Le texte est trop court (20 caractères minimum).' }); return; }
    setBusy(true); setGeneral('');
    try {
      await apiService.saveLegalDocument(editing.id, editing.id ? { title: title.trim(), content } : { type: editing.type, locale: 'fr', title: title.trim(), content });
      toast.success(editing.id ? 'Brouillon enregistré' : 'Brouillon créé', 'Publiez-le puis activez-le pour l’afficher dans les applications.');
      onSaved(); onClose();
    } catch (e) {
      onAuthError(e);
      if (e instanceof ApiError && (e.field === 'title' || e.field === 'content')) setErrors({ [e.field]: errorText(e) }); else setGeneral(errorText(e));
    } finally { setBusy(false); }
  };

  return (
    <Drawer open={Boolean(editing)} onClose={onClose} wide icon={FileText}
      title={editing ? `${LEGAL_TYPE_LABEL[editing.type]}${editing.version ? ` · v${editing.version}` : ''}` : ''} subtitle={editing?.readOnly ? 'Version publiée : lecture seule' : editing?.id ? 'Brouillon' : 'Nouveau brouillon'}
      footer={editing && !editing.readOnly ? <div className="flex gap-3 pb-4"><button type="button" className="k-btn-ghost flex-1" onClick={onClose}>Annuler</button><button type="submit" form="legal-form" className="k-btn-accent flex-1" disabled={busy || loadingDoc}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Enregistrer le brouillon</button></div> : undefined}>
      {general && <ErrorBanner message={general} />}
      {loadingDoc ? <SkeletonCard lines={4} /> : (
        <form id="legal-form" onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Titre" htmlFor="legal-title" required error={errors.title}><TextInput id="legal-title" value={title} onChange={(e) => { setTitle(e.target.value); setErrors({}); }} readOnly={editing?.readOnly} invalid={Boolean(errors.title)} maxLength={120} /></Field>
          <Field label="Texte" htmlFor="legal-content" required error={errors.content} hint="Texte brut. Sautez une ligne entre les paragraphes. Les signes < et > ne sont pas acceptés.">
            <textarea id="legal-content" rows={18} className="k-input font-sans leading-relaxed" value={content} onChange={(e) => { setContent(e.target.value); setErrors({}); }} readOnly={editing?.readOnly} aria-invalid={Boolean(errors.content) || undefined} aria-describedby="legal-content-msg" />
          </Field>
        </form>
      )}
    </Drawer>
  );
};

export const LegalDocumentsPanel: React.FC<{ scope: Scope; onAuthError: (e: unknown) => void }> = ({ scope, onAuthError }) => {
  const copy = COPY[scope];
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data, loading, error, reload } = useLoad(() => apiService.fetchLegalDocuments(), onAuthError);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [seed, setSeed] = useState<{ title: string; content: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const groups = useMemo(() => groupVersions(data ?? [], LEGAL_SCOPES[scope]), [data, scope]);

  const run = async (d: LegalDocument, action: 'publish' | 'unpublish' | 'activate' | 'delete') => {
    if (action === 'publish' && !(await confirm({ title: `Publier la version ${d.version} ?`, message: 'Une version publiée ne peut plus être modifiée. Elle ne s’affichera dans les applications qu’une fois activée.', confirmLabel: 'Publier' }))) return;
    if (action === 'activate' && !(await confirm({ title: `Afficher la version ${d.version} ?`, message: 'Les applications afficheront ce texte à la place de la version actuelle.', confirmLabel: 'Activer cette version' }))) return;
    if (action === 'delete' && !(await confirm({ title: `Supprimer le brouillon v${d.version} ?`, message: 'Cette action est définitive.', confirmLabel: 'Supprimer', danger: true }))) return;
    setBusyId(d.id);
    try {
      if (action === 'delete') await apiService.deleteLegalDocument(d.id); else await apiService.legalAction(d.id, action);
      toast.success({ publish: 'Version publiée', unpublish: 'Retour en brouillon', activate: 'Version activée', delete: 'Brouillon supprimé' }[action]);
      await reload();
    } catch (e) { onAuthError(e); toast.error('Action refusée', errorText(e)); } finally { setBusyId(null); }
  };

  const newVersion = (type: LegalType, latest: LegalDocument | undefined) => {
    setSeed(null);
    if (!latest) { setEditing({ id: null, type, readOnly: false }); return; }
    // Start from the latest text so a new version is a small edit, not a rewrite.
    apiService.fetchLegalDocument(latest.id).then((d) => { setSeed({ title: d.title, content: d.content }); setEditing({ id: null, type, readOnly: false }); }).catch((e) => { onAuthError(e); toast.error('Chargement impossible', errorText(e)); });
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={copy.icon} title={copy.title} subtitle={copy.subtitle} onRefresh={reload} refreshing={loading} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={4} />}
      {data && groups.map(({ type, versions, active }) => (
        <section key={type} className="k-card space-y-3 p-4 sm:p-5" aria-label={LEGAL_TYPE_LABEL[type]}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-kraveo-ink">{LEGAL_TYPE_LABEL[type]}</h2>
              <p className="text-xs text-kraveo-ink3">{active ? `Affiché dans les applications : version ${active.version}, publiée le ${dateOnly(active.publishedAt)}` : 'Aucune version affichée dans les applications pour l’instant.'}</p>
            </div>
            <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" onClick={() => newVersion(type, versions[0])}><FilePlus2 className="h-4 w-4" aria-hidden="true" />Nouvelle version</button>
          </div>
          {versions.length === 0 && <EmptyState icon={copy.icon} title="Aucune version" description="Créez un premier brouillon, publiez-le puis activez-le." />}
          <ul className="divide-y divide-kraveo-line/60 rounded-k-md border border-kraveo-line">
            {versions.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <button type="button" className="min-w-0 text-left" onClick={() => setEditing({ id: d.id, type: d.type, readOnly: d.status === 'PUBLISHED', version: d.version })}>
                  <span className="block truncate font-bold text-kraveo-ink">Version {d.version} · {d.title}</span>
                  <span className="block text-xs text-kraveo-ink3">{d.status === 'PUBLISHED' ? `Publiée le ${dateOnly(d.publishedAt)}` : `Brouillon modifié le ${dateOnly(d.updatedAt)}`}</span>
                </button>
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  {d.isActive ? <Pill tone="green"><CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />Affichée</Pill> : <Pill tone={d.status === 'PUBLISHED' ? 'blue' : 'grey'}>{d.status === 'PUBLISHED' ? 'Publiée' : 'Brouillon'}</Pill>}
                  {d.status === 'DRAFT' && <button type="button" className="k-btn-ghost !min-h-[34px] text-xs" disabled={busyId === d.id} onClick={() => run(d, 'publish')}><Send className="h-3.5 w-3.5" aria-hidden="true" />Publier</button>}
                  {d.status === 'PUBLISHED' && !d.isActive && <button type="button" className="k-btn-accent !min-h-[34px] text-xs" disabled={busyId === d.id} onClick={() => run(d, 'activate')}>Activer</button>}
                  {d.status === 'PUBLISHED' && !d.isActive && <button type="button" className="k-icon-btn" disabled={busyId === d.id} onClick={() => run(d, 'unpublish')} aria-label={`Repasser la version ${d.version} en brouillon`}><Undo2 className="h-4 w-4" aria-hidden="true" /></button>}
                  {d.status === 'DRAFT' && <button type="button" className="k-icon-btn" disabled={busyId === d.id} onClick={() => run(d, 'delete')} aria-label={`Supprimer le brouillon de la version ${d.version}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <DocumentDrawer editing={editing} seed={seed} onClose={() => { setEditing(null); setSeed(null); }} onSaved={reload} onAuthError={onAuthError} />
      {dialog}
    </div>
  );
};
