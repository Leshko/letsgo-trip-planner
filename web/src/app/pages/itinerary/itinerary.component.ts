import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, CdkDropListGroup, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { Idea, ItineraryDay, ItineraryEntry } from '../../core/models';
import { dayName, shortDate, todayIso } from '../../core/format';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { Time12Pipe } from '../../shared/pipes';
import { messageOf } from '../landing/landing.component';

@Component({
  selector: 'app-itinerary',
  imports: [FormsModule, CdkDropListGroup, CdkDropList, CdkDrag, CdkDragHandle, AvatarComponent, Time12Pipe],
  templateUrl: './itinerary.component.html',
})
export class ItineraryComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly days = signal<ItineraryDay[]>([]);
  readonly ideas = signal<Idea[]>([]);
  readonly loaded = signal(false);
  readonly today = todayIso();
  readonly totalEntries = computed(() => this.days().reduce((n, d) => n + d.entries.length, 0));

  /** Ideas not yet on the plan, most-voted first: the natural "what's next" list. */
  readonly unplanned = computed(() => {
    const planned = new Set(this.days().flatMap((d) => d.entries.map((e) => e.ideaId)));
    return this.ideas().filter((i) => !planned.has(i.id));
  });

  // add form state (one day open at a time)
  readonly addingFor = signal<string | null>(null);
  readonly error = signal('');
  draftTitle = '';
  draftTime = '';
  draftNotes = '';
  draftIdeaId = '';

  // edit state
  readonly editing = signal<ItineraryEntry | null>(null);
  editTitle = '';
  editTime = '';
  editNotes = '';

  dayName = dayName;
  shortDate = shortDate;

  constructor() {
    usePolling(() => this.load(), 15_000);
  }

  async load() {
    const id = this.session.tripId();
    if (!id) return;
    const [days, ideas] = await Promise.all([this.api.itinerary(id), this.api.listIdeas(id)]);
    this.days.set(days);
    this.ideas.set(ideas);
    this.loaded.set(true);
  }

  dayNumber(date: string): number {
    return this.days().findIndex((d) => d.date === date) + 1;
  }

  openAdd(date: string, idea?: Idea) {
    this.addingFor.set(date);
    this.error.set('');
    this.draftTitle = '';
    this.draftTime = '';
    this.draftNotes = '';
    this.draftIdeaId = idea?.id ?? '';
  }

  pickIdea() {
    const idea = this.ideas().find((i) => i.id === this.draftIdeaId);
    if (idea && !this.draftTitle) this.draftTitle = idea.title;
  }

  async add() {
    const date = this.addingFor();
    if (!date) return;
    try {
      const entry = await this.api.addEntry(this.session.tripId(), {
        date,
        title: this.draftTitle || undefined,
        startTime: this.draftTime || undefined,
        notes: this.draftNotes || undefined,
        ideaId: this.draftIdeaId || undefined,
      });
      this.days.update((all) => all.map((d) => (d.date === date ? { ...d, entries: sortEntries([...d.entries, entry]) } : d)));
      this.addingFor.set(null);
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't add that"));
    }
  }

  startEdit(e: ItineraryEntry) {
    this.editing.set(e);
    this.editTitle = e.title;
    this.editTime = e.startTime;
    this.editNotes = e.notes;
  }

  async saveEdit() {
    const e = this.editing();
    if (!e) return;
    const updated = await this.api.updateEntry(this.session.tripId(), e.id, {
      title: this.editTitle,
      startTime: this.editTime,
      notes: this.editNotes,
    });
    this.days.update((all) =>
      all.map((d) => (d.date === e.date ? { ...d, entries: sortEntries(d.entries.map((x) => (x.id === e.id ? updated : x))) } : d)),
    );
    this.editing.set(null);
  }

  async remove(e: ItineraryEntry) {
    if (!confirm(`Take "${e.title}" off the plan?`)) return;
    await this.api.deleteEntry(this.session.tripId(), e.id);
    this.days.update((all) => all.map((d) => ({ ...d, entries: d.entries.filter((x) => x.id !== e.id) })));
    this.editing.set(null);
  }

  async drop(event: CdkDragDrop<ItineraryEntry[], ItineraryEntry[], ItineraryEntry>, targetDate: string) {
    const days = this.days().map((d) => ({ ...d, entries: [...d.entries] }));
    const target = days.find((d) => d.date === targetDate)!;
    if (event.previousContainer === event.container) {
      moveItemInArray(target.entries, event.previousIndex, event.currentIndex);
    } else {
      const sourceDate = event.previousContainer.id;
      const source = days.find((d) => d.date === sourceDate)!;
      transferArrayItem(source.entries, target.entries, event.previousIndex, event.currentIndex);
    }
    // Dropping between timed entries clears the time so the manual order wins.
    const moved = target.entries[event.currentIndex];
    if (moved.startTime && event.previousContainer !== event.container) {
      moved.startTime = '';
      await this.api.updateEntry(this.session.tripId(), moved.id, { startTime: '' });
    }
    this.days.set(days);
    this.days.set(
      await this.api.reorder(
        this.session.tripId(),
        targetDate,
        target.entries.map((e) => e.id),
      ),
    );
  }
}

function sortEntries(entries: ItineraryEntry[]): ItineraryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime) || a.position - b.position;
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    return a.position - b.position;
  });
}
