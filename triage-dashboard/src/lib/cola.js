// Lógica pura de la cola de evaluaciones del encargado (sin React, fácil de probar).

const PRIORIDAD = { A1: 1, A2: 2, A3: 3, A4: 4 };

export const FILTROS = [
  { id: 'todas', label: 'Todas' },
  { id: 'pendiente', label: 'Pendientes' },
  { id: 'revisada', label: 'Revisadas' },
  { id: 'derivada', label: 'Derivadas' },
];

// Compatibilidad: evaluaciones guardadas antes de `estadoRevision` solo traen `estado`.
export const estadoRevision = (e) => e.estadoRevision || (e.estado === 'validado' ? 'revisada' : 'pendiente');

export const alertaPendiente = (e) => Boolean(e.alerta) && !e.alertaRevisada;

const esCritica = (e) => e.alertaNivel === 'critica' && !e.alertaRevisada;
const prioridad = (e) => PRIORIDAD[e.nivelFinal || e.iaSugerida] || 5;

// R.123: por riesgo (pendientes primero, alertas críticas sin revisar, luego A1 → A4) o por fecha.
export function ordenarCola(cola, orden = 'riesgo') {
  const copia = [...cola];
  if (orden === 'reciente') {
    return copia.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  }
  return copia.sort((a, b) => {
    const cerradoA = estadoRevision(a) === 'pendiente' ? 0 : 1;
    const cerradoB = estadoRevision(b) === 'pendiente' ? 0 : 1;
    if (cerradoA !== cerradoB) return cerradoA - cerradoB;
    if (esCritica(a) !== esCritica(b)) return esCritica(a) ? -1 : 1;
    return prioridad(a) - prioridad(b);
  });
}

// R.135: lista de evaluaciones pendientes / revisadas / derivadas.
export function filtrarCola(cola, filtro = 'todas') {
  return filtro === 'todas' ? cola : cola.filter((e) => estadoRevision(e) === filtro);
}

const METRICAS = [
  { clave: 'peso', etiqueta: 'Peso', unidad: 'kg' },
  { clave: 'presionSys', etiqueta: 'PA sistólica', unidad: 'mmHg' },
  { clave: 'presionDia', etiqueta: 'PA diastólica', unidad: 'mmHg' },
  { clave: 'fcReposo', etiqueta: 'FC reposo', unidad: 'lpm' },
  { clave: 'imc', etiqueta: 'IMC', unidad: 'kg/m²' },
  { clave: 'grasa', etiqueta: 'Grasa', unidad: '%' },
];

// R.130: evaluaciones anteriores del mismo socio, de la más reciente a la más antigua.
export function evaluacionesPrevias(actual, historial) {
  return (historial || [])
    .filter((h) => h.idBaseDatos !== actual.idBaseDatos && (h.fecha || '') < (actual.fecha || ''))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

// R.131: cómo cambiaron las mediciones respecto de la evaluación anterior. null si no hay anterior.
export function calcularTendencia(actual, historial) {
  const [anterior] = evaluacionesPrevias(actual, historial);
  if (!anterior) return null;
  return METRICAS.map(({ clave, etiqueta, unidad }) => {
    const ahora = parseFloat(actual.mediciones?.[clave]);
    const antes = parseFloat(anterior.mediciones?.[clave]);
    if (Number.isNaN(ahora) || Number.isNaN(antes)) return null;
    return { clave, etiqueta, unidad, actual: ahora, anterior: antes, delta: Math.round((ahora - antes) * 10) / 10 };
  }).filter(Boolean);
}
