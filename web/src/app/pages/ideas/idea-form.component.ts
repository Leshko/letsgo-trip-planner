import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { CostLevel, Idea, IdeaDetail, IdeaInput, IdeaKind, Unfurled } from '../../core/models';
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
  readonly saved = output<Idea>();
  readonly cancelled = output<void>();

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

  async fetchPreview(force = false) {
    const url = this.form.link.trim();
    if (!url || (!force && url === this.lastUnfurled)) return;
    if (!/^(https?:\/\/)?[^\s/]+\.[^\s/]+/i.test(url)) return;
    this.lastUnfurled = url;
    this.previewBusy.set(true);
    this.previewError.set('');
    try {
      const u = await this.api.unfurl(this.session.tripId(), url);
      this.preview.set(u);
      if (!this.form.title.trim() && u.title) this.form.title = u.title.slice(0, 120);
      if (!this.form.description.trim() && u.description) this.form.description = u.description.slice(0, 2000);
      this.form.siteName = u.siteName;
      if (!this.form.imageUrl && u.image) this.form.imageUrl = u.image;
    } catch (e: unknown) {
      this.preview.set(null);
      this.previewError.set(messageOf(e, "Couldn't read that link, but you can still save"));
    } finally {
      this.previewBusy.set(false);
    }
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
