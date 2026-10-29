import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { AiPreview, CostLevel, FormCarry, Idea, IdeaDetail, IdeaInput, IdeaKind, Unfurled } from '../../core/models';
import { messageOf } from '../landing/landing.component';

const SUGGESTED_LABELS = ['Hours', 'Price', 'Phone', 'Booking', 'Parking', 'Kids', 'Dress code', 'Distance'];

/**
 * One form for suggesting a new idea and for editing an existing one.
 * Paste a link and it pulls the title, description and photos from the page.
 */
@Component({
  selector: 'app-idea-form',
  imports: [FormsModule],
  templateUrl: './idea-form.component.html',
})
export class IdeaFormComponent {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);

  readonly kind = input.required<IdeaKind>();
  /** When set, the form edits this idea instead of creating one. */
  readonly idea = input<Idea | null>(null);
  readonly placeholder = input('');
  /** State carried over from the other segment after a "switch?" suggestion. */
  readonly initial = input<FormCarry | null>(null);
  readonly saved = output<Idea>();
  readonly cancelled = output<void>();
  readonly switchKind = output<FormCarry>();
  readonly aiEnabled = signal(false);
  readonly kindSuggestion = computed<IdeaKind | null>(() => {
    const k = this.preview()?.ai?.kind;
    return !this.isEdit() && (k === 'food' || k === 'activity') && k !== this.kind() ? k : null;
  });

  readonly isEdit = computed(() => !!this.idea());
  readonly costs: CostLevel[] = ['free', '$', '$$', '$$$'];
  readonly suggestedLabels = SUGGESTED_LABELS;

  form: IdeaInput = blank();
  readonly busy = signal(false);
  readonly error = signal('');

  readonly preview = signal<Unfurled | null>(null);
  readonly previewBusy = signal(false);
  readonly previewError = signal('');
  /** Photos to choose from: the preview's, plus the current cover if it isn't among them. */
  readonly photoChoices = computed(() => {
    const imgs = this.preview()?.images ?? [];
    const cur = this.currentImage();
    return cur && !imgs.includes(cur) ? [cur, ...imgs] : imgs;
  });
  private readonly currentImage = signal('');
  private lastUnfurled = '';

  ngOnInit() {
    void this.api
      .aiStatus()
      .then((s) => this.aiEnabled.set(s.enabled))
      .catch(() => undefined);
    const carried = this.initial();
    if (carried) {
      this.form = { ...carried.form, details: carried.form.details.map((d) => ({ ...d })) };
      this.preview.set(carried.preview);
      this.lastUnfurled = carried.form.link;
      this.currentImage.set(carried.form.imageUrl);
    }
    const i = this.idea();
    if (i) {
      this.form = {
        title: i.title,
        description: i.description,
        link: i.link,
        address: i.address,
        cost: i.cost,
        imageUrl: i.imageUrl,
        siteName: i.siteName,
        details: i.details.map((d) => ({ ...d })),
      };
      this.currentImage.set(i.imageUrl);
      this.lastUnfurled = i.link;
    }
  }

  readonly notice = signal('');

  /** Edit form: read the page again and replace what the AI fills in. Nothing is saved until Save. */
  reanalyze() {
    return this.fetchPreview(true, true);
  }

  async fetchPreview(force = false, replace = false) {
    const url = this.form.link.trim();
    if (!url || (!force && url === this.lastUnfurled)) return;
    if (!/^(https?:\/\/)?[^\s/]+\.[^\s/]+/i.test(url)) return;
    this.lastUnfurled = url;
    this.previewBusy.set(true);
    this.previewError.set('');
    try {
      this.notice.set('');
      const u = await this.api.unfurl(this.session.tripId(), url, replace);
      this.preview.set(u);
      if (!this.form.title.trim() && u.title) this.form.title = u.title.slice(0, 120);
      if (!this.form.description.trim() && u.description) this.form.description = u.description.slice(0, 2000);
      this.form.siteName = u.siteName;
      if (!this.form.imageUrl && u.image) this.form.imageUrl = u.image;
      if (u.ai) {
        this.applyAi(u.ai, u, replace);
        if (replace) this.notice.set('Updated from the page. Save to keep it, Cancel to discard.');
      } else if (replace) {
        this.notice.set(u.aiStatus === 'off' ? 'AI summaries are off; photos refreshed.' : "Couldn't get a summary this time; photos refreshed.");
      }
    } catch (e: unknown) {
      this.preview.set(null);
      this.previewError.set(messageOf(e, "Couldn't read that link, but you can still save"));
    } finally {
      this.previewBusy.set(false);
    }
  }

  /** Fill only what the person hasn't typed; never overwrite their words. */
  private applyAi(ai: AiPreview, u: Unfurled, replace = false) {
    if (!this.form.title.trim() && ai.title) this.form.title = ai.title.slice(0, 120);
    if ((replace || !this.form.description.trim() || this.form.description === u.description) && ai.summary) {
      this.form.description = ai.summary.slice(0, 2000);
    }
    if ((replace || !this.form.address.trim()) && ai.address) this.form.address = ai.address;
    if ((replace || !this.form.cost) && ai.priceLevel) this.form.cost = ai.priceLevel;
    this.form.details = this.form.details.filter((d) => d.label.trim() || d.value.trim());
    if (replace) {
      // Rows the AI knows about get its latest values; the person's own rows stay.
      const fresh = new Map(ai.details.map((d) => [d.label.trim().toLowerCase(), d.value]));
      this.form.details = this.form.details.map((d) => {
        const v = fresh.get(d.label.trim().toLowerCase());
        return v ? { ...d, value: v.slice(0, 300) } : d;
      });
    }
    const extra: IdeaDetail[] = [
      ...ai.details,
      { label: 'Hours', value: ai.hours },
      { label: 'Phone', value: ai.phone },
      { label: 'Booking', value: ai.bookingNote },
      { label: 'Good for', value: ai.goodFor },
    ];
    for (const d of extra) {
      if (this.form.details.length >= 12) break;
      if (!d.label.trim() || !d.value.trim() || this.hasLabel(d.label)) continue;
      this.form.details.push({ label: d.label.trim().slice(0, 40), value: d.value.trim().slice(0, 300) });
    }
    if (ai.coverImage && u.images.includes(ai.coverImage) && (replace || !this.form.imageUrl || this.form.imageUrl === u.image)) {
      this.form.imageUrl = ai.coverImage;
    }
  }

  suggestSwitch() {
    const k = this.kindSuggestion();
    if (!k) return;
    this.switchKind.emit({ kind: k, form: { ...this.form, details: this.form.details.map((d) => ({ ...d })) }, preview: this.preview() });
  }

  onLinkPaste(ev: ClipboardEvent) {
    if (ev.clipboardData?.getData('text')) setTimeout(() => void this.fetchPreview(), 0);
  }

  pickImage(src: string) {
    this.form.imageUrl = this.form.imageUrl === src ? '' : src;
  }

  setCost(lvl: CostLevel) {
    this.form.cost = this.form.cost === lvl ? '' : lvl;
  }

  addDetail(label = '') {
    if (this.form.details.length >= 12) return;
    this.form.details.push({ label, value: '' });
  }

  removeDetail(d: IdeaDetail) {
    this.form.details = this.form.details.filter((x) => x !== d);
  }

  hasLabel(label: string): boolean {
    return this.form.details.some((d) => d.label.toLowerCase() === label.toLowerCase());
  }

  get canSave(): boolean {
    return !!this.form.title.trim() && !this.busy();
  }

  async save() {
    this.busy.set(true);
    this.error.set('');
    const body: IdeaInput = {
      ...this.form,
      details: this.form.details.filter((d) => d.label.trim() && d.value.trim()),
    };
    try {
      const existing = this.idea();
      const idea = existing
        ? await this.api.updateIdea(this.session.tripId(), existing.id, body)
        : await this.api.createIdea(this.session.tripId(), { kind: this.kind(), ...body });
      this.saved.emit(idea);
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't save that"));
    } finally {
      this.busy.set(false);
    }
  }
}

function blank(): IdeaInput {
  return { title: '', description: '', link: '', address: '', cost: '', imageUrl: '', siteName: '', details: [] };
}
