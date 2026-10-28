import { Component, computed, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { Idea } from '../../core/models';
import { dateRangeDays } from './days';
import { LongDatePipe } from '../../shared/pipes';

/** "Add to the plan" sheet: pick a day and an optional time for an idea. */
@Component({
  selector: 'app-plan-sheet',
  imports: [FormsModule, LongDatePipe],
  template: `
    <div class="modal-backdrop" (click)="cancelled.emit()">
      <form class="modal stack-v" (click)="$event.stopPropagation()" (ngSubmit)="add()" role="dialog" aria-label="Add to the plan">
        <h2>Add to the plan</h2>
        <p class="muted">{{ idea().title }}</p>
        <div class="field">
          <label for="pday">Which day?</label>
          <select id="pday" class="select" name="pday" [(ngModel)]="date">
            @for (d of days(); track d) { <option [value]="d">{{ d | longDate }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="ptime">Time (optional)</label>
          <input id="ptime" class="input" type="time" name="ptime" [(ngModel)]="time" />
        </div>
        <div class="row">
          <button class="btn btn--primary grow" type="submit" [disabled]="!date">Add</button>
          <button class="btn btn--ghost" type="button" (click)="cancelled.emit()">Cancel</button>
        </div>
      </form>
    </div>
  `,
})
export class PlanSheetComponent {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  readonly idea = input.required<Idea>();
  readonly added = output<void>();
  readonly cancelled = output<void>();
  readonly days = computed(() => {
    const t = this.session.trip();
    return t ? dateRangeDays(t.startDate, t.endDate) : [];
  });
  date = '';
  time = '';

  ngOnInit() {
    this.date = this.days()[0] ?? '';
  }

  async add() {
    if (!this.date) return;
    await this.api.addEntry(this.session.tripId(), { date: this.date, ideaId: this.idea().id, startTime: this.time || undefined });
    this.added.emit();
  }
}
