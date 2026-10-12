// Presentación de la sugerencia de IA y comparación con la decisión del encargado (sin React, fácil de probar).

export const CATEGORIAS = {
  A1: { nombre: 'Requiere evaluación médica', corto: 'Riesgo' },
  A2: { nombre: 'Apto con precaución', corto: 'Precaución' },
  A3: { nombre: 'Apto con intensidad moderada', corto: 'Apto mod.' },
  A4: { nombre: 'Apto', corto: 'Apto' },
};

export const nombreCategoria = (categoria) => CATEGORIAS[categoria]?.nombre ?? 'Sin clasificar';

export const UMBRAL_BAJA_CONFIANZA = 0.7; // el mismo valor de reglas_aptitud.json; el servidor decide `requiereRevision`

// 0.85 → 85. null si el servidor no informó la confianza.
export function porcentajeConfianza(confianza) {
  return typeof confianza === 'number' && Number.isFinite(confianza) ? Math.round(confianza * 100) : null;
}

export function nivelConfianza(confianza) {
  if (porcentajeConfianza(confianza) === null) return 'sin-dato';
  return confianza < UMBRAL_BAJA_CONFIANZA ? 'baja' : 'alta';
}

const cerrada = (e) => e.estado === 'validado' && Boolean(e.nivelFinal) && Boolean(e.iaSugerida);

// R.110: qué sugirió la IA y qué decidió el encargado. null mientras el caso sigue abierto.
export function compararConIA(e) {
  if (!cerrada(e)) return null;
  return {
    categoriaIA: e.iaSugerida,
    categoriaFinal: e.nivelFinal,
    coincide: e.iaSugerida === e.nivelFinal,
    decision: e.decisionPersonal ?? null,
  };
}

// Coincidencia entre la IA y el encargado en los casos ya cerrados.
export function coincidenciaIA(cola) {
  const comparaciones = cola.map(compararConIA).filter(Boolean);
  const coinciden = comparaciones.filter((c) => c.coincide).length;
  return {
    total: comparaciones.length,
    coinciden,
    porcentaje: comparaciones.length === 0 ? null : Math.round((coinciden / comparaciones.length) * 100),
  };
}

export const ETIQUETA_SEVERIDAD = { leve: 'Leve', precaucion: 'Precaución', critico: 'Crítico' };
