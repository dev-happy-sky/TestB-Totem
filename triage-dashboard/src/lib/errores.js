// Mensajes de error del inicio de sesión, pensados para que quien los lee sepa qué corregir (sin React).

const detalle = (datos) => (typeof datos?.detail === 'string' && datos.detail.trim() ? datos.detail : null);

// Qué responde el servidor cuando falla el login. `estado` es el código HTTP; `datos`, el cuerpo JSON (o {}).
export function mensajeErrorLogin(estado, datos = {}) {
  if (estado === 404) {
    return 'El servidor no tiene el inicio de sesión: el backend publicado está desactualizado. Hay que desplegar la última versión.';
  }
  if (estado === 401) return detalle(datos) || 'Credenciales inválidas.';
  if (estado === 403) return detalle(datos) || 'No tienes permiso para entrar.';
  if (estado === 422) return 'Revisa el usuario y la contraseña: el formato no es válido.';
  if (estado === 429) return detalle(datos) || 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  if (estado >= 500) return `El servidor tuvo un error (código ${estado}). Revisa los registros del backend.`;
  return detalle(datos) || `No se pudo iniciar sesión (código ${estado}).`;
}

// Cuando ni siquiera hay respuesta: el backend está caído, la URL es otra o el navegador bloqueó la llamada por CORS.
export const MENSAJE_SIN_RESPUESTA =
  'No se pudo comunicar con el servidor. Revisa que el backend esté activo y que permita este dominio (CORS).';

// Servidor al que apunta el dashboard, sin rutas ni credenciales: sirve para detectar que se está usando otro backend.
export function describirServidor(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url || '');
  }
}
