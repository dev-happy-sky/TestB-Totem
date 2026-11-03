// IMC compacto: el estado (categoría OMS) en pequeño y una línea fina que cambia de
// color según ese estado. Misma lógica que la app del tótem.

const CATEGORIAS = [
  { max: 18.5, etiqueta: 'Peso insuficiente', texto: 'text-blue-500', linea: 'bg-blue-400' },
  { max: 25, etiqueta: 'Normopeso', texto: 'text-green-600', linea: 'bg-green-600' },
  { max: 30, etiqueta: 'Sobrepeso', texto: 'text-yellow-500', linea: 'bg-yellow-500' },
  { max: 35, etiqueta: 'Obesidad', texto: 'text-orange-500', linea: 'bg-orange-500' },
  { max: Infinity, etiqueta: 'Obesidad mórbida', texto: 'text-red-600', linea: 'bg-red-600' },
];

function categoriaDe(imc) {
  let i = 0;
  while (i < CATEGORIAS.length - 1 && imc >= CATEGORIAS[i].max) i++;
  return CATEGORIAS[i];
}

export default function BarraImc({ imc }) {
  const valor = Number(imc);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  const cat = categoriaDe(valor);
  return (
    <div aria-label={`IMC ${valor.toFixed(1)}, ${cat.etiqueta}`}>
      <p className={`text-xs font-bold ${cat.texto} mb-1`}>IMC {valor.toFixed(1)} · {cat.etiqueta}</p>
      <div className={`h-1.5 rounded-full ${cat.linea}`} />
    </div>
  );
}
