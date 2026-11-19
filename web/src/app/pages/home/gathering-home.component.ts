import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { Activity, Photo, Post } from '../../core/models';
import { daysUntil, longDate, dateRangeLabel, todayIso } from '../../core/format';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { IconComponent } from '../../shared/icon.component';
import { AgoPipe } from '../../shared/pipes';

const ICONS: Partial<Record<Activity['type'], string>> = {
  joined: '👋',
  vote: '🙌',
  lodging: '📍',
  trip: '🎉',
  photo: '📷',
  post: '📝',
  selfie: '🤳',
};

/** Home for a gathering: when and where, who's coming, the wall and the photos. */
@Component({
  selector: 'app-gathering-home',
  imports: [RouterLink, AvatarComponent, IconComponent, AgoPipe],
  template: `
    @if (trip(); as t) {
      <div class="page" data-testid="gathering-home">
        <section class="card card--accent">
          <div class="tiny">{{ when() }}{{ t.lodging.checkIn ? ' · ' + t.lodging.checkIn : '' }}</div>
          <div class="countdown" data-testid="gathering-countdown">{{ countdown().big }}</div>
          <div class="muted">{{ countdown().label }}</div>
        </section>

        @if (t.lodging.name || t.lodging.address || t.lodging.checkIn || t.lodging.notes) {
          <section class="card card--sea mt" data-testid="where-when">
            <div class="row" style="align-items:flex-start">
              <span style="font-size:1.8rem" aria-hidden="true">📍</span>
              <div class="grow" style="min-width:0">
                <div class="tiny">Where &amp; when</div>
                <div style="font-weight:700">{{ t.lodging.name || t.destination || t.lodging.address }}</div>
                @if (t.lodging.address) { <div class="tiny">{{ t.lodging.address }}</div> }
                <div class="tiny"><strong>{{ when() }}{{ t.lodging.checkIn ? ' · starts ' + t.lodging.checkIn : '' }}</strong></div>
                @if (t.lodging.notes) { <p class="tiny" style="white-space:pre-wrap;margin-top:6px">{{ t.lodging.notes }}</p> }
              </div>
            </div>
            <div class="row row--wrap mt">
              @if (t.lodging.address) { <a class="btn btn--sm" [href]="directions(t.lodging.address)" target="_blank" rel="noopener">🧭 Directions</a> }
              <a class="btn btn--sm" routerLink="/trip/stay">Details</a>
            </div>
          </section>
        } @else {
          <a routerLink="/trip/stay" class="card card--flat row mt" style="text-decoration:none;color:inherit" data-testid="where-when-add">
            <span style="font-size:1.6rem">📍</span>
            <div class="grow"><strong>Add where &amp; when</strong><div class="tiny">The address, what time, what to bring</div></div>
            <span class="muted">›</span>
          </a>
        }

        <section class="card card--flat mt">
          <div class="tiny">Who's in · {{ t.members.length }}</div>
          <div class="who-row mt" style="margin-top:8px">
            @for (m of t.members; track m.id) {
              <span class="who"><app-avatar [member]="m" /><span class="tiny">{{ m.id === me()?.id ? 'You' : m.name }}</span></span>
            }
          </div>
        </section>

        <div class="today-actions mt">
          <a class="btn btn--tinted" routerLink="/trip/wall"><app-icon name="bubble" [size]="20" /> Post to the wall</a>
          <a class="btn btn--tinted" routerLink="/trip/wall" [queryParams]="{ poll: 1 }"><span aria-hidden="true">📊</span> Start a poll</a>
          <a class="btn btn--tinted" routerLink="/trip/photos"><app-icon name="camera" [size]="20" /> Add photos</a>
        </div>

        <div class="section-title"><h2>The wall</h2><a routerLink="/trip/wall">All posts ›</a></div>
        @if (loaded() && !posts().length) {
          <a routerLink="/trip/wall" class="card card--flat empty" style="display:block;text-decoration:none;color:inherit">
            <div class="big">💬</div>Quiet so far. Say hi, or ask who's bringing what.
          </a>
        }
        <div class="stack-v">
          @for (p of posts().slice(0, 3); track p.id) {
            <a [routerLink]="p.poll ? ['/trip/poll', p.id] : ['/trip/wall']" class="post" style="text-decoration:none;color:inherit">
              <app-avatar [member]="p.member" size="sm" />
              <div class="post__bubble"><span class="comment__who">{{ p.member.id === me()?.id ? 'You' : p.member.name }}</span><span class="tiny">{{ p.createdAt | ago }}</span>
                <div class="post__body" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">{{ p.poll ? '📊 Poll: ' : '' }}{{ p.body }}</div>
              </div>
            </a>
          }
        </div>

        <div class="section-title"><h2>Photos</h2><a routerLink="/trip/photos">Album ›</a></div>
        @if (photos().length) {
          <a routerLink="/trip/photos" class="home-photos" style="display:grid;text-decoration:none">
            @for (ph of photos().slice(0, 8); track ph.id) {
              <img [src]="ph.urls.thumb ?? ph.urls.preview ?? ph.urls.original" alt="" loading="lazy" />
            }
          </a>
        } @else if (loaded()) {
          <a routerLink="/trip/photos" class="card card--flat row" style="text-decoration:none;color:inherit">
            <span style="font-size:1.6rem">📷</span>
            <div class="grow"><strong>Start the album</strong><div class="tiny">Everyone adds their photos; anyone can download them all</div></div>
            <span class="muted">›</span>
          </a>
        }

        @if (feed().length) {
          <div class="section-title"><h2>What's happening</h2></div>
          <section class="card">
            <div class="feed">
              @for (a of feed(); track a.id) {
                <div class="feed__item">
                  <span class="feed__ico">{{ icons[a.type] ?? '✨' }}</span>
                  <app-avatar [member]="a.member" size="sm" />
                  <div class="grow">
                    <span class="feed__who">{{ a.member.id === me()?.id ? 'You' : a.member.name }}</span> {{ a.message }}
                    <div class="tiny">{{ a.createdAt | ago }}</div>
                  </div>
                </div>
              }
            </div>
          </section>
        }
      </div>
    }
  `,
})
export class GatheringHomeComponent {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);

  readonly trip = this.session.trip;
  readonly me = this.session.member;
  readonly posts = signal<Post[]>([]);
  readonly photos = signal<Photo[]>([]);
  readonly feed = signal<Activity[]>([]);
  readonly loaded = signal(false);
  readonly icons = ICONS;

  readonly when = computed(() => {
    const t = this.trip();
    if (!t) return '';
    return t.startDate === t.endDate ? longDate(t.startDate) : dateRangeLabel(t.startDate, t.endDate);
  });

  readonly countdown = computed(() => {
    const t = this.trip();
    if (!t) return { big: '', label: '' };
    const today = todayIso();
    const until = daysUntil(t.startDate);
    if (today > t.endDate) return { big: 'Done ✓', label: 'That was a good one. Add your photos to the album.' };
    if (today >= t.startDate) return { big: 'Today 🎉', label: `${t.name} is today. See you there!` };
    if (until === 1) return { big: 'Tomorrow', label: `${t.name} is tomorrow.` };
    return { big: `${until} days`, label: `until ${t.name}` };
  });

  constructor() {
    usePolling(() => this.load());
  }

  async load() {
    const id = this.session.tripId();
    if (!id) return;
    const [posts, photos, feed] = await Promise.all([this.api.listPosts(id), this.api.listPhotos(id), this.api.activity(id, 15)]);
    this.posts.set(posts);
    this.photos.set(photos);
    this.feed.set(feed);
    this.loaded.set(true);
  }

  directions(address: string): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }
}
