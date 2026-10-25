import { Component, model } from '@angular/core';
import { AVATAR_EMOJI } from '../core/avatar';

@Component({
  selector: 'app-emoji-picker',
  template: `
    <div class="emoji-grid" role="radiogroup" aria-label="Pick an avatar">
      @for (e of options; track e) {
        <button type="button" class="emoji-grid__item" role="radio" [attr.aria-checked]="value() === e"
          [class.is-selected]="value() === e" (click)="value.set(value() === e ? '' : e)">{{ e }}</button>
      }
    </div>
  `,
})
export class EmojiPickerComponent {
  readonly options = AVATAR_EMOJI;
  readonly value = model('');
}
