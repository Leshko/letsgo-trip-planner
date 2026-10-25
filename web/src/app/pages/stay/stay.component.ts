import { Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { Lodging } from '../../core/models';
import { nights } from '../../core/format';
import { messageOf } from '../landing/landing.component';

@Component({
  selector: 'app-stay',
  imports: [FormsModule],
  templateUrl: './stay.component.html',
})
export class StayComponent {
  private readonly api = inject(ApiService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly session = inject(SessionService);

  readonly trip = this.session.trip;
  readonly lodging = computed<Lodging>(() => this.trip()?.lodging ?? emptyLodging());
  readonly hasLodging = computed(() => {
    const l = this.lodging();
    return !!(l.name || l.address || l.link || l.notes || l.photos.length);
  });
  readonly nights = computed(() => {
    const t = this.trip();
    return t ? nights(t.startDate, t.endDate) : 0;
  });

  /** Google Maps' keyless embed: an address query rendered as a map. */
  readonly mapUrl = computed<SafeResourceUrl | null>(() => {
    const q = this.lodging().address.trim();
    if (!q) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`);
  });
  readonly directionsUrl = computed(() => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(this.lodging().address)}`);

  readonly editing = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly lightbox = signal<string | null>(null);
  form: Lodging & { photosText: string } = { ...emptyLodging(), photosText: '' };

  /** A dead photo link just disappears rather than showing a broken-image icon. */
  hidePhoto(ev: Event) {
    (ev.target as HTMLElement).style.display = 'none';
  }

  edit() {
    const l = this.lodging();
    this.form = { ...l, photos: [...l.photos], photosText: l.photos.join('\n') };
    this.error.set('');
    this.editing.set(true);
  }

  async save() {
    this.busy.set(true);
    this.error.set('');
    try {
      const { photosText, ...rest } = this.form;
      const photos = photosText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      const trip = await this.api.updateLodging(this.session.tripId(), { ...rest, photos });
      this.session.setTrip(trip);
      this.editing.set(false);
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't save"));
    } finally {
      this.busy.set(false);
    }
  }
}

function emptyLodging(): Lodging {
  return { name: '', address: '', checkIn: '', checkOut: '', link: '', notes: '', photos: [] };
}
