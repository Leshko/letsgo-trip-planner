import { Component, computed, input } from '@angular/core';
import { Member } from '../core/models';
import { AvatarComponent } from './avatar.component';

/** Overlapping row of avatars, e.g. "who's in" on an idea. */
@Component({
  selector: 'app-avatar-stack',
  imports: [AvatarComponent],
  template: `
    <span class="stack" [title]="names()">
      @for (m of shown(); track m.id) { <app-avatar [member]="m" size="sm" /> }
      @if (extra() > 0) { <span class="stack__more">+{{ extra() }}</span> }
    </span>
  `,
})
export class AvatarStackComponent {
  readonly members = input.required<Member[]>();
  readonly max = input(5);
  readonly shown = computed(() => this.members().slice(0, this.max()));
  readonly extra = computed(() => Math.max(0, this.members().length - this.max()));
  readonly names = computed(() => this.members().map((m) => m.name).join(', '));
}
