// Trae las últimas noticias del portal oficial Duoc UC (https://www.duoc.cl/noticias/).
// Se ejecuta en el servidor del propio Next.js, así que no hay problemas de CORS.
// El sitio no expone API REST ni RSS útil, por eso se extraen título + enlace del HTML.
// Ante cualquier error devuelve una lista vacía: la UI muestra entonces un enlace al portal.

export const revalidate = 1800; // cachea 30 min (no golpear el sitio en cada visita)

const ENTIDADES = {
  '&amp;': '&', '&#038;': '&', '&nbsp;': ' ',
  '&#8217;': '’', '&#8216;': '‘', '&#8220;': '“', '&#8221;': '”',
  '&#8211;': '–', '&#8212;': '—', '&hellip;': '…',
};
function decodificar(s) {
  return s.replace(/&[a-z#0-9]+;/gi, (e) => ENTIDADES[e] ?? e).replace(/\s+/g, ' ').trim();
}

export async function GET() {
  try {
    const res = await fetch('https://www.duoc.cl/noticias/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TotemFit/1.0)' },
      next: { revalidate },
    });
    if (!res.ok) return Response.json({ items: [] });
    const html = await res.text();

    // Títulos (class="card-title">Texto) y enlaces (?noticia_post_type=slug), emparejando
    // cada título con el primer enlace que aparece después de él en el HTML.
    const titulos = [...html.matchAll(/class="card-title">\s*([^<]+?)\s*</g)].map((m) => ({ i: m.index, t: decodificar(m[1]) }));
    const enlaces = [...html.matchAll(/href="(https:\/\/www\.duoc\.cl\/\?noticia_post_type=[^"]+)"/g)].map((m) => ({ i: m.index, u: m[1] }));

    const vistos = new Set();
    const items = [];
    for (const { i, t } of titulos) {
      if (!t) continue;
      const enlace = enlaces.find((l) => l.i > i);
      if (enlace && !vistos.has(enlace.u)) {
        vistos.add(enlace.u);
        items.push({ titulo: t, url: enlace.u });
      }
      if (items.length >= 5) break;
    }
    return Response.json({ items });
  } catch {
    return Response.json({ items: [] });
  }
}
