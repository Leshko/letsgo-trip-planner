import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { dateRangeLabel } from '../../core/format';

interface AdminMember {
  id: string;
  name: string;
  emoji: string;
  avatarUrl: string;
  isOwner: boolean;
  joinedAt: string;
  counts: { votes: number; ideas: number; comments: number; photos: number; posts: number };
  mergedDevices: number;
}

interface AdminTrip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  inviteCode: string;
  createdAt: string;
  lastActivityAt: string | null;
  counts: { members: number; ideas: number; photos: number; posts: number };
  members: AdminMember[];
}

const KEY_STORE = 'letsgo.adminKey';

/** Server-wide admin: every trip, join links, and merging a rejoined person back into their old spot. */
@Component({
  selector: 'app-admin',
  imports: [FormsModule],
  template: `
    <div class="page">
      <div class="row mt" style="justify-content:space-between;align-items:center">
        <h1>Admin</h1>
        @if (key()) { <button class="btn btn--ghost btn--sm" type="button" (click)="forget()">Lock</button> }
      </div>

      @if (!key()) {
        <form class="card mt stack-v" (ngSubmit)="unlock()">
          <p class="muted">Type the admin key from the <code>ADMIN_KEY</code> line in letsgo.env on your server.</p>
          <div class="field">
            <label for="akey">Admin key</label>
            <input id="akey" class="input" name="akey" type="password" [(ngModel)]="keyInput" autocomplete="current-password" required data-testid="admin-key" />
          </div>
          @if (error()) { <p class="error" data-testid="admin-error">{{ error() }}</p> }
          <button class="btn btn--primary btn--block" type="submit" [disabled]="busy() || !keyInput">{{ busy() ? 'Checking…' : 'Unlock' }}</button>
        </form>
      } @else {
        @if (error()) { <p class="card card--flat mt error">{{ error() }}</p> }
        <p class="muted mt">{{ trips().length }} {{ trips().length === 1 ? 'trip' : 'trips' }}</p>
        <div class="stack-v" style="gap:12px">
          @for (t of trips(); track t.id) {
            <section class="card stack-v" style="gap:10px" [attr.data-testid]="'admin-trip-' + t.inviteCode">
              <div>
                <div class="row" style="justify-content:space-between;gap:8px">
                  <h2 style="margin:0">{{ t.name }}</h2>
                  <span class="chip">{{ t.inviteCode }}</span>
                </div>
                <div class="tiny">{{ t.destination || 'No destination' }} · {{ range(t) }}</div>
                <div class="tiny">{{ t.counts.members }} people · {{ t.counts.ideas }} ideas · {{ t.counts.photos }} photos · {{ t.counts.posts }} posts · last active {{ ago(t.lastActivityAt || t.createdAt) }}</div>
              </div>

              <div class="row" style="gap:8px">
                <input class="input grow" readonly [value]="joinLink(t)" (focus)="$any($event.target).select()" aria-label="Join link" />
                <button class="btn btn--sm" type="button" (click)="copy(t)" data-testid="copy-link">Copy</button>
                <button class="btn btn--sm btn--tinted" type="button" (click)="share(t)">Share</button>
              </div>

              <button class="btn btn--ghost btn--sm" type="button" style="align-self:flex-start" (click)="toggle(t.id)">
                {{ open() === t.id ? 'Hide people' : 'People and duplicates (' + t.members.length + ')' }}
              </button>

              @if (open() === t.id) {
                <ul class="list-plain stack-v" style="gap:8px">
                  @for (m of t.members; track m.id) {
                    <li class="row" style="gap:10px;align-items:flex-start">
                      <span class="admin-av">{{ m.emoji || m.name.slice(0, 1).toUpperCase() }}</span>
                      <div class="grow">
                        <div><strong>{{ m.name }}</strong> @if (m.isOwner) { <span class="chip">organizer</span> }</div>
                        <div class="tiny">joined {{ ago(m.joinedAt) }} · {{ m.counts.votes }} votes · {{ m.counts.ideas }} ideas · {{ m.counts.comments }} comments · {{ m.counts.photos }} photos{{ m.mergedDevices ? ' · ' + m.mergedDevices + ' merged device' + (m.mergedDevices > 1 ? 's' : '') : '' }}</div>
                      </div>
                    </li>
                  }
                </ul>

                @if (t.members.length > 1) {
                  <div class="card card--flat stack-v" style="gap:8px" data-testid="merge-panel">
                    <strong>Someone rejoined as a new person?</strong>
                    <p class="tiny">Pick the new spot they made, then their original one. Everything they did moves to the original, and their phone opens the original from now on.</p>
                    <div class="field">
                      <label [for]="'from-' + t.id">New spot (will be removed)</label>
                      <select class="input" [id]="'from-' + t.id" [name]="'from-' + t.id" [(ngModel)]="fromId" data-testid="merge-from">
                        <option value="">Choose…</option>
                        @for (m of t.members; track m.id) { <option [value]="m.id">{{ m.name }} (joined {{ ago(m.joinedAt) }})</option> }
                      </select>
                    </div>
                    <div class="field">
                      <label [for]="'into-' + t.id">Original spot (kept)</label>
                      <select class="input" [id]="'into-' + t.id" [name]="'into-' + t.id" [(ngModel)]="intoId" data-testid="merge-into">
                        <option value="">Choose…</option>
                        @for (m of t.members; track m.id) { <option [value]="m.id" [disabled]="m.id === fromId">{{ m.name }} (joined {{ ago(m.joinedAt) }})</option> }
                      </select>
                    </div>
                    @if (preview(t); as p) { <p class="tiny" data-testid="merge-preview">{{ p }}</p> }
                    <button class="btn btn--primary" type="button" (click)="merge(t)" [disabled]="busy() || !fromId || !intoId || fromId === intoId" data-testid="merge-btn">
                      {{ busy() ? 'Merging…' : 'Merge' }}
                    </button>
                  </div>
                }
              }
            </section>
          } @empty {
            <div class="card card--flat empty">No trips yet.</div>
          }
        </div>
      }
      @if (toast()) { <div class="toast" role="status" data-testid="admin-toast">{{ toast() }}</div> }
    </div>
  `,
  styles: [`.admin-av { width: 32px; height: 32px; border-radius: 50%; background: var(--fill-2, #e5e5ea); display: grid; place-items: center; font-weight: 700; flex: none; }`],
})
export class AdminComponent {
  private readonly http = inject(HttpClient);

