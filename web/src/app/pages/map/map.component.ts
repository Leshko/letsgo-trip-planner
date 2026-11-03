import { Component, ElementRef, NgZone, OnDestroy, computed, effect, inject, signal, viewChild, ViewEncapsulation } from '@angular/core';
import * as L from 'leaflet';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { LetsGoService } from '../../core/lets-go';
import { LiveLocationService } from '../../core/live-location.service';
import { avatarHue, initials } from '../../core/avatar';
import { MemberLocation } from '../../core/models';
import { longDate, relativeTime, todayIso } from '../../core/format';
import { usePolling } from '../../core/polling';
import { IconComponent } from '../../shared/icon.component';
import { messageOf } from '../landing/landing.component';

const problemText = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : messageOf(e, fallback);

/** Faded after this long without an update. */
const STALE_MS = 30 * 60 * 1000;
const EXPLAINED_KEY = 'letsgo.mapExplained';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Everyone who opted in, on one map, as their own photo or emoji. */
@Component({
  selector: 'app-map',
  imports: [IconComponent],
  templateUrl: './map.component.html',
  styleUrl: './map.component.css',
  encapsulation: ViewEncapsulation.None,
})
export class MapComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly zone = inject(NgZone);
  readonly session = inject(SessionService);
  readonly letsGo = inject(LetsGoService);
  readonly location = inject(LiveLocationService);

  private readonly host = viewChild<ElementRef<HTMLDivElement>>('map');
  readonly locations = signal<MemberLocation[]>([]);
  readonly live = signal(true);
  readonly loaded = signal(false);
  readonly error = signal('');
  readonly showExplain = signal(false);

  private map: L.Map | null = null;
  private layer: L.LayerGroup | null = null;
  private fitted = false;

  /** Everyone to draw: the server's list, with my own spot from this phone when it's fresher. */
  readonly pins = computed(() => {
    const me = this.session.member();
    const mine = this.location.position();
    const list = this.locations().slice();
    if (me && mine && this.location.sharing()) {
      const i = list.findIndex((l) => l.member.id === me.id);
      const self: MemberLocation = {
        member: { ...me, sharesLocation: true },
        lat: mine.lat,
        lng: mine.lng,
        accuracy: mine.accuracy,
        updatedAt: mine.at,
      };
      if (i < 0) list.push(self);
      else if (list[i].updatedAt < mine.at) list[i] = self;
    }
    return list;
  });

  readonly others = computed(() => this.pins().filter((p) => p.member.id !== this.session.member()?.id));

  constructor() {
    usePolling(() => this.load(), 20_000);
    effect(() => {
      const el = this.host()?.nativeElement;
      const pins = this.pins();
      if (!el) return;
      this.zone.runOutsideAngular(() => this.draw(el, pins));
    });
  }

  ngOnDestroy() {
    this.map?.remove();
    this.map = null;
  }

  async load() {
    const id = this.session.tripId();
    if (!id) return;
    try {
      const res = await this.api.familyMap(id);
      this.live.set(res.live);
      this.locations.set(res.locations);
      this.loaded.set(true);
    } catch {
      /* keep the last map; the next poll retries */
    }
  }

  private draw(el: HTMLDivElement, pins: MemberLocation[]) {
    if (!this.map) {
      this.map = L.map(el, { zoomControl: false, attributionControl: true }).setView([39.8, -98.6], 3);
      L.control.zoom({ position: 'bottomright' }).addTo(this.map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(this.map);
      this.layer = L.layerGroup().addTo(this.map);
      // The container can size itself after the first paint (tabs, safe areas).
      setTimeout(() => this.map?.invalidateSize(), 0);
    }
    const meId = this.session.member()?.id;
    this.layer!.clearLayers();
    const now = Date.now();
    for (const p of pins) {
      const isMe = p.member.id === meId;
      const stale = now - p.updatedAt > STALE_MS;
      const m = p.member;
      const face = m.avatarUrl
        ? `<img src="${esc(m.avatarUrl)}" alt="">`
        : m.emoji
          ? `<span class="map-pin__emoji">${esc(m.emoji)}</span>`
          : esc(initials(m.name));
      const icon = L.divIcon({
        className: 'map-pin-wrap',
        html: `<div class="map-pin${isMe ? ' map-pin--me' : ''}${stale ? ' map-pin--stale' : ''}" style="--hue:${avatarHue(m.name)}" data-member="${esc(m.id)}">
            <div class="map-pin__face">${face}</div><div class="map-pin__name">${esc(isMe ? 'You' : m.name)}</div></div>`,
        iconSize: [52, 70],
        iconAnchor: [26, 52],
        popupAnchor: [0, -50],
      });
      const dir = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
      L.marker([p.lat, p.lng], { icon, zIndexOffset: isMe ? 1000 : 0, title: m.name })
        .bindPopup(
          `<div class="map-pop"><strong>${esc(isMe ? 'You' : m.name)}</strong><div class="tiny">Last seen ${esc(relativeTime(new Date(p.updatedAt).toISOString()))}</div>` +
            (isMe ? '' : `<a href="${dir}" target="_blank" rel="noopener">🧭 Directions</a>`) +
            `</div>`,
        )
        .addTo(this.layer!);
      if (isMe && p.accuracy > 30 && p.accuracy < 2000) {
        L.circle([p.lat, p.lng], { radius: p.accuracy, color: '#007aff', weight: 1, fillOpacity: 0.08 }).addTo(this.layer!);
      }
    }
    if (!this.fitted && pins.length) {
      this.fitted = true;
      this.fitAll(pins);
    }
  }

  private fitAll(pins = this.pins()) {
    if (!this.map || !pins.length) return;
    if (pins.length === 1) this.map.setView([pins[0].lat, pins[0].lng], 15);
    else this.map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as L.LatLngTuple)), { padding: [60, 60], maxZoom: 16 });
  }

  showEveryone() {
    this.zone.runOutsideAngular(() => this.fitAll());
  }

  async centerOnMe() {
    this.error.set('');
    try {
      const pos = this.location.position() ?? (await this.location.locateOnce());
      this.zone.runOutsideAngular(() => this.map?.setView([pos.lat, pos.lng], 16));
    } catch (e: unknown) {
      this.error.set(problemText(e, "Couldn't find your location"));
    }
  }

  async toggleSharing() {
    this.error.set('');
    if (this.location.sharing()) {
      try {
        await this.location.disable();
      } catch (e: unknown) {
        this.error.set(messageOf(e, "Couldn't switch it off. Try again."));
      }
      return;
    }
    if (!readExplained()) {
      this.showExplain.set(true);
      return;
    }
    await this.turnOn();
  }

  async turnOn() {
    this.showExplain.set(false);
    markExplained();
    try {
      await this.location.enable();
      this.fitted = false;
    } catch (e: unknown) {
      this.error.set(problemText(e, "Couldn't share your location"));
    }
  }

  readonly isLive = computed(() => this.live() && !!this.letsGo.tripDay());
  readonly tripOver = computed(() => {
    const t = this.session.trip();
    return !!t && todayIso() > t.endDate;
  });
  /** "Sat, Jul 15": sharing ends at midnight after this day. */
  readonly lastDay = computed(() => {
    const t = this.session.trip();
    return t ? longDate(t.endDate) : '';
  });
}

function readExplained(): boolean {
  try {
    return localStorage.getItem(EXPLAINED_KEY) === '1';
  } catch {
    return false;
  }
}

function markExplained(): void {
  try {
    localStorage.setItem(EXPLAINED_KEY, '1');
  } catch {
    /* ignore */
  }
}
