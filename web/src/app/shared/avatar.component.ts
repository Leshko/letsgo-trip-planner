import { Component, computed, input } from '@angular/core';
import { avatarHue, initials } from '../core/avatar';
import { Member } from '../core/models';

@Component({
  selector: 'app-avatar',
  template: `
    <span class="avatar" [class.avatar--sm]="size() === 'sm'" [class.avatar--lg]="size() === 'lg'"
      [style.--hue]="hue()" [title]="member().name" [attr.aria-label]="member().name">
      @if (member().emoji) { <span class="avatar__emoji">{{ member().emoji }}</span> }
      @else { {{ initials() }} }
    </span>
  `,
})
export class AvatarComponent {
  readonly member = input.required<Member>();
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly hue = computed(() => avatarHue(this.member().name));
  readonly initials = computed(() => initials(this.member().name));
}
