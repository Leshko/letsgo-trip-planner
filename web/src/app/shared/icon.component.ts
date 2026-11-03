import { Component, input } from '@angular/core';

export type IconName =
  | 'home' | 'bed' | 'sparkles' | 'fork' | 'calendar' | 'bubble' | 'chevron' | 'plus' | 'pencil' | 'share'
  | 'camera' | 'download' | 'trash' | 'close' | 'left' | 'right' | 'bell' | 'back'
  | 'map' | 'sun' | 'locate';

/** SF-Symbols-style line icons, drawn inline so they tint with `currentColor`. */
@Component({
  selector: 'app-icon',
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (name()) {
        @case ('home') { <path d="M3.5 11.5 12 4l8.5 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M10 19.5v-5h4v5" /> }
        @case ('bed') { <path d="M3 18V7" /><path d="M3 13h18v5" /><path d="M21 13v-2a2 2 0 0 0-2-2h-8v4" /><circle cx="7" cy="10" r="1.8" /><path d="M3 16h18" /> }
        @case ('sparkles') { <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9z" /><path d="M19 3v3" /><path d="M17.5 4.5h3" /><path d="M5 17v3" /><path d="M3.5 18.5h3" /> }
        @case ('fork') { <path d="M7 3v7a2.5 2.5 0 0 0 5 0V3" /><path d="M9.5 3v18" /><path d="M9.5 12v9" /><path d="M17 3c-1.7 1.2-2.5 3.2-2.5 6 0 2 .8 3 2.5 3v9" /> }
        @case ('calendar') { <rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17" /><path d="M8 3v4" /><path d="M16 3v4" /><circle cx="8" cy="14" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="14" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="14" r="1" fill="currentColor" stroke="none" /> }
        @case ('bubble') { <path d="M12 4.5c-4.7 0-8.5 3-8.5 6.8 0 2 1 3.8 2.7 5l-.7 3.7 3.8-2c.9.2 1.8.3 2.7.3 4.7 0 8.5-3 8.5-6.8S16.7 4.5 12 4.5z" /> }
        @case ('chevron') { <path d="m9 6 6 6-6 6" /> }
        @case ('plus') { <path d="M12 5v14" /><path d="M5 12h14" /> }
        @case ('pencil') { <path d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.1l-1.9-1.9a1.5 1.5 0 0 0-2.1 0L4 16z" /><path d="m13 7 4 4" /> }
        @case ('bell') { <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /><path d="M12 3.5v1.5" /> }
        @case ('back') { <path d="m14 6-6 6 6 6" /> }
        @case ('camera') { <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.2-1.8c.3-.4.7-.7 1.2-.7h3.2c.5 0 .9.3 1.2.7L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" /><circle cx="12" cy="12.5" r="3.3" /> }
        @case ('download') { <path d="M12 4v11" /><path d="m8 11 4 4 4-4" /><path d="M5 17v1.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V17" /> }
        @case ('trash') { <path d="M5 7h14" /><path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" /><path d="M7 7l.8 11.2A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.8L17 7" /><path d="M10 11v5" /><path d="M14 11v5" /> }
        @case ('close') { <path d="m6 6 12 12" /><path d="M18 6 6 18" /> }
        @case ('left') { <path d="m15 6-6 6 6 6" /> }
        @case ('right') { <path d="m9 6 6 6-6 6" /> }
        @case ('map') { <path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z" /><path d="M9 4.5v13" /><path d="M15 6.5v13" /> }
        @case ('sun') { <circle cx="12" cy="12" r="4" /><path d="M12 2.5v2" /><path d="M12 19.5v2" /><path d="m5.3 5.3 1.4 1.4" /><path d="m17.3 17.3 1.4 1.4" /><path d="M2.5 12h2" /><path d="M19.5 12h2" /><path d="m5.3 18.7 1.4-1.4" /><path d="m17.3 6.7 1.4-1.4" /> }
        @case ('locate') { <circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /><path d="M12 2.5v3" /><path d="M12 18.5v3" /><path d="M2.5 12h3" /><path d="M18.5 12h3" /> }
        @case ('share') { <path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /> }
      }
    </svg>
  `,
  host: { style: 'display:inline-flex;line-height:0' },
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input(24);
}
