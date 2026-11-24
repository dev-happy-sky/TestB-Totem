// Categorías de presión arterial de la American Heart Association (2025) para el panel del encargado.
// Mismos umbrales que backend-totem/motor_aptitud.py (categoria_presion_aha) y reglas_aptitud.json.
// Las clases de Tailwind van escritas completas para que se incluyan al compilar.

const NIVELES = {
  grave:   { texto: 'Hipertensión grave',   color: 'text-red-900',    chip: 'bg-red-200 text-red-900' },
  etapa2:  { texto: 'Hipertensión etapa 2', color: 'text-red-700',    chip: 'bg-red-100 text-red-700' },
  etapa1:  { texto: 'Hipertensión etapa 1', color: 'text-orange-700', chip: 'bg-orange-100 text-orange-700' },
  elevada: { texto: 'Presión elevada',      color: 'text-yellow-700', chip: 'bg-yellow-100 text-yellow-700' },
  baja:    { texto: 'Presión baja',         color: 'text-blue-700',   chip: 'bg-blue-100 text-blue-700' },
  normal:  { texto: 'Presión normal',       color: 'text-green-700',  chip: 'bg-green-100 text-green-700' },
};

// Devuelve { texto, color, chip } o null si falta alguno de los dos valores.
export function nivelPresion(sistolica, diastolica) {
  const sis = parseFloat(sistolica);
  const dia = parseFloat(diastolica);
  if (Number.isNaN(sis) || Number.isNaN(dia)) return null;
  if (sis > 180 || dia > 120) return NIVELES.grave;
  if (sis >= 140 || dia >= 90) return NIVELES.etapa2;
  if (sis >= 130 || dia >= 80) return NIVELES.etapa1;
  if (sis >= 120) return NIVELES.elevada;
  if (sis < 90 || dia < 60) return NIVELES.baja;
  return NIVELES.normal;
}