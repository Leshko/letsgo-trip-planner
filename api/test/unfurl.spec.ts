import { parseUnfurl } from '../src/unfurl/unfurl.parser';
import { isPrivate } from '../src/unfurl/unfurl.service';

describe('unfurl parser', () => {
  const html = `<!doctype html><html><head>
    <title>Fallback &amp; Title</title>
    <meta property="og:title" content="Emerald Bay Kayak Tours" />
    <meta property="og:description" content='Two hours on the water &#39;with&#39; the kids'>
    <meta property="og:site_name" content="Tahoe Adventures">
    <meta property="og:image" content="/img/cover.jpg">
    <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
    <link rel="icon" href="/favicon.png">
  </head><body>
    <img src="/sprite.png"><img src="pixel.gif" width="1" height="1">
    <img data-src="https://cdn.example.com/gallery/1.jpg" class="photo">
    <img src="/gallery/2.jpg">
  </body></html>`;

  it('prefers Open Graph and resolves relative URLs', () => {
    const u = parseUnfurl(
      html,
      'https://www.tahoe-adventures.example/tours/kayak',
    );
    expect(u.title).toBe('Emerald Bay Kayak Tours');
    expect(u.description).toBe("Two hours on the water 'with' the kids");
    expect(u.siteName).toBe('Tahoe Adventures');
    expect(u.image).toBe('https://www.tahoe-adventures.example/img/cover.jpg');
    expect(u.images).toEqual([
      'https://www.tahoe-adventures.example/img/cover.jpg',
      'https://cdn.example.com/tw.jpg',
      'https://cdn.example.com/gallery/1.jpg',
      'https://www.tahoe-adventures.example/gallery/2.jpg',
    ]);
    expect(u.icon).toBe('https://www.tahoe-adventures.example/favicon.png');
  });

  it('falls back to <title> and the hostname', () => {
    const u = parseUnfurl(
      '<html><head><title>Just a &lt;page&gt;</title></head><body></body></html>',
      'https://www.plain.example/x',
    );
    expect(u.title).toBe('Just a <page>');
    expect(u.siteName).toBe('plain.example');
    expect(u.images).toEqual([]);
  });

  it('knows private addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.9',
      '192.168.86.113',
      '169.254.169.254',
      '::1',
      '::ffff:192.168.1.1',
      'fd00::1',
    ]) {
      expect(isPrivate(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '104.16.0.1', '2606:4700::1111'])
      expect(isPrivate(ip)).toBe(false);
  });
});
