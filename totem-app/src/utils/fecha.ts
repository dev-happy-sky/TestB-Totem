const EDAD_MAXIMA = 120;

const edadCumplida = (nacimiento: Date, hoy: Date) => {
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  if (hoy.getMonth() < nacimiento.getMonth() || (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate())) edad -= 1;
  return edad;
};

/**
 * Convierte "DD/MM/AAAA" (también acepta "-" o ".") a "AAAA-MM-DD". Devuelve null si no es una fecha real,
 * es futura o corresponde a más de 120 años (mismo criterio que el backend).
 */
export function parseFechaNacimiento(texto: string, hoy: Date = new Date()): string | null {
  const m = /^\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\s*$/.exec(texto ?? '');
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = Number(m[3]);
  const fecha = new Date(anio, mes - 1, dia);
  if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null; // p. ej. 30/02
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (fecha > inicioHoy || edadCumplida(fecha, inicioHoy) > EDAD_MAXIMA) return null;
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** "AAAA-MM-DD" → "DD/MM/AAAA" (sin pasar por Date, para no depender de la zona horaria). */
export function isoADisplay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

const PATRON_TELEFONO = /^\+?[\d\s\-()]{6,29}$/;

/** El teléfono es opcional: vacío es válido; si se escribe, debe tener formato de teléfono. */
export function telefonoValido(telefono: string): boolean {
  const limpio = (telefono ?? '').trim();
  return limpio === '' || PATRON_TELEFONO.test(limpio);
}