  readonly key = signal(readKey());
  readonly trips = signal<AdminTrip[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly toast = signal('');
  readonly open = signal<string | null>(null);
  readonly byId = computed(() => new Map(this.trips().flatMap((t) => t.members.map((m) => [m.id, m] as const))));
  keyInput = '';
  fromId = '';
  intoId = '';

  constructor() {
    if (this.key()) void this.load();
  }

  private headers() {
    return { headers: new HttpHeaders({ 'X-Admin-Key': this.key() }) };
  }

  async unlock() {
    this.busy.set(true);
    this.error.set('');
    try {
      this.key.set(this.keyInput.trim());
      await firstValueFrom(this.http.get('/api/admin/check', this.headers()));
      writeKey(this.key());
      this.keyInput = '';
      await this.load();
    } catch (e: unknown) {
      this.key.set('');
      this.error.set(messageOf(e));
    } finally {
      this.busy.set(false);
    }
  }

  async load() {
    try {
      this.trips.set(await firstValueFrom(this.http.get<AdminTrip[]>('/api/admin/trips', this.headers())));
      this.error.set('');
    } catch (e: unknown) {
      if ((e as HttpErrorResponse).status === 401) this.forget();
      this.error.set(messageOf(e));
    }
  }

  forget() {
    writeKey('');
    this.key.set('');
    this.trips.set([]);
  }

  toggle(id: string) {
    this.open.set(this.open() === id ? null : id);
    this.fromId = '';
    this.intoId = '';
  }

  joinLink(t: AdminTrip) {
    return `${location.origin}/join/${t.inviteCode}`;
  }

  async copy(t: AdminTrip) {
    try {
      await navigator.clipboard.writeText(this.joinLink(t));
      this.flash('Join link copied');
    } catch {
      this.flash('Select the link and copy it');
    }
  }

  async share(t: AdminTrip) {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: t.name, text: `Join "${t.name}" on LetsGo Together`, url: this.joinLink(t) });
        return;
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return;
      }
    }
    await this.copy(t);
  }

  preview(t: AdminTrip): string {
    const from = this.byId().get(this.fromId);
    const into = this.byId().get(this.intoId);
    if (!from || !into || from.id === into.id || !t.members.some((m) => m.id === from.id)) return '';
    const c = from.counts;
    return `${from.name}'s ${c.votes} votes, ${c.ideas} ideas, ${c.comments} comments and ${c.photos} photos move to ${into.name}. ${from.name}'s phone will open ${into.name}'s spot. The name ${into.name} is kept.`;
  }

  async merge(t: AdminTrip) {
    const from = this.byId().get(this.fromId);
    const into = this.byId().get(this.intoId);
    if (!from || !into) return;
    if (!confirm(`Merge "${from.name}" into "${into.name}"? This can't be undone.`)) return;
    this.busy.set(true);
    try {
      const r = await firstValueFrom(
        this.http.post<{ trip: AdminTrip; moved: Record<string, number> }>(
          `/api/admin/trips/${t.id}/merge`,
          { fromMemberId: from.id, intoMemberId: into.id },
          this.headers(),
        ),
      );
      this.trips.update((list) => list.map((x) => (x.id === t.id ? r.trip : x)));
      this.fromId = '';
      this.intoId = '';
      const shown = ['votes', 'ideas', 'comments', 'photos', 'posts', 'plan entries', 'reactions'];
      const moved = Object.entries(r.moved)
        .filter(([k]) => shown.includes(k))
        .map(([k, n]) => `${n} ${k}`)
        .join(', ');
      this.flash(`Merged ${from.name} into ${into.name}${moved ? ` (${moved})` : ''}`);
    } catch (e: unknown) {
      this.error.set(messageOf(e));
    } finally {
      this.busy.set(false);
    }
  }

  range(t: AdminTrip) {
    return dateRangeLabel(t.startDate, t.endDate);
  }

  ago(iso: string) {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  }

  private flash(msg: string) {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(''), 3500);
  }
}

function messageOf(e: unknown): string {
  const m = (e as { error?: { message?: string | string[] } })?.error?.message;
  return (Array.isArray(m) ? m[0] : m) ?? "Couldn't reach the server";
}

function readKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

function writeKey(v: string) {
  try {
    if (v) localStorage.setItem(KEY_STORE, v);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* ignore */
  }
}
