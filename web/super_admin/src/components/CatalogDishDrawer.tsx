import React, { useMemo, useRef, useState } from 'react';
import { ImageOff, Loader2, UtensilsCrossed } from 'lucide-react';
import { Vendor } from '../types';
import { ApiError, apiService, DishWrite } from '../services/api';
import { CatalogDish } from '../lib/catalogParse';
import { CommissionType, MAX_DISH_PRICE, amountText, commissionLabel, frNumber, isHttpUrl, parseCommissionValue, parseVendorPrice, rupees, toPaise } from '../lib/pricing';
import { PreviewState, usePricePreview } from '../lib/usePricePreview';
import { Drawer } from './ui/Drawer';
import { Field } from './ui/Field';
import { Switch } from './ui/Switch';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { StateBadge } from './CatalogStateBadge';

const SOURCE_LABEL = { DISH: 'ce plat', VENDOR: 'ce restaurant', GLOBAL: 'par défaut' } as const;

type CommissionMode = 'INHERIT' | CommissionType;
type Busy = null | 'save' | 'approve' | 'accept' | 'reject' | 'delete' | 'restore' | 'create';

interface Props {
  open: boolean;
  /** The dish to edit, or null to add a dish for a restaurant. */
  item: CatalogDish | null;
  vendors: Vendor[];
  categories: string[];
  onClose: () => void;
  /** Called after the server accepted a change: the list reloads and the sidebar badge refreshes. */
  onChanged: () => void;
  onAuthError: (error: unknown) => void;
}

interface FormState {
  vendorId: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string;
  isVeg: boolean;
  isAvailable: boolean;
  vendorPrice: string;
  mode: CommissionMode;
  commissionValue: string;
}

const formFrom = (item: CatalogDish | null): FormState => ({
  vendorId: item?.vendorId ?? '',
  name: item?.name ?? '',
  description: item?.description ?? '',
  category: item?.category ?? '',
  imageUrl: item?.imageUrl ?? '',
  isVeg: item?.isVeg ?? true,
  isAvailable: item?.isAvailable ?? true,
  vendorPrice: amountText(item?.vendorPrice),
  mode: item?.commissionOverride?.type ?? 'INHERIT',
  commissionValue: item?.commissionOverride ? amountText(item.commissionOverride.value) : '',
});

const plain = (error: unknown): string => {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return 'Un problème est survenu. Veuillez réessayer.';
};

const PreviewCard: React.FC<{ state: PreviewState; vendorPrice: number | null; title: string }> = ({ state, vendorPrice, title }) => {
  const shown = state.status === 'ready' ? state.preview : state.status === 'loading' ? state.last : null;
  return (
    <div className="k-inset space-y-2 p-4" aria-live="polite" data-testid="price-preview">
      <p className="k-label">{title}</p>
      {state.status === 'idle' && <p className="text-sm text-kraveo-ink3">Saisissez un prix restaurant valide pour voir ce que paie le client.</p>}
      {state.status === 'error' && <p role="alert" className="text-sm font-semibold text-kraveo-danger">{state.message}</p>}
      {(state.status === 'loading' || state.status === 'ready') && (
        <>
          <div className={`flex flex-wrap items-baseline gap-x-6 gap-y-1 ${state.status === 'loading' ? 'opacity-60' : ''}`}>
            <p><span className="k-num text-2xl text-kraveo-ink" data-testid="preview-price">{shown ? rupees(shown.price) : '…'}</span> <span className="text-xs text-kraveo-ink3">payé par le client</span></p>
            <p className="text-sm text-kraveo-ink2"><b className="tabular-nums text-kraveo-g700" data-testid="preview-commission">{shown ? rupees(shown.commission) : '…'}</b> de commission Affia Foods</p>
            <p className="text-sm text-kraveo-ink2"><b className="tabular-nums text-kraveo-ink">{rupees(vendorPrice)}</b> pour le restaurant</p>
          </div>
          {shown?.rule && <p className="text-xs text-kraveo-ink3" data-testid="preview-rule">Règle : {commissionLabel(shown.rule.type, shown.rule.value)} ({SOURCE_LABEL[shown.rule.source]}){shown.roundingStep ? `, prix arrondi au multiple supérieur de ${shown.roundingStep} FCFA` : ''}{shown.nominalCommission !== null && toPaise(shown.nominalCommission) !== toPaise(shown.commission) ? `; l’arrondi ajoute ${rupees(shown.commission - shown.nominalCommission)}` : ''}.</p>}
          {state.status === 'loading' && <p className="flex items-center gap-1.5 text-xs text-kraveo-ink3"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />Calcul en cours…</p>}
        </>
      )}
    </div>
  );
};

