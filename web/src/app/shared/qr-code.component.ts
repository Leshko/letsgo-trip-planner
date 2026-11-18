import { Component, effect, input, signal } from '@angular/core';

/**
 * A QR code of a link, drawn on this device (nothing is sent anywhere).
 * "Save image" makes a picture with the name and code under it, for printing or texting.
 */
@Component({
  selector: 'app-qr-code',
  template: `
    <div class="qr" data-testid="qr">
      @if (src(); as s) {
        <img class="qr__img" [src]="s" [alt]="'QR code to join ' + title()" width="220" height="220" data-testid="qr-img" [attr.data-link]="link()" />
        <button class="btn btn--tinted btn--sm" type="button" (click)="save()" data-testid="qr-save">Save image</button>
      } @else if (failed()) {
        <p class="tiny">Couldn't draw the QR code. The link and code above still work.</p>
      } @else {
        <div class="qr__img qr__img--loading" aria-hidden="true"></div>
      }
    </div>
  `,
})
export class QrCodeComponent {
  /** What scanning opens. */
  readonly link = input.required<string>();
  /** Printed under the code in the saved image. */
  readonly title = input('');
  readonly caption = input('');
  readonly src = signal('');
  readonly failed = signal(false);

  constructor() {
    effect(() => {
      const link = this.link();
      this.src.set('');
      this.failed.set(false);
      void draw(link).then(
        (url) => {
          if (link === this.link()) this.src.set(url);
        },
        () => this.failed.set(true),
      );
    });
  }

  /** A printable card: the QR code with the name and invite code under it. */
  async save() {
    try {
      const qr = await loadImage(await draw(this.link(), 880));
      const W = 1080;
      const H = 1350;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      if (!g) throw new Error('no canvas');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
      g.drawImage(qr, (W - 880) / 2, 70, 880, 880);
      g.fillStyle = '#111111';
      g.textAlign = 'center';
      g.font = '600 64px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.fillText(fit(g, this.title() || 'LetsGo Together', W - 120), W / 2, 1060);
      g.fillStyle = '#555555';
      g.font = '44px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.fillText(fit(g, this.caption() || 'Scan to join', W - 120), W / 2, 1140);
      g.fillStyle = '#0f8fb3';
      g.font = '600 40px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.fillText('LetsGo Together', W / 2, 1250);
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = `${(this.title() || 'letsgo').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'letsgo'}-qr.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      this.failed.set(true);
    }
  }
}

interface QrLib {
  toDataURL(text: string, options: object): Promise<string>;
}

async function draw(text: string, width = 440): Promise<string> {
  // The library is CommonJS: depending on the bundler it arrives as the module or under "default".
  const mod = (await import('qrcode')) as unknown as QrLib & { default?: QrLib };
  const QR = typeof mod.toDataURL === 'function' ? mod : mod.default;
  if (!QR) throw new Error('qr library');
  return QR.toDataURL(text, { width, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

/** Shorten text with an ellipsis until it fits the width. */
function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}
