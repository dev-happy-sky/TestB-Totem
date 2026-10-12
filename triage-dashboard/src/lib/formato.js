// Formato de datos del socio y de las mediciones para el panel del encargado (sin React, fácil de probar).

// "2002-03-15" (o "2002-03-15T10:00:00") → "15/03/2002", sin pasar por Date para no depender de la zona horaria.
export function formatearFechaISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// Hora local "HH:MM" de un instante ISO; '' si no es una fecha válida.
export function horaLocal(iso) {
  if (!iso) return ''; // new Date(null) sería 1970, no "sin fecha"
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? '' : fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Datos de contacto del socio: fecha de nacimiento y teléfono, omitiendo lo que no se conoce.
export function describirContacto(e) {
  return [
    e.fechaNacimiento && `Nacimiento: ${formatearFechaISO(e.fechaNacimiento)}`,
    e.telefono && `Tel. ${e.telefono}`,
  ].filter(Boolean).join(' · ');
}

export const etiquetaDias = (n) => (n == null ? 'Sin indicar' : `${n} ${n === 1 ? 'día' : 'días'}`);