export const CatalogDishDrawer: React.FC<Props> = ({ open, item, vendors, categories, onClose, onChanged, onAuthError }) => {
  // The panel gives this component a new `key` per dish, so the form always starts from the dish being opened.
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const creating = item === null;
  const [form, setForm] = useState<FormState>(() => formFrom(item));
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  const deleted = item?.state === 'DELETED';
  const baseline = useMemo(() => formFrom(item), [item]);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => { setForm((current) => ({ ...current, [key]: value })); setError(''); };

  // ── validation ──
  const price = parseVendorPrice(form.vendorPrice);
  const commission = form.mode === 'INHERIT' ? null : parseCommissionValue(form.mode, form.commissionValue);
  const errors = {
    vendorId: creating && !form.vendorId ? 'Choisissez le restaurant auquel appartient ce plat.' : '',
    name: form.name.trim().length < 2 ? 'Saisissez le nom du plat (au moins 2 caractères).' : form.name.trim().length > 80 ? 'Le nom doit faire moins de 80 caractères.' : '',
    category: form.category.trim().length < 2 ? 'Saisissez une catégorie, par exemple Thiéboudienne ou Grillades.' : form.category.trim().length > 40 ? 'La catégorie doit faire moins de 40 caractères.' : '',
    imageUrl: form.imageUrl.trim() && !isHttpUrl(form.imageUrl) ? 'Saisissez une adresse web complète commençant par https://'
      : !creating && !form.imageUrl.trim() && baseline.imageUrl.trim() ? 'Un plat doit avoir une photo. Saisissez une nouvelle adresse au lieu de laisser vide.' : '',
    description: form.description.length > 300 ? 'La description doit faire moins de 300 caractères.' : '',
    vendorPrice: price.ok ? '' : price.message,
    commission: commission && !commission.ok ? commission.message : '',
  };
  const valid = Object.values(errors).every((message) => message === '');
  const show = (message: string) => (touched ? message : '');

  const dirty = useMemo(() => (Object.keys(baseline) as Array<keyof FormState>).filter((key) => form[key] !== baseline[key]), [form, baseline]);
  const dirtyOther = dirty.filter((key) => key !== 'mode' && key !== 'commissionValue' && key !== 'vendorPrice' && key !== 'vendorId');
  const commissionDirty = dirty.includes('mode') || dirty.includes('commissionValue');
  const priceDirty = dirty.includes('vendorPrice');

  // ── live preview (asked of the server; never computed here) ──
  const effectiveVendorId = creating ? form.vendorId : item.vendorId;
  const commissionInput = commission && commission.ok && form.mode !== 'INHERIT' ? { type: form.mode, value: commission.value } : null;
  const commissionInvalid = form.mode !== 'INHERIT' && !(commission && commission.ok);
  const preview = usePricePreview({ vendorId: effectiveVendorId, vendorPrice: price.ok ? price.value : null, commission: commissionInput, commissionInvalid });
  const pendingPrice = item?.pendingVendorPrice ?? null;
  const pendingPreview = usePricePreview({ vendorId: effectiveVendorId, vendorPrice: pendingPrice, commission: commissionInput, commissionInvalid });

  // ── actions ──
  const run = async (kind: Exclude<Busy, null>, work: () => Promise<void>, success: string) => {
    if (busyRef.current) return; // double click / second button while a request runs
    busyRef.current = true;
    setBusy(kind);
    setError('');
    try {
      await work();
      toast.success(success);
      onChanged();
      onClose();
    } catch (failure) {
      onAuthError(failure);
      setError(plain(failure));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const commissionBody = (): { commissionType?: CommissionType; commissionValue?: number } => (commissionInput ? { commissionType: commissionInput.type, commissionValue: commissionInput.value } : {});

  const otherChanges = (): DishWrite => {
    const changes: DishWrite = {};
    if (dirty.includes('name')) changes.name = form.name.trim();
    if (dirty.includes('description')) changes.description = form.description.trim();
    if (dirty.includes('category')) changes.category = form.category.trim();
    if (dirty.includes('imageUrl') && form.imageUrl.trim()) changes.imageUrl = form.imageUrl.trim();
    if (dirty.includes('isVeg')) changes.isVeg = form.isVeg;
    if (dirty.includes('isAvailable')) changes.isAvailable = form.isAvailable;
    return changes;
  };

  /** Everything that changed, for PATCH. A commission cleared back to "inherit" is sent as nulls. */
  const patchBody = (): DishWrite => {
    const changes = otherChanges();
    if (priceDirty && price.ok) changes.vendorPrice = price.value;
    if (commissionDirty) {
      if (form.mode === 'INHERIT') { changes.commissionType = null; changes.commissionValue = null; }
      else if (commissionInput) { changes.commissionType = commissionInput.type; changes.commissionValue = commissionInput.value; }
    }
    return changes;
  };

  const submitBlocked = (): boolean => {
    setTouched(true);
    if (!valid) { setError('Corrigez d’abord les champs signalés.'); return true; }
    return false;
  };

  const onSave = () => {
    if (!item || submitBlocked()) return;
    const changes = patchBody();
    if (Object.keys(changes).length === 0) { setError('Rien n’a été modifié.'); return; }
    run('save', async () => { await apiService.updateCatalogItem(item.id, changes); }, 'Plat enregistré');
  };

  const onCreate = () => {
    if (submitBlocked() || !price.ok) return;
    const body: DishWrite & { vendorId: string; name: string; vendorPrice: number } = {
      vendorId: form.vendorId, name: form.name.trim(), category: form.category.trim(), isVeg: form.isVeg, isAvailable: form.isAvailable, vendorPrice: price.value,
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.imageUrl.trim() ? { imageUrl: form.imageUrl.trim() } : {}),
      ...commissionBody(),
    };
    run('create', async () => { await apiService.createCatalogItem(body); }, 'Plat ajouté et en ligne');
  };

  const onApprove = () => {
    if (!item || submitBlocked() || !price.ok) return;
    // Anything besides the price and commission, and a commission cleared back to "inherit", is saved first.
    const early: DishWrite = otherChanges();
    if (commissionDirty && form.mode === 'INHERIT') { early.commissionType = null; early.commissionValue = null; }
    run('approve', async () => {
      if (Object.keys(early).length > 0) await apiService.updateCatalogItem(item.id, early);
      await apiService.approveCatalogItem(item.id, { ...(priceDirty ? { vendorPrice: price.value } : {}), ...commissionBody() });
    }, 'Plat validé et en ligne');
  };

  const onAcceptPending = () => {
    if (!item || pendingPrice === null || commissionInvalid) return;
    run('accept', async () => { await apiService.approveCatalogItem(item.id, { applyPending: true, ...(commissionDirty ? commissionBody() : {}) }); }, 'Changement de prix accepté');
  };

  const onReject = async () => {
    if (!item) return;
    const text = reason.trim();
    if (text.length < 3) { setError('Écrivez un motif court que le restaurant verra (au moins 3 caractères).'); return; }
    if (text.length > 200) { setError('Le motif doit faire moins de 200 caractères.'); return; }
    if (busyRef.current) return;
    const ok = declining
      ? await confirm({ title: `Refuser le changement de prix pour ${item.name} ?`, message: `${item.vendorName} verra ce motif : « ${text} ». Le plat reste en ligne à ${rupees(item.vendorPrice)}.`, confirmLabel: 'Refuser le changement', danger: true })
      : await confirm({ title: `Refuser ${item.name} ?`, message: `${item.vendorName} verra ce motif : « ${text} ». Le plat reste masqué pour les clients.`, confirmLabel: 'Refuser le plat', danger: true });
    if (!ok) return;
    run('reject', async () => { await apiService.rejectCatalogItem(item.id, text); }, declining ? 'Changement de prix refusé' : 'Plat refusé');
  };

  const onDelete = async () => {
    if (!item || busyRef.current) return;
    const ok = await confirm({ title: `Supprimer ${item.name} ?`, message: 'Les clients ne verront plus ce plat. Les anciennes commandes en gardent une copie, et vous pourrez restaurer le plat plus tard.', confirmLabel: 'Supprimer le plat', danger: true });
    if (!ok) return;
    run('delete', async () => { await apiService.deleteCatalogItem(item.id); }, 'Plat supprimé');
  };

  const onRestore = () => { if (item) run('restore', async () => { await apiService.restoreCatalogItem(item.id); }, 'Plat restauré'); };

  // A live dish with a requested price change is declined with a reason (reject); a plain live dish cannot be rejected.
  const declining = item?.state === 'CHANGE_PENDING';
  const canApprove = item !== null && (item.state === 'PENDING' || item.state === 'REJECTED');
  const disabledAll = busy !== null;
  const readOnly = deleted || disabledAll;
  const showImage = form.imageUrl.trim() !== '' && isHttpUrl(form.imageUrl) && !imageFailed;
  const spin = (kind: Busy) => (busy === kind ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null);

  const footer = (
    <div className="space-y-2 pb-4">
      {error && <p role="alert" className="break-words rounded-k-sm border border-kraveo-danger/30 bg-kraveo-danger/10 px-3 py-2 text-sm text-kraveo-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {creating && <button type="button" className="k-btn-primary flex-1" onClick={onCreate} disabled={disabledAll} aria-busy={busy === 'create'}>{spin('create')}Ajouter le plat</button>}
        {!creating && deleted && <button type="button" className="k-btn-primary flex-1" onClick={onRestore} disabled={disabledAll} aria-busy={busy === 'restore'}>{spin('restore')}Restaurer le plat</button>}
        {!creating && !deleted && canApprove && <button type="button" className="k-btn-primary flex-1" onClick={onApprove} disabled={disabledAll} aria-busy={busy === 'approve'}>{spin('approve')}Valider{priceDirty || commissionDirty ? ' avec ces montants' : ''}</button>}
        {!creating && !deleted && !rejecting && canApprove && item?.state === 'PENDING' && <button type="button" className="k-btn-danger" onClick={() => setRejecting(true)} disabled={disabledAll}>Refuser…</button>}
        {!creating && !deleted && <button type="button" className={canApprove ? 'k-btn-ghost' : 'k-btn-primary flex-1'} onClick={onSave} disabled={disabledAll || dirty.length === 0} aria-busy={busy === 'save'}>{spin('save')}Enregistrer les modifications</button>}
        {!creating && !deleted && <button type="button" className="k-btn-danger" onClick={onDelete} disabled={disabledAll} aria-busy={busy === 'delete'}>{spin('delete')}Supprimer</button>}
        <button type="button" className="k-btn-ghost" onClick={onClose}>Fermer</button>
      </div>
    </div>
  );

  return (
    <>
      <Drawer open={open} onClose={onClose} title={creating ? 'Ajouter un plat' : item.name} subtitle={creating ? 'Mis en ligne immédiatement pour le restaurant choisi' : item.vendorName} icon={UtensilsCrossed} wide footer={footer} focusFirstField={creating}>
        <div className="space-y-5">
          {item && <div className="flex flex-wrap items-center gap-2"><StateBadge state={item.state} /><span className="text-xs text-kraveo-ink3">{item.createdBy === 'ADMIN' ? 'Ajouté par un admin' : 'Ajouté par le restaurant'}</span></div>}
          {item?.state === 'REJECTED' && item.rejectionReason && <p className="break-words rounded-k-sm border border-kraveo-danger/30 bg-kraveo-danger/10 px-3 py-2 text-sm text-kraveo-ink"><b>Refusé :</b> {item.rejectionReason}</p>}
          {item && item.state !== 'REJECTED' && item.state !== 'DELETED' && item.rejectionReason && <p className="break-words rounded-k-sm border border-kraveo-line bg-kraveo-surface2 px-3 py-2 text-sm text-kraveo-ink2"><b>Dernière note au restaurant :</b> {item.rejectionReason}</p>}
          {deleted && <p className="rounded-k-sm border border-kraveo-line bg-kraveo-surface2 px-3 py-2 text-sm text-kraveo-ink2">Ce plat est supprimé et masqué pour les clients. Restaurez-le pour pouvoir le modifier.</p>}

          {pendingPrice !== null && !deleted && (
            <section className="space-y-3 rounded-k-md border border-kraveo-status-placed/40 bg-kraveo-status-placed/10 p-4" aria-label="Demande de changement de prix">
              <p className="text-sm text-kraveo-ink"><b>{item?.vendorName}</b> demande à changer le prix de <b className="tabular-nums">{rupees(item?.vendorPrice)}</b> à <b className="tabular-nums">{rupees(pendingPrice)}</b>. Le plat reste en ligne à l’ancien prix jusqu’à votre acceptation.</p>
              <PreviewCard state={pendingPreview} vendorPrice={pendingPrice} title="Si vous acceptez" />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="k-btn-primary flex-1" onClick={onAcceptPending} disabled={disabledAll || dirtyOther.length > 0 || priceDirty || commissionInvalid} aria-busy={busy === 'accept'}>{spin('accept')}Accepter le changement de prix</button>
                {!rejecting && <button type="button" className="k-btn-danger" onClick={() => setRejecting(true)} disabled={disabledAll}>Refuser le changement…</button>}
              </div>
              {(dirtyOther.length > 0 || priceDirty) && <p className="text-xs text-kraveo-ink3">Enregistrez ou annulez d’abord vos autres modifications, puis acceptez.</p>}
            </section>
          )}

          {creating && (
            <Field label="Restaurant" htmlFor="dish-vendor" required error={show(errors.vendorId)}>
              <select id="dish-vendor" className="k-select" value={form.vendorId} onChange={(event) => set('vendorId', event.target.value)} aria-invalid={Boolean(show(errors.vendorId))} aria-describedby={show(errors.vendorId) ? 'dish-vendor-msg' : undefined} disabled={readOnly}>
                <option value="">Choisissez un restaurant…</option>
                {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
              </select>
            </Field>
          )}

          <Field label="Nom du plat" htmlFor="dish-name" required error={show(errors.name)}>
            <input id="dish-name" className="k-input" value={form.name} maxLength={80} onChange={(event) => set('name', event.target.value)} aria-invalid={Boolean(show(errors.name))} aria-describedby={show(errors.name) ? 'dish-name-msg' : undefined} disabled={readOnly} autoComplete="off" />
          </Field>

          <Field label="Catégorie" htmlFor="dish-category" required error={show(errors.category)}>
            <input id="dish-category" className="k-input" list="dish-categories" value={form.category} maxLength={40} onChange={(event) => set('category', event.target.value)} aria-invalid={Boolean(show(errors.category))} aria-describedby={show(errors.category) ? 'dish-category-msg' : undefined} disabled={readOnly} autoComplete="off" />
            <datalist id="dish-categories">{categories.map((name) => <option key={name} value={name} />)}</datalist>
          </Field>

          <Field label="Description (facultatif)" htmlFor="dish-description" error={show(errors.description)}>
            <textarea id="dish-description" className="k-input min-h-[72px] py-2" value={form.description} onChange={(event) => set('description', event.target.value)} aria-invalid={Boolean(show(errors.description))} aria-describedby={show(errors.description) ? 'dish-description-msg' : undefined} disabled={readOnly} />
          </Field>

          <Field label="Adresse web de la photo (facultatif)" htmlFor="dish-image" error={show(errors.imageUrl)} hint="Un lien direct vers l’image, commençant par https://">
            <input id="dish-image" className="k-input" inputMode="url" value={form.imageUrl} onChange={(event) => { set('imageUrl', event.target.value); setImageFailed(false); }} aria-invalid={Boolean(show(errors.imageUrl))} aria-describedby="dish-image-msg" disabled={readOnly} autoComplete="off" />
          </Field>
          {form.imageUrl.trim() !== '' && isHttpUrl(form.imageUrl) && (
            <div className="k-inset flex h-32 items-center justify-center overflow-hidden">
              {showImage
                ? <img src={form.imageUrl.trim()} alt={`Photo de ${form.name || 'ce plat'}`} className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
                : <p className="flex items-center gap-2 text-sm text-kraveo-ink3"><ImageOff className="h-4 w-4" aria-hidden="true" />Cette image n’a pas pu être chargée.</p>}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="k-inset flex items-center justify-between gap-3 px-4 py-3">
              <div><p className="text-sm font-bold text-kraveo-ink">{form.isVeg ? 'Végétarien' : 'Non végétarien'}</p><p className="text-[11px] text-kraveo-ink3">Affiché aux clients</p></div>
              <Switch checked={form.isVeg} onChange={() => set('isVeg', !form.isVeg)} label="Végétarien" disabled={readOnly} />
            </div>
            <div className="k-inset flex items-center justify-between gap-3 px-4 py-3">
              <div><p className="text-sm font-bold text-kraveo-ink">{form.isAvailable ? 'Disponible' : 'Épuisé'}</p><p className="text-[11px] text-kraveo-ink3">Les plats épuisés apparaissent grisés</p></div>
              <Switch checked={form.isAvailable} onChange={() => set('isAvailable', !form.isAvailable)} label="Disponible à la commande" disabled={readOnly} />
            </div>
          </div>

          <fieldset className="space-y-3" disabled={readOnly}>
            <legend className="k-label mb-2">Tarification</legend>
            <Field label="Prix restaurant (FCFA)" htmlFor="dish-price" required error={show(errors.vendorPrice)} hint={`Ce que reçoit le restaurant pour une portion. Jusqu’à ${frNumber(MAX_DISH_PRICE)}, 2 décimales au maximum.`}>
              <input id="dish-price" className="k-input" inputMode="decimal" value={form.vendorPrice} onChange={(event) => set('vendorPrice', event.target.value)} aria-invalid={Boolean(show(errors.vendorPrice))} aria-describedby="dish-price-msg" autoComplete="off" />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Commission" htmlFor="dish-commission-mode">
                <select id="dish-commission-mode" className="k-select" value={form.mode} onChange={(event) => set('mode', event.target.value as CommissionMode)}>
                  <option value="INHERIT">Utiliser la valeur du restaurant / globale</option>
                  <option value="PERCENT">Pourcentage du prix restaurant</option>
                  <option value="FLAT">Montant fixe en FCFA</option>
                </select>
              </Field>
              {form.mode !== 'INHERIT' && (
                <Field label={form.mode === 'PERCENT' ? 'Pourcentage (%)' : 'Montant (FCFA)'} htmlFor="dish-commission-value" required error={show(errors.commission)}>
                  <input id="dish-commission-value" className="k-input" inputMode="decimal" value={form.commissionValue} onChange={(event) => set('commissionValue', event.target.value)} aria-invalid={Boolean(show(errors.commission))} aria-describedby={show(errors.commission) ? 'dish-commission-value-msg' : undefined} autoComplete="off" />
                </Field>
              )}
            </div>
            {item && item.commissionOverride && form.mode === 'INHERIT' && <p className="text-xs text-kraveo-ink3">Ce plat avait sa propre commission ({commissionLabel(item.commissionOverride.type, item.commissionOverride.value)}) ; l’enregistrement la supprime.</p>}
            {item && !item.commissionOverride && form.mode === 'INHERIT' && item.commission && <p className="text-xs text-kraveo-ink3">Utilise {commissionLabel(item.commission.type, item.commission.value)} ({SOURCE_LABEL[item.commission.source]}).</p>}
          </fieldset>

          <PreviewCard state={preview} vendorPrice={price.ok ? price.value : null} title="Prix client (en direct)" />
          {!creating && item?.price !== null && item?.price !== undefined && <p className="text-xs text-kraveo-ink3">Actuellement, les clients paient {rupees(item.price)}. L’enregistrement applique le nouveau prix affiché ci-dessus.</p>}
          {item?.priceIsStale && item.computedPrice !== null && <p className="rounded-k-sm border border-kraveo-status-placed/40 bg-kraveo-status-placed/10 px-3 py-2 text-xs text-kraveo-ink">Les règles actuelles de commission et d’arrondi donneraient {rupees(item.computedPrice)}, mais les clients paient encore {rupees(item.price)}. Enregistrer ce plat le met à jour, ou lancez « Recalculer les prix » dans Réglages pour tous les plats.</p>}

          {!creating && !deleted && (item?.state === 'PENDING' || declining) && (
            <section className="space-y-2" aria-label={declining ? 'Refuser le changement de prix' : 'Refuser ce plat'}>
              {!rejecting
                ? <p className="text-xs text-kraveo-ink3">{declining ? 'Pas acceptable ? Utilisez « Refuser le changement » pour garder l’ancien prix et expliquer pourquoi au restaurant.' : 'Pas adapté ? Utilisez « Refuser » pour le renvoyer avec un motif.'}</p>
                : (
                  <>
                    <Field label="Motif visible par le restaurant" htmlFor="dish-reject-reason" required>
                      <textarea id="dish-reject-reason" className="k-input min-h-[72px] py-2" value={reason} maxLength={200} onChange={(event) => { setReason(event.target.value); setError(''); }} disabled={disabledAll} />
                    </Field>
                    <div className="flex gap-2">
                      <button type="button" className="k-btn-danger flex-1" onClick={onReject} disabled={disabledAll} aria-busy={busy === 'reject'}>{spin('reject')}{declining ? 'Refuser le changement' : 'Refuser le plat'}</button>
                      <button type="button" className="k-btn-ghost" onClick={() => { setRejecting(false); setReason(''); setError(''); }} disabled={disabledAll}>Laisser tomber</button>
                    </div>
                  </>
                )}
            </section>
          )}
        </div>
      </Drawer>
      {dialog}
    </>
  );
};
