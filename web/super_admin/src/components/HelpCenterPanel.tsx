import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2, Plus, Trash2 } from 'lucide-react';
import { apiService, ApiError } from '../services/api';
import { HELP_AUDIENCES, HELP_AUDIENCE_LABEL, HelpArticle, HelpAudience, slugify } from '../lib/platformParse';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { SkeletonCard } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { PageHeader, UnderlineTabs } from './ui/PageToolbar';
import { CheckRow, ErrorBanner, Pill, TextInput, errorText, useLoad } from './platform/common';

interface Form { title: string; slug: string; theme: string; audience: HelpAudience; content: string; isPublished: boolean; sortOrder: string }
const emptyForm = (): Form => ({ title: '', slug: '', theme: '', audience: 'ALL', content: '', isPublished: false, sortOrder: '0' });

const ArticleDrawer: React.FC<{ open: boolean; editing: HelpArticle | null; themes: string[]; onClose: () => void; onSaved: () => void; onAuthError: (e: unknown) => void }> = ({ open, editing, themes, onClose, onSaved, onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [form, setForm] = useState<Form>(emptyForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({}); setGeneral(''); setSlugTouched(Boolean(editing));
    if (!editing) { setForm(emptyForm()); return; }
    setForm({ title: editing.title, slug: editing.slug, theme: editing.theme, audience: editing.audience, content: '', isPublished: editing.isPublished, sortOrder: String(editing.sortOrder) });
    apiService.fetchHelpArticle(editing.id).then((a) => setForm((f) => ({ ...f, content: a.content }))).catch((e) => { onAuthError(e); setGeneral(errorText(e)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value, ...(key === 'title' && !slugTouched ? { slug: slugify(String(value)) } : {}) }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };
  const fail = (e: unknown) => { onAuthError(e); if (e instanceof ApiError && e.field) setErrors({ [e.field]: errorText(e) }); else setGeneral(errorText(e)); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const sort = Number(form.sortOrder);
    if (form.title.trim().length < 3) { setErrors({ title: 'Donnez un titre (3 caractères minimum).' }); return; }
    if (form.theme.trim().length < 2) { setErrors({ theme: 'Choisissez un thème.' }); return; }
    if (form.content.trim().length < 20) { setErrors({ content: 'Le texte est trop court (20 caractères minimum).' }); return; }
    if (!Number.isInteger(sort) || sort < 0) { setErrors({ sortOrder: 'Saisissez un nombre entier (0 ou plus).' }); return; }
    setBusy(true); setGeneral('');
    try {
      await apiService.saveHelpArticle(editing?.id ?? null, { title: form.title.trim(), slug: form.slug.trim(), theme: form.theme.trim(), audience: form.audience, content: form.content, isPublished: form.isPublished, sortOrder: sort });
      toast.success(editing ? 'Article mis à jour' : 'Article créé', form.isPublished ? 'Il est visible dans les applications.' : 'Il reste invisible tant qu’il n’est pas publié.');
      onSaved(); onClose();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!editing || !(await confirm({ title: 'Supprimer cet article ?', message: 'Il disparaît aussi des applications.', confirmLabel: 'Supprimer', danger: true }))) return;
    setBusy(true);
    try { await apiService.deleteHelpArticle(editing.id); toast.success('Article supprimé'); onSaved(); onClose(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} wide icon={BookOpen} title={editing ? 'Modifier l’article' : 'Nouvel article'} subtitle={editing?.slug}
      footer={<div className="flex gap-3 pb-4">
        {editing && <button type="button" className="k-btn-danger" onClick={remove} disabled={busy} aria-label="Supprimer l’article"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
        <button type="button" className="k-btn-ghost flex-1" onClick={onClose}>Annuler</button>
        <button type="submit" form="help-form" className="k-btn-accent flex-1" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Enregistrer</button>
      </div>}>
      <form id="help-form" onSubmit={submit} className="space-y-4" noValidate>
        {general && <ErrorBanner message={general} />}
        <Field label="Titre" htmlFor="help-title" required error={errors.title}><TextInput id="help-title" value={form.title} onChange={(e) => set('title', e.target.value)} invalid={Boolean(errors.title)} maxLength={140} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Thème" htmlFor="help-theme" required error={errors.theme} hint="Les articles du même thème sont regroupés.">
            <TextInput id="help-theme" list="help-themes" value={form.theme} onChange={(e) => set('theme', e.target.value)} invalid={Boolean(errors.theme)} maxLength={60} />
            <datalist id="help-themes">{themes.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="Pour qui ?" htmlFor="help-audience"><select id="help-audience" className="k-input" value={form.audience} onChange={(e) => set('audience', e.target.value as HelpAudience)}>{HELP_AUDIENCES.map((a) => <option key={a} value={a}>{HELP_AUDIENCE_LABEL[a]}</option>)}</select></Field>
          <Field label="Adresse (slug)" htmlFor="help-slug" error={errors.slug} hint="Minuscules, chiffres et tirets. Remplie à partir du titre."><TextInput id="help-slug" value={form.slug} onChange={(e) => { setSlugTouched(true); set('slug', e.target.value); }} invalid={Boolean(errors.slug)} maxLength={80} /></Field>
          <Field label="Ordre d’affichage" htmlFor="help-sort" error={errors.sortOrder}><TextInput id="help-sort" inputMode="numeric" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} invalid={Boolean(errors.sortOrder)} /></Field>
        </div>
        <Field label="Texte" htmlFor="help-content" required error={errors.content} hint="Texte brut. Sautez une ligne entre les paragraphes. Les signes < et > ne sont pas acceptés.">
          <textarea id="help-content" rows={12} className="k-input leading-relaxed" value={form.content} onChange={(e) => set('content', e.target.value)} aria-invalid={Boolean(errors.content) || undefined} aria-describedby="help-content-msg" />
        </Field>
        <CheckRow id="help-published" label="Publié" hint="Visible dans les applications des personnes concernées." checked={form.isPublished} onChange={(v) => set('isPublished', v)} />
      </form>
      {dialog}
    </Drawer>
  );
};

export const HelpCenterPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const { data, loading, error, reload } = useLoad(() => apiService.fetchHelpArticles(), onAuthError);
  const [audience, setAudience] = useState<'ALL_AUDIENCES' | HelpAudience>('ALL_AUDIENCES');
  const [drawer, setDrawer] = useState<{ open: boolean; editing: HelpArticle | null }>({ open: false, editing: null });
  const articles = data ?? [];
  const themes = useMemo(() => Array.from(new Set(articles.map((a) => a.theme))).sort((a, b) => a.localeCompare(b, 'fr')), [articles]);
  const shown = articles.filter((a) => audience === 'ALL_AUDIENCES' || a.audience === audience);
  const byTheme = useMemo(() => {
    const groups = new Map<string, HelpArticle[]>();
    for (const a of shown) groups.set(a.theme, [...(groups.get(a.theme) ?? []), a]);
    return Array.from(groups);
  }, [shown]);
  const countOf = (a: HelpAudience) => articles.filter((x) => x.audience === a).length;

  return (
    <div className="space-y-5">
      <PageHeader icon={BookOpen} title="Centre d’aide" subtitle="Les articles d’aide affichés dans les applications des clients, restaurants et livreurs." onRefresh={reload} refreshing={loading}
        actions={<button type="button" className="k-btn-accent" onClick={() => setDrawer({ open: true, editing: null })}><Plus className="h-4 w-4" aria-hidden="true" />Nouvel article</button>} />
      <UnderlineTabs label="Public" value={audience} onChange={setAudience}
        tabs={[{ id: 'ALL_AUDIENCES', label: 'Tous', count: articles.length }, ...HELP_AUDIENCES.map((a) => ({ id: a, label: HELP_AUDIENCE_LABEL[a], count: countOf(a) }))]} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={4} />}
      {data && shown.length === 0 && <div className="k-card p-6"><EmptyState icon={BookOpen} title="Aucun article" description="Écrivez un premier article pour répondre aux questions fréquentes." /></div>}
      {byTheme.map(([theme, list]) => (
        <section key={theme} className="space-y-2" aria-label={theme}>
          <h2 className="k-label px-1">{theme}</h2>
          <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
            {list.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setDrawer({ open: true, editing: a })} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-kraveo-surface2">
                  <span className="min-w-0"><span className="block truncate font-bold text-kraveo-ink">{a.title}</span><span className="block truncate font-mono text-[11px] text-kraveo-ink3">{a.slug}</span></span>
                  <span className="flex shrink-0 items-center gap-2"><Pill>{HELP_AUDIENCE_LABEL[a.audience]}</Pill><Pill tone={a.isPublished ? 'green' : 'grey'}>{a.isPublished ? 'Publié' : 'Brouillon'}</Pill></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <ArticleDrawer open={drawer.open} editing={drawer.editing} themes={themes} onClose={() => setDrawer({ open: false, editing: null })} onSaved={reload} onAuthError={onAuthError} />
    </div>
  );
};
