import { normalizarMatricula } from '../utils/matricula';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://totem-backend-g6yh.onrender.com';

export type EstadoRevision = 'pendiente' | 'revisada' | 'derivada';

/** Campos de la tabla `socios` que el tótem muestra y edita. */
export type DatosSocio = {
  nombre: string;
  apellido: string;
  fecha_nacimiento: string | null;
  telefono: string | null;
  plan_membresia: string | null;
  edad: number | null;
};

export type DatosRegistro = {
  matricula: string; nombre: string; apellido: string; fecha_nacimiento: string; telefono?: string; plan_membresia: string;
  confirmar_duplicado?: boolean;
};

export type CambiosSocio = Partial<{
  nombre: string; apellido: string; fecha_nacimiento: string; telefono: string; plan_membresia: string;
}>;

export type RespuestaIdentificacion =
  | { registrado: false; matricula: string }
  | {
      registrado: true;
      matricula: string;
      socio: DatosSocio;
      evaluacion_vigente: { fecha: string; estado: EstadoRevision } | null;
      evaluaciones_previas: { fecha: string; estado: EstadoRevision }[];
      vigencia_horas: number;
    };

export type Coincidencia = { nombre: string; plan_membresia: string | null; matricula: string };

export type ErrorApi = {
  ok: false;
  /** 0 = no hubo respuesta válida del servidor (red caída o respuesta que no es JSON). */
  status: number;
  /** Código de negocio del backend, p. ej. `posible_duplicado` o `matricula_registrada`. */
  code?: string;
  mensaje: string;
  coincidencias?: Coincidencia[];
};

export type ResultadoApi<T> = { ok: true; data: T } | ErrorApi;

function describirError(status: number, data: unknown): Omit<ErrorApi, 'ok' | 'status'> {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return { mensaje: detail };
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const d = detail as { code?: string; message?: string; coincidencias?: Coincidencia[] };
    return { code: d.code, mensaje: d.message ?? `Error ${status}`, coincidencias: d.coincidencias };
  }
  if (Array.isArray(detail)) {
    // 422 de validación: se muestra el primer mensaje, sin el prefijo técnico de pydantic.
    const primero = (detail[0] as { msg?: string } | undefined)?.msg ?? '';
    return { mensaje: primero.replace(/^Value error, /, '') || 'Revisa los datos ingresados.' };
  }
  return { mensaje: JSON.stringify(data) };
}

/**
 * Tiempo máximo de espera por llamada. Sin él, un servidor que no responde deja la pantalla en "Guardando…" para siempre. Es largo
 * a propósito: el servidor gratuito de Render tarda ~50 s en despertar si estuvo inactivo.
 */
export const TIEMPO_MAXIMO_MS = 45000;
export const MENSAJE_TIEMPO_AGOTADO = 'El servidor no respondió a tiempo. Revisa tu conexión e intenta nuevamente.';

async function llamar<T>(ruta: string, metodo: 'GET' | 'POST' | 'PUT', cuerpo?: unknown): Promise<ResultadoApi<T>> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);
  try {
    const respuesta = await fetch(`${API_URL}${ruta}`, {
      signal: control.signal,
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Totem-Key': process.env.EXPO_PUBLIC_TOTEM_KEY ?? '',
      },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    });
    const texto = await respuesta.text();
    let data: unknown;
    try {
      data = JSON.parse(texto);
    } catch {
      return { ok: false, status: 0, mensaje: `El servidor respondió texto no JSON (${respuesta.status}): ${texto.slice(0, 100)}` };
    }
    if (!respuesta.ok) return { ok: false, status: respuesta.status, ...describirError(respuesta.status, data) };
    return { ok: true, data: data as T };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return { ok: false, status: 0, mensaje: MENSAJE_TIEMPO_AGOTADO };
    const mensaje = error instanceof Error && error.message ? error.message : 'No se pudo comunicar con el servidor central.';
    return { ok: false, status: 0, mensaje };
  } finally {
    clearTimeout(temporizador);
  }
}

export const identificarSocio = (matricula: string) =>
  llamar<RespuestaIdentificacion>('/api/socios/identificar', 'POST', { matricula });

export const registrarSocio = (datos: DatosRegistro) => llamar<{ status: string; socio: DatosSocio; matricula: string }>('/api/socios', 'POST', datos);

export const actualizarSocio = (matricula: string, cambios: CambiosSocio) =>
  llamar<{ status: string; cambios: string[]; socio: DatosSocio }>(`/api/socios/${normalizarMatricula(matricula)}`, 'PUT', cambios);

export const enviarEvaluacion = (payload: unknown) =>
  llamar<{ status: string; sesion_id: string }>('/api/evaluaciones', 'POST', payload);
